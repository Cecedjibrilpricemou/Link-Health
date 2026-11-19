// Les candidatures des motards livreurs : le depot par le motard, l'examen
// par l'administration, et la creation directe par celle-ci.
//
// **Tout livreur a un dossier.** Le motard qui candidate depuis
// `/devenir-livreur` en depose un, et attend une decision. L'administration
// qui cree un compte elle-meme en depose un aussi, enregistre d'emblee comme
// valide. Les deux portes exigent les memes six pieces : deux exigences qui
// different finissent par servir de contournement l'une a l'autre - on passe
// par la porte qui demande le moins.
//
// **Aucun compte n'est cree au depot**, pour la meme raison que les demandes
// d'agrement : un acces ouvert sur un dossier que personne n'a lu offrirait
// la plateforme - et le domicile des patients - a quiconque sait remplir un
// formulaire. Le compte nait de la validation.
//
// Ce service ne verifie pas qu'un permis est authentique : personne ne le
// peut depuis une application. Il verifie que les six pieces sont la, sont
// lisibles, sont reellement des images ou des PDF, et que le motard est
// majeur. Le reste est le travail de l'agent, et c'est pour cela que l'ecran
// d'examen existe.
import { randomUUID } from 'crypto';
import { promises as fs, mkdirSync } from 'fs';
import path from 'path';

import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/app-error';
import { hashPassword } from '../utils/password.utils';
import {
  TAILLE_MAX_PIECE,
  typeMimeReel,
  type TypeMimePieceLivreur,
} from '../middlewares/upload.middleware';
import { genererMotDePasseTemp } from './admin-structure.service';
import {
  envoyerAccuseCandidatureLivreur,
  envoyerIdentifiantsLivreur,
  envoyerRefusCandidatureLivreur,
} from './email.service';
import type { JwtPayload } from '../types/auth.types';
import {
  Prisma,
  Role,
  StatutCandidatureLivreur,
  TypePieceLivreur,
} from '../config/generated/client/client';

/** **Jamais sous `uploads/`**, qui est servi sans authentification. */
const DOSSIER_PIECES = path.join(process.cwd(), 'stockage-prive', 'livreurs');

/**
 * Les roles qui recrutent les livreurs, et donc examinent leurs dossiers.
 *
 * Ce sont ceux qui les creaient deja par `POST /comptes/livreurs` : l'examen
 * d'une candidature n'est qu'une autre facon de recruter, et il serait
 * absurde qu'un administrateur regional puisse creer un livreur sans dossier
 * mais pas valider celui qui en a depose un.
 */
export const ROLES_RECRUTEMENT_LIVREUR: readonly Role[] = [
  Role.ADMIN_REGIONAL,
  Role.ADMIN_NATIONAL,
  Role.SUPER_ADMIN,
];

export function exigerRoleRecrutement(user: JwtPayload): void {
  if (!ROLES_RECRUTEMENT_LIVREUR.includes(user.role)) {
    throw new ForbiddenError('Le recrutement des livreurs est reserve a l administration regionale ou nationale');
  }
}

/** Les six pieces, toutes exigees, dans l'ordre ou l'ecran les presente. */
export const PIECES_LIVREUR: readonly TypePieceLivreur[] = [
  TypePieceLivreur.CNI_RECTO,
  TypePieceLivreur.CNI_VERSO,
  TypePieceLivreur.PERMIS_CONDUIRE,
  TypePieceLivreur.CARTE_GRISE,
  TypePieceLivreur.ASSURANCE,
  TypePieceLivreur.CERTIFICAT_RESIDENCE,
];

/** Les noms que le motard reconnait, pour les messages de refus. */
const LIBELLES: Readonly<Record<TypePieceLivreur, string>> = {
  CNI_RECTO: 'La carte d’identité (recto)',
  CNI_VERSO: 'La carte d’identité (verso)',
  PERMIS_CONDUIRE: 'Le permis de conduire',
  CARTE_GRISE: 'La carte grise',
  ASSURANCE: 'L’attestation d’assurance',
  CERTIFICAT_RESIDENCE: 'Le certificat de résidence',
};

export function libellePieceLivreur(type: TypePieceLivreur): string {
  return LIBELLES[type];
}

/** Majeur : un mineur ne conduit pas une moto de livraison en Guinee. */
export const AGE_MINIMUM = 18;

const EXTENSIONS: Readonly<Record<TypeMimePieceLivreur, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Ce que multer remet au service : le nom du champ est le type de piece. */
export interface FichierRecu {
  fieldname: string;
  originalname?: string;
  buffer: Buffer;
}

interface PieceValidee {
  type: TypePieceLivreur;
  contenu: Buffer;
  typeMime: TypeMimePieceLivreur;
}

interface PieceEcrite {
  type: TypePieceLivreur;
  fichier: string;
  typeMime: TypeMimePieceLivreur;
  taille: number;
}

/** Ce que le motard - ou l'agent qui le cree - envoie. Zod a deja trie. */
export interface CandidatRecu {
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: 'M' | 'F';
  telephone: string;
  email?: string | undefined;
  prefecture: string;
  commune?: string | undefined;
  quartier: string;
}

// ── Les pieces ──────────────────────────────────────────────────

/**
 * Les six pieces, verifiees octet par octet.
 *
 * Le nom de champ vient du client : il n'est **jamais** accepte tel quel. Un
 * type deja vu, un fichier vide, trop gros ou dont les octets ne sont ni une
 * image ni un PDF arretent tout, avant la moindre ecriture.
 */
export function validerPiecesLivreur(fichiers: readonly FichierRecu[]): PieceValidee[] {
  const connus = new Set<string>(PIECES_LIVREUR);
  const vus = new Set<TypePieceLivreur>();
  const validees: PieceValidee[] = [];

  for (const f of fichiers) {
    if (!connus.has(f.fieldname)) {
      throw new ValidationError(`Pièce inconnue : « ${f.fieldname} ».`);
    }
    const type = f.fieldname as TypePieceLivreur;
    if (vus.has(type)) {
      throw new ValidationError(`${LIBELLES[type]} a été envoyée deux fois.`);
    }
    vus.add(type);

    if (f.buffer.length === 0) {
      throw new ValidationError(`${LIBELLES[type]} est un fichier vide.`);
    }
    if (f.buffer.length > TAILLE_MAX_PIECE) {
      throw new ValidationError(`${LIBELLES[type]} dépasse 5 Mo.`);
    }
    const typeMime = typeMimeReel(f.buffer);
    if (!typeMime) {
      throw new ValidationError(
        `${LIBELLES[type]} n'est ni une photo (JPEG, PNG) ni un PDF, quelle que soit son extension.`,
      );
    }
    validees.push({ type, contenu: f.buffer, typeMime });
  }

  const manquantes = PIECES_LIVREUR.filter((p) => !vus.has(p));
  if (manquantes.length > 0) {
    throw new ValidationError(
      `Dossier incomplet : il manque ${manquantes.map((p) => LIBELLES[p].toLowerCase()).join(', ')}.`,
    );
  }
  return validees;
}

/** Le chemin d'une piece, sans jamais pouvoir sortir du dossier prive. */
export function cheminPieceLivreur(nom: string): string {
  if (!/^[A-Za-z0-9_-]+\.(pdf|jpg|png)$/.test(nom)) throw new NotFoundError('Pièce introuvable');
  return path.join(DOSSIER_PIECES, nom);
}

/**
 * Ecrit les pieces **avant** toute ecriture en base : un echec ne laisse au
 * pire que des fichiers orphelins, que l'appelant efface.
 */
export async function ecrireFichiersLivreur(pieces: readonly PieceValidee[]): Promise<PieceEcrite[]> {
  mkdirSync(DOSSIER_PIECES, { recursive: true });
  const ecrites: PieceEcrite[] = [];
  try {
    for (const p of pieces) {
      const nom = `${randomUUID()}.${EXTENSIONS[p.typeMime]}`;
      await fs.writeFile(cheminPieceLivreur(nom), p.contenu);
      ecrites.push({ type: p.type, fichier: nom, typeMime: p.typeMime, taille: p.contenu.length });
    }
  } catch (e) {
    await supprimerFichiersLivreur(ecrites.map((p) => p.fichier));
    if (e instanceof AppError) throw e;
    throw new ValidationError('Échec de l’enregistrement des pièces.');
  }
  return ecrites;
}

/** Nettoyage : un fichier deja absent n'est pas une erreur. */
export async function supprimerFichiersLivreur(noms: readonly string[]): Promise<void> {
  await Promise.all(noms.map((n) => fs.unlink(cheminPieceLivreur(n)).catch(() => undefined)));
}

// ── L'identite du candidat ──────────────────────────────────────

/** L'age revolu a une date donnee, sans fuseau : seule la date compte. */
export function ageAu(naissance: Date, maintenant: Date): number {
  let age = maintenant.getUTCFullYear() - naissance.getUTCFullYear();
  const mois = maintenant.getUTCMonth() - naissance.getUTCMonth();
  if (mois < 0 || (mois === 0 && maintenant.getUTCDate() < naissance.getUTCDate())) age -= 1;
  return age;
}

/**
 * La date de naissance, lue strictement, et l'age minimum.
 *
 * `new Date('2008-02-30')` ne rend pas une erreur : JavaScript la reporte au
 * 1er mars. On relit donc la date obtenue pour s'assurer qu'elle est bien
 * celle qui a ete saisie, sinon un 30 fevrier passerait pour un 1er mars.
 */
export function lireDateNaissance(saisie: string, maintenant = new Date()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(saisie.trim());
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !date || date.toISOString().slice(0, 10) !== saisie.trim()) {
    throw new ValidationError('La date de naissance est invalide.');
  }
  if (date.getTime() > maintenant.getTime()) {
    throw new ValidationError('La date de naissance est dans le futur.');
  }
  if (ageAu(date, maintenant) < AGE_MINIMUM) {
    throw new ValidationError(`Il faut avoir au moins ${AGE_MINIMUM} ans pour devenir livreur.`);
  }
  return date;
}

/** Les champs du dossier, nettoyes une fois pour toutes les portes. */
function donneesCandidat(dto: CandidatRecu, dateNaissance: Date) {
  return {
    prenom: dto.prenom.trim(),
    nom: dto.nom.trim(),
    dateNaissance,
    sexe: dto.sexe,
    telephone: dto.telephone.trim(),
    email: dto.email?.trim().toLowerCase() || null,
    prefecture: dto.prefecture.trim(),
    commune: dto.commune?.trim() || null,
    quartier: dto.quartier.trim(),
  };
}

/**
 * Le telephone et l'email doivent etre libres : le compte du livreur les
 * portera, et la base refuserait un doublon au pire moment - apres que
 * l'agent a tout verifie.
 */
async function exigerIdentifiantsLibres(
  telephone: string,
  email: string | null,
  moment: 'depot' | 'validation',
): Promise<void> {
  const suite = moment === 'validation'
    ? ' : la candidature ne peut pas être validée en l’état.'
    : '.';
  const telPris = await prisma.utilisateur.findUnique({ where: { telephone }, select: { id: true } });
  if (telPris) throw new ConflictError(`Ce numéro de téléphone est déjà utilisé par un compte${suite}`);
  if (email) {
    const emailPris = await prisma.utilisateur.findUnique({ where: { email }, select: { id: true } });
    if (emailPris) throw new ConflictError(`Cette adresse email est déjà utilisée par un compte${suite}`);
  }
}

// ── Le numero de dossier ────────────────────────────────────────

/**
 * Le prochain numero de l'annee, `DL-2026-0001`. Meme raisonnement que pour
 * les demandes d'agrement : deux depots simultanes se disputent un numero,
 * l'unicite en base refuse le second, l'appelant recommence.
 */
async function prochainNumero(annee: number): Promise<string> {
  const prefixe = `DL-${annee}-`;
  const dernier = await prisma.candidatureLivreur.findFirst({
    where: { numero: { startsWith: prefixe } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  const rang = dernier ? Number(dernier.numero.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(rang).padStart(4, '0')}`;
}

function estCollision(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError
    ? e.code === 'P2002'
    : typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Vrai si la collision porte sur le numero de dossier, et non sur autre chose. */
function collisionSurNumero(e: unknown): boolean {
  if (!estCollision(e)) return false;
  const cible = (e as { meta?: { target?: unknown } }).meta?.target;
  return cible === undefined || String(cible).includes('numero');
}

/**
 * Cree le dossier avec un numero neuf, en recommencant sur collision.
 * `creer` recoit le numero et fait l'ecriture - eventuellement dans une
 * transaction qui cree aussi le compte.
 */
async function avecNumero<T>(creer: (numero: string) => Promise<T>): Promise<T> {
  // Trois tentatives : une collision suppose deux depots dans la meme
  // fraction de seconde, trois de suite releveraient d'autre chose.
  for (let essai = 0; ; essai += 1) {
    const numero = await prochainNumero(new Date().getFullYear());
    try {
      return await creer(numero);
    } catch (e) {
      if (!collisionSurNumero(e) || essai === 2) throw e;
      logger.warn('[LIVREUR] numero de dossier deja pris, nouvelle tentative', { numero });
    }
  }
}

// ── Le compte du livreur ────────────────────────────────────────

/** Le client d'une transaction ouverte sur le client etendu du projet. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Le compte et son profil, dans la transaction de l'appelant. */
async function creerCompteLivreur(
  tx: Tx,
  candidat: ReturnType<typeof donneesCandidat>,
  motDePasseHash: string,
): Promise<string> {
  const compte = await tx.utilisateur.create({
    data: {
      telephone: candidat.telephone,
      email: candidat.email,
      motDePasseHash,
      prenom: candidat.prenom,
      nom: candidat.nom,
      role: Role.LIVREUR,
      idStructure: null,
      doitChangerMotDePasse: true,
    },
    select: { id: true },
  });
  await tx.livreurProfile.create({
    data: {
      idUtilisateur: compte.id,
      quartier: candidat.quartier,
      prefecture: candidat.prefecture,
      commune: candidat.commune,
    },
  });
  return compte.id;
}

/**
 * Faire parvenir le mot de passe temporaire au livreur.
 *
 * **Par courriel quand c'est possible, a l'ecran sinon, jamais les deux.**
 * Beaucoup de motards n'ont pas d'email : sans repli, ils n'auraient aucun
 * moyen d'apprendre leur mot de passe, puisque les SMS ne partent pas
 * encore. Mais quand le courriel est parti, l'agent n'a aucune raison de
 * connaitre le mot de passe d'un tiers, et la reponse ne le porte pas.
 *
 * Renvoie le mot de passe a afficher, ou `null` s'il est parti par courriel.
 */
async function transmettreIdentifiants(
  candidat: ReturnType<typeof donneesCandidat>,
  motDePasse: string,
  numero: string,
): Promise<string | null> {
  if (!candidat.email) return motDePasse;
  try {
    await envoyerIdentifiantsLivreur({
      destinataire: candidat.email,
      prenomNom: `${candidat.prenom} ${candidat.nom}`,
      telephone: candidat.telephone,
      motDePasseTemporaire: motDePasse,
    });
    return null;
  } catch (e) {
    // Le compte existe : sans repli, le livreur resterait dehors. Erreur et
    // non avertissement, parce qu'un courriel promis n'est pas parti.
    logger.error('[LIVREUR] identifiants non envoyes, affiches a l agent', {
      numero,
      erreur: e instanceof Error ? e.message : String(e),
    });
    return motDePasse;
  }
}

// ── Le depot public ─────────────────────────────────────────────

/**
 * Deposer une candidature. **Sans compte : c'est tout l'objet de cette porte.**
 *
 * Tout ce qui peut refuser le dossier passe avant la premiere ecriture : un
 * dossier refuse ne laisse ni fichier, ni ligne, ni numero consomme.
 */
export async function deposer(dto: CandidatRecu, fichiers: readonly FichierRecu[]) {
  const candidat = donneesCandidat(dto, lireDateNaissance(dto.dateNaissance));
  const validees = validerPiecesLivreur(fichiers);

  // Un motard qui redepose pendant l'examen ferait deux dossiers pour une
  // seule personne, et deux agents pour les instruire.
  const enCours = await prisma.candidatureLivreur.findFirst({
    where: {
      telephone: candidat.telephone,
      statut: { in: [StatutCandidatureLivreur.RECUE, StatutCandidatureLivreur.EN_ANALYSE] },
    },
    select: { numero: true },
  });
  if (enCours) {
    throw new ConflictError(
      `Une candidature est déjà en cours d'examen pour ce numéro de téléphone (dossier ${enCours.numero}).`,
    );
  }
  await exigerIdentifiantsLibres(candidat.telephone, candidat.email, 'depot');

  const ecrites = await ecrireFichiersLivreur(validees);
  let cree: { numero: string; deposeLe: Date };
  try {
    cree = await avecNumero((numero) =>
      prisma.candidatureLivreur.create({
        data: {
          ...candidat,
          numero,
          pieces: { create: ecrites.map((p) => ({ ...p })) },
        },
        select: { numero: true, deposeLe: true },
      }),
    );
  } catch (e) {
    await supprimerFichiersLivreur(ecrites.map((p) => p.fichier));
    throw e;
  }

  logger.info('[LIVREUR] candidature deposee', { numero: cree.numero });

  // L'accuse part apres l'enregistrement, et son echec ne le defait pas : le
  // motard voit son numero a l'ecran de toute facon.
  if (candidat.email) {
    try {
      await envoyerAccuseCandidatureLivreur({
        destinataire: candidat.email,
        prenomNom: `${candidat.prenom} ${candidat.nom}`,
        numero: cree.numero,
      });
    } catch (e) {
      logger.error('[LIVREUR] accuse de reception non envoye', {
        numero: cree.numero,
        erreur: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    numero: cree.numero,
    statut: StatutCandidatureLivreur.RECUE,
    deposeLe: cree.deposeLe.toISOString(),
  };
}

// ── La creation directe par l'administration ────────────────────

/**
 * Creer un livreur **avec son dossier**, enregistre d'emblee comme valide.
 *
 * Une seule transaction pour le compte, le profil et le dossier : un livreur
 * sans dossier, ou un dossier valide sans livreur, mentiraient l'un comme
 * l'autre sur ce qui a ete verifie.
 */
export async function creerAvecDossier(
  auteur: JwtPayload,
  dto: CandidatRecu,
  fichiers: readonly FichierRecu[],
): Promise<{ idUtilisateur: string; numero: string; motDePasseTemporaire: string | null }> {
  exigerRoleRecrutement(auteur);
  const candidat = donneesCandidat(dto, lireDateNaissance(dto.dateNaissance));
  const validees = validerPiecesLivreur(fichiers);
  await exigerIdentifiantsLibres(candidat.telephone, candidat.email, 'depot');

  const motDePasse = genererMotDePasseTemp();
  const motDePasseHash = await hashPassword(motDePasse);

  const ecrites = await ecrireFichiersLivreur(validees);
  let resultat: { idUtilisateur: string; numero: string };
  try {
    resultat = await avecNumero((numero) =>
      prisma.$transaction(async (tx) => {
        const idUtilisateur = await creerCompteLivreur(tx, candidat, motDePasseHash);
        await tx.candidatureLivreur.create({
          data: {
            ...candidat,
            numero,
            statut: StatutCandidatureLivreur.VALIDEE,
            deposeParAdministration: true,
            idLivreurCree: idUtilisateur,
            idExaminePar: auteur.userId,
            examineLe: new Date(),
            pieces: { create: ecrites.map((p) => ({ ...p })) },
          },
          select: { id: true },
        });
        return { idUtilisateur, numero };
      }),
    );
  } catch (e) {
    await supprimerFichiersLivreur(ecrites.map((p) => p.fichier));
    if (estCollision(e)) {
      // Un compte a pris ce telephone ou cet email entre la verification et
      // l'ecriture : on le dit comme le controle l'aurait dit.
      throw new ConflictError('Ce numéro de téléphone ou cet email est déjà utilisé par un compte.');
    }
    throw e;
  }

  logger.info('[LIVREUR] livreur cree avec son dossier', {
    numero: resultat.numero,
    parQui: auteur.userId,
  });

  const motDePasseTemporaire = await transmettreIdentifiants(candidat, motDePasse, resultat.numero);
  return { ...resultat, motDePasseTemporaire };
}

// ── L'examen ────────────────────────────────────────────────────

/** Ce que la liste affiche : de quoi trier, pas de quoi instruire. */
export async function lister(user: JwtPayload, statut?: string) {
  exigerRoleRecrutement(user);
  const filtre = statut && (Object.values(StatutCandidatureLivreur) as string[]).includes(statut)
    ? { where: { statut: statut as StatutCandidatureLivreur } }
    : {};
  const candidatures = await prisma.candidatureLivreur.findMany({
    ...filtre,
    orderBy: { deposeLe: 'desc' },
    select: {
      id: true, numero: true, statut: true, prenom: true, nom: true,
      telephone: true, prefecture: true, commune: true, quartier: true,
      deposeParAdministration: true, deposeLe: true,
      _count: { select: { pieces: true } },
    },
  });
  return candidatures.map((c) => ({
    id: c.id,
    numero: c.numero,
    statut: c.statut,
    prenom: c.prenom,
    nom: c.nom,
    telephone: c.telephone,
    prefecture: c.prefecture,
    commune: c.commune,
    quartier: c.quartier,
    deposeParAdministration: c.deposeParAdministration,
    nombrePieces: c._count.pieces,
    deposeLe: c.deposeLe.toISOString(),
  }));
}

/**
 * Le dossier complet. `manquantes` est recalculee a la lecture : si la liste
 * des pieces exigees change, un dossier ancien doit se montrer incomplet.
 */
export async function detail(user: JwtPayload, id: string) {
  exigerRoleRecrutement(user);
  const c = await prisma.candidatureLivreur.findUnique({
    where: { id },
    select: {
      id: true, numero: true, statut: true, deposeParAdministration: true,
      prenom: true, nom: true, dateNaissance: true, sexe: true,
      telephone: true, email: true, prefecture: true, commune: true, quartier: true,
      motifRefus: true, examineLe: true, idLivreurCree: true, deposeLe: true,
      examinePar: { select: { prenom: true, nom: true } },
      pieces: {
        select: { id: true, type: true, typeMime: true, taille: true, deposeLe: true },
        orderBy: { deposeLe: 'asc' },
      },
    },
  });
  if (!c) throw new NotFoundError('Candidature introuvable');

  const presentes = new Set(c.pieces.map((p) => p.type));
  const manquantes = PIECES_LIVREUR.filter((p) => !presentes.has(p));
  // Les pieces dans l'ordre de l'ecran, pas dans celui de leur ecriture.
  const pieces = [...c.pieces].sort(
    (a, b) => PIECES_LIVREUR.indexOf(a.type) - PIECES_LIVREUR.indexOf(b.type),
  );

  return {
    id: c.id,
    numero: c.numero,
    statut: c.statut,
    deposeParAdministration: c.deposeParAdministration,
    prenom: c.prenom,
    nom: c.nom,
    dateNaissance: c.dateNaissance.toISOString().slice(0, 10),
    age: ageAu(c.dateNaissance, new Date()),
    sexe: c.sexe as 'M' | 'F',
    telephone: c.telephone,
    email: c.email,
    prefecture: c.prefecture,
    commune: c.commune,
    quartier: c.quartier,
    pieces: pieces.map((p) => ({
      id: p.id,
      type: p.type,
      typeMime: p.typeMime as TypeMimePieceLivreur,
      taille: p.taille,
      deposeLe: p.deposeLe.toISOString(),
    })),
    manquantes,
    complet: manquantes.length === 0,
    motifRefus: c.motifRefus,
    examineLe: c.examineLe?.toISOString() ?? null,
    examinePar: c.examinePar ? `${c.examinePar.prenom} ${c.examinePar.nom}` : null,
    idLivreurCree: c.idLivreurCree,
    deposeLe: c.deposeLe.toISOString(),
  };
}

/**
 * La candidature, si elle peut encore etre decidee.
 *
 * **Une decision ne se reprend pas.** Revalider un dossier refuse creerait un
 * compte sans que le motard ait rien redepose ; refuser un dossier valide
 * laisserait un livreur actif rattache a un dossier refuse.
 */
async function candidatureOuverte(id: string) {
  const c = await prisma.candidatureLivreur.findUnique({
    where: { id },
    select: { id: true, numero: true, statut: true },
  });
  if (!c) throw new NotFoundError('Candidature introuvable');
  if (c.statut === StatutCandidatureLivreur.VALIDEE) {
    throw new ConflictError(`Le dossier ${c.numero} a déjà été validé.`);
  }
  if (c.statut === StatutCandidatureLivreur.REFUSEE) {
    throw new ConflictError(`Le dossier ${c.numero} a déjà été refusé.`);
  }
  return c;
}

/** Prendre le dossier en charge, pour que deux agents ne doublonnent pas. */
export async function mettreEnAnalyse(user: JwtPayload, id: string) {
  exigerRoleRecrutement(user);
  const c = await candidatureOuverte(id);
  if (c.statut === StatutCandidatureLivreur.RECUE) {
    await prisma.candidatureLivreur.update({
      where: { id },
      data: { statut: StatutCandidatureLivreur.EN_ANALYSE, idExaminePar: user.userId },
    });
    logger.info('[LIVREUR] dossier mis en analyse', { numero: c.numero, parQui: user.userId });
  }
  return detail(user, id);
}

/**
 * Valider : le compte du livreur et son profil naissent ici.
 *
 * Le dossier doit encore etre complet, et le telephone encore libre : des
 * semaines ont pu passer depuis le depot.
 */
export async function valider(user: JwtPayload, id: string) {
  exigerRoleRecrutement(user);
  const ouverte = await candidatureOuverte(id);
  const c = await prisma.candidatureLivreur.findUniqueOrThrow({
    where: { id },
    select: {
      prenom: true, nom: true, dateNaissance: true, sexe: true, telephone: true,
      email: true, prefecture: true, commune: true, quartier: true,
      pieces: { select: { type: true } },
    },
  });

  const presentes = new Set(c.pieces.map((p) => p.type));
  const manquantes = PIECES_LIVREUR.filter((p) => !presentes.has(p));
  if (manquantes.length > 0) {
    throw new ValidationError(
      `Dossier incomplet : il manque ${manquantes.map((p) => LIBELLES[p].toLowerCase()).join(', ')}.`,
    );
  }
  // L'age a ete verifie au depot ; il ne peut que croitre, inutile d'y revenir.

  const candidat = {
    prenom: c.prenom,
    nom: c.nom,
    dateNaissance: c.dateNaissance,
    sexe: c.sexe as 'M' | 'F',
    telephone: c.telephone,
    email: c.email,
    prefecture: c.prefecture,
    commune: c.commune,
    quartier: c.quartier,
  };
  await exigerIdentifiantsLibres(candidat.telephone, candidat.email, 'validation');

  const motDePasse = genererMotDePasseTemp();
  const motDePasseHash = await hashPassword(motDePasse);

  try {
    await prisma.$transaction(async (tx) => {
      const idUtilisateur = await creerCompteLivreur(tx, candidat, motDePasseHash);
      // `updateMany` avec le statut dans le filtre : si un autre agent a
      // decide entre-temps, rien n'est mis a jour, et la transaction est
      // annulee plutot que d'ecraser sa decision.
      const { count } = await tx.candidatureLivreur.updateMany({
        where: {
          id,
          statut: { in: [StatutCandidatureLivreur.RECUE, StatutCandidatureLivreur.EN_ANALYSE] },
        },
        data: {
          statut: StatutCandidatureLivreur.VALIDEE,
          idLivreurCree: idUtilisateur,
          idExaminePar: user.userId,
          examineLe: new Date(),
          motifRefus: null,
        },
      });
      if (count === 0) {
        throw new ConflictError(`Le dossier ${ouverte.numero} vient d'être décidé par un autre agent.`);
      }
    });
  } catch (e) {
    if (estCollision(e)) {
      throw new ConflictError(
        'Ce numéro de téléphone ou cet email est désormais utilisé par un autre compte : la candidature ne peut pas être validée en l’état.',
      );
    }
    throw e;
  }

  logger.info('[LIVREUR] candidature validee', { numero: ouverte.numero, parQui: user.userId });

  const motDePasseTemporaire = await transmettreIdentifiants(candidat, motDePasse, ouverte.numero);
  return { candidature: await detail(user, id), motDePasseTemporaire };
}

/**
 * Refuser, avec un motif. Les pieces restent : elles sont la preuve de ce sur
 * quoi la decision a porte.
 */
export async function refuser(user: JwtPayload, id: string, motif: string) {
  exigerRoleRecrutement(user);
  const ouverte = await candidatureOuverte(id);
  const motifNet = motif.trim();
  if (motifNet.length < 10) {
    throw new ValidationError(
      'Le motif du refus doit être explicite : au moins dix caractères, pour que le candidat sache quoi corriger.',
    );
  }

  const { count } = await prisma.candidatureLivreur.updateMany({
    where: {
      id,
      statut: { in: [StatutCandidatureLivreur.RECUE, StatutCandidatureLivreur.EN_ANALYSE] },
    },
    data: {
      statut: StatutCandidatureLivreur.REFUSEE,
      motifRefus: motifNet,
      idExaminePar: user.userId,
      examineLe: new Date(),
    },
  });
  if (count === 0) {
    throw new ConflictError(`Le dossier ${ouverte.numero} vient d'être décidé par un autre agent.`);
  }
  logger.info('[LIVREUR] candidature refusee', { numero: ouverte.numero, parQui: user.userId });

  const c = await prisma.candidatureLivreur.findUniqueOrThrow({
    where: { id },
    select: { prenom: true, nom: true, email: true },
  });
  if (c.email) {
    try {
      await envoyerRefusCandidatureLivreur({
        destinataire: c.email,
        prenomNom: `${c.prenom} ${c.nom}`,
        numero: ouverte.numero,
        motif: motifNet,
      });
    } catch (e) {
      logger.error('[LIVREUR] refus non notifie', {
        numero: ouverte.numero,
        erreur: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return detail(user, id);
}

/**
 * Le contenu d'une piece, pour l'agent qui examine. Chaque lecture est
 * journalisee : une carte d'identite ne se consulte pas sans trace.
 */
export async function lirePiece(
  user: JwtPayload,
  idPiece: string,
): Promise<{ contenu: Buffer; typeMime: TypeMimePieceLivreur }> {
  exigerRoleRecrutement(user);
  const piece = await prisma.pieceCandidatureLivreur.findUnique({
    where: { id: idPiece },
    select: { fichier: true, type: true, typeMime: true },
  });
  if (!piece) throw new NotFoundError('Pièce introuvable');
  try {
    const contenu = await fs.readFile(cheminPieceLivreur(piece.fichier));
    logger.info('[LIVREUR] piece consultee', { idPiece, type: piece.type, parQui: user.userId });
    return { contenu, typeMime: piece.typeMime as TypeMimePieceLivreur };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new NotFoundError('Pièce introuvable');
  }
}
