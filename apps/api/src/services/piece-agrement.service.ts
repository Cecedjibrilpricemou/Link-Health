// Les pieces d'agrement des structures privees.
//
// **La creation ne demandait aucune preuve reglementaire.** Les trois portes
// — `POST /admin-structure/structures`, `POST /admin-structure/pharmacies` et
// `POST /assurance/assureurs` — acceptaient un nom, une prefecture et un
// telephone. Une pharmacie sans agrement, une clinique sans autorisation
// d'exploitation entraient sur la plateforme comme les autres, et le patient
// n'avait aucun moyen de faire la difference.
//
// Ce service tient la regle **une seule fois**, pour les trois portes. Les
// cabler separement aurait fait diverger les exigences : une pharmacie
// stricte, un assureur qui passe a travers.
//
// Deux choses qu'il ne fait pas, et c'est voulu :
//   - il ne verifie pas que l'agrement est authentique. Personne ne peut le
//     faire depuis une application : seule l'administration le peut. Il exige
//     que la piece existe, soit lisible et soit un vrai PDF.
//   - il n'exige rien des structures publiques. Un CHU n'a pas d'agrement
//     prive a produire ; le lui demander serait un obstacle invente.
import { randomUUID } from 'crypto';
import { promises as fs, mkdirSync } from 'fs';
import path from 'path';

import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { estPdf, TAILLE_MAX_PIECE } from '../middlewares/upload.middleware';
import type { JwtPayload } from '../types/auth.types';
import { TypePieceAgrement, TypeStructure } from '../config/generated/client/client';

/** **Jamais sous `uploads/`**, qui est servi sans authentification. */
const DOSSIER_PIECES = path.join(process.cwd(), 'stockage-prive', 'agrements');

/**
 * Les trois etablissements publics qui ont un medecin a leur tete.
 *
 * Ils sont crees par un acte de l'Etat, comme le poste et le centre de sante,
 * mais leur direction est medicale : l'inscription a l'ordre professionnel a
 * un sens chez eux, pas dans un poste tenu par un agent communautaire.
 */
const HOPITAUX_PUBLICS: readonly TypeStructure[] = [
  TypeStructure.HOPITAL_PREF,
  TypeStructure.HOPITAL_REG,
  TypeStructure.CHU,
];

/**
 * Les structures nees d'un acte de l'Etat, et non d'un agrement commercial.
 *
 * **Elles n'ont ni registre du commerce ni arrete d'exploitation** : l'acte
 * qui les cree les autorise du meme geste. Leur reclamer un RCCM serait un
 * obstacle invente, et un champ rempli au hasard pour y echapper vaut moins
 * qu'un champ vide.
 */
export function estStructurePublique(type: TypeStructure | string): boolean {
  return (
    type === TypeStructure.POSTE
    || type === TypeStructure.CENTRE
    || HOPITAUX_PUBLICS.includes(type as TypeStructure)
  );
}

/**
 * Ce que chaque type de structure doit produire. **Toutes obligatoires.**
 *
 * Les quatre pieces sanitaires du prive sont celles que les controles exigent
 * reellement (campagne du 27 juillet 2026) : agrement de creation, agrement
 * d'exploitation, diplomes legalises du personnel de sante, attestations
 * d'inscription aux ordres professionnels.
 *
 * **Le public en produit aussi** (decision du 2026-11-18). Il ne l'a pas
 * toujours fait : la table n'avait longtemps que les types prives, au motif
 * que l'administration sait ce qu'elle cree. Mais une structure entre
 * desormais aussi par une demande publique, ou personne ne sait qui depose,
 * et deux portes qui n'exigent pas la meme chose finissent par servir de
 * contournement l'une a l'autre. Ce que le public fournit :
 *   - l'acte qui le cree, a la place des deux agrements commerciaux ;
 *   - le diplome de son responsable ;
 *   - pour un hopital, l'inscription a l'ordre de son directeur medical.
 *
 * L'assureur reste a part : il releve de la Banque Centrale, pas du ministere
 * de la Sante. Son agrement vient d'une autre autorite, il n'a ni diplome ni
 * ordre professionnel a produire.
 *
 * Un type absent de cette table n'exige rien — il n'en reste qu'un, la
 * pharmacie hospitaliere, qui opere sous l'autorisation de son hopital
 * (`SOUS_AUTORISATION_DU_PARENT`).
 */
export const PIECES_REQUISES: Readonly<Partial<Record<TypeStructure, readonly TypePieceAgrement[]>>> = {
  PHARMACIE: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.AGREMENT_EXPLOITATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
    TypePieceAgrement.INSCRIPTION_ORDRE,
  ],
  CLINIQUE: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.AGREMENT_EXPLOITATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
    TypePieceAgrement.INSCRIPTION_ORDRE,
  ],
  LABORATOIRE: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.AGREMENT_EXPLOITATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
    TypePieceAgrement.INSCRIPTION_ORDRE,
  ],
  HOPITAL_PREF: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
    TypePieceAgrement.INSCRIPTION_ORDRE,
  ],
  HOPITAL_REG: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
    TypePieceAgrement.INSCRIPTION_ORDRE,
  ],
  CHU: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
    TypePieceAgrement.INSCRIPTION_ORDRE,
  ],
  // Un poste et un centre sont souvent tenus par un infirmier ou un agent
  // communautaire, que nul ordre professionnel n'inscrit : l'exiger d'eux
  // rendrait leur creation impossible.
  POSTE: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
  ],
  CENTRE: [
    TypePieceAgrement.AGREMENT_CREATION,
    TypePieceAgrement.DIPLOME_RESPONSABLE,
  ],
  // L'assureur releve de la Banque Centrale : ni diplome ni ordre a produire.
  // Mais la compagnie doit prouver son existence (l'extrait RCCM, et non le
  // seul numero saisi) et celui qui en repondra, son identite et sa residence.
  ASSURANCE: [
    TypePieceAgrement.AGREMENT_ASSURANCE,
    TypePieceAgrement.EXTRAIT_RCCM,
    TypePieceAgrement.PIECE_IDENTITE_RESPONSABLE,
    TypePieceAgrement.CERTIFICAT_RESIDENCE_RESPONSABLE,
  ],
};

/** Le libelle lisible d'une piece, pour nommer ce qui manque. */
const LIBELLES: Readonly<Record<TypePieceAgrement, string>> = {
  AGREMENT_CREATION: "l'agrément de création",
  AGREMENT_EXPLOITATION: "l'agrément d'exploitation",
  DIPLOME_RESPONSABLE: 'le diplôme légalisé du responsable',
  INSCRIPTION_ORDRE: "l'attestation d'inscription à l'ordre professionnel",
  AGREMENT_ASSURANCE: "l'agrément de la Banque Centrale",
  EXTRAIT_RCCM: "l'extrait RCCM",
  PIECE_IDENTITE_RESPONSABLE: "la carte d'identité ou le passeport du responsable",
  CERTIFICAT_RESIDENCE_RESPONSABLE: 'le certificat de résidence du responsable',
  AUTRE: 'une pièce complémentaire',
};

/**
 * Le libelle d'une piece, **tel que celui qui la cherche la connait**.
 *
 * Le meme `AGREMENT_CREATION` s'appelle « agrément de création » pour une
 * officine et « acte de création » pour un CHU. Ce n'est pas un detail de
 * presentation : un directeur d'hopital cherchant un « agrément » dans ses
 * archives ne trouverait rien.
 */
export function libellePiece(type: TypeStructure | string, piece: TypePieceAgrement): string {
  if (piece === TypePieceAgrement.AGREMENT_CREATION && estStructurePublique(type)) {
    return "l'acte de création de l'établissement";
  }
  return LIBELLES[piece];
}

/**
 * Un type factice pour une structure qui opere **sous l'autorisation d'une
 * autre**, et n'a donc pas d'agrement propre a produire.
 *
 * Le cas reel : la pharmacie d'un hopital. Ce n'est pas une officine
 * independante, elle existe par l'autorisation de l'hopital qui la porte —
 * la plateforme modelise deja cette dependance pour les conventions
 * d'assurance, qu'elle herite de son hopital. Lui demander quatre agrements
 * propres bloquerait un hopital qui ouvre sa pharmacie interne.
 *
 * Absent de `PIECES_REQUISES`, il tombe donc dans l'exemption par defaut.
 */
export const SOUS_AUTORISATION_DU_PARENT = 'SOUS_AUTORISATION_DU_PARENT';

/** Vrai quand ce type doit produire des pieces. */
export function exigeDesPieces(type: TypeStructure | string): boolean {
  return (PIECES_REQUISES[type as TypeStructure]?.length ?? 0) > 0;
}

export function piecesRequisesPour(type: TypeStructure | string): readonly TypePieceAgrement[] {
  return PIECES_REQUISES[type as TypeStructure] ?? [];
}

/**
 * Le RCCM, normalise : majuscules, espaces retires.
 *
 * **Volontairement tolerant.** Deux formes circulent en Guinee —
 * `GN.TCC.2026.A.14724` recente, `GC-KAL.2017.B.000123` ancienne — et aucun
 * texte officiel n'en fixe le format. Une regex serree refuserait le RCCM
 * d'une officine installee depuis dix ans. On verifie une longueur et un jeu
 * de caracteres plausibles, et on laisse passer le reste : un RCCM inexact se
 * corrige, un RCCM refuse bloque une pharmacie reelle.
 */
export function normaliserRccm(valeur: string): string {
  const net = valeur.replace(/\s+/g, '').toUpperCase();
  if (net.length < 6 || net.length > 40) {
    throw new ValidationError('Le numéro RCCM doit comporter entre 6 et 40 caractères.');
  }
  if (!/^[A-Z0-9./-]+$/.test(net)) {
    throw new ValidationError('Le numéro RCCM ne peut contenir que des lettres, chiffres, points, tirets et barres obliques.');
  }
  return net;
}

/** Un fichier recu, tel que multer le presente. */
export interface FichierRecu {
  /** Le nom du champ : il doit nommer un `TypePieceAgrement`. */
  fieldname: string;
  originalname?: string;
  buffer: Buffer;
  size?: number;
}

/** Une piece prete a etre ecrite : type reconnu, contenu verifie. */
interface PieceValidee {
  type: TypePieceAgrement;
  contenu: Buffer;
  libelle: string | null;
}

/**
 * Traduit les fichiers recus en pieces, ou refuse.
 *
 * Trois refus, dans cet ordre : un nom de champ qui ne nomme pas une piece
 * connue, un contenu qui n'est pas un PDF, une piece exigee absente. Le nom de
 * champ n'est **jamais** accepte tel quel : il vient du client.
 */
export function validerPieces(
  type: TypeStructure | string,
  fichiers: readonly FichierRecu[],
  libelles: Readonly<Record<string, string | undefined>> = {},
): PieceValidee[] {
  const connus = new Set<string>(Object.values(TypePieceAgrement));
  const validees: PieceValidee[] = [];
  const vus = new Set<TypePieceAgrement>();

  for (const f of fichiers) {
    if (!connus.has(f.fieldname)) {
      throw new ValidationError(`Pièce inconnue : « ${f.fieldname} ».`);
    }
    const typePiece = f.fieldname as TypePieceAgrement;

    // Le meme type depose deux fois serait refuse par l'index unique partiel,
    // mais avec un message de base de donnees que personne ne comprend.
    if (typePiece !== TypePieceAgrement.AUTRE && vus.has(typePiece)) {
      throw new ValidationError(`${LIBELLES[typePiece]} a été envoyé deux fois.`);
    }
    vus.add(typePiece);

    if (f.buffer.length === 0) {
      throw new ValidationError(`${LIBELLES[typePiece]} est un fichier vide.`);
    }
    if (f.buffer.length > TAILLE_MAX_PIECE) {
      throw new ValidationError(`${LIBELLES[typePiece]} dépasse 5 Mo.`);
    }
    // Ce qui fait foi : les octets, pas l'en-tete `Content-Type`.
    if (!estPdf(f.buffer)) {
      throw new ValidationError(
        `${LIBELLES[typePiece]} n'est pas un vrai fichier PDF, quelle que soit son extension.`,
      );
    }

    const libelle = libelles[f.fieldname]?.trim() || null;
    if (typePiece === TypePieceAgrement.AUTRE && !libelle) {
      throw new ValidationError('Une pièce complémentaire doit porter un libellé.');
    }
    validees.push({ type: typePiece, contenu: f.buffer, libelle });
  }

  const manquantes = piecesRequisesPour(type).filter((p) => !vus.has(p));
  if (manquantes.length > 0) {
    throw new ValidationError(
      `Dossier incomplet : il manque ${manquantes.map((p) => libellePiece(type, p)).join(', ')}.`,
    );
  }

  return validees;
}

/**
 * La structure dont cet utilisateur repond, ou `null` s'il n'en repond
 * d'aucune.
 *
 * **Deux roles en repondent, et il a fallu les distinguer finement.**
 * L'administrateur de structure, d'abord. Le **titulaire** d'une officine
 * ensuite : depuis que la validation d'une demande fait de lui un
 * `PHARMACIEN` et non un administrateur, c'est lui qui doit pouvoir
 * renouveler l'agrement de sa pharmacie - un agrement expire, et personne
 * d'autre sur place ne peut le redeposer.
 *
 * Mais **tous les agents d'une officine portent ce meme role** : l'adjoint,
 * le preparateur, le caissier. Seul le profil les distingue. Ouvrir sur le
 * role seul aurait donne au caissier le diplome du titulaire, son numero
 * d'inscription a l'ordre et l'adresse exacte du local. D'ou le controle sur
 * `estResponsable`, et non sur le role.
 */
async function structureDontIlRepond(user: JwtPayload): Promise<string | null> {
  if (user.role === 'ADMIN_STRUCTURE') {
    const compte = await prisma.utilisateur.findUnique({
      where: { id: user.userId },
      select: { idStructure: true },
    });
    return compte?.idStructure ?? null;
  }

  if (user.role === 'PHARMACIEN') {
    const profil = await prisma.pharmacienProfile.findUnique({
      where: { idUtilisateur: user.userId },
      select: { estResponsable: true, roleOfficine: true, idStructure: true },
    });
    // **Deux marques pour un meme titre, et il faut les deux.** Le reste du
    // module officine reconnait le titulaire a `roleOfficine`, et le menu du
    // navigateur filtre sur ce champ. Les trois portes de creation posent
    // toujours les deux ensemble, mais s'en tenir a `estResponsable` ferait
    // afficher l'entree « Dossier reglementaire » a un titulaire que le
    // serveur refuserait ensuite : un ecran vide, sans explication. Aucune
    // des deux marques n'ouvre quoi que ce soit a l'adjoint ou au caissier.
    const titulaire = profil?.estResponsable || profil?.roleOfficine === 'TITULAIRE';
    return titulaire ? profil?.idStructure ?? null : null;
  }

  return null;
}

/**
 * La structure dont l'appelant repond, nommee, pour un client qui n'en
 * connait pas l'identifiant.
 *
 * L'espace d'administration apprend le sien par `GET /admin-structure/stats`.
 * **Le titulaire d'une officine n'a pas cet ecran** : son espace est celui du
 * pharmacien, qui ne parle jamais de structure. Plutot que de lui ouvrir des
 * statistiques dont il n'a que faire, cette route ne rend que ce qu'il faut
 * pour ouvrir son dossier : un identifiant et un nom a afficher.
 */
export async function maStructure(user: JwtPayload): Promise<{ id: string; nom: string }> {
  const id = await structureDontIlRepond(user);
  if (!id) throw new ForbiddenError('Accès réservé');

  const structure = await prisma.structureSante.findUnique({
    where: { id },
    select: { id: true, nom: true },
  });
  if (!structure) throw new NotFoundError('Structure introuvable');
  return structure;
}

/** Le chemin d'une piece, sans jamais pouvoir sortir du dossier prive. */
export function cheminPiece(nom: string): string {
  if (!/^[A-Za-z0-9_-]+\.pdf$/.test(nom)) throw new NotFoundError('Pièce introuvable');
  return path.join(DOSSIER_PIECES, nom);
}

/**
 * Ecrit les pieces sur le disque **avant** toute ecriture en base.
 *
 * Dans cet ordre, un echec d'ecriture ne laisse aucune structure a demi creee.
 * L'inverse laisserait une structure en base dont les pieces manquent, et il
 * faudrait la supprimer pour compenser. Ici, l'echec ne laisse au pire que des
 * fichiers orphelins, que `supprimerFichiers` nettoie.
 */
export async function ecrireFichiers(
  pieces: readonly PieceValidee[],
): Promise<{ type: TypePieceAgrement; fichier: string; taille: number; libelle: string | null }[]> {
  mkdirSync(DOSSIER_PIECES, { recursive: true });
  const ecrites: { type: TypePieceAgrement; fichier: string; taille: number; libelle: string | null }[] = [];
  try {
    for (const p of pieces) {
      const nom = `${randomUUID()}.pdf`;
      await fs.writeFile(cheminPiece(nom), p.contenu);
      ecrites.push({ type: p.type, fichier: nom, taille: p.contenu.length, libelle: p.libelle });
    }
  } catch (e) {
    // Rien ne doit rester d'une ecriture partielle.
    await supprimerFichiers(ecrites.map((p) => p.fichier));
    if (e instanceof AppError) throw e;
    throw new ValidationError('Échec de l’enregistrement des pièces justificatives.');
  }
  return ecrites;
}

/** Nettoyage : un fichier deja absent n'est pas une erreur. */
export async function supprimerFichiers(noms: readonly string[]): Promise<void> {
  await Promise.all(noms.map((n) => fs.unlink(cheminPiece(n)).catch(() => undefined)));
}

/**
 * Le dossier d'une structure, tel que l'administration le verrait.
 *
 * `complet` repond sur les pieces **exigees pour ce type**. Une structure
 * publique est donc complete sans rien deposer, et c'est juste : elle n'a rien
 * a produire.
 */
export async function dossierDe(idStructure: string) {
  const structure = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: {
      id: true, nom: true, type: true, rccm: true,
      numeroAgrementCreation: true, numeroAgrementExploitation: true, lieuAutorise: true,
      piecesAgrement: {
        select: { id: true, type: true, taille: true, libelle: true, deposeLe: true },
        orderBy: { deposeLe: 'desc' },
      },
    },
  });
  if (!structure) throw new NotFoundError('Structure introuvable');

  const presentes = new Set(structure.piecesAgrement.map((p) => p.type));
  const manquantes = piecesRequisesPour(structure.type).filter((p) => !presentes.has(p));

  return {
    idStructure: structure.id,
    nom: structure.nom,
    type: structure.type,
    rccm: structure.rccm,
    numeroAgrementCreation: structure.numeroAgrementCreation,
    numeroAgrementExploitation: structure.numeroAgrementExploitation,
    lieuAutorise: structure.lieuAutorise,
    exigeDesPieces: exigeDesPieces(structure.type),
    complet: manquantes.length === 0,
    manquantes,
    pieces: structure.piecesAgrement.map((p) => ({
      id: p.id,
      type: p.type,
      taille: p.taille,
      libelle: p.libelle,
      deposeLe: p.deposeLe.toISOString(),
    })),
  };
}

/**
 * Le dossier d'une structure, **pour qui en repond**.
 *
 * `dossierDe` ne verifiait aucun perimetre : la route etait ouverte a tout
 * administrateur de structure, qui pouvait donc lire le dossier d'une autre -
 * son RCCM, ses numeros d'agrement, la liste de ses pieces. Les fichiers
 * restaient hors de portee, mais pas ce qui les decrit. En ouvrant la route
 * aux titulaires d'officine, le trou serait devenu un annuaire des
 * concurrents.
 *
 * Une structure dont on ne repond pas se traite comme une structure inconnue :
 * rien ne doit confirmer qu'elle existe.
 */
export async function dossierPour(user: JwtPayload, idStructure: string) {
  const national = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN_NATIONAL';
  if (!national) {
    const sienne = await structureDontIlRepond(user);
    if (!sienne || sienne !== idStructure) throw new NotFoundError('Structure introuvable');
  }
  return dossierDe(idStructure);
}

/**
 * Le contenu d'une piece, pour qui a le droit de la lire.
 *
 * **Seules l'administration nationale et la structure elle-meme.** Un agrement
 * porte le nom du responsable, parfois son numero de diplome et l'adresse du
 * local : ce n'est pas une donnee medicale, mais ce n'est pas public non plus.
 * Chaque lecture est journalisee, comme la photo d'un assure.
 */
export async function lirePiece(user: JwtPayload, idPiece: string): Promise<{ fichier: string; contenu: Buffer }> {
  const piece = await prisma.pieceAgrement.findUnique({
    where: { id: idPiece },
    select: { fichier: true, type: true, idStructure: true },
  });
  if (!piece) throw new NotFoundError('Pièce introuvable');

  const national = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN_NATIONAL';
  if (!national) {
    const sienne = await structureDontIlRepond(user);
    // Deux refus distincts, et la nuance compte. Qui ne repond d'aucune
    // structure - un medecin, un patient, le caissier d'une officine - se
    // voit refuser l'acces : il n'a aucun titre a etre la. Qui en repond
    // d'une autre recoit « introuvable » : rien ne doit lui confirmer que
    // cette piece existe.
    if (sienne === null) throw new ForbiddenError('Accès réservé');
    if (sienne !== piece.idStructure) throw new NotFoundError('Pièce introuvable');
  }

  try {
    const contenu = await fs.readFile(cheminPiece(piece.fichier));
    logger.info('[AGREMENT] piece consultee', { idPiece, type: piece.type, parQui: user.userId });
    return { fichier: piece.fichier, contenu };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new NotFoundError('Pièce introuvable');
  }
}

/** Ce que le client envoie comme identifiants reglementaires. */
export interface IdentifiantsRecus {
  rccm?: string | undefined;
  numeroAgrementCreation?: string | undefined;
  numeroAgrementExploitation?: string | undefined;
  lieuAutorise?: string | undefined;
}

/** Ce que la structure enregistre. */
export interface IdentifiantsValides {
  rccm: string | null;
  numeroAgrementCreation: string | null;
  numeroAgrementExploitation: string | null;
  lieuAutorise: string | null;
}

/**
 * Les identifiants exiges, selon le type.
 *
 * Volontairement **ici et pas dans le schema zod** : l'exigence depend du
 * type de structure, et un `superRefine` par porte aurait reecrit trois fois
 * la meme regle. Les pieces et les numeros se decident au meme endroit.
 *
 * L'assureur n'a qu'une reference : celle de la decision d'agrement de la
 * Banque Centrale (forme `D/2009/CAM/LOA/07`), portee par
 * `numeroAgrementCreation`. Il n'y a pas d'arrete d'exploitation distinct chez
 * elle, contrairement au ministere de la Sante.
 */
export function validerIdentifiants(
  type: TypeStructure | string,
  recus: IdentifiantsRecus,
): IdentifiantsValides {
  const texte = (v: string | undefined): string | null => {
    const net = v?.trim();
    return net ? net : null;
  };

  const valides: IdentifiantsValides = {
    rccm: recus.rccm?.trim() ? normaliserRccm(recus.rccm) : null,
    numeroAgrementCreation: texte(recus.numeroAgrementCreation),
    numeroAgrementExploitation: texte(recus.numeroAgrementExploitation),
    lieuAutorise: texte(recus.lieuAutorise),
  };

  if (!exigeDesPieces(type)) return valides;

  /**
   * Une structure publique ne porte qu'une reference : celle de l'acte qui
   * la cree. Ni registre du commerce, ni arrete d'exploitation — l'acte
   * l'autorise du meme geste. Les deux champs sont **effaces** plutot que
   * laisses tels quels : une valeur saisie par erreur ferait croire, des
   * annees plus tard, que l'hopital possede un RCCM.
   */
  if (estStructurePublique(type)) {
    valides.rccm = null;
    valides.numeroAgrementExploitation = null;
    if (!valides.numeroAgrementCreation) {
      throw new ValidationError(
        "Dossier incomplet : il manque la référence de l'acte de création de l'établissement.",
      );
    }
    return valides;
  }

  const manquants: string[] = [];
  if (!valides.rccm) manquants.push('le numéro RCCM');
  if (!valides.lieuAutorise) manquants.push("le lieu autorisé par l'agrément");

  if (type === TypeStructure.ASSURANCE) {
    if (!valides.numeroAgrementCreation) manquants.push("la référence de l'agrément de la Banque Centrale");
    // Pas d'arrete d'exploitation distinct : ne rien garder plutot que de
    // laisser une valeur que personne ne saurait interpreter.
    valides.numeroAgrementExploitation = null;
  } else {
    if (!valides.numeroAgrementCreation) manquants.push("le numéro de l'agrément de création");
    if (!valides.numeroAgrementExploitation) manquants.push("le numéro de l'agrément d'exploitation");
  }

  if (manquants.length > 0) {
    throw new ValidationError(`Dossier incomplet : il manque ${manquants.join(', ')}.`);
  }
  return valides;
}

/**
 * Deposer ou remplacer des pieces sur une structure deja creee.
 *
 * Deux besoins reels, qu'un blocage a la creation ne couvre pas :
 *   - les structures anterieures a cette regle n'ont aucune piece, et la
 *     migration ne pouvait pas les inventer ;
 *   - **un agrement se renouvelle.** Le ministere prevoit un renouvellement
 *     periodique : remplacer la piece expiree doit etre un geste, pas une
 *     recreation de la structure.
 *
 * Contrairement a la creation, le dossier n'a pas besoin d'etre complet ici :
 * on accepte ce qui arrive. Exiger les quatre d'un coup empecherait de
 * completer un dossier piece par piece.
 */
export async function deposerPieces(
  user: JwtPayload,
  idStructure: string,
  fichiers: readonly FichierRecu[],
  libelles: Readonly<Record<string, string | undefined>> = {},
) {
  const structure = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: { id: true, type: true, nom: true },
  });
  if (!structure) throw new NotFoundError('Structure introuvable');

  const national = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN_NATIONAL';
  if (!national) {
    const sienne = await structureDontIlRepond(user);
    if (!sienne || sienne !== idStructure) {
      throw new ForbiddenError('Vous ne pouvez déposer des pièces que pour votre structure');
    }
  }

  if (fichiers.length === 0) throw new ValidationError('Aucune pièce envoyée.');

  // `validerPieces` verifierait aussi les pieces manquantes ; on ne veut pas
  // de ce controle ici. Le type sans exigence court-circuite ce seul volet,
  // tout en gardant la verification des octets et des noms de champ.
  const validees = validerPieces(SOUS_AUTORISATION_DU_PARENT, fichiers, libelles);

  const remplaces = validees
    .filter((p) => p.type !== TypePieceAgrement.AUTRE)
    .map((p) => p.type);

  const anciennes = remplaces.length === 0 ? [] : await prisma.pieceAgrement.findMany({
    where: { idStructure, type: { in: remplaces } },
    select: { id: true, fichier: true },
  });

  const fichiersEcrits = await ecrireFichiers(validees);
  try {
    await prisma.$transaction(async (tx) => {
      // L'index unique partiel refuserait deux pieces du meme type : l'ancienne
      // part avant que la nouvelle n'arrive, dans la meme transaction.
      for (const a of anciennes) {
        await tx.pieceAgrement.delete({ where: { id: a.id } });
      }
      await tx.pieceAgrement.createMany({
        data: fichiersEcrits.map((p) => ({ ...p, idStructure, idDeposePar: user.userId })),
      });
    });
  } catch (e) {
    await supprimerFichiers(fichiersEcrits.map((p) => p.fichier));
    throw e;
  }

  // Les fichiers remplaces ne partent qu'apres le commit : si la transaction
  // avait echoue, l'ancienne piece doit rester lisible.
  await supprimerFichiers(anciennes.map((a) => a.fichier));

  logger.info('[AGREMENT] pieces deposees', {
    idStructure, type: structure.type, deposees: fichiersEcrits.length,
    remplacees: anciennes.length, parQui: user.userId,
  });
  return dossierDe(idStructure);
}
