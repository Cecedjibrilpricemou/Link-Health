import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/app-error';
import path from 'path';
import fs from 'fs';

const AVATARS_DIR = path.join(process.cwd(), 'uploads', 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

export const TYPES_IMAGE_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp'];

// Stockage en mémoire : l'image est redimensionnée par sharp avant d'être
// écrite sur disque, on n'écrit donc jamais l'original pleine résolution.
export const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!TYPES_IMAGE_ACCEPTES.includes(file.mimetype)) {
      cb(new Error('Format non supporté — utilisez une image JPEG, PNG ou WebP.'));
      return;
    }
    cb(null, true);
  },
}).single('photo');

export const AVATARS_PUBLIC_PATH = '/uploads/avatars';
export { AVATARS_DIR };

// Logo de la plateforme (page Parametres > Identite). Meme principe : en
// memoire, redimensionne par sharp, jamais l'original sur disque.
const LOGOS_DIR = path.join(process.cwd(), 'uploads', 'logos');
fs.mkdirSync(LOGOS_DIR, { recursive: true });

export const TYPES_LOGO_ACCEPTES = [...TYPES_IMAGE_ACCEPTES, 'image/svg+xml'];

export const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!TYPES_LOGO_ACCEPTES.includes(file.mimetype)) {
      cb(new Error('Format non supporté — utilisez une image PNG, JPEG, WebP ou SVG.'));
      return;
    }
    cb(null, true);
  },
}).single('logo');

export const LOGOS_PUBLIC_PATH = '/uploads/logos';
export { LOGOS_DIR };

// Photo d'identite d'une personne assuree. En memoire : elle est recadree par
// sharp puis ecrite dans le stockage prive (jamais sous `uploads/`, public).
export const uploadPhotoAssure = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!TYPES_IMAGE_ACCEPTES.includes(file.mimetype)) {
      cb(new Error('Format non supporté — utilisez une image JPEG, PNG ou WebP.'));
      return;
    }
    cb(null, true);
  },
}).single('photo');

// ── Les pieces d'agrement des structures privees ─────────────────────
//
// **Le filtre de multer ne suffit pas pour un PDF.** `file.mimetype` vient de
// l'en-tete `Content-Type` envoye par le client : un fichier renomme passe.
// Pour les images ci-dessus le risque reste faible, `sharp` echouant sur un
// non-image ; un PDF, lui, est stocke tel quel et rien ne dementirait
// l'en-tete. Le filtre ci-dessous est donc un refus precoce, pas la
// verification : celle-ci lit les octets de tete (`estPdf`).
export const TYPE_PDF = 'application/pdf';

/** 5 Mo : un agrement scanne a plat depasse facilement 2 Mo. */
export const TAILLE_MAX_PIECE = 5 * 1024 * 1024;

/** Quatre pieces exigees, plus quelques `AUTRE` : dix bornent le dossier. */
export const NOMBRE_MAX_PIECES = 10;

// `.any()` et non `.fields([...])` : les quatre pieces nommees arrivent sous
// leur propre nom, mais `AUTRE` peut etre depose plusieurs fois. Les noms de
// champ sont valides contre l'enum cote service, jamais acceptes tels quels.
export const uploadPiecesAgrement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_PIECE, files: NOMBRE_MAX_PIECES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== TYPE_PDF) {
      cb(new Error('Les pièces justificatives doivent être des fichiers PDF.'));
      return;
    }
    cb(null, true);
  },
}).any();

/** `%PDF-` : les cinq octets qui ouvrent tout PDF, quelle que soit sa version. */
const SIGNATURE_PDF = Buffer.from('%PDF-', 'latin1');

/**
 * Ce qui fait foi. `Content-Type` est declaratif, les octets ne le sont pas.
 *
 * Renvoie `true` seulement si le contenu commence par la signature PDF. Un
 * HTML, un exécutable ou une image renommes en `.pdf` echouent ici, et
 * echouent **avant** d'etre ecrits sur le disque.
 */
export function estPdf(contenu: Buffer): boolean {
  return contenu.length > SIGNATURE_PDF.length && contenu.subarray(0, SIGNATURE_PDF.length).equals(SIGNATURE_PDF);
}

/**
 * Recoit les pieces et traduit les refus de multer en erreurs lisibles.
 *
 * Multer rend `LIMIT_FILE_SIZE` et `LIMIT_FILE_COUNT` sans dire de quoi il
 * parle : laisses tels quels, ils remontent en 500.
 */
export function recevoirPiecesAgrement(req: Request, res: Response, next: NextFunction) {
  uploadPiecesAgrement(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(new ValidationError('Pièce trop volumineuse (5 Mo maximum par fichier).'));
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        next(new ValidationError(`Trop de pièces (${NOMBRE_MAX_PIECES} maximum).`));
        return;
      }
    }
    next(new ValidationError(err instanceof Error ? err.message : 'Échec du téléversement.'));
  });
}

// ── Les pieces du dossier d'un motard livreur ────────────────────────
//
// **Une photo autant qu'un PDF.** Un motard photographie sa carte grise avec
// son telephone ; exiger un PDF l'enverrait chercher un cybercafe pour un
// papier qu'il a en main. Le dossier accepte donc JPEG, PNG et PDF.
//
// Comme pour l'agrement, le filtre ci-dessous n'est qu'un refus precoce : ce
// qui fait foi, ce sont les octets (`typeMimeReel`). Il laisse passer un type
// absent ou `application/octet-stream`, que certains telephones envoient pour
// une photo parfaitement valide - les octets trancheront.

/** Les formats qu'un dossier de livreur accepte, tels qu'on les reconnait. */
export type TypeMimePieceLivreur = 'application/pdf' | 'image/jpeg' | 'image/png';

/** Six pieces exactement : multer refuse la septieme avant de la lire. */
export const NOMBRE_PIECES_LIVREUR = 6;

const TYPES_DECLARES_LIVREUR = ['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream', ''];

export const uploadPiecesLivreur = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_PIECE, files: NOMBRE_PIECES_LIVREUR },
  fileFilter: (_req, file, cb) => {
    if (!TYPES_DECLARES_LIVREUR.includes(file.mimetype ?? '')) {
      cb(new Error('Les pièces doivent être des photos (JPEG, PNG) ou des fichiers PDF.'));
      return;
    }
    cb(null, true);
  },
}).any();

const SIGNATURE_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Le format reel d'une piece, lu dans ses octets de tete - ou `null`.
 *
 * C'est ce type, et non l'en-tete du client, qui est conserve puis renvoye a
 * la lecture : un HTML renomme en `.jpg` et servi comme `text/html` depuis
 * notre domaine serait une page executee chez l'agent qui l'ouvre.
 */
export function typeMimeReel(contenu: Buffer): TypeMimePieceLivreur | null {
  const commencePar = (signature: Buffer) =>
    contenu.length > signature.length && contenu.subarray(0, signature.length).equals(signature);
  if (estPdf(contenu)) return 'application/pdf';
  if (commencePar(SIGNATURE_JPEG)) return 'image/jpeg';
  if (commencePar(SIGNATURE_PNG)) return 'image/png';
  return null;
}

/** Recoit les pieces d'un livreur, refus de multer traduits comme pour l'agrement. */
export function recevoirPiecesLivreur(req: Request, res: Response, next: NextFunction) {
  uploadPiecesLivreur(req, res, (err: unknown) => {
    if (!err) { next(); return; }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(new ValidationError('Pièce trop volumineuse (5 Mo maximum par fichier).'));
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        next(new ValidationError(`Trop de pièces (${NOMBRE_PIECES_LIVREUR} maximum).`));
        return;
      }
    }
    next(new ValidationError(err instanceof Error ? err.message : 'Échec du téléversement.'));
  });
}

/**
 * En multipart, les champs texte sont des chaines plates : impossible d'y
 * porter un objet imbrique comme `admin`. Le client envoie donc un seul champ
 * `donnees` contenant du JSON, et ce middleware le remet a sa place.
 *
 * **Tolerant par necessite.** Une structure publique n'a aucune piece a
 * fournir et continue de poster du JSON ordinaire : dans ce cas `donnees` est
 * absent et `req.body` est laisse tel quel. Exiger le multipart partout aurait
 * casse la creation des postes et centres de sante sans rien y gagner.
 */
export function corpsJsonMultipart(req: Request, _res: Response, next: NextFunction) {
  const brut = (req.body as Record<string, unknown> | undefined)?.['donnees'];
  if (typeof brut !== 'string') { next(); return; }
  try {
    req.body = JSON.parse(brut);
    next();
  } catch {
    next(new ValidationError('Le champ « donnees » ne contient pas du JSON valide.'));
  }
}
