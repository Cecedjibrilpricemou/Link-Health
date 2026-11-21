import { randomUUID } from 'crypto';
import {
  EncounterStatus,
  Prisma,
  Role,
  SyncMutationStatus,
  SyncOperation,
} from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { hashPassword } from '../utils/password.utils';
import { assertCanAccessPatient } from './access-control.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';

export interface RecordSyncEventInput {
  scope: string;
  entityType: string;
  entityId?: string;
  operation: SyncOperation;
  payload?: unknown;
  idUtilisateur?: string;
  idStructure?: string;
}

type SyncMutationInput = {
  clientMutationId: string;
  deviceId?: string;
  entityType: string;
  entityId?: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  baseVersion?: number;
};

export async function recordSyncEvent(input: RecordSyncEventInput) {
  return prisma.syncEvent.create({
    data: {
      scope: input.scope,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      payload: input.payload as object | undefined,
      idUtilisateur: input.idUtilisateur,
      idStructure: input.idStructure,
    },
  });
}

export async function getSyncChanges(
  user: JwtPayload,
  params: { since?: Date; limit?: number; scope?: string }
) {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: user.userId },
    select: { idStructure: true },
  });

  const limit = Math.min(params.limit ?? 100, 500);
  const scope = params.scope ?? 'medical';

  const changes = await prisma.syncEvent.findMany({
    where: {
      scope,
      ...(params.since ? { creeLe: { gt: params.since } } : {}),
      OR: [
        { idUtilisateur: user.userId },
        ...(utilisateur?.idStructure ? [{ idStructure: utilisateur.idStructure }] : []),
        { idStructure: null, idUtilisateur: null },
      ],
    },
    take: limit,
    orderBy: { version: 'asc' },
  });

  return {
    data: changes,
    meta: {
      count: changes.length,
      lastVersion: changes.at(-1)?.version ?? null,
      serverTime: new Date().toISOString(),
    },
  };
}

export async function pushSyncMutations(user: JwtPayload, mutations: SyncMutationInput[]) {
  const results = [];

  for (const mutation of mutations) {
    const saved = await prisma.syncMutation.upsert({
      where: { clientMutationId: mutation.clientMutationId },
      update: {},
      create: {
        clientMutationId: mutation.clientMutationId,
        deviceId: mutation.deviceId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        operation: mutation.operation,
        payload: mutation.payload as Prisma.InputJsonValue,
        baseVersion: mutation.baseVersion,
        statut: SyncMutationStatus.RECU,
        idUtilisateur: user.userId,
      },
    });

    if (saved.statut !== SyncMutationStatus.RECU) {
      results.push(saved);
      continue;
    }

    results.push(await processMutation(user, saved.id, mutation));
  }

  return {
    data: results,
    meta: {
      accepted: results.length,
      processed: results.filter((item) => item.statut === SyncMutationStatus.TRAITE).length,
      rejected: results.filter((item) => item.statut === SyncMutationStatus.REJETE).length,
    },
  };
}

async function processMutation(user: JwtPayload, idMutation: string, mutation: SyncMutationInput) {
  try {
    const entityId = await applyMutation(user, mutation);

    await recordSyncEvent({
      scope: 'medical',
      entityType: mutation.entityType,
      entityId,
      operation: mutation.operation,
      idUtilisateur: user.userId,
      payload: mutation.payload,
    });

    return prisma.syncMutation.update({
      where: { id: idMutation },
      data: {
        statut: SyncMutationStatus.TRAITE,
        traiteLe: new Date(),
        entityId,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur traitement mutation';
    return prisma.syncMutation.update({
      where: { id: idMutation },
      data: {
        statut: SyncMutationStatus.REJETE,
        traiteLe: new Date(),
        erreur: message,
      },
    });
  }
}

/**
 * Ce que chaque role peut ecrire hors ligne, et rien d'autre.
 *
 * **Le canal de synchronisation etait generique.** Tout role admis sur la
 * route pouvait pousser n'importe quel type : un pharmacien, present ici pour
 * remonter son stock, pouvait creer une consultation, des constantes vitales
 * ou une vaccination. Le perimetre patient le bornait a ceux ayant une
 * ordonnance en attente -- c'est-a-dire, avant correction, a tout le pays.
 *
 * Une ecriture au dossier medical par un metier qui n'en a pas le role n'est
 * pas une question de perimetre : c'est une question de droit. La table ci-
 * dessous le dit une fois, pour tous les types a venir.
 */
const ENTITES_PAR_ROLE: Readonly<Record<string, readonly string[]>> = {
  ASC: ['PatientProfile', 'Consultation', 'ConstantesVitales', 'Vaccination'],
  ASC_SUPERVISOR: ['PatientProfile', 'Consultation', 'ConstantesVitales', 'Vaccination'],
  MEDECIN: ['PatientProfile', 'Consultation', 'ConstantesVitales', 'Vaccination'],
  SAGE_FEMME: ['PatientProfile', 'Consultation', 'ConstantesVitales', 'Vaccination'],
  // L'officine remonte son stock, et c'est tout ce qu'elle a a remonter.
  PHARMACIEN: ['Stock'],
  // L'administrateur de structure ne soigne pas : il n'ecrit pas de dossier.
  ADMIN_STRUCTURE: ['Stock'],
  // Le patient hors ligne ne modifie que sa propre fiche, et le perimetre
  // patient la borne deja a la sienne.
  PATIENT: ['PatientProfile'],
};

export function assertEntiteAutorisee(user: JwtPayload, entityType: string): void {
  const permis = ENTITES_PAR_ROLE[user.role] ?? [];
  if (!permis.includes(entityType)) {
    throw new ForbiddenError(
      `Votre role ne peut pas synchroniser des donnees de type ${entityType}`,
    );
  }
}

/**
 * Exportee pour que le test puisse verifier que le garde est **branche**, et
 * pas seulement qu'il est juste. Un test qui n'appelle que le garde laisse
 * retirer son appel sans rien signaler.
 */
export async function applyMutation(user: JwtPayload, mutation: SyncMutationInput): Promise<string | undefined> {
  if (mutation.operation === SyncOperation.DELETE) {
    throw new ForbiddenError('Suppression offline non autorisee sur les donnees medicales');
  }

  // **Avant toute lecture du contenu.** Un refus de droit ne doit pas dependre
  // de la validite du payload : sinon le message d'erreur renseigne sur ce
  // qu'on aurait pu ecrire.
  assertEntiteAutorisee(user, mutation.entityType);

  switch (mutation.entityType) {
    case 'PatientProfile':
      return upsertPatientFromSync(user, mutation);
    case 'Consultation':
      return createConsultationFromSync(user, mutation);
    case 'ConstantesVitales':
      return upsertVitalsFromSync(user, mutation);
    case 'Vaccination':
      return createVaccinationFromSync(user, mutation);
    case 'Stock':
      return updateStockFromSync(user, mutation);
    default:
      throw new ValidationError(`Type de ressource sync non supporte: ${mutation.entityType}`);
  }
}

async function upsertPatientFromSync(user: JwtPayload, mutation: SyncMutationInput) {
  const payload = mutation.payload;

  if (mutation.operation === SyncOperation.UPDATE) {
    if (!mutation.entityId) throw new ValidationError('entityId requis pour mise a jour patient');
    await assertCanAccessPatient(user, mutation.entityId);

    const updated = await prisma.patientProfile.update({
      where: { id: mutation.entityId },
      data: {
        ...(typeof payload.groupeSanguin === 'string' && { groupeSanguin: payload.groupeSanguin }),
        ...(Array.isArray(payload.allergies) && { allergies: payload.allergies as string[] }),
        ...(Array.isArray(payload.maladiesChroniques) && { maladiesChroniques: payload.maladiesChroniques as string[] }),
        ...(typeof payload.sousPrefecture === 'string' && { sousPrefecture: payload.sousPrefecture }),
        ...(typeof payload.village === 'string' && { village: payload.village }),
      },
    });

    return updated.id;
  }

  if (!['ASC', 'ASC_SUPERVISOR'].includes(user.role)) {
    throw new ForbiddenError('Seul un ASC peut creer un patient offline');
  }

  const telephone = String(payload.telephone ?? '');
  const prenom = String(payload.prenom ?? '');
  const nom = String(payload.nom ?? '');
  const dateNaissance = String(payload.dateNaissance ?? '');
  const sexe = String(payload.sexe ?? '');
  const prefecture = String(payload.prefecture ?? '');
  if (!telephone || !prenom || !nom || !dateNaissance || !sexe || !prefecture) {
    throw new ValidationError('Donnees patient offline incompletes');
  }

  const motDePasseHash = await hashPassword(`offline-${randomUUID()}`);

  const created = await prisma.$transaction(async (tx) => {
    const utilisateur = await tx.utilisateur.create({
      data: { telephone, prenom, nom, role: Role.PATIENT, motDePasseHash, doitChangerMotDePasse: true },
    });

    return tx.patientProfile.create({
      data: {
        idUtilisateur: utilisateur.id,
        dateNaissance: new Date(dateNaissance),
        sexe,
        prefecture,
        sousPrefecture: typeof payload.sousPrefecture === 'string' ? payload.sousPrefecture : undefined,
        village: typeof payload.village === 'string' ? payload.village : undefined,
        allergies: Array.isArray(payload.allergies) ? payload.allergies as string[] : [],
        maladiesChroniques: Array.isArray(payload.maladiesChroniques) ? payload.maladiesChroniques as string[] : [],
      },
    });
  });

  return created.id;
}

async function createConsultationFromSync(user: JwtPayload, mutation: SyncMutationInput) {
  if (!['ASC', 'ASC_SUPERVISOR'].includes(user.role)) throw new ForbiddenError('Seul un ASC peut creer une consultation offline');
  const asc = await prisma.ascProfile.findUnique({ where: { idUtilisateur: user.userId } });
  if (!asc) throw new NotFoundError('Profil ASC non trouve');

  const payload = mutation.payload;
  const idPatient = String(payload.idPatient ?? '');
  const motifPrincipal = String(payload.motifPrincipal ?? '');
  if (!idPatient || !motifPrincipal) throw new ValidationError('Donnees consultation incompletes');
  await assertCanAccessPatient(user, idPatient);

  const consultation = await prisma.consultation.create({
    data: {
      idPatient,
      idAsc: asc.id,
      motifPrincipal,
      symptomes: Array.isArray(payload.symptomes) ? payload.symptomes as string[] : [],
      notesAsc: typeof payload.notesAsc === 'string' ? payload.notesAsc : undefined,
      statut: EncounterStatus.EN_COURS,
    },
  });

  return consultation.id;
}

async function upsertVitalsFromSync(user: JwtPayload, mutation: SyncMutationInput) {
  const payload = mutation.payload;
  const idConsultation = String(payload.idConsultation ?? mutation.entityId ?? '');
  if (!idConsultation) throw new ValidationError('idConsultation requis');

  const existing = await prisma.constantesVitales.findUnique({ where: { idConsultation } });
  const data = {
    ...(typeof payload.temperature === 'number' && { temperature: payload.temperature }),
    ...(typeof payload.poidsKg === 'number' && { poidsKg: payload.poidsKg }),
    ...(typeof payload.tailleCm === 'number' && { tailleCm: payload.tailleCm }),
    ...(typeof payload.spo2 === 'number' && { spo2: payload.spo2 }),
    ...(typeof payload.frequenceCardiaque === 'number' && { frequenceCardiaque: payload.frequenceCardiaque }),
    ...(typeof payload.frequenceRespiratoire === 'number' && { frequenceRespiratoire: payload.frequenceRespiratoire }),
  };

  const vitals = existing
    ? await prisma.constantesVitales.update({ where: { idConsultation }, data })
    : await prisma.constantesVitales.create({ data: { idConsultation, ...data } });

  return vitals.id;
}

async function createVaccinationFromSync(user: JwtPayload, mutation: SyncMutationInput) {
  const payload = mutation.payload;
  const idPatient = String(payload.idPatient ?? '');
  const vaccinNom = String(payload.vaccinNom ?? '');
  if (!idPatient || !vaccinNom) throw new ValidationError('Donnees vaccination incompletes');
  await assertCanAccessPatient(user, idPatient);

  const vaccination = await prisma.vaccination.create({
    data: {
      idPatient,
      idAdministrePar: user.userId,
      vaccinNom,
      codeEpi: typeof payload.codeEpi === 'string' ? payload.codeEpi : undefined,
      numeroLot: typeof payload.numeroLot === 'string' ? payload.numeroLot : undefined,
      siteInjection: typeof payload.siteInjection === 'string' ? payload.siteInjection : undefined,
      reaction: typeof payload.reaction === 'string' ? payload.reaction : undefined,
      dateProchaineD: typeof payload.dateProchaineD === 'string' ? new Date(payload.dateProchaineD) : undefined,
    },
  });

  return vaccination.id;
}

async function updateStockFromSync(user: JwtPayload, mutation: SyncMutationInput) {
  if (!mutation.entityId) throw new ValidationError('entityId requis pour stock');
  const asc = await prisma.ascProfile.findUnique({ where: { idUtilisateur: user.userId } });
  if (!asc) throw new NotFoundError('Profil ASC non trouve');

  const stock = await prisma.stock.findFirst({ where: { id: mutation.entityId, idAsc: asc.id } });
  if (!stock) throw new NotFoundError('Stock non trouve dans le perimetre ASC');

  const quantite = Number(mutation.payload.quantite);
  if (!Number.isInteger(quantite) || quantite < 0) throw new ValidationError('Quantite stock invalide');

  const updated = await prisma.stock.update({
    where: { id: mutation.entityId },
    data: { quantite },
  });

  return updated.id;
}
