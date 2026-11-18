import { Role } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { deconnecterUtilisateur } from '../realtime/socket.server';
import type { CompteView, SuspensionView } from '@baobaoheath/shared-types';

/**
 * Suspendre et reactiver un compte (EF-12-01).
 *
 * « Immediate » est le mot du cahier des charges, et il engage. Ce service
 * ferme donc **trois portes a la fois** :
 *
 *   1. `estActif = false` — chaque requete HTTP relit la session en base, donc
 *      le refus est effectif des la requete suivante. C'etait deja le cas ;
 *   2. **les sessions sont supprimees** — sans quoi elles tiennent jusqu'a
 *      leur expiration, et le compte parait encore ouvert ;
 *   3. **les connexions temps reel sont coupees** — un socket n'est
 *      authentifie qu'a la poignee de main. Un compte suspendu continuait de
 *      recevoir les notifications de ses patients jusqu'a ce qu'il ferme son
 *      navigateur, alors que la moindre requete HTTP lui etait refusee. C'est
 *      le trou que ce bloc comble.
 *
 * Le motif est **obligatoire** : une suspension coupe un soignant de ses
 * patients, et une mesure qu'on ne peut pas expliquer ne peut pas etre
 * contestee. Une contrainte SQL le refuse aussi, pour que la regle ne depende
 * pas de ce fichier.
 */

/** En deca, un motif ne dit rien d'utile — « non » ou « rgpd » n'expliquent rien. */
const MOTIF_MIN = 10;

type Auteur = { userId: string; role: Role };

function enVue(u: {
  id: string; prenom: string; nom: string; email: string | null; telephone: string;
  role: Role; estActif: boolean; suspenduLe: Date | null; motifSuspension: string | null;
  derniereConnexion: Date | null;
  numeroOrdre?: string | null; ordreVerifieLe?: Date | null;
  suspenduPar: { prenom: string; nom: string } | null;
  structure: { nom: string } | null;
}): CompteView {
  return {
    id: u.id,
    prenom: u.prenom,
    nom: u.nom,
    email: u.email,
    telephone: u.telephone,
    role: u.role,
    estActif: u.estActif,
    structure: u.structure?.nom ?? null,
    derniereConnexion: u.derniereConnexion?.toISOString() ?? null,
    suspension: u.suspenduLe
      ? {
          suspenduLe: u.suspenduLe.toISOString(),
          motif: u.motifSuspension ?? '',
          parQui: u.suspenduPar ? `${u.suspenduPar.prenom} ${u.suspenduPar.nom}` : null,
        }
      : null,
    // Un compte ferme sans date ni motif vient de l'ancienne voie
    // (`desactiverAgent`, reservee a l'admin de structure). On le dit plutot
    // que de laisser croire a une suspension documentee : 15 comptes de la
    // base de demonstration sont dans ce cas.
    fermeSansMotif: !u.estActif && u.suspenduLe === null,
    // EF-01-08 : l'ecran doit pouvoir dire qui attend la verification de son
    // ordre - sans elle, le compte ne s'active pas, et le nom n'est pas fige.
    soumisOrdre: ROLES_A_ORDRE.includes(u.role),
    numeroOrdre: u.numeroOrdre ?? null,
    ordreVerifieLe: u.ordreVerifieLe?.toISOString() ?? null,
  };
}

const SELECTION = {
  id: true, prenom: true, nom: true, email: true, telephone: true, role: true,
  numeroOrdre: true, ordreVerifieLe: true,
  estActif: true, suspenduLe: true, motifSuspension: true, derniereConnexion: true,
  suspenduPar: { select: { prenom: true, nom: true } },
  structure: { select: { nom: true } },
};

export async function rechercher(filtres: {
  q?: string; role?: Role; actifs?: boolean; page?: number; limit?: number;
}): Promise<{ comptes: CompteView[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, filtres.page ?? 1);
  const limit = Math.min(filtres.limit ?? 25, 100);

  // Cet ecran administre les professionnels, pas les dossiers des patients :
  // exclure PATIENT cote serveur, meme si le client demande explicitement ce role.
  const where: Record<string, unknown> = { role: { not: Role.PATIENT } };
  if (filtres.role) where['AND'] = [{ role: filtres.role }];
  if (filtres.actifs !== undefined) where['estActif'] = filtres.actifs;
  if (filtres.q) {
    const q = filtres.q.trim();
    where['OR'] = [
      { nom: { contains: q, mode: 'insensitive' } },
      { prenom: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { telephone: { contains: q } },
    ];
  }

  const [lignes, total] = await Promise.all([
    prisma.utilisateur.findMany({
      where,
      select: SELECTION,
      orderBy: [{ estActif: 'asc' }, { nom: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.utilisateur.count({ where }),
  ]);

  return { comptes: lignes.map(enVue), total, page, limit };
}

/**
 * Les raisons de refuser une suspension.
 *
 * Fonction pure, exportee : ce sont les garde-fous, et ils doivent pouvoir
 * etre eprouves sans base.
 */
export function motifDeRefus(
  auteur: Auteur,
  cible: { id: string; role: Role; estActif: boolean },
  autresAdminsActifs: number
): string | null {
  // Se suspendre soi-meme enferme dehors immediatement, et personne d'autre
  // ne peut forcement rouvrir.
  if (auteur.userId === cible.id) {
    return 'Vous ne pouvez pas suspendre votre propre compte';
  }

  if (!cible.estActif) {
    return 'Ce compte est deja ferme';
  }

  // Un ADMIN_NATIONAL ne suspend pas un SUPER_ADMIN : la hierarchie ne
  // s'inverse pas.
  if (cible.role === 'SUPER_ADMIN' && auteur.role !== 'SUPER_ADMIN') {
    return "Seul un super administrateur peut suspendre un super administrateur";
  }

  // **Le garde-fou qui compte.** La base de demonstration ne porte qu'un seul
  // SUPER_ADMIN actif : le suspendre laisserait la plateforme entiere sans
  // administration, sans moyen de revenir en arriere.
  if (cible.role === 'SUPER_ADMIN' && autresAdminsActifs === 0) {
    return "C'est le dernier super administrateur actif : le suspendre laisserait la plateforme sans administration";
  }

  return null;
}

export async function suspendre(
  auteur: Auteur,
  idCible: string,
  motif: string
): Promise<SuspensionView> {
  const propre = motif.trim();
  if (propre.length < MOTIF_MIN) {
    throw new ValidationError(
      `Le motif doit faire au moins ${MOTIF_MIN} caracteres : une suspension qu'on ne peut pas expliquer ne peut pas etre contestee`
    );
  }

  const cible = await prisma.utilisateur.findUnique({
    where: { id: idCible },
    select: { id: true, role: true, estActif: true, prenom: true, nom: true },
  });
  if (!cible) throw new NotFoundError('Compte introuvable');

  const autresAdminsActifs = cible.role === 'SUPER_ADMIN'
    ? await prisma.utilisateur.count({
        where: { role: 'SUPER_ADMIN', estActif: true, id: { not: cible.id } },
      })
    : 1;

  const refus = motifDeRefus(auteur, cible, autresAdminsActifs);
  if (refus) throw new ForbiddenError(refus);

  // Reclamation atomique : deux administrateurs qui suspendent en meme temps
  // ne doivent pas produire deux traces contradictoires. `count === 0` veut
  // dire que quelqu'un est passe avant.
  const { count } = await prisma.utilisateur.updateMany({
    where: { id: cible.id, estActif: true },
    data: {
      estActif: false,
      suspenduLe: new Date(),
      motifSuspension: propre,
      idSuspenduPar: auteur.userId,
    },
  });
  if (count === 0) throw new ForbiddenError('Ce compte vient d etre ferme par quelqu un d autre');

  // Les trois portes. L'ordre compte : on ferme le compte d'abord, pour
  // qu'une reconnexion immediate soit refusee, et on coupe ensuite.
  const sessionsFermees = (await prisma.session.deleteMany({ where: { idUtilisateur: cible.id } })).count;
  const socketsFermes = await deconnecterUtilisateur(cible.id, propre).catch((error: unknown) => {
    // Un echec cote temps reel ne doit pas annuler la suspension : le compte
    // est deja ferme, et chaque requete HTTP le verifie.
    logger.error('[SUSPENSION] fermeture des sockets echouee', { idCible: cible.id, error });
    return 0;
  });

  logger.info('[SUSPENSION] compte ferme', {
    idCible: cible.id, parQui: auteur.userId, sessionsFermees, socketsFermes,
  });

  return {
    id: cible.id,
    nomComplet: `${cible.prenom} ${cible.nom}`,
    estActif: false,
    motif: propre,
    sessionsFermees,
    socketsFermes,
  };
}

/**
 * Les roles inscrits a un ordre professionnel (EF-01-08).
 *
 * Ni l'accueil ni l'administration n'y figurent : il n'existe pas d'ordre des
 * agents d'accueil, et exiger un numero qu'on ne peut pas produire bloquerait
 * des comptes legitimes.
 */
export const ROLES_A_ORDRE: Role[] = ['MEDECIN', 'PHARMACIEN', 'ASC', 'ASC_SUPERVISOR', 'TECHNICIEN_LABO'];

/**
 * Enregistrer qu'un numero d'ordre a ete confronte au registre (EF-01-08).
 *
 * **C'est une declaration d'administrateur, pas un appel a une API.** Il
 * n'existe pas de registre national interrogeable ; un humain regarde, et son
 * nom reste. Meme forme que la verification d'identite (EF-01-04).
 */
export async function verifierOrdre(
  auteur: Auteur,
  idCible: string,
  numeroOrdre: string
): Promise<{ id: string; nomComplet: string; numeroOrdre: string; verifieLe: string }> {
  const cible = await prisma.utilisateur.findUnique({
    where: { id: idCible },
    select: { id: true, role: true, prenom: true, nom: true },
  });
  if (!cible) throw new NotFoundError('Compte introuvable');
  if (!ROLES_A_ORDRE.includes(cible.role)) {
    throw new ValidationError(`Le role ${cible.role} ne releve d'aucun ordre professionnel`);
  }

  const maj = await prisma.utilisateur.update({
    where: { id: cible.id },
    data: {
      numeroOrdre: numeroOrdre.trim(),
      ordreVerifieLe: new Date(),
      idOrdreVerifiePar: auteur.userId,
    },
    select: { numeroOrdre: true, ordreVerifieLe: true },
  });

  logger.info('[ORDRE] numero verifie', { idCible: cible.id, parQui: auteur.userId });

  return {
    id: cible.id,
    nomComplet: `${cible.prenom} ${cible.nom}`,
    numeroOrdre: maj.numeroOrdre!,
    verifieLe: maj.ordreVerifieLe!.toISOString(),
  };
}

export async function reactiver(auteur: Auteur, idCible: string): Promise<SuspensionView> {
  const cible = await prisma.utilisateur.findUnique({
    where: { id: idCible },
    select: { id: true, role: true, estActif: true, prenom: true, nom: true, ordreVerifieLe: true },
  });
  if (!cible) throw new NotFoundError('Compte introuvable');
  if (cible.estActif) throw new ValidationError('Ce compte est deja actif');

  // **Un soignant dont le numero d'ordre n'a pas ete verifie ne soigne pas**
  // (EF-01-08). C'est le seul moment ou l'on peut encore l'exiger : apres,
  // le compte est ouvert.
  if (ROLES_A_ORDRE.includes(cible.role) && !cible.ordreVerifieLe) {
    throw new ValidationError(
      "Le numero d'ordre de ce compte n'a pas ete verifie. Verifiez-le avant de l'activer : "
      + "un soignant dont l'inscription n'est pas confirmee ne doit pas acceder a des dossiers."
    );
  }

  if (cible.role === 'SUPER_ADMIN' && auteur.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Seul un super administrateur peut reactiver un super administrateur');
  }

  // La fiche ne garde aucune trace de la suspension levee — la contrainte SQL
  // l'exige, et c'est voulu : un compte actif qui afficherait encore un motif
  // de suspension serait trompeur. **Le journal d'audit, lui, garde tout** :
  // il est en ajout seul, et c'est la qu'une enquete retrouvera l'histoire.
  const { count } = await prisma.utilisateur.updateMany({
    where: { id: cible.id, estActif: false },
    data: { estActif: true, suspenduLe: null, motifSuspension: null, idSuspenduPar: null },
  });
  if (count === 0) throw new ValidationError('Ce compte vient d etre reactive par quelqu un d autre');

  logger.info('[SUSPENSION] compte reactive', { idCible: cible.id, parQui: auteur.userId });

  return {
    id: cible.id,
    nomComplet: `${cible.prenom} ${cible.nom}`,
    estActif: true,
    motif: null,
    sessionsFermees: 0,
    socketsFermes: 0,
  };
}

// ── Le nom d'un professionnel ────────────────────────────────────────

/**
 * Un professionnel peut-il changer lui-meme son prenom ou son nom ?
 *
 * Tant que son numero d'ordre n'est pas verifie, oui. Ensuite, non : son nom
 * est celui que l'administration a confronte au registre de l'ordre, et il
 * figure sur les ordonnances qu'il signe. Le changer seul couperait le lien
 * entre la signature et l'inscription verifiee. La correction passe alors par
 * l'administration (`corrigerNom`), avec un motif et une trace.
 *
 * Appelee par `PUT /auth/profile`, comme la regle du patient (R15).
 */
export async function assertNomModifiableParLeProfessionnel(
  userId: string,
  souhait: { prenom?: string; nom?: string },
): Promise<void> {
  if (!souhait.prenom && !souhait.nom) return;
  const actuel = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: { role: true, prenom: true, nom: true, ordreVerifieLe: true },
  });
  if (!actuel || !ROLES_A_ORDRE.includes(actuel.role) || !actuel.ordreVerifieLe) return;
  const change = (souhait.prenom && souhait.prenom.trim() !== actuel.prenom)
    || (souhait.nom && souhait.nom.trim() !== actuel.nom);
  if (change) {
    throw new ForbiddenError(
      "Votre nom a ete verifie avec votre numero d'ordre : pour le corriger, adressez-vous a l'administration de la plateforme"
    );
  }
}

/**
 * L'administration corrige le nom d'un compte professionnel, avec un motif.
 *
 * **La trace garde l'avant et l'apres.** Le journal d'audit enregistre deja
 * la requete, mais pas ce qu'il y avait avant : une ligne dediee le fait, en
 * ajout seul. Une ordonnance signee sous l'ancien nom reste ainsi rattachable.
 *
 * Les patients n'empruntent pas ce chemin : leur identite se corrige a
 * l'accueil, sur l'ecran Identites (R15), qui garde son propre historique.
 */
export async function corrigerNom(
  auteur: Auteur,
  idCible: string,
  dto: { prenom?: string; nom?: string; motif: string },
  maintenant = new Date(),
): Promise<CompteView> {
  const motif = dto.motif.trim();
  if (motif.length < MOTIF_MIN) {
    throw new ValidationError("Le motif est exige, dix caracteres au moins : une correction sans motif n'est pas contestable");
  }
  const cible = await prisma.utilisateur.findUnique({ where: { id: idCible }, select: SELECTION });
  if (!cible) throw new NotFoundError('Compte introuvable');
  if (cible.role === Role.PATIENT) {
    throw new ValidationError("Le nom d'un patient se corrige a l'accueil, depuis l'ecran Identites");
  }
  if (cible.role === Role.SUPER_ADMIN && auteur.role !== Role.SUPER_ADMIN) {
    throw new ForbiddenError("Seul un super administrateur peut corriger le nom d'un super administrateur");
  }

  const prenom = dto.prenom?.trim();
  const nom = dto.nom?.trim();
  const apres = {
    prenom: prenom && prenom !== cible.prenom ? prenom : cible.prenom,
    nom: nom && nom !== cible.nom ? nom : cible.nom,
  };
  if (apres.prenom === cible.prenom && apres.nom === cible.nom) {
    throw new ValidationError('Aucun changement : les valeurs saisies sont deja celles du compte');
  }

  const maj = await prisma.$transaction(async (tx) => {
    const u = await tx.utilisateur.update({ where: { id: idCible }, data: apres, select: SELECTION });
    await tx.journalAudit.create({
      data: {
        action: 'CORRECTION_NOM',
        ressource: 'utilisateurs',
        idRessource: idCible,
        idUtilisateur: auteur.userId,
        creeLe: maintenant,
        metadonnees: { avant: { prenom: cible.prenom, nom: cible.nom }, apres, motif },
      },
    });
    return u;
  });

  logger.info('[COMPTE] nom corrige', { idCible, parQui: auteur.userId });
  return enVue(maj);
}
