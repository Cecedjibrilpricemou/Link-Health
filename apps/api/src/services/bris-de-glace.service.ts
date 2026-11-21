import { MotifBrisDeGlace, Prisma, Role } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { notifierSansBloquer } from './notification.service';
import type { BrisDeGlaceView, MotifRefusBrisDeGlace } from '@baobaoheath/shared-types';

/**
 * Bris de glace : l'acces en urgence a un dossier auquel on n'a pas droit
 * (EF-02-06).
 *
 * ## Pourquoi cette porte doit exister
 *
 * Un patient arrive inconscient dans un service qui ne le suit pas. Le
 * soignant a besoin de ses allergies, tout de suite. Un controle d'acces sans
 * porte de secours ferait prescrire a l'aveugle — et la regle serait contournee
 * autrement, par un compte prete ou un mot de passe partage, sans laisser la
 * moindre trace. Une porte declaree vaut mieux qu'une porte derobee.
 *
 * ## Pourquoi ce n'est pas un passe-partout
 *
 *   - **un motif est exige**, pris dans une liste fermee *et* explique en
 *     toutes lettres. La liste permet de compter, le texte permet de juger ;
 *   - **l'acces expire.** Sans expiration, le premier bris de glace deviendrait
 *     la facon normale d'entrer ;
 *   - **le patient est prevenu.** C'est ce qui separe un acces d'urgence assume
 *     d'une porte derobee ;
 *   - **l'administration repasse derriere.** Un garde-fou que personne ne relit
 *     n'est pas un garde-fou ;
 *   - **la declaration ne se reecrit pas** : un declencheur PostgreSQL refuse de
 *     toucher au motif, au patient, a l'auteur et aux dates. Quelqu'un qui
 *     pourrait changer son motif apres coup n'aurait rien declare.
 */

/**
 * Combien de temps la vitre reste cassee.
 *
 * **Quatre heures, et c'est un choix discutable.** Assez pour une prise en
 * charge d'urgence et les examens qui suivent ; trop court pour couvrir une
 * garde entiere, ce qui est voulu — un soignant qui a encore besoin du dossier
 * le lendemain doit le redeclarer, et ce second geste se verra. La valeur n'est
 * pas calibree sur du terrain : elle est ici, nommee, pour pouvoir etre
 * discutee.
 */
export const DUREE_HEURES = 4;

/**
 * Les roles qui peuvent briser la glace.
 *
 * **Volontairement etroit : ceux qui donnent des soins.** Un agent d'accueil
 * ou un administrateur de structure n'a aucune raison de lire un dossier
 * medical en urgence — et leur ouvrir cette porte ferait de l'exception la
 * regle. Un pharmacien non plus : il verifie une ordonnance, qui lui est
 * presentee.
 */
export const ROLES_AUTORISES: Role[] = [Role.MEDECIN, Role.SAGE_FEMME, Role.ASC, Role.ASC_SUPERVISOR];

export const EXPLICATION_MIN = 20;

/**
 * Pourquoi la declaration est refusee, ou `null` si elle peut etre faite.
 *
 * Fonction pure, exportee et testee a part : c'est elle qui tient la porte.
 */
export function motifDeRefus(
  auteur: { userId: string; role: Role },
  patient: { id: string; idUtilisateur: string } | null,
  explication: string
): MotifRefusBrisDeGlace | null {
  if (!patient) return 'PATIENT_INTROUVABLE';
  if (!ROLES_AUTORISES.includes(auteur.role)) return 'ROLE_NON_AUTORISE';

  // **On ne brise pas la glace sur son propre dossier.** Il est deja ouvert, et
  // le faire creerait une trace d'urgence qui n'en est pas une.
  if (patient.idUtilisateur === auteur.userId) return 'SON_PROPRE_DOSSIER';

  if (explication.trim().length < EXPLICATION_MIN) return 'EXPLICATION_TROP_COURTE';
  return null;
}

const SELECTION = {
  id: true, motif: true, explication: true, ouvertLe: true, expireLe: true,
  refermeLe: true, statutRevue: true, avisRevue: true, revuLe: true, notifieLe: true,
  patient: {
    select: { id: true, utilisateur: { select: { prenom: true, nom: true } } },
  },
  auteur: { select: { id: true, prenom: true, nom: true, role: true } },
  revuPar: { select: { prenom: true, nom: true } },
  structure: { select: { nom: true } },
} satisfies Prisma.BrisDeGlaceSelect;

type Brut = Prisma.BrisDeGlaceGetPayload<{ select: typeof SELECTION }>;

/**
 * Encore ouvert ?
 *
 * Fonction pure : **la meme regle sert a l'affichage et au controle d'acces**.
 * Deux regles separees finiraient par diverger, et c'est l'ecran qui mentirait.
 */
export function estOuvert(
  b: { expireLe: Date; refermeLe: Date | null },
  maintenant = new Date()
): boolean {
  return b.refermeLe === null && b.expireLe > maintenant;
}

export function vue(b: Brut, maintenant = new Date()): BrisDeGlaceView {
  return {
    id: b.id,
    motif: b.motif,
    explication: b.explication,
    ouvertLe: b.ouvertLe.toISOString(),
    expireLe: b.expireLe.toISOString(),
    refermeLe: b.refermeLe?.toISOString() ?? null,
    ouvert: estOuvert(b, maintenant),
    statutRevue: b.statutRevue,
    avisRevue: b.avisRevue,
    revuLe: b.revuLe?.toISOString() ?? null,
    revuPar: b.revuPar ? `${b.revuPar.prenom} ${b.revuPar.nom}` : null,
    // **`null` dit que la notification a echoue**, et cela se voit au lieu de
    // se perdre : un bris de glace dont le patient n'a pas ete prevenu n'est
    // qu'a moitie declare.
    notifieLe: b.notifieLe?.toISOString() ?? null,
    patient: {
      id: b.patient.id,
      nomComplet: `${b.patient.utilisateur.prenom} ${b.patient.utilisateur.nom}`,
    },
    auteur: {
      id: b.auteur.id,
      nomComplet: `${b.auteur.prenom} ${b.auteur.nom}`,
      role: b.auteur.role,
    },
    structure: b.structure?.nom ?? null,
  };
}

/**
 * Declarer un acces en urgence.
 *
 * Le patient est prevenu dans la foulee. **L'echec de la notification ne fait
 * pas echouer la declaration** : refuser l'acces parce qu'un message n'est pas
 * parti laisserait un soignant devant un patient inconscient. Mais le manque se
 * voit — `notifieLe` reste nul, et l'ecran de revue le signale.
 */
export async function declarer(
  auteur: { userId: string; role: Role },
  dto: { idPatient: string; motif: MotifBrisDeGlace; explication: string },
  maintenant = new Date()
): Promise<{ bris: BrisDeGlaceView } | { refus: MotifRefusBrisDeGlace }> {
  const patient = await prisma.patientProfile.findUnique({
    where: { id: dto.idPatient },
    select: { id: true, idUtilisateur: true },
  });

  const refus = motifDeRefus(auteur, patient, dto.explication);
  if (refus) return { refus };

  const u = await prisma.utilisateur.findUnique({
    where: { id: auteur.userId },
    select: {
      prenom: true, nom: true, idStructure: true,
      ascProfile: { select: { idStructure: true } },
      medecinProfile: { select: { idStructure: true } },
    },
  });

  const b = await prisma.brisDeGlace.create({
    data: {
      motif: dto.motif,
      explication: dto.explication.trim(),
      idPatient: dto.idPatient,
      idAuteur: auteur.userId,
      idStructure:
        u?.idStructure ?? u?.ascProfile?.idStructure ?? u?.medecinProfile?.idStructure ?? null,
      ouvertLe: maintenant,
      expireLe: new Date(maintenant.getTime() + DUREE_HEURES * 3600_000),
    },
    select: SELECTION,
  });

  // **Le patient est prevenu.** C'est ce qui separe un acces d'urgence assume
  // d'une porte derobee.
  try {
    await notifierSansBloquer({
      idUtilisateur: patient!.idUtilisateur,
      type: 'ALERTE_VITALE',
      titre: 'Votre dossier a été ouvert en urgence',
      // Le lien mene a « Qui a accede a mon dossier » : la notification ne se
      // contente pas d'alerter, elle amene la ou l'on peut verifier.
      lienAction: '/patient/consentements',
      contenu:
        `${u?.prenom ?? ''} ${u?.nom ?? ''} a ouvert votre dossier en urgence. `
        + `Motif déclaré : ${dto.explication.trim()} `
        + `Cet accès se referme automatiquement. Vous pouvez le consulter dans `
        + `« Qui a accédé à mon dossier ».`,
    });
    await prisma.brisDeGlace.update({
      where: { id: b.id },
      data: { notifieLe: new Date() },
    });
    return { bris: vue({ ...b, notifieLe: new Date() }, maintenant) };
  } catch {
    // On ne refuse pas l'acces parce qu'une notification n'est pas partie :
    // il y a un patient inconscient au bout. Le manque reste visible.
    return { bris: vue(b, maintenant) };
  }
}

/** Refermer avant l'heure. Le geste honnete quand on n'a plus besoin du dossier. */
export async function refermer(
  auteur: { userId: string },
  id: string
): Promise<{ bris: BrisDeGlaceView } | { refus: MotifRefusBrisDeGlace }> {
  const b = await prisma.brisDeGlace.findUnique({
    where: { id },
    select: { idAuteur: true, refermeLe: true },
  });
  if (!b) return { refus: 'BRIS_INTROUVABLE' };
  // **Seul celui qui a brise la vitre la referme.** Un tiers qui refermerait
  // l'acces de quelqu'un d'autre le laisserait devant un dossier qu'il
  // consultait peut-etre encore.
  if (b.idAuteur !== auteur.userId) return { refus: 'PAS_VOTRE_ACCES' };
  if (b.refermeLe) return { refus: 'DEJA_REFERME' };

  const maj = await prisma.brisDeGlace.update({
    where: { id },
    data: { refermeLe: new Date() },
    select: SELECTION,
  });
  return { bris: vue(maj) };
}

/**
 * Les dossiers qu'un soignant peut lire grace a un bris de glace en cours.
 *
 * **Ni referme, ni expire.** Une requete qui oublierait l'une des deux
 * conditions laisserait la porte ouverte pour toujours.
 */
export async function dossiersOuvertsPour(
  userId: string,
  maintenant = new Date()
): Promise<string[]> {
  const bs = await prisma.brisDeGlace.findMany({
    where: { idAuteur: userId, refermeLe: null, expireLe: { gt: maintenant } },
    select: { idPatient: true },
  });
  return bs.map((b) => b.idPatient);
}

/** La liste pour l'administration, ou pour un soignant sur ses propres acces. */
export async function lister(
  filtres: { idAuteur?: string; idPatient?: string; aRevoirSeulement?: boolean },
  limite = 100
): Promise<BrisDeGlaceView[]> {
  const bs = await prisma.brisDeGlace.findMany({
    where: {
      ...(filtres.idAuteur ? { idAuteur: filtres.idAuteur } : {}),
      ...(filtres.idPatient ? { idPatient: filtres.idPatient } : {}),
      ...(filtres.aRevoirSeulement ? { statutRevue: 'A_REVOIR' } : {}),
    },
    orderBy: { ouvertLe: 'desc' },
    take: limite,
    select: SELECTION,
  });
  const maintenant = new Date();
  return bs.map((b) => vue(b, maintenant));
}

/**
 * Rendre une revue.
 *
 * **Un avis est exige, meme pour dire que l'acces etait fonde.** Une case
 * cochee sans phrase ne permet pas de savoir si quelqu'un a reellement regarde.
 */
export async function reviser(
  relecteur: { userId: string },
  id: string,
  dto: { statut: 'JUSTIFIE' | 'INJUSTIFIE'; avis: string }
): Promise<{ bris: BrisDeGlaceView } | { refus: MotifRefusBrisDeGlace }> {
  if (dto.avis.trim().length < EXPLICATION_MIN) return { refus: 'AVIS_TROP_COURT' };

  const b = await prisma.brisDeGlace.findUnique({
    where: { id },
    select: { idAuteur: true, statutRevue: true },
  });
  if (!b) return { refus: 'BRIS_INTROUVABLE' };
  // **On ne relit pas son propre acces.** Un garde-fou qu'on s'applique a
  // soi-meme n'en est pas un.
  if (b.idAuteur === relecteur.userId) return { refus: 'PAS_SON_PROPRE_ACCES' };
  if (b.statutRevue !== 'A_REVOIR') return { refus: 'DEJA_REVU' };

  const maj = await prisma.brisDeGlace.update({
    where: { id },
    data: {
      statutRevue: dto.statut,
      avisRevue: dto.avis.trim(),
      revuLe: new Date(),
      idRevuPar: relecteur.userId,
    },
    select: SELECTION,
  });
  return { bris: vue(maj) };
}
