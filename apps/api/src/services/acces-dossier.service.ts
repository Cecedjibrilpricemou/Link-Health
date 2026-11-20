// L'accord du patient pour que le medecin d'un rendez-vous lise son
// historique.
//
// **Ce qui change.** Le medecin soigne la visite qu'il recoit sans rien
// demander : l'episode, le rendez-vous, la consultation du jour, les analyses
// de cette visite. L'histoire medicale au-dela - consultations passees, dans
// cette structure ou ailleurs, resultats, ordonnances, vaccinations, fiche
// medicale - c'est le patient qui choisit de la partager, avec ce medecin,
// pour cet episode.
//
//   - **La demande part a la prise du rendez-vous** : notification dans son
//     espace, et courriel s'il a une adresse. Le lien ouvre l'application : on
//     n'accorde pas l'acces a son dossier d'un clic dans un courriel, qu'un
//     tiers peut lire ou transferer.
//   - **L'accord vaut jusqu'a la cloture de l'episode, plus trente jours**,
//     pour les resultats et le controle qui suivent. Le patient le retire a
//     tout moment, avec effet immediat.
//   - **Un refus ne se redemande pas.** Le patient peut changer d'avis depuis
//     son espace ; le medecin, lui, ne relance qu'une demande restee sans
//     reponse, une fois par jour au plus.
//   - **L'urgence passe par le bris de glace**, declare, date et relu.
import type { Prisma } from '../config/generated/client/client';
import { StatutAutorisationAcces } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { JwtPayload } from '../types/auth.types';
import type {
  AutorisationAccesDossierView, EtatAccesDossierView, HistoriquePatientView,
} from '@baobaoheath/shared-types';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/app-error';
import { envoyerDemandeAccesDossier } from './email.service';
import { examensSuivisDuPatient } from './laboratoire.service';
import { notifierSansBloquer } from './notification.service';

/** Apres la cloture de l'episode, l'accord court encore ce nombre de jours. */
export const JOURS_APRES_CLOTURE = 30;
/** Un medecin ne relance une demande qu'une fois par jour. */
const DELAI_RELANCE_MS = 24 * 60 * 60 * 1000;

const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * Une autorisation **active** : accordee, et dont l'episode n'est pas clos
 * depuis plus de trente jours. Sans episode (supprime), elle ne vaut plus :
 * c'est lui qui la bornait.
 */
export function filtreAutorisationActive(maintenant = new Date()): Prisma.AutorisationAccesDossierWhereInput {
  const limite = new Date(maintenant.getTime() - JOURS_APRES_CLOTURE * JOUR_MS);
  return {
    statut: StatutAutorisationAcces.ACCORDEE,
    episode: { is: { OR: [{ closLe: null }, { closLe: { gt: limite } }] } },
  };
}

/** La fin de validite d'un accord, connue seulement une fois l'episode clos. */
export function expireLe(closLe: Date | null): Date | null {
  return closLe ? new Date(closLe.getTime() + JOURS_APRES_CLOTURE * JOUR_MS) : null;
}

/**
 * Ce medecin peut-il lire l'historique de ce patient ?
 *
 * Deux portes, et deux seulement : l'accord du patient, encore valable, ou un
 * bris de glace en cours. Une relation de soin ne suffit pas - c'est tout
 * l'objet de l'accord.
 */
export async function peutLireHistorique(user: JwtPayload, idPatient: string, maintenant = new Date()): Promise<boolean> {
  const [accord, urgence] = await Promise.all([
    prisma.autorisationAccesDossier.findFirst({
      where: { idPatient, idMedecin: user.userId, ...filtreAutorisationActive(maintenant) },
      select: { id: true },
    }),
    prisma.brisDeGlace.findFirst({
      where: { idPatient, idAuteur: user.userId, refermeLe: null, expireLe: { gt: maintenant } },
      select: { id: true },
    }),
  ]);
  return !!accord || !!urgence;
}

/**
 * Les patients dont ce medecin peut lire la fiche, pour une liste : la meme
 * regle que `peutLireHistorique`, en filtre. Sans effet pour les autres roles.
 */
export function filtrePatientsLisibles(user: JwtPayload, maintenant = new Date()): Prisma.PatientProfileWhereInput {
  if (user.role !== 'MEDECIN') return {};
  return {
    OR: [
      { autorisationsAcces: { some: { idMedecin: user.userId, ...filtreAutorisationActive(maintenant) } } },
      { brisDeGlace: { some: { idAuteur: user.userId, refermeLe: null, expireLe: { gt: maintenant } } } },
    ],
  };
}

/** Le refus, pour un medecin, en nommant les deux issues. */
export async function assertPeutLireHistorique(user: JwtPayload, idPatient: string): Promise<void> {
  if (await peutLireHistorique(user, idPatient)) return;
  throw new ForbiddenError(
    "L'historique de ce patient demande son accord. Il l'a recu a la prise du rendez-vous ; en urgence, passez par le bris de glace.",
  );
}

/**
 * Le meme garde, pour les lectures existantes qui montrent l'historique
 * (fiche medicale, resultats, export) : il ne s'applique qu'au medecin. Les
 * autres roles gardent leurs regles.
 */
export async function assertHistoriqueSiMedecin(user: JwtPayload, idPatient: string): Promise<void> {
  if (user.role === 'MEDECIN') await assertPeutLireHistorique(user, idPatient);
}

// ── La demande, a la prise du rendez-vous ────────────────────────────

/**
 * Demander l'accord du patient pour ce medecin et cet episode.
 *
 * **Ne fait jamais echouer la prise du rendez-vous** : elle est enregistree.
 * Une demande deja posee pour cet episode n'est pas refaite, quel que soit
 * son etat - et surtout pas apres un refus ou un retrait.
 */
export async function demanderAccesDossier(d: {
  idPatient: string;
  idMedecin: string;
  idEpisode: string;
  idRendezVous: string;
  prevuLe: Date;
}): Promise<void> {
  try {
    const existante = await prisma.autorisationAccesDossier.findUnique({
      where: { idPatient_idMedecin_idEpisode: { idPatient: d.idPatient, idMedecin: d.idMedecin, idEpisode: d.idEpisode } },
      select: { id: true },
    });
    if (existante) return;

    const demande = await prisma.autorisationAccesDossier.create({
      data: { idPatient: d.idPatient, idMedecin: d.idMedecin, idEpisode: d.idEpisode, idRendezVous: d.idRendezVous },
      select: { id: true },
    });
    await prevenirPatient(demande.id, d.prevuLe);
  } catch (e) {
    logger.error('[ACCES] demande d accord non posee', {
      idEpisode: d.idEpisode,
      erreur: e instanceof Error ? e.message : String(e),
    });
  }
}

/** La date du rendez-vous, telle qu'on la lit a Conakry. */
function quand(prevuLe: Date): string {
  return prevuLe.toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Conakry',
  });
}

/**
 * Prevenir le patient : dans son espace, et par courriel s'il a une adresse.
 *
 * Ni structure ni motif : un nom d'etablissement peut reveler la nature du
 * soin, et un courriel se lit parfois par-dessus une epaule.
 */
async function prevenirPatient(idAutorisation: string, prevuLe: Date): Promise<void> {
  const a = await prisma.autorisationAccesDossier.findUniqueOrThrow({
    where: { id: idAutorisation },
    select: {
      medecin: { select: { prenom: true, nom: true } },
      patient: { select: { utilisateur: { select: { id: true, prenom: true, nom: true, email: true } } } },
    },
  });
  const medecin = `Dr ${a.medecin.prenom} ${a.medecin.nom}`;
  const patient = a.patient.utilisateur;

  await notifierSansBloquer({
    idUtilisateur: patient.id,
    type: 'ACCES_DOSSIER_DEMANDE',
    titre: 'Un medecin demande acces a votre historique',
    contenu: `${medecin}, qui vous recoit le ${quand(prevuLe)}, souhaite consulter votre historique medical. `
      + 'Vous pouvez accepter ou refuser depuis votre espace.',
    lienAction: '/patient/acces-dossier',
    metadonnees: { idAutorisation },
  });

  if (patient.email) {
    try {
      await envoyerDemandeAccesDossier({
        destinataire: patient.email,
        prenomNom: `${patient.prenom} ${patient.nom}`,
        medecin,
        quand: quand(prevuLe),
      });
    } catch (e) {
      logger.error('[ACCES] courriel de demande non envoye', {
        idAutorisation,
        erreur: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

// ── Cote patient ─────────────────────────────────────────────────────

const VUE_SELECT = {
  id: true, statut: true, demandeeLe: true, decideeLe: true, retireeLe: true,
  medecin: { select: { prenom: true, nom: true } },
  episode: { select: { closLe: true, structure: { select: { nom: true } } } },
  rendezVous: { select: { prevuLe: true } },
} satisfies Prisma.AutorisationAccesDossierSelect;

type LigneAutorisation = Prisma.AutorisationAccesDossierGetPayload<{ select: typeof VUE_SELECT }>;

function versVue(a: LigneAutorisation, maintenant: Date): AutorisationAccesDossierView {
  const fin = expireLe(a.episode?.closLe ?? null);
  const expiree = a.statut === StatutAutorisationAcces.ACCORDEE && (!a.episode || (!!fin && fin <= maintenant));
  return {
    id: a.id,
    statut: expiree ? ('EXPIREE' as const) : a.statut,
    medecin: `Dr ${a.medecin.prenom} ${a.medecin.nom}`,
    structure: a.episode?.structure.nom ?? null,
    rendezVousLe: a.rendezVous?.prevuLe.toISOString() ?? null,
    demandeeLe: a.demandeeLe.toISOString(),
    decideeLe: a.decideeLe?.toISOString() ?? null,
    retireeLe: a.retireeLe?.toISOString() ?? null,
    expireLe: fin?.toISOString() ?? null,
  };
}

async function patientDe(userId: string): Promise<string> {
  const p = await prisma.patientProfile.findUnique({ where: { idUtilisateur: userId }, select: { id: true } });
  if (!p) throw new NotFoundError('Profil patient introuvable');
  return p.id;
}

/** Les demandes et accords du patient : en attente d'abord, puis le reste. */
export async function mesAutorisations(userId: string, maintenant = new Date()): Promise<AutorisationAccesDossierView[]> {
  const idPatient = await patientDe(userId);
  const lignes = await prisma.autorisationAccesDossier.findMany({
    where: { idPatient },
    select: VUE_SELECT,
    orderBy: { demandeeLe: 'desc' },
    take: 100,
  });
  const ordre: Record<string, number> = { DEMANDEE: 0, ACCORDEE: 1, REFUSEE: 2, RETIREE: 3, EXPIREE: 4 };
  return lignes.map((l) => versVue(l, maintenant)).sort((a, b) => ordre[a.statut]! - ordre[b.statut]!);
}

async function autorisationDuPatient(userId: string, id: string) {
  const idPatient = await patientDe(userId);
  const a = await prisma.autorisationAccesDossier.findFirst({
    where: { id, idPatient },
    select: { id: true, statut: true, idMedecin: true, episode: { select: { closLe: true } }, patient: { select: { utilisateur: { select: { prenom: true, nom: true } } } } },
  });
  if (!a) throw new NotFoundError('Demande introuvable');
  return a;
}

async function vueDe(id: string): Promise<AutorisationAccesDossierView> {
  const a = await prisma.autorisationAccesDossier.findUniqueOrThrow({ where: { id }, select: VUE_SELECT });
  return versVue(a, new Date());
}

/**
 * Accorder. Possible depuis une demande, et aussi apres un refus ou un
 * retrait : le patient peut changer d'avis. Pas sur un episode clos depuis
 * plus de trente jours - l'accord serait mort-ne.
 */
export async function accorderAcces(userId: string, id: string) {
  const a = await autorisationDuPatient(userId, id);
  if (a.statut === StatutAutorisationAcces.ACCORDEE) return vueDe(id);
  const fin = expireLe(a.episode?.closLe ?? null);
  if (!a.episode || (fin && fin <= new Date())) {
    throw new ConflictError('Ce suivi est termine depuis plus de trente jours : il n’y a plus rien a partager.');
  }
  await prisma.autorisationAccesDossier.update({
    where: { id },
    data: { statut: StatutAutorisationAcces.ACCORDEE, decideeLe: new Date(), retireeLe: null },
  });
  logger.info('[ACCES] accord donne', { idAutorisation: id });

  // Le medecin le sait : il peut ouvrir l'historique avant la visite.
  const patient = a.patient.utilisateur;
  await notifierSansBloquer({
    idUtilisateur: a.idMedecin,
    type: 'ACCES_DOSSIER_ACCORDE',
    titre: 'Acces a l historique accorde',
    contenu: `${patient.prenom} ${patient.nom} vous autorise a consulter son historique medical.`,
    lienAction: '/medecin/agenda',
    metadonnees: { idAutorisation: id },
  });
  return vueDe(id);
}

/** Refuser une demande en attente. On ne la redemandera pas. */
export async function refuserAcces(userId: string, id: string) {
  const a = await autorisationDuPatient(userId, id);
  if (a.statut !== StatutAutorisationAcces.DEMANDEE) throw new ConflictError("Cette demande n'attend plus de reponse.");
  await prisma.autorisationAccesDossier.update({
    where: { id },
    data: { statut: StatutAutorisationAcces.REFUSEE, decideeLe: new Date() },
  });
  logger.info('[ACCES] accord refuse', { idAutorisation: id });
  return vueDe(id);
}

/** Retirer un accord donne. Effet immediat : la lecture suivante est refusee. */
export async function retirerAcces(userId: string, id: string) {
  const a = await autorisationDuPatient(userId, id);
  if (a.statut !== StatutAutorisationAcces.ACCORDEE) throw new ConflictError("Cet acces n'est pas accorde.");
  await prisma.autorisationAccesDossier.update({
    where: { id },
    data: { statut: StatutAutorisationAcces.RETIREE, retireeLe: new Date() },
  });
  logger.info('[ACCES] accord retire', { idAutorisation: id });
  return vueDe(id);
}

// ── Cote medecin ─────────────────────────────────────────────────────

export type EtatAcces = EtatAccesDossierView['etat'];

/**
 * Ou en est l'acces de ce medecin a l'historique de ce patient.
 *
 * L'accord actif prime ; a defaut, la demande la plus recente dit ou l'on en
 * est. `peutRelancer` : une demande sans reponse, pas relancee depuis un jour.
 */
export async function etatAcces(user: JwtPayload, idPatient: string, maintenant = new Date()): Promise<EtatAccesDossierView> {
  const [lignes, urgence] = await Promise.all([
    prisma.autorisationAccesDossier.findMany({
      where: { idPatient, idMedecin: user.userId },
      select: { ...VUE_SELECT, relanceeLe: true },
      orderBy: { demandeeLe: 'desc' },
    }),
    prisma.brisDeGlace.findFirst({
      where: { idPatient, idAuteur: user.userId, refermeLe: null, expireLe: { gt: maintenant } },
      select: { expireLe: true },
    }),
  ]);
  const vues = lignes.map((l) => ({ ligne: l, vue: versVue(l, maintenant) }));
  const active = vues.find((v) => v.vue.statut === 'ACCORDEE');
  const courante = active ?? vues[0];
  const etat: EtatAcces = courante ? courante.vue.statut : 'AUCUNE';
  const derniere = courante?.ligne.relanceeLe ?? (courante ? new Date(courante.vue.demandeeLe) : null);
  return {
    etat,
    expireLe: courante?.vue.expireLe ?? null,
    peutRelancer: etat === 'DEMANDEE' && !!derniere && maintenant.getTime() - derniere.getTime() >= DELAI_RELANCE_MS,
    brisDeGlaceJusquau: urgence?.expireLe.toISOString() ?? null,
    peutLire: etat === 'ACCORDEE' || !!urgence,
  };
}

/** Relancer une demande restee sans reponse : une fois par jour au plus. */
export async function relancerDemande(user: JwtPayload, idPatient: string, maintenant = new Date()): Promise<EtatAccesDossierView> {
  const demande = await prisma.autorisationAccesDossier.findFirst({
    where: { idPatient, idMedecin: user.userId, statut: StatutAutorisationAcces.DEMANDEE },
    select: { id: true, demandeeLe: true, relanceeLe: true, rendezVous: { select: { prevuLe: true } } },
    orderBy: { demandeeLe: 'desc' },
  });
  if (!demande) throw new NotFoundError("Aucune demande en attente aupres de ce patient.");
  const derniere = demande.relanceeLe ?? demande.demandeeLe;
  if (maintenant.getTime() - derniere.getTime() < DELAI_RELANCE_MS) {
    throw new ConflictError('Le patient a deja ete sollicite il y a moins de vingt-quatre heures.');
  }
  await prisma.autorisationAccesDossier.update({ where: { id: demande.id }, data: { relanceeLe: maintenant } });
  await prevenirPatient(demande.id, demande.rendezVous?.prevuLe ?? maintenant);
  return etatAcces(user, idPatient, maintenant);
}

/**
 * L'historique du patient, pour le medecin qu'il a autorise.
 *
 * Toutes structures confondues : c'est ce que le patient a choisi de partager.
 * Les consultations les plus recentes d'abord, cinquante au plus.
 */
export async function historiquePatient(user: JwtPayload, idPatient: string): Promise<HistoriquePatientView> {
  await assertPeutLireHistorique(user, idPatient);

  const [patient, consultations, vaccinations, examensSuivis] = await Promise.all([
    prisma.patientProfile.findUnique({
      where: { id: idPatient },
      select: {
        dateNaissance: true, sexe: true, groupeSanguin: true, allergies: true, maladiesChroniques: true,
        utilisateur: { select: { prenom: true, nom: true } },
      },
    }),
    prisma.consultation.findMany({
      where: { idPatient },
      orderBy: { consulteeLE: 'desc' },
      take: 50,
      select: {
        id: true, consulteeLE: true, motifPrincipal: true, statut: true,
        episode: { select: { structure: { select: { nom: true } } } },
        asc: { select: { structure: { select: { nom: true } } } },
        medecinValideur: { select: { prenom: true, nom: true } },
        diagnostics: { select: { libelle: true, typeDiagnostic: true, statutClinique: true } },
        ordonnances: {
          select: {
            lignes: { select: { posologie: true, frequence: true, dureeJours: true, quantite: true, medicament: { select: { libelle: true } } } },
          },
        },
      },
    }),
    prisma.vaccination.findMany({
      where: { idPatient },
      orderBy: { administreLe: 'desc' },
      take: 50,
      select: { vaccinNom: true, administreLe: true, dateProchaineD: true },
    }),
    examensSuivisDuPatient(idPatient),
  ]);
  if (!patient) throw new NotFoundError('Patient non trouve');

  logger.info('[ACCES] historique lu', { idPatient, parQui: user.userId });
  return {
    patient: {
      prenom: patient.utilisateur.prenom,
      nom: patient.utilisateur.nom,
      dateNaissance: patient.dateNaissance.toISOString(),
      sexe: patient.sexe,
      groupeSanguin: patient.groupeSanguin,
      allergies: patient.allergies,
      maladiesChroniques: patient.maladiesChroniques,
    },
    consultations: consultations.map((c) => ({
      id: c.id,
      date: c.consulteeLE.toISOString(),
      motif: c.motifPrincipal,
      structure: c.episode?.structure.nom ?? c.asc?.structure?.nom ?? null,
      medecin: c.medecinValideur ? `Dr ${c.medecinValideur.prenom} ${c.medecinValideur.nom}` : null,
      diagnostics: c.diagnostics.map((d) => d.libelle),
      traitements: c.ordonnances.flatMap((o) => o.lignes.map((l) => ({
        produit: l.medicament.libelle, posologie: l.posologie, frequence: l.frequence, dureeJours: l.dureeJours, quantite: l.quantite,
      }))),
    })),
    vaccinations: vaccinations.map((v) => ({
      vaccin: v.vaccinNom,
      le: v.administreLe.toISOString(),
      prochaineDose: v.dateProchaineD?.toISOString() ?? null,
    })),
    examensSuivis,
  };
}
