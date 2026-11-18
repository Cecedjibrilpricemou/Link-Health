import { randomUUID } from 'crypto';
import { NiveauIdentite, Role, SyncOperation } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { CreatePatientDto, PatientFilters, UpdatePatientDto } from '../types/patient.types';
import { generateTokenPair } from '../utils/jwt.utils';
import { hashPassword } from '../utils/password.utils';
import { assertCanAccessPatient, buildPatientWhereForUser } from './access-control.service';
import { recordSyncEvent } from './sync.service';
import { initialiserConsentementsParDefaut } from './privacy.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';

export async function createPatient(dto: CreatePatientDto) {
  const existing = await prisma.utilisateur.findUnique({ where: { telephone: dto.telephone } });
  if (existing) throw new ConflictError('Ce numero de telephone est deja utilise');

  const motDePasseHash = await hashPassword(dto.motDePasse);

  const result = await prisma.$transaction(async (tx) => {
    const utilisateur = await tx.utilisateur.create({
      data: {
        telephone: dto.telephone,
        motDePasseHash,
        prenom: dto.prenom,
        nom: dto.nom,
        role: Role.PATIENT,
      },
    });

    const patient = await tx.patientProfile.create({
      data: {
        idUtilisateur: utilisateur.id,
        dateNaissance: new Date(dto.dateNaissance),
        sexe: dto.sexe,
        prefecture: dto.prefecture,
        sousPrefecture: dto.sousPrefecture,
        village: dto.village,
        groupeSanguin: dto.groupeSanguin,
        allergies: dto.allergies ?? [],
        maladiesChroniques: dto.maladiesChroniques ?? [],
        urgenceNom: dto.urgenceNom,
        urgenceTelephone: dto.urgenceTelephone,
      },
      include: {
        utilisateur: {
          select: {
            id: true, telephone: true, email: true, prenom: true, nom: true,
            photoUrl: true, langue: true, role: true, estActif: true, creeLe: true,
          },
        },
      },
    });

    await initialiserConsentementsParDefaut(tx, patient.id, utilisateur.id);

    return { utilisateur, patient };
  });

  const sessionId = randomUUID();
  const tokenPair = generateTokenPair({
    userId: result.utilisateur.id,
    role: result.utilisateur.role,
    sessionId,
  });

  await prisma.session.create({
    data: {
      id: sessionId,
      refreshToken: tokenPair.refreshToken,
      expireLe: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      idUtilisateur: result.utilisateur.id,
    },
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'PatientProfile',
    entityId: result.patient.id,
    operation: SyncOperation.CREATE,
    idUtilisateur: result.utilisateur.id,
    payload: { prefecture: result.patient.prefecture },
  });

  return { tokenPair, patient: result.patient };
}

export async function getPatients(user: JwtPayload, filters: PatientFilters) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where = {
    AND: [
      await buildPatientWhereForUser(user),
      {
        ...(filters.prefecture && { prefecture: filters.prefecture }),
        ...(filters.search && {
          OR: [
            { utilisateur: { prenom: { contains: filters.search, mode: 'insensitive' as const } } },
            { utilisateur: { nom: { contains: filters.search, mode: 'insensitive' as const } } },
            { utilisateur: { telephone: { contains: filters.search } } },
          ],
        }),
      },
    ],
  };

  const [patients, total] = await Promise.all([
    prisma.patientProfile.findMany({
      where,
      skip,
      take: limit,
      include: {
        utilisateur: {
          select: { id: true, telephone: true, prenom: true, nom: true, email: true, photoUrl: true },
        },
      },
      orderBy: { creeLe: 'desc' },
    }),
    prisma.patientProfile.count({ where }),
  ]);

  return { data: patients, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

export async function getPatientById(user: JwtPayload, id: string) {
  await assertCanAccessPatient(user, id);

  const patient = await prisma.patientProfile.findUnique({
    where: { id },
    include: {
      utilisateur: {
        select: {
          id: true,
          telephone: true,
          email: true,
          prenom: true,
          nom: true,
          photoUrl: true,
          langue: true,
          creeLe: true,
        },
      },
    },
  });

  if (!patient) throw new NotFoundError('Patient non trouve');
  return patient;
}

/**
 * Retrouver un patient par son code QR.
 *
 * **Une ancienne carte doit continuer de fonctionner** (EF-01-06). Quand le
 * dossier a ete fusionne dans un autre, on amene au dossier survivant : c'est
 * lui qui porte l'histoire. Sans ce saut, la personne qui presente la carte
 * qu'elle a dans la poche tomberait sur un dossier vide, et on lui dirait
 * qu'elle n'a pas d'antecedents.
 *
 * Il n'y a jamais de chaine de fusion — un declencheur PostgreSQL l'interdit —
 * donc un seul saut suffit.
 */
export async function getPatientByQrCode(user: JwtPayload, qrCode: string) {
  const trouve = await prisma.patientProfile.findUnique({
    where: { qrCode },
    select: { id: true, idFusionneDans: true },
  });
  if (!trouve) throw new NotFoundError('Patient non trouve');

  const patient = await prisma.patientProfile.findUnique({
    where: { id: trouve.idFusionneDans ?? trouve.id },
    include: {
      utilisateur: {
        select: { id: true, telephone: true, email: true, prenom: true, nom: true, photoUrl: true },
      },
    },
  });

  if (!patient) throw new NotFoundError('Patient non trouve');
  await assertCanAccessPatient(user, patient.id);
  return patient;
}

/**
 * Le dossier du patient connecte.
 *
 * **Suit le lien de fusion** (EF-01-06) : quelqu'un dont le dossier a ete
 * absorbe se connecte avec son ancien compte, et doit voir son dossier — pas
 * une coquille vide. C'est la meme personne, c'est la premisse de la fusion.
 */
export async function getMyProfile(userId: string) {
  const sien = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true, idFusionneDans: true },
  });

  const patient = await prisma.patientProfile.findUnique({
    where: sien?.idFusionneDans ? { id: sien.idFusionneDans } : { idUtilisateur: userId },
    include: {
      utilisateur: {
        select: { id: true, telephone: true, email: true, prenom: true, nom: true, photoUrl: true, langue: true },
      },
      structurePreferee: {
        select: { id: true, nom: true, type: true, prefecture: true, adresse: true, telephone: true },
      },
    },
  });

  if (!patient) throw new NotFoundError('Profil patient non trouve');
  return patient;
}

/**
 * Le patient peut-il changer lui-meme son prenom ou son nom ?
 *
 * Tant que son identite est provisoire, oui : c'est lui qui la declare. Une
 * fois verifiee sur piece, non : le nom est celui que l'agent a lu, et le
 * changer sans trace annulerait la verification. Il passe alors par
 * l'accueil, qui corrige avec un motif (R15). Un dossier absorbe par une
 * fusion n'est plus le sien : la meme porte.
 *
 * Exportee : `PUT /auth/profile` change aussi le nom, et doit tenir la meme regle.
 */
export async function assertNomModifiableParLePatient(
  userId: string,
  souhait: { prenom?: string; nom?: string },
): Promise<void> {
  if (!souhait.prenom && !souhait.nom) return;
  const actuel = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: { prenom: true, nom: true, patientProfile: { select: { idFusionneDans: true, niveauIdentite: true } } },
  });
  if (!actuel?.patientProfile) return;
  const change = (souhait.prenom && souhait.prenom.trim() !== actuel.prenom)
    || (souhait.nom && souhait.nom.trim() !== actuel.nom);
  if (!change) return;

  if (actuel.patientProfile.idFusionneDans || actuel.patientProfile.niveauIdentite === NiveauIdentite.VERIFIEE) {
    throw new ForbiddenError(
      "Votre identite a ete verifiee sur piece : pour corriger votre nom, adressez-vous a l'accueil de votre structure"
    );
  }
}

/** Une chaine videe efface le champ : `''` devient `null`. */
function vidable(valeur: string | undefined): string | null | undefined {
  if (valeur === undefined) return undefined;
  return valeur.trim() === '' ? null : valeur.trim();
}

export async function updateMyProfile(userId: string, dto: UpdatePatientDto) {
  const sien = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true, idFusionneDans: true },
  });
  if (!sien) throw new NotFoundError('Profil patient non trouve');
  await assertNomModifiableParLePatient(userId, { prenom: dto.prenom, nom: dto.nom });
  // Apres une fusion, le patient lit le dossier principal (getMyProfile) :
  // c'est la qu'il doit aussi ecrire, sinon ses changements partent dans un
  // dossier que plus personne ne lit.
  const idDossier = sien.idFusionneDans ?? sien.id;

  const champsVidables = ['groupeSanguin', 'sousPrefecture', 'village', 'urgenceNom', 'urgenceTelephone'] as const;
  const updated = await prisma.$transaction(async (tx) => {
    if (dto.prenom || dto.nom || dto.email || dto.langue || dto.photoUrl) {
      await tx.utilisateur.update({
        where: { id: userId },
        data: {
          ...(dto.prenom && { prenom: dto.prenom }),
          ...(dto.nom && { nom: dto.nom }),
          ...(dto.email && { email: dto.email }),
          ...(dto.langue && { langue: dto.langue }),
          ...(dto.photoUrl && { photoUrl: dto.photoUrl }),
        },
      });
    }

    const data: Record<string, unknown> = {};
    for (const champ of champsVidables) {
      const valeur = vidable(dto[champ]);
      if (valeur !== undefined) data[champ] = valeur;
    }
    // Une liste vide est une reponse : « aucune allergie connue ».
    if (dto.allergies !== undefined) data['allergies'] = dto.allergies;
    if (dto.maladiesChroniques !== undefined) data['maladiesChroniques'] = dto.maladiesChroniques;

    return tx.patientProfile.update({
      where: { id: idDossier },
      data,
      include: {
        utilisateur: {
          select: { id: true, telephone: true, email: true, prenom: true, nom: true, photoUrl: true, langue: true },
        },
      },
    });
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'PatientProfile',
    entityId: updated.id,
    operation: SyncOperation.UPDATE,
    idUtilisateur: userId,
    payload: dto,
  });

  return updated;
}

export async function exportPatientDossier(userId: string) {
  const patient = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    include: {
      utilisateur: {
        select: {
          id: true, telephone: true, email: true, prenom: true, nom: true,
          photoUrl: true, langue: true, role: true, creeLe: true,
        },
      },
      consultations: {
        include: { constantes: true, diagnostics: true, ordonnances: { include: { lignes: { include: { medicament: true } } } } },
        orderBy: { consulteeLE: 'desc' },
      },
      vaccinations: true,
      factures: { orderBy: { creeLe: 'desc' } },
    },
  });

  if (!patient) throw new NotFoundError('Patient non trouve');
  return patient;
}

export async function updateStructurePreferee(userId: string, idStructure: string | null) {
  const patient = await prisma.patientProfile.findUnique({ where: { idUtilisateur: userId } });
  if (!patient) throw new NotFoundError('Profil patient non trouve');

  if (idStructure) {
    const structure = await prisma.structureSante.findUnique({ where: { id: idStructure } });
    if (!structure) throw new NotFoundError('Structure non trouvee');
    if (!structure.estActive) throw new ValidationError("Cette structure n'est plus active");
  }

  const updated = await prisma.patientProfile.update({
    where: { idUtilisateur: userId },
    data: { idStructurePreferee: idStructure },
    include: {
      structurePreferee: {
        select: { id: true, nom: true, type: true, prefecture: true },
      },
    },
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'PatientProfile',
    entityId: updated.id,
    operation: SyncOperation.UPDATE,
    idUtilisateur: userId,
    payload: { idStructurePreferee: idStructure },
  });

  return updated;
}
