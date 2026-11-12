// R15 : le patient demande lui-meme la correction de son identite.
//
// Il ne la fait pas. Une identite verifiee sur piece ne se reecrit pas sur
// simple declaration, et une identite provisoire sert deja a rapprocher les
// doublons : un nom change sans trace casse les deux. Le patient **demande**,
// avec sa raison ; l'accueil de sa structure decide.
//
// - Accepter applique la correction par le meme chemin que l'accueil
//   (`corrigerIdentite`) : l'ancienne valeur, l'agent et le motif sont gardes.
// - Refuser exige une reponse : le patient doit savoir quoi faire ensuite
//   (le plus souvent, venir avec sa piece).
// Dans les deux cas, il est prevenu.
import type {
  DemandeCorrectionIdentiteView, DemanderCorrectionIdentiteDto,
} from '@baobaoheath/shared-types';
import { StatutDemandeCorrection } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { ConflictError, NotFoundError, ValidationError } from '../utils/app-error';
import { assertCanAccessPatient, buildPatientWhereForUser } from './access-control.service';
import { corrigerIdentite, jourDe, lireDateNaissance } from './identite.service';
import { notifierSansBloquer } from './notification.service';

const TEXTE_MIN = 10;

const SELECTION = {
  id: true, statut: true, prenom: true, nom: true, sexe: true, dateNaissance: true,
  justification: true, reponse: true, creeLe: true, traiteeLe: true,
  traitePar: { select: { prenom: true, nom: true } },
} as const;

type Ligne = {
  id: string; statut: StatutDemandeCorrection; prenom: string | null; nom: string | null; sexe: string | null;
  dateNaissance: string | null; justification: string; reponse: string | null; creeLe: Date; traiteeLe: Date | null;
  traitePar: { prenom: string; nom: string } | null;
  patient?: { id: string; sexe: string; dateNaissance: Date; utilisateur: { prenom: string; nom: string } };
};

function enVue(l: Ligne): DemandeCorrectionIdentiteView {
  return {
    id: l.id,
    statut: l.statut,
    demande: {
      ...(l.prenom ? { prenom: l.prenom } : {}),
      ...(l.nom ? { nom: l.nom } : {}),
      ...(l.sexe ? { sexe: l.sexe } : {}),
      ...(l.dateNaissance ? { dateNaissance: l.dateNaissance } : {}),
    },
    justification: l.justification,
    reponse: l.reponse,
    creeLe: l.creeLe.toISOString(),
    traiteeLe: l.traiteeLe?.toISOString() ?? null,
    traitePar: l.traitePar ? `${l.traitePar.prenom} ${l.traitePar.nom}` : null,
    ...(l.patient
      ? {
          patient: {
            id: l.patient.id,
            prenom: l.patient.utilisateur.prenom,
            nom: l.patient.utilisateur.nom,
            sexe: l.patient.sexe,
            dateNaissance: jourDe(l.patient.dateNaissance),
          },
        }
      : {}),
  };
}

/** Le dossier du patient connecte ; apres une fusion, le principal. */
async function dossierDuPatient(userId: string) {
  const sien = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true, idFusionneDans: true },
  });
  if (!sien) throw new NotFoundError('Profil patient non trouve');
  const id = sien.idFusionneDans ?? sien.id;
  const dossier = await prisma.patientProfile.findUnique({
    where: { id },
    select: { id: true, sexe: true, dateNaissance: true, utilisateur: { select: { prenom: true, nom: true } } },
  });
  if (!dossier) throw new NotFoundError('Profil patient non trouve');
  return dossier;
}

export async function demanderCorrection(
  userId: string,
  dto: DemanderCorrectionIdentiteDto,
  maintenant = new Date(),
): Promise<DemandeCorrectionIdentiteView> {
  const justification = dto.justification.trim();
  if (justification.length < TEXTE_MIN) {
    throw new ValidationError('Dites en une phrase pourquoi : cela aide l accueil a verifier (dix caracteres au moins)');
  }
  const dossier = await dossierDuPatient(userId);

  // Seuls les traits qui different de l'actuel : demander la meme chose ne
  // demande rien.
  const prenom = dto.prenom?.trim();
  const nom = dto.nom?.trim();
  const data = {
    prenom: prenom && prenom !== dossier.utilisateur.prenom ? prenom : null,
    nom: nom && nom !== dossier.utilisateur.nom ? nom : null,
    sexe: dto.sexe && dto.sexe !== dossier.sexe ? dto.sexe : null,
    dateNaissance: null as string | null,
  };
  if (dto.dateNaissance) {
    const jour = jourDe(lireDateNaissance(dto.dateNaissance, maintenant));
    if (jour !== jourDe(dossier.dateNaissance)) data.dateNaissance = jour;
  }
  if (!data.prenom && !data.nom && !data.sexe && !data.dateNaissance) {
    throw new ValidationError('Aucun changement : les valeurs saisies sont deja celles de votre dossier');
  }

  const enAttente = await prisma.demandeCorrectionIdentite.count({
    where: { idPatient: dossier.id, statut: StatutDemandeCorrection.EN_ATTENTE },
  });
  if (enAttente > 0) {
    throw new ConflictError("Une demande est deja en attente : l'accueil doit d'abord y repondre");
  }

  const creee = await prisma.demandeCorrectionIdentite.create({
    data: { ...data, justification, idPatient: dossier.id, creeLe: maintenant },
    select: SELECTION,
  });
  return enVue(creee as Ligne);
}

export async function mesDemandes(userId: string): Promise<DemandeCorrectionIdentiteView[]> {
  const dossier = await dossierDuPatient(userId);
  const lignes = await prisma.demandeCorrectionIdentite.findMany({
    where: { idPatient: dossier.id },
    orderBy: { creeLe: 'desc' },
    take: 10,
    select: SELECTION,
  });
  return (lignes as Ligne[]).map(enVue);
}

/** Les demandes en attente des patients de **son** perimetre, les plus anciennes d'abord. */
export async function demandesEnAttente(user: JwtPayload): Promise<DemandeCorrectionIdentiteView[]> {
  const perimetre = await buildPatientWhereForUser(user);
  const lignes = await prisma.demandeCorrectionIdentite.findMany({
    where: { statut: StatutDemandeCorrection.EN_ATTENTE, patient: perimetre },
    orderBy: { creeLe: 'asc' },
    take: 50,
    select: {
      ...SELECTION,
      patient: { select: { id: true, sexe: true, dateNaissance: true, utilisateur: { select: { prenom: true, nom: true } } } },
    },
  });
  return (lignes as Ligne[]).map(enVue);
}

async function demandeATraiter(user: JwtPayload, idDemande: string) {
  const demande = await prisma.demandeCorrectionIdentite.findUnique({
    where: { id: idDemande },
    select: {
      id: true, statut: true, prenom: true, nom: true, sexe: true, dateNaissance: true, justification: true,
      idPatient: true, patient: { select: { idUtilisateur: true } },
    },
  });
  if (!demande) throw new NotFoundError('Demande non trouvee');
  await assertCanAccessPatient(user, demande.idPatient);
  if (demande.statut !== StatutDemandeCorrection.EN_ATTENTE) {
    throw new ConflictError('Cette demande a deja ete traitee');
  }
  return demande;
}

/**
 * Accepter : la correction passe par `corrigerIdentite`, avec l'ancienne
 * valeur et l'agent. Le motif de l'agent dit ce qu'il a vu (« acte de
 * naissance presente »), la raison du patient l'accompagne.
 */
export async function accepterDemande(
  user: JwtPayload,
  idDemande: string,
  dto: { motif: string },
  maintenant = new Date(),
): Promise<DemandeCorrectionIdentiteView> {
  const motif = dto.motif.trim();
  if (motif.length < TEXTE_MIN) {
    throw new ValidationError("Dites ce que vous avez verifie (dix caracteres au moins) : c'est ce qui rend la correction contestable");
  }
  const demande = await demandeATraiter(user, idDemande);

  // Correction d'abord : si deux agents acceptent en meme temps, le second
  // trouve l'identite deja corrigee et s'arrete la (« Aucun changement »).
  await corrigerIdentite(user, demande.idPatient, {
    ...(demande.prenom ? { prenom: demande.prenom } : {}),
    ...(demande.nom ? { nom: demande.nom } : {}),
    ...(demande.sexe ? { sexe: demande.sexe as 'M' | 'F' } : {}),
    ...(demande.dateNaissance ? { dateNaissance: demande.dateNaissance } : {}),
    motif: `${motif} (demande du patient : ${demande.justification})`,
  }, maintenant);

  const traitee = await prisma.demandeCorrectionIdentite.updateMany({
    where: { id: idDemande, statut: StatutDemandeCorrection.EN_ATTENTE },
    data: { statut: StatutDemandeCorrection.ACCEPTEE, traiteeLe: maintenant, idTraitePar: user.userId, reponse: motif },
  });
  if (traitee.count !== 1) throw new ConflictError('Cette demande a deja ete traitee');

  await notifierSansBloquer({
    idUtilisateur: demande.patient.idUtilisateur,
    type: 'IDENTITE_DEMANDE_TRAITEE',
    titre: 'Votre identite a ete corrigee',
    contenu: "L'accueil a accepte votre demande de correction. Votre dossier est a jour.",
    lienAction: '/patient/profil',
    metadonnees: { idDemande },
  });
  return relire(idDemande);
}

/** Refuser, en disant pourquoi : le patient doit savoir quoi faire ensuite. */
export async function refuserDemande(
  user: JwtPayload,
  idDemande: string,
  dto: { reponse: string },
  maintenant = new Date(),
): Promise<DemandeCorrectionIdentiteView> {
  const reponse = dto.reponse.trim();
  if (reponse.length < TEXTE_MIN) {
    throw new ValidationError('Dites au patient pourquoi, et quoi faire (dix caracteres au moins)');
  }
  const demande = await demandeATraiter(user, idDemande);

  const traitee = await prisma.demandeCorrectionIdentite.updateMany({
    where: { id: idDemande, statut: StatutDemandeCorrection.EN_ATTENTE },
    data: { statut: StatutDemandeCorrection.REFUSEE, traiteeLe: maintenant, idTraitePar: user.userId, reponse },
  });
  if (traitee.count !== 1) throw new ConflictError('Cette demande a deja ete traitee');

  await notifierSansBloquer({
    idUtilisateur: demande.patient.idUtilisateur,
    type: 'IDENTITE_DEMANDE_TRAITEE',
    titre: "Votre demande de correction n'a pas ete acceptee",
    contenu: `Reponse de l'accueil : ${reponse}`,
    lienAction: '/patient/profil',
    metadonnees: { idDemande },
  });
  return relire(idDemande);
}

async function relire(idDemande: string): Promise<DemandeCorrectionIdentiteView> {
  const ligne = await prisma.demandeCorrectionIdentite.findUnique({ where: { id: idDemande }, select: SELECTION });
  if (!ligne) throw new NotFoundError('Demande non trouvee');
  return enVue(ligne as Ligne);
}
