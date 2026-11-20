// src/services/demande-rendez-vous.service.ts
//
// Prise de rendez-vous a distance (addendum du 2026-09-28, point 6).
//
// Le patient fait sa demande depuis chez lui ; un medecin l'accepte en fixant
// un creneau, ce qui ouvre l'episode de la visite. Trois metiers, trois
// gestes, et aucun ne deborde sur l'autre :
//
//   patient   -> demande, et peut se raviser
//   accueil   -> oriente celles que personne ne vise (son metier, le seul
//                qu'il garde sur ce circuit)
//   medecin   -> accepte en fixant l'heure, ou refuse avec un motif
//
// La demande n'ouvre pas d'episode : un episode est une visite, et une demande
// n'en est pas encore une. Elle le devient a l'acceptation, pas avant — sinon
// la file de l'hopital se remplirait de visites qui n'auront jamais lieu.
import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { messageRendezVous } from './message-sortant.service';
import { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { prochainNumero } from './numero.service';
import { envoyerSmsSimule, notifierSansBloquer } from './notification.service';
import { getIdentitePlateforme } from './parametres.service';
import { demanderAccesDossier } from './acces-dossier.service';
import type {

  DemandeRendezVousView,
  CreerDemandeRendezVousDto,
  AccepterDemandeRendezVousDto,
} from '@baobaoheath/shared-types';

/**
 * Les structures ou l'on peut etre recu en consultation.
 *
 * Une pharmacie, un laboratoire et une compagnie d'assurance n'en sont pas —
 * et la liste proposee au patient les contenait toutes.
 */
const TYPES_DE_SOIN = ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'] as const;

const DEMANDE_INCLUDE = {
  patient: {
    select: {
      id: true, dateNaissance: true, sexe: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
  },
  structure: { select: { id: true, nom: true, prefecture: true } },
  // `bureau` : ou le patient devra se rendre. Souvent nul.
  medecin: {
    select: {
      id: true, prenom: true, nom: true,
      medecinProfile: { select: { bureau: true } },
    },
  },
  episode: { select: { id: true, numero: true } },
} satisfies Prisma.DemandeRendezVousInclude;

type DemandeRow = Prisma.DemandeRendezVousGetPayload<{ include: typeof DEMANDE_INCLUDE }>;

function versVue(d: DemandeRow): DemandeRendezVousView {
  return {
    id: d.id,
    motif: d.motif,
    statut: d.statut,
    creeLe: d.creeLe.toISOString(),
    traiteeLe: d.traiteeLe?.toISOString() ?? null,
    motifRefus: d.motifRefus,
    patient: {
      id: d.patient.id,
      prenom: d.patient.utilisateur.prenom,
      nom: d.patient.utilisateur.nom,
      dateNaissance: d.patient.dateNaissance.toISOString(),
      sexe: d.patient.sexe,
      telephone: d.patient.utilisateur.telephone,
    },
    structure: d.structure,
    medecin: d.medecin
      ? {
          id: d.medecin.id,
          prenom: d.medecin.prenom,
          nom: d.medecin.nom,
          bureau: d.medecin.medecinProfile?.bureau ?? null,
        }
      : null,
    idEpisode: d.episode?.id ?? null,
    numeroEpisode: d.episode?.numero ?? null,
  };
}

/** Le profil patient de l'utilisateur connecte. */
async function patientDe(userId: string): Promise<{ id: string; idStructurePreferee: string | null }> {
  const p = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true, idStructurePreferee: true },
  });
  if (!p) throw new ForbiddenError('Aucun dossier patient rattache a votre compte');
  return p;
}

async function structureDuProfessionnel(userId: string): Promise<string> {
  const u = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: { idStructure: true, medecinProfile: { select: { idStructure: true } } },
  });
  const id = u?.idStructure ?? u?.medecinProfile?.idStructure;
  if (!id) throw new ForbiddenError('Aucune structure rattachee a votre compte');
  return id;
}

// ── Cote patient ─────────────────────────────────────────────────────

export async function creerDemande(userId: string, dto: CreerDemandeRendezVousDto): Promise<DemandeRendezVousView> {
  const patient = await patientDe(userId);

  const idStructure = dto.idStructure ?? patient.idStructurePreferee;
  if (!idStructure) throw new ValidationError('Choisissez un etablissement');

  const structure = await prisma.structureSante.findFirst({
    // **Le type est verifie ici, pas seulement dans la liste deroulante.**
    // Filtrer l'affichage ne protege rien : l'identifiant d'une pharmacie
    // reste un identifiant valide, et la demande serait acceptee.
    where: { id: idStructure, estActive: true, type: { in: [...TYPES_DE_SOIN] } },
    select: { id: true, nom: true },
  });
  if (!structure) {
    throw new ValidationError(
      "Etablissement introuvable, inactif, ou ne recevant pas de consultation.",
    );
  }

  // Le medecin souhaite, s'il y en a un, doit appartenir a cet etablissement :
  // sinon la demande partirait vers quelqu'un qui n'y consulte pas.
  if (dto.idMedecin) {
    const m = await prisma.utilisateur.findFirst({
      where: {
        id: dto.idMedecin, role: 'MEDECIN', estActif: true,
        OR: [{ idStructure }, { medecinProfile: { idStructure } }],
      },
      select: { id: true },
    });
    if (!m) throw new ValidationError('Ce medecin n exerce pas dans cet etablissement');
  }

  // Une seule demande en attente a la fois : sans cela, un patient inquiet en
  // depose plusieurs et occupe la file pour rien.
  const dejaEnAttente = await prisma.demandeRendezVous.findFirst({
    where: { idPatient: patient.id, statut: 'EN_ATTENTE' },
    select: { id: true },
  });
  if (dejaEnAttente) throw new ConflictError('Vous avez deja une demande en attente de reponse');

  const creee = await prisma.demandeRendezVous.create({
    data: {
      idPatient: patient.id,
      idStructure,
      idMedecin: dto.idMedecin ?? null,
      motif: dto.motif.trim(),
    },
    include: DEMANDE_INCLUDE,
  });

  // Prevenir qui de droit, sinon la demande dort.
  if (dto.idMedecin) {
    await notifierSansBloquer({
      idUtilisateur: dto.idMedecin,
      type: 'RAPPEL_RENDEZ_VOUS',
      titre: 'Demande de rendez-vous',
      contenu: `${creee.patient.utilisateur.prenom} ${creee.patient.utilisateur.nom} demande un rendez-vous.`,
      lienAction: '/medecin/demandes',
      metadonnees: { idDemande: creee.id },
    });
  } else {
    // Personne n'est vise : c'est l'accueil qui oriente.
    const agents = await prisma.utilisateur.findMany({
      where: { idStructure, role: 'AGENT_ACCUEIL', estActif: true },
      select: { id: true },
      take: 5,
    });
    for (const a of agents) {
      await notifierSansBloquer({
        idUtilisateur: a.id,
        type: 'RAPPEL_RENDEZ_VOUS',
        titre: 'Demande de rendez-vous a orienter',
        contenu: `${creee.patient.utilisateur.prenom} ${creee.patient.utilisateur.nom} demande un rendez-vous, sans medecin designe.`,
        lienAction: '/hopital/demandes',
        metadonnees: { idDemande: creee.id },
      });
    }
  }

  return versVue(creee);
}

export async function mesDemandes(userId: string): Promise<DemandeRendezVousView[]> {
  const patient = await patientDe(userId);
  const rows = await prisma.demandeRendezVous.findMany({
    where: { idPatient: patient.id },
    include: DEMANDE_INCLUDE,
    orderBy: { creeLe: 'desc' },
    take: 50,
  });
  return rows.map(versVue);
}

/** Le patient se ravise. Seule une demande encore en attente peut etre retiree. */
export async function annulerDemande(userId: string, idDemande: string): Promise<DemandeRendezVousView> {
  const patient = await patientDe(userId);
  const d = await prisma.demandeRendezVous.findFirst({
    where: { id: idDemande, idPatient: patient.id },
    select: { id: true, statut: true },
  });
  if (!d) throw new NotFoundError('Demande introuvable');
  if (d.statut !== 'EN_ATTENTE') throw new ConflictError('Cette demande a deja ete traitee');

  const maj = await prisma.demandeRendezVous.update({
    where: { id: idDemande },
    data: { statut: 'ANNULEE', traiteeLe: new Date() },
    include: DEMANDE_INCLUDE,
  });
  return versVue(maj);
}

// ── Cote accueil : orienter celles que personne ne vise ──────────────

export async function demandesAOrienter(user: JwtPayload): Promise<DemandeRendezVousView[]> {
  const idStructure = await structureDuProfessionnel(user.userId);
  const rows = await prisma.demandeRendezVous.findMany({
    // Celles qui visent deja un medecin ne le concernent pas : elles sont
    // dans la file de ce medecin.
    where: { idStructure, statut: 'EN_ATTENTE', idMedecin: null },
    include: DEMANDE_INCLUDE,
    // La plus ancienne d'abord : c'est le patient qui attend depuis le plus longtemps.
    orderBy: { creeLe: 'asc' },
    take: 100,
  });
  return rows.map(versVue);
}

export async function orienterDemande(user: JwtPayload, idDemande: string, idMedecin: string): Promise<DemandeRendezVousView> {
  const idStructure = await structureDuProfessionnel(user.userId);

  const d = await prisma.demandeRendezVous.findFirst({
    where: { id: idDemande, idStructure },
    include: { patient: { select: { utilisateur: { select: { prenom: true, nom: true } } } } },
  });
  if (!d) throw new NotFoundError('Demande introuvable');
  if (d.statut !== 'EN_ATTENTE') throw new ConflictError('Cette demande a deja ete traitee');

  const medecin = await prisma.utilisateur.findFirst({
    where: {
      id: idMedecin, role: 'MEDECIN', estActif: true,
      OR: [{ idStructure }, { medecinProfile: { idStructure } }],
    },
    select: { id: true },
  });
  if (!medecin) throw new ValidationError('Ce medecin n exerce pas dans votre etablissement');

  const maj = await prisma.demandeRendezVous.update({
    where: { id: idDemande },
    data: { idMedecin },
    include: DEMANDE_INCLUDE,
  });

  await notifierSansBloquer({
    idUtilisateur: idMedecin,
    type: 'RAPPEL_RENDEZ_VOUS',
    titre: 'Demande de rendez-vous',
    contenu: `${d.patient.utilisateur.prenom} ${d.patient.utilisateur.nom} demande un rendez-vous. Fixez-lui un creneau.`,
    lienAction: '/medecin/demandes',
    metadonnees: { idDemande },
  });

  return versVue(maj);
}

// ── Cote medecin : accepter en fixant l'heure, ou refuser ────────────

export async function mesDemandesRecues(userId: string): Promise<DemandeRendezVousView[]> {
  const rows = await prisma.demandeRendezVous.findMany({
    where: { idMedecin: userId, statut: 'EN_ATTENTE' },
    include: DEMANDE_INCLUDE,
    orderBy: { creeLe: 'asc' },
    take: 100,
  });
  return rows.map(versVue);
}

/**
 * Accepter, c'est fixer l'heure — et c'est ce geste qui ouvre la visite.
 *
 * L'episode et le rendez-vous naissent ensemble, dans la meme transaction :
 * un episode sans rendez-vous laisserait un dossier ouvert que personne
 * n'attend, et un rendez-vous sans episode n'aurait rien ou se rattacher.
 */
export async function accepterDemande(
  userId: string,
  idDemande: string,
  dto: AccepterDemandeRendezVousDto
): Promise<DemandeRendezVousView> {
  const prevuLe = new Date(dto.prevuLe);
  if (Number.isNaN(prevuLe.getTime())) throw new ValidationError('Date de rendez-vous invalide');

  const d = await prisma.demandeRendezVous.findFirst({
    where: { id: idDemande, idMedecin: userId },
    include: {
      patient: { select: { id: true, utilisateur: { select: { prenom: true, nom: true } } } },
      structure: { select: { id: true, nom: true } },
    },
  });
  if (!d) throw new NotFoundError('Aucune demande de ce patient ne vous est adressee');
  if (d.statut !== 'EN_ATTENTE') throw new ConflictError('Cette demande a deja ete traitee');

  const maintenant = new Date();

  const cree = await prisma.$transaction(async (tx) => {
    // Attribution atomique : deux acceptations simultanees donnent un gagnant
    // et un perdant, jamais deux episodes pour une seule demande.
    const prise = await tx.demandeRendezVous.updateMany({
      where: { id: idDemande, statut: 'EN_ATTENTE' },
      data: { statut: 'ACCEPTEE', traiteeLe: maintenant, idTraitePar: userId },
    });
    if (prise.count === 0) throw new ConflictError('Cette demande vient d etre traitee');

    const numero = await prochainNumero('EP', tx);
    const episode = await tx.episodeSoins.create({
      data: {
        numero,
        motif: d.motif,
        statut: 'EN_COURS',
        idStructure: d.structure.id,
        idPatient: d.patient.id,
        // La demande vient du patient : c'est le medecin qui l'ouvre en
        // l'acceptant, et il en est d'emblee responsable.
        idOuvertPar: userId,
        idResponsable: userId,
      },
    });

    const rdv = await tx.rendezVous.create({
      data: {
        idPatient: d.patient.id,
        idMedecin: userId,
        idEpisode: episode.id,
        prevuLe,
        motif: d.motif,
        statut: 'PLANIFIE',
      },
      select: { id: true },
    });

    await tx.demandeRendezVous.update({
      where: { id: idDemande },
      data: { idEpisode: episode.id },
    });
    return { idEpisode: episode.id, idRendezVous: rdv.id };
  });

  // L'historique, au-dela de cette visite, demande l'accord du patient.
  await demanderAccesDossier({ idPatient: d.patient.id, idMedecin: userId, ...cree, prevuLe });

  // Le patient apprend son heure : c'est la reponse qu'il attendait.
  const patientUser = await prisma.utilisateur.findFirst({
    where: { patientProfile: { id: d.patient.id } },
    select: { id: true, telephone: true },
  });
  if (patientUser) {
    const quand = prevuLe.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    await notifierSansBloquer({
      idUtilisateur: patientUser.id,
      type: 'RAPPEL_RENDEZ_VOUS',
      titre: 'Votre rendez-vous est fixe',
      contenu: `Rendez-vous a ${d.structure.nom} le ${quand}. Presentez-vous a l'accueil.`,
      lienAction: '/patient/parcours',
      metadonnees: { idDemande },
    });
    const { nomCourt } = await getIdentitePlateforme();
    // Par le constructeur, pour que le nom de l'etablissement passe le meme
    // controle : « Centre de traitement X » revelerait la nature du soin.
    await envoyerSmsSimule(patientUser.telephone, messageRendezVous(nomCourt, quand, d.structure.nom));
  }

  const maj = await prisma.demandeRendezVous.findUniqueOrThrow({ where: { id: idDemande }, include: DEMANDE_INCLUDE });
  return versVue(maj);
}

/** Refuser demande un motif : un refus sans explication est un mur. */
export async function refuserDemande(userId: string, idDemande: string, motif: string): Promise<DemandeRendezVousView> {
  const raison = motif.trim();
  if (raison.length < 5) throw new ValidationError('Indiquez un motif de refus');

  const d = await prisma.demandeRendezVous.findFirst({
    where: { id: idDemande, idMedecin: userId },
    select: { id: true, statut: true, idPatient: true, structure: { select: { nom: true } } },
  });
  if (!d) throw new NotFoundError('Aucune demande de ce patient ne vous est adressee');
  if (d.statut !== 'EN_ATTENTE') throw new ConflictError('Cette demande a deja ete traitee');

  const maj = await prisma.demandeRendezVous.update({
    where: { id: idDemande },
    data: { statut: 'REFUSEE', traiteeLe: new Date(), idTraitePar: userId, motifRefus: raison },
    include: DEMANDE_INCLUDE,
  });

  const patientUser = await prisma.utilisateur.findFirst({
    where: { patientProfile: { id: d.idPatient } },
    select: { id: true },
  });
  if (patientUser) {
    await notifierSansBloquer({
      idUtilisateur: patientUser.id,
      type: 'RAPPEL_RENDEZ_VOUS',
      titre: 'Votre demande de rendez-vous',
      // Le motif est dans l'espace du patient, pas dans la notification : il
      // peut contenir un detail que rien ne doit sortir de la plateforme.
      contenu: `Votre demande a ${d.structure.nom} n'a pas pu aboutir. Le motif est dans votre espace.`,
      lienAction: '/patient/rendez-vous',
      metadonnees: { idDemande },
    });
  }

  return versVue(maj);
}
