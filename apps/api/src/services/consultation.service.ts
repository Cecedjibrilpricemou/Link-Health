import { EncounterStatus, Prisma, SyncOperation } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import {
  ConsultationFilters,
  CreateConsultationDto,
  DiagnosticDto,
  OrdonnanceDto,
  ReferralDto,
  VitalsDto,
} from '../types/consultation.types';
import {
  assertCanAccessConsultation,
  assertCanAccessPatient,
  buildConsultationWhereForUser,
} from './access-control.service';
import { appliquerReglesDocument, avecExpirationEtAlertes, ordonnanceEnRedaction } from './ordonnance.service';
import { analyserPrescription } from './prescription-securite.service';
import { recordSyncEvent } from './sync.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { estPraticien } from '../utils/praticien.util';

async function getAscForUser(userId: string) {
  const asc = await prisma.ascProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true, idStructure: true },
  });

  if (!asc) throw new NotFoundError('Profil ASC non trouve');
  return asc;
}

async function assertCanModifyAsAsc(user: JwtPayload, idConsultation: string) {
  const asc = await getAscForUser(user.userId);
  const consultation = await prisma.consultation.findFirst({
    where: { id: idConsultation, idAsc: asc.id },
    select: { id: true, statut: true },
  });

  if (!consultation) throw new ForbiddenError('Acces refuse a cette consultation');
  if (consultation.statut === EncounterStatus.TERMINEE) {
    throw new ValidationError('Impossible de modifier une consultation terminee');
  }

  return { asc, consultation };
}

export async function createConsultation(
  user: JwtPayload,
  dto: CreateConsultationDto
) {
  const asc = await getAscForUser(user.userId);
  const patient = await prisma.patientProfile.findUnique({
    where: { id: dto.idPatient },
    select: { id: true },
  });

  if (!patient) throw new NotFoundError('Patient non trouve');
  await assertCanAccessPatient(user, dto.idPatient);

  const consultation = await prisma.consultation.create({
    data: {
      idPatient: dto.idPatient,
      idAsc: asc.id,
      motifPrincipal: dto.motifPrincipal,
      symptomes: dto.symptomes ?? [],
      statut: EncounterStatus.EN_COURS,
    },
    include: {
      patient: {
        include: {
          utilisateur: {
            select: {
              prenom: true,
              nom: true,
              telephone: true,
            },
          },
        },
      },
    },
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'Consultation',
    entityId: consultation.id,
    operation: SyncOperation.CREATE,
    idUtilisateur: user.userId,
    idStructure: asc.idStructure ?? undefined,
    payload: { idPatient: dto.idPatient, statut: consultation.statut },
  });

  return consultation;
}

export async function getConsultationById(user: JwtPayload, id: string) {
  await assertCanAccessConsultation(user, id);

  const consultation = await prisma.consultation.findUnique({
    where: { id },
    include: {
      patient: {
        include: {
          utilisateur: {
            select: {
              prenom: true,
              nom: true,
              telephone: true,
              photoUrl: true,
            },
          },
        },
      },
      asc: {
        include: {
          utilisateur: {
            select: { prenom: true, nom: true },
          },
        },
      },
      constantes: true,
      diagnostics: true,
      ordonnances: {
        include: {
          lignes: { include: { medicament: true } },
          signataire: { select: { prenom: true, nom: true } },
        },
      },
      // La structure cible est affichee sur la fiche : sans cette relation,
      // referencement.structureCible etait undefined cote client.
      referencement: {
        include: {
          structureCible: {
            select: { id: true, nom: true, type: true, prefecture: true },
          },
        },
      },
      facture: true,
    },
  });

  if (!consultation) throw new NotFoundError('Consultation non trouvee');
  return {
    ...consultation,
    ordonnances: consultation.ordonnances.map((o) => avecExpirationEtAlertes(o)),
  };
}

export async function saveVitals(user: JwtPayload, idConsultation: string, dto: VitalsDto) {
  // **Deux auteurs possibles, deux controles.** Un medecin n'a pas de profil
  // d'agent communautaire : exiger `assertCanModifyAsAsc` de lui refusait la
  // saisie des constantes en consultation hospitaliere, alors que c'est lui
  // qui prend la tension quand il mene l'entretien. Meme forme que
  // `alertesPrescription` et `addOrdonnance`, qui branchent deja sur le role.
  let idStructureAuteur: string | undefined;
  if (estPraticien(user.role)) {
    await assertCanAccessConsultation(user, idConsultation);
    const u = await prisma.utilisateur.findUnique({
      where: { id: user.userId },
      select: { idStructure: true, medecinProfile: { select: { idStructure: true } } },
    });
    idStructureAuteur = u?.idStructure ?? u?.medecinProfile?.idStructure ?? undefined;
  } else {
    const { asc } = await assertCanModifyAsAsc(user, idConsultation);
    idStructureAuteur = asc.idStructure ?? undefined;
  }

  const consultation = await prisma.consultation.findUnique({
    where: { id: idConsultation },
    include: { constantes: true },
  });

  if (!consultation) throw new NotFoundError('Consultation non trouvee');

  const alertes: string[] = [];
  if (dto.temperature && dto.temperature > 39.5) alertes.push('Fievre elevee > 39.5 C');
  if (dto.spo2 && dto.spo2 < 95) alertes.push('SpO2 critique < 95%');
  if (dto.frequenceRespiratoire && dto.frequenceRespiratoire > 50) alertes.push('Frequence respiratoire elevee > 50/min');
  if (dto.tensionSystolique && dto.tensionSystolique > 180) alertes.push('Tension systolique dangereuse > 180 mmHg');
  if (dto.glycemie && dto.glycemie > 3) alertes.push('Glycemie critique > 3 g/L');

  const vitals = consultation.constantes
    ? await prisma.constantesVitales.update({
        where: { idConsultation },
        data: { ...dto, alertes },
      })
    : await prisma.constantesVitales.create({
        data: {
          idConsultation,
          ...dto,
          alertes,
        },
      });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'ConstantesVitales',
    entityId: vitals.id,
    operation: consultation.constantes ? SyncOperation.UPDATE : SyncOperation.CREATE,
    idUtilisateur: user.userId,
    idStructure: idStructureAuteur,
    payload: { idConsultation, alertes },
  });

  return vitals;
}

export async function completeConsultation(user: JwtPayload, id: string) {
  const { asc } = await assertCanModifyAsAsc(user, id);

  const consultation = await prisma.consultation.findUnique({
    where: { id },
    include: {
      constantes: true,
      diagnostics: true,
      ordonnances: true,
    },
  });

  if (!consultation) throw new NotFoundError('Consultation non trouvee');
  if (consultation.statut === EncounterStatus.TERMINEE) throw new ValidationError('Consultation deja terminee');

  const updated = await prisma.consultation.update({
    where: { id },
    data: { statut: EncounterStatus.TERMINEE },
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'Consultation',
    entityId: id,
    operation: SyncOperation.UPDATE,
    idUtilisateur: user.userId,
    idStructure: asc.idStructure ?? undefined,
    payload: { statut: EncounterStatus.TERMINEE },
  });

  return updated;
}

export async function addDiagnostic(
  user: JwtPayload,
  idConsultation: string,
  dto: DiagnosticDto
) {
  if (estPraticien(user.role)) {
    await assertCanAccessConsultation(user, idConsultation);
  } else {
    await assertCanModifyAsAsc(user, idConsultation);
  }

  const diagnostic = await prisma.diagnostic.create({
    data: {
      idConsultation,
      libelle: dto.libelle,
      codeIcd11: dto.codeIcd11,
      typeDiagnostic: dto.typeDiagnostic ?? 'PRINCIPAL',
      source: dto.source,
      severite: dto.severite,
      statutClinique: 'ACTIF',
    },
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'Diagnostic',
    entityId: diagnostic.id,
    operation: SyncOperation.CREATE,
    idUtilisateur: user.userId,
    payload: { idConsultation, libelle: diagnostic.libelle },
  });

  return diagnostic;
}

/**
 * EF-05-05/06 : ce que le prescripteur doit savoir avant d'ajouter ce
 * medicament. Appele par l'ecran avant la prescription ; l'API recalcule de
 * toute facon les memes alertes a la creation, donc sauter cet appel ne permet
 * pas de les contourner, seulement de ne pas les voir.
 */
export async function alertesPrescription(
  user: JwtPayload,
  idConsultation: string,
  idMedicament: string
) {
  if (estPraticien(user.role)) {
    await assertCanAccessConsultation(user, idConsultation);
  } else {
    await assertCanModifyAsAsc(user, idConsultation);
  }
  return analyserPrescription(idConsultation, idMedicament);
}

export async function addOrdonnance(
  user: JwtPayload,
  idConsultation: string,
  dto: OrdonnanceDto
) {
  if (estPraticien(user.role)) {
    await assertCanAccessConsultation(user, idConsultation);
  } else {
    await assertCanModifyAsAsc(user, idConsultation);
  }

  const medicament = await prisma.medicament.findUnique({
    where: { id: dto.idMedicament },
  });

  if (!medicament) throw new NotFoundError('Medicament non trouve');

  // EF-05-05/06 : les alertes sont recalculees ici, jamais reprises du
  // client. Les reprendre reviendrait a laisser le prescripteur decider s'il
  // veut etre alerte. Elles n'empechent rien : elles sont figees sur la ligne
  // avec le motif eventuel, pour qu'on sache plus tard ce qui a ete montre.
  const { alertes } = await analyserPrescription(idConsultation, dto.idMedicament);

  // Le medicament rejoint l'ordonnance en cours de redaction de la
  // consultation ; si elle n'existe pas encore, elle est ouverte ici avec son
  // numero et son code de verification.
  const ordonnance = await ordonnanceEnRedaction(idConsultation);

  const ligne = await prisma.ligneOrdonnance.create({
    data: {
      idOrdonnance: ordonnance.id,
      idMedicament: dto.idMedicament,
      posologie: dto.posologie,
      frequence: dto.frequence,
      dureeJours: dto.dureeJours,
      quantite: dto.quantite ?? 1,
      instructions: dto.instructions,
      // Cast vers le type JSON de Prisma : la forme est celle du contrat.
      alertes: alertes.length ? (alertes as unknown as Prisma.InputJsonValue) : undefined,
      motifDepassement: alertes.length ? (dto.motifDepassement ?? null) : null,
    },
    include: { medicament: true },
  });

  // EF-05-09 / EF-05-12 : ce qui se decide au niveau du document. Un produit
  // reglemente ferme le renouvellement et raccourcit la validite, sans que le
  // prescripteur ait a y penser — et sans qu'il puisse s'y soustraire.
  await appliquerReglesDocument(ordonnance.id, dto.renouvellementsAutorises);

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'LigneOrdonnance',
    entityId: ligne.id,
    operation: SyncOperation.CREATE,
    idUtilisateur: user.userId,
    payload: {
      idOrdonnance: ordonnance.id,
      idConsultation,
      idMedicament: dto.idMedicament,
      quantite: ligne.quantite,
    },
  });

  return ligne;
}

// ── AMÉLIORATION : $transaction pour garantir atomicité consultation + referencement ──
export async function createReferral(
  user: JwtPayload,
  idConsultation: string,
  dto: ReferralDto
) {
  const { asc } = await assertCanModifyAsAsc(user, idConsultation);
  const consultation = await prisma.consultation.findUnique({
    where: { id: idConsultation },
    include: { referencement: true },
  });

  if (!consultation) throw new NotFoundError('Consultation non trouvee');
  if (consultation.referencement) throw new ValidationError('Un referencement existe deja pour cette consultation');

  const structure = await prisma.structureSante.findUnique({
    where: { id: dto.idStructureCible },
  });

  if (!structure) throw new NotFoundError('Structure de sante cible non trouvee');

  const referral = await prisma.$transaction(async (tx) => {
    await tx.consultation.update({
      where: { id: idConsultation },
      data: { statut: EncounterStatus.REFERENCEE },
    });

    return tx.referencement.create({
      data: {
        idConsultation,
        idStructureSource: asc.idStructure,
        idStructureCible: dto.idStructureCible,
        urgence: dto.urgence,
        resumeClinique: dto.resumeClinique,
      },
      include: { structureCible: true },
    });
  });

  await recordSyncEvent({
    scope: 'medical',
    entityType: 'Referencement',
    entityId: referral.id,
    operation: SyncOperation.CREATE,
    idUtilisateur: user.userId,
    idStructure: asc.idStructure ?? undefined,
    payload: { idConsultation, idStructureCible: dto.idStructureCible, urgence: dto.urgence },
  });

  return referral;
}

export async function getConsultations(user: JwtPayload, filters: ConsultationFilters) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where = {
    AND: [
      await buildConsultationWhereForUser(user),
      {
        ...(filters.idPatient && { idPatient: filters.idPatient }),
        ...(filters.idAsc && { idAsc: filters.idAsc }),
        ...(filters.statut && { statut: filters.statut }),
      },
    ],
  };

  const [consultations, total] = await Promise.all([
    prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        patient: {
          include: {
            utilisateur: {
              select: { prenom: true, nom: true, telephone: true },
            },
          },
        },
        constantes: true,
        diagnostics: true,
      },
      orderBy: { consulteeLE: 'desc' },
    }),
    prisma.consultation.count({ where }),
  ]);

  return {
    data: consultations,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getMesConsultations(
  userId: string,
  filters: ConsultationFilters
) {
  const patient = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true },
  });

  if (!patient) throw new NotFoundError('Profil patient non trouve');

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where = {
    idPatient: patient.id,
    ...(filters.statut && { statut: filters.statut }),
  };

  const [consultations, total] = await Promise.all([
    prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        constantes: true,
        diagnostics: true,
        ordonnances: { include: { lignes: { include: { medicament: true } } } },
        facture: true,
        // Qui a vu le patient : affiche dans son dossier et son tableau de
        // bord ("Agent Mamadou Bah"), a la place d'un motif technique.
        asc: { select: { utilisateur: { select: { prenom: true, nom: true } } } },
        // Le role : « Dr » pour le medecin seul, pas pour la sage-femme.
        medecinValideur: { select: { prenom: true, nom: true, role: true } },
      },
      orderBy: { consulteeLE: 'desc' },
    }),
    prisma.consultation.count({ where }),
  ]);

  return {
    data: consultations,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
