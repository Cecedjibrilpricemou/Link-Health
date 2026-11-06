import { Response } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { AuthRequest } from '../middlewares/auth.middleware';
import { ValidationError } from '../utils/app-error';
import { AVATARS_DIR, AVATARS_PUBLIC_PATH, LOGOS_DIR, LOGOS_PUBLIC_PATH } from '../middlewares/upload.middleware';
import { modifierLogo } from '../services/parametres.service';
import type { IdentitePlateformeView } from '@baobaoheath/shared-types';

// Les avatars sont affichés au maximum à ~72px (hero profil patient) : on
// stocke en 256px pour rester net sur écrans haute densité sans imposer le
// téléchargement de l'original à chaque chargement de page — la plateforme
// cible des connexions à faible débit.
const TAILLE_AVATAR_PX = 256;

export async function uploadAvatarController(req: AuthRequest, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError('Aucune image reçue.');
  }

  const filename = `${req.user!.userId}-${Date.now()}-${randomUUID().slice(0, 8)}.webp`;

  try {
    await sharp(req.file.buffer)
      .rotate() // respecte l'orientation EXIF des photos prises au téléphone
      .resize(TAILLE_AVATAR_PX, TAILLE_AVATAR_PX, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toFile(path.join(AVATARS_DIR, filename));
  } catch {
    throw new ValidationError("Image illisible ou corrompue.");
  }

  // Le chemin seul, sans l'hote qui a recu le fichier : voir utils/chemin-media.
  const url = `${AVATARS_PUBLIC_PATH}/${filename}`;
  res.status(200).json({ success: true, data: { url } });
}

// Le logo s'affiche dans la barre de navigation (~32px de haut) et dans les
// e-mails : 512px de large suffisent. On garde les proportions et la
// transparence (PNG).
const LARGEUR_LOGO_PX = 512;

/**
 * Ce qu'un SVG ne doit pas contenir pour etre seulement *rendu*.
 *
 * **Un SVG est un document, pas une image** : il peut porter du script, des
 * gestionnaires d'evenements, du HTML (`foreignObject`), des entites XML qui
 * lisent un fichier local, ou des references vers d'autres ressources. Le SVG
 * est de toute facon converti en PNG ci-dessous — ce qui supprime tout code —,
 * mais on ne confie pas un document hostile a la bibliotheque de rendu.
 */
const SVG_INTERDIT = [
  /<script\b/i,
  /\son[a-z]+\s*=/i,
  /<foreignObject\b/i,
  /<!ENTITY\b|<!DOCTYPE\b/i,
  /<(?:iframe|embed|object)\b/i,
  // Toute reference qui n'est pas une ancre interne (#id) ni une image en data:.
  /\b(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)/i,
  /javascript:/i,
];

export async function uploadLogoController(req: AuthRequest, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError('Aucune image reçue.');
  }

  const estSvg = req.file.mimetype === 'image/svg+xml';
  if (estSvg) {
    const texte = req.file.buffer.toString('utf8');
    if (SVG_INTERDIT.some((motif) => motif.test(texte))) {
      throw new ValidationError('Ce SVG contient du script, des liens ou des entités : enregistrez-le en PNG, ou exportez un SVG simple.');
    }
  }

  // **Toujours un PNG, y compris pour un SVG** : une image matricielle ne peut
  // plus porter de code, et /uploads est servi sur l'origine de l'API.
  const filename = `logo-${Date.now()}-${randomUUID().slice(0, 8)}.png`;

  try {
    await sharp(req.file.buffer, estSvg ? { density: 300 } : {})
      .rotate()
      .resize({ width: LARGEUR_LOGO_PX, height: LARGEUR_LOGO_PX, fit: 'inside', withoutEnlargement: !estSvg })
      .png({ compressionLevel: 9 })
      .toFile(path.join(LOGOS_DIR, filename));
  } catch {
    throw new ValidationError('Image illisible ou corrompue.');
  }

  const logoUrl = `${LOGOS_PUBLIC_PATH}/${filename}`;
  const data: IdentitePlateformeView = await modifierLogo(req.user!.userId, logoUrl);
  res.status(200).json({ success: true, data });
}
