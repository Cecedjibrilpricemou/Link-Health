// L'infirmier : il soigne sans prescrire.
//
// **Ce qu'il fait.** Il voit les patients en visite dans sa structure, lit le
// dossier de la visite - motif, allergies, ce que le medecin a prescrit -,
// prend les constantes, note ses soins et enregistre les vaccins.
//
// **Ce qu'il ne fait pas.** Ni ordonnance, ni demande d'analyse, ni cloture de
// la prise en charge, ni historique du patient hors de la visite : ce sont des
// actes du praticien, et leurs routes ne le laissent pas passer.
//
// **Le perimetre, c'est la visite ouverte dans sa structure.** Une visite
// close ou d'une autre structure lui est inconnue : il n'a pas a lire le
// dossier d'un patient qu'il ne soigne pas.
import { prisma } from '../config/prisma';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { nomDuPraticien } from '../utils/praticien.util';
import type { JwtPayload } from '../types/auth.types';
import { StatutEpisode } from '../config/generated/client/client';

/** Une visite que l'infirmier soigne encore. */
const VISITE_EN_COURS = [StatutEpisode.OUVERT, StatutEpisode.EN_COURS];

/** Les constantes d'un passage, toutes facultatives. */
const CONSTANTES = [
  'temperature', 'tensionSystolique', 'tensionDiastolique', 'frequenceCardiaque',
  'frequenceRespiratoire', 'spo2', 'poidsKg', 'glycemie',
] as const;
type Constante = (typeof CONSTANTES)[number];

export type SoinRecu = Partial<Record<Constante, number>> & { note?: string | undefined };

async function structureDe(user: JwtPayload): Promise<string> {
  const u = await prisma.utilisateur.findUnique({ where: { id: user.userId }, select: { idStructure: true } });
  if (!u?.idStructure) throw new ForbiddenError('Aucune structure rattachee a votre compte');
  return u.idStructure;
}

const PERSONNE = { select: { prenom: true, nom: true, role: true } } as const;

const SOIN_SELECT = {
  id: true, creeLe: true, note: true,
  temperature: true, tensionSystolique: true, tensionDiastolique: true, frequenceCardiaque: true,
  frequenceRespiratoire: true, spo2: true, poidsKg: true, glycemie: true,
  auteur: PERSONNE,
} as const;

type SoinLigne = {
  id: string; creeLe: Date; note: string | null; auteur: { prenom: string; nom: string; role: string };
} & Record<Constante, number | null>;

function versSoin(s: SoinLigne) {
  return {
    id: s.id,
    creeLe: s.creeLe.toISOString(),
    note: s.note,
    constantes: Object.fromEntries(CONSTANTES.map((c) => [c, s[c]])) as Record<Constante, number | null>,
    auteur: `${s.auteur.prenom} ${s.auteur.nom}`,
  };
}

/**
 * Les patients en visite dans sa structure : qui attend, depuis quand, pour
 * quoi, et quand il a ete vu pour la derniere fois.
 */
export async function patientsDuJour(user: JwtPayload) {
  const idStructure = await structureDe(user);
  const episodes = await prisma.episodeSoins.findMany({
    where: { idStructure, statut: { in: VISITE_EN_COURS } },
    orderBy: { ouvertLe: 'desc' },
    take: 200,
    select: {
      id: true, numero: true, motif: true, service: true, statut: true, ouvertLe: true,
      patient: { select: { id: true, dateNaissance: true, sexe: true, utilisateur: { select: { prenom: true, nom: true } } } },
      responsable: PERSONNE,
      soinsInfirmiers: { select: { creeLe: true }, orderBy: { creeLe: 'desc' }, take: 1 },
      _count: { select: { soinsInfirmiers: true } },
    },
  });
  return episodes.map((e) => ({
    idEpisode: e.id,
    numero: e.numero,
    motif: e.motif,
    service: e.service,
    statut: e.statut,
    ouvertLe: e.ouvertLe.toISOString(),
    patient: {
      id: e.patient.id,
      prenom: e.patient.utilisateur.prenom,
      nom: e.patient.utilisateur.nom,
      dateNaissance: e.patient.dateNaissance.toISOString(),
      sexe: e.patient.sexe,
    },
    responsable: e.responsable ? nomDuPraticien(e.responsable) : null,
    dernierSoinLe: e.soinsInfirmiers[0]?.creeLe.toISOString() ?? null,
    nombreSoins: e._count.soinsInfirmiers,
  }));
}

/** La visite, si elle est en cours dans sa structure ; sinon elle n'existe pas pour lui. */
async function visiteEnCours(user: JwtPayload, idEpisode: string) {
  const idStructure = await structureDe(user);
  const e = await prisma.episodeSoins.findFirst({
    where: { id: idEpisode, idStructure },
    select: { id: true, statut: true, idPatient: true },
  });
  if (!e) throw new NotFoundError('Visite introuvable dans votre structure');
  if (!(VISITE_EN_COURS as string[]).includes(e.statut)) {
    throw new ConflictError('Cette visite est terminee : elle ne se soigne plus.');
  }
  return e;
}

/**
 * Le dossier de la visite, pour soigner : qui est le patient, ce qui l'amene,
 * a quoi il est allergique, ce que le medecin a prescrit, ses vaccins, et les
 * soins deja faits.
 *
 * **Seulement la visite.** Ni les consultations d'autres visites, ni les
 * resultats d'analyse : ce qu'il faut pour soigner aujourd'hui, pas
 * l'historique du patient, qui reste au praticien et a l'accord du patient.
 */
export async function dossierDeVisite(user: JwtPayload, idEpisode: string) {
  const v = await visiteEnCours(user, idEpisode);
  const e = await prisma.episodeSoins.findUniqueOrThrow({
    where: { id: v.id },
    select: {
      id: true, numero: true, motif: true, service: true, statut: true, ouvertLe: true,
      responsable: PERSONNE,
      patient: {
        select: {
          id: true, dateNaissance: true, sexe: true, groupeSanguin: true, allergies: true, maladiesChroniques: true,
          utilisateur: { select: { prenom: true, nom: true } },
          vaccinations: {
            orderBy: { administreLe: 'desc' }, take: 10,
            select: { id: true, vaccinNom: true, administreLe: true, dateProchaineD: true },
          },
        },
      },
      consultations: {
        select: {
          ordonnances: {
            select: {
              creeLe: true,
              lignes: { select: { posologie: true, frequence: true, dureeJours: true, medicament: { select: { libelle: true } } } },
            },
          },
        },
      },
      soinsInfirmiers: { orderBy: { creeLe: 'desc' }, select: SOIN_SELECT },
    },
  });
  const p = e.patient;
  return {
    idEpisode: e.id,
    numero: e.numero,
    motif: e.motif,
    service: e.service,
    statut: e.statut,
    ouvertLe: e.ouvertLe.toISOString(),
    responsable: e.responsable ? nomDuPraticien(e.responsable) : null,
    patient: {
      id: p.id,
      prenom: p.utilisateur.prenom,
      nom: p.utilisateur.nom,
      dateNaissance: p.dateNaissance.toISOString(),
      sexe: p.sexe,
      groupeSanguin: p.groupeSanguin,
      allergies: p.allergies.filter(Boolean),
      maladiesChroniques: p.maladiesChroniques.filter(Boolean),
    },
    // Ce qu'il administre : les lignes prescrites pendant cette visite.
    prescriptions: e.consultations.flatMap((c) => c.ordonnances.flatMap((o) => o.lignes.map((l) => ({
      produit: l.medicament.libelle,
      posologie: l.posologie,
      frequence: l.frequence,
      dureeJours: l.dureeJours,
      prescritLe: o.creeLe.toISOString(),
    })))),
    vaccinations: p.vaccinations.map((x) => ({
      id: x.id,
      vaccin: x.vaccinNom,
      administreLe: x.administreLe.toISOString(),
      rappelLe: x.dateProchaineD?.toISOString() ?? null,
    })),
    soins: e.soinsInfirmiers.map(versSoin),
  };
}

/**
 * Noter un passage : des constantes, un soin, ou les deux. Un passage vide ne
 * dit rien au medecin qui le lira : il est refuse.
 */
export async function enregistrerSoin(user: JwtPayload, idEpisode: string, dto: SoinRecu) {
  const v = await visiteEnCours(user, idEpisode);
  const note = dto.note?.trim() || null;
  const constantes = Object.fromEntries(CONSTANTES.filter((c) => dto[c] !== undefined).map((c) => [c, dto[c]]));
  if (!note && Object.keys(constantes).length === 0) {
    throw new ValidationError('Notez au moins une constante ou le soin fait.');
  }
  const s = await prisma.soinInfirmier.create({
    data: { ...constantes, note, idEpisode: v.id, idAuteur: user.userId },
    select: SOIN_SELECT,
  });
  return versSoin(s);
}

/**
 * Les soins d'une visite, pour le praticien qui la suit : il lit les
 * constantes prises avant lui et les soins faits apres sa prescription.
 */
export async function soinsDeLaVisite(user: JwtPayload, idEpisode: string) {
  const u = await prisma.utilisateur.findUnique({
    where: { id: user.userId },
    select: { idStructure: true, medecinProfile: { select: { idStructure: true } } },
  });
  const idStructure = u?.idStructure ?? u?.medecinProfile?.idStructure;
  if (!idStructure) throw new ForbiddenError('Aucune structure rattachee a votre compte');
  const e = await prisma.episodeSoins.findFirst({ where: { id: idEpisode, idStructure }, select: { id: true } });
  if (!e) throw new NotFoundError('Visite introuvable dans votre structure');
  const soins = await prisma.soinInfirmier.findMany({
    where: { idEpisode: e.id }, orderBy: { creeLe: 'desc' }, select: SOIN_SELECT,
  });
  return soins.map(versSoin);
}
