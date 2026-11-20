// Les images des pages publiques, remplacees par le super-admin.
//
// **Des emplacements fixes.** La mise en page prevoit ou vont les images (la
// page d'accueil, les ecrans de connexion, les etapes de « Comment ca
// marche ») ; le super-admin change l'image, pas la page.
//
// **Une image propre, quelle que soit celle recue.** Trop petite, elle serait
// floue : refusee, en disant la taille attendue. Sinon elle est redressee
// (orientation des photos de telephone), reduite, convertie en WebP, et
// declinee en une version pour petits ecrans. Le cadrage reste celui des
// pages (`object-fit: cover`) : aucune image ne deforme la mise en page.
//
// **Rien du fichier recu n'est garde tel quel** : ni l'original, ni ses
// metadonnees (lieu de prise de vue d'une photo de telephone), ni son nom.
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { EMPLACEMENTS_VISUELS } from '@baobaoheath/shared-types';
import type { EmplacementVisuel, ParametresVisuelsView } from '@baobaoheath/shared-types';
import { logger } from '../config/logger';
import { ValidationError } from '../utils/app-error';
import { VISUELS_DIR, VISUELS_PUBLIC_PATH } from '../middlewares/upload.middleware';
import { enregistrerVisuel, getValeursParametres } from './parametres.service';

/**
 * Par emplacement : la largeur gardee, celle de la version pour petits
 * ecrans, et la largeur minimale acceptee (en dessous, l'image serait floue
 * a l'endroit ou elle s'affiche).
 */
export const FORMATS_VISUELS: Record<EmplacementVisuel, { largeur: number; petite: number; minimum: number }> = {
  ACCUEIL: { largeur: 1600, petite: 800, minimum: 900 },
  CONNEXION: { largeur: 1200, petite: 640, minimum: 700 },
  ETAPE_1: { largeur: 1200, petite: 600, minimum: 600 },
  ETAPE_2: { largeur: 1200, petite: 600, minimum: 600 },
  ETAPE_3: { largeur: 1200, petite: 600, minimum: 600 },
  ETAPE_4: { largeur: 1200, petite: 600, minimum: 600 },
  ETAPE_5: { largeur: 1200, petite: 600, minimum: 600 },
  ETAPE_6: { largeur: 1200, petite: 600, minimum: 600 },
  ETAPE_7: { largeur: 1200, petite: 600, minimum: 600 },
};

/** Une description, c'est une phrase : au-dela, elle n'est plus lue. */
export const DESCRIPTION_MAX = 200;
/** Une image trop allongee ne remplit aucun cadre : refusee aussi. */
const RAPPORT_MAX = 3;

export function emplacementConnu(e: string): e is EmplacementVisuel {
  return (EMPLACEMENTS_VISUELS as readonly string[]).includes(e);
}

function exigerEmplacement(e: string): EmplacementVisuel {
  if (!emplacementConnu(e)) throw new ValidationError("Emplacement d'image inconnu.");
  return e;
}

/**
 * Combien de temps une image remplacee reste servie. La reponse publique est
 * gardee une minute par les navigateurs : supprimer l'ancienne image aussitot
 * afficherait une image cassee a qui a charge la page juste avant.
 */
export const DELAI_CONSERVATION_MS = 10 * 60 * 1000;

/** Le debut du nom des fichiers d'un emplacement : `visuel-etape-1-`. */
function prefixe(emplacement: EmplacementVisuel): string {
  return `visuel-${emplacement.toLowerCase().replace('_', '-')}-`;
}

/**
 * Supprimer les images remplacees d'un emplacement, une fois passe le delai
 * de conservation. Jamais celles en service, jamais hors du dossier des
 * visuels, jamais celles d'un autre emplacement.
 */
async function nettoyerAnciennes(emplacement: EmplacementVisuel, enService: string[], maintenant = Date.now()): Promise<void> {
  const gardes = new Set(enService.map((u) => path.basename(u)));
  let noms: string[];
  try {
    noms = await fs.readdir(VISUELS_DIR);
  } catch {
    return;
  }
  for (const nom of noms) {
    if (!nom.startsWith(prefixe(emplacement)) || gardes.has(nom)) continue;
    const chemin = path.join(VISUELS_DIR, nom);
    try {
      const { mtimeMs } = await fs.stat(chemin);
      if (maintenant - mtimeMs >= DELAI_CONSERVATION_MS) await fs.rm(chemin, { force: true });
    } catch {
      // Deja supprime par une requete concurrente : rien a faire.
    }
  }
}

/**
 * Supprimer tout de suite les fichiers d'un envoi rate. Seulement ceux du
 * dossier des visuels : un chemin ne doit jamais faire effacer autre chose.
 */
async function supprimerFichiers(...urls: string[]): Promise<void> {
  for (const url of urls) {
    if (!url.startsWith(`${VISUELS_PUBLIC_PATH}/`)) continue;
    const nom = path.basename(url);
    if (nom !== url.slice(VISUELS_PUBLIC_PATH.length + 1)) continue;
    await fs.rm(path.join(VISUELS_DIR, nom), { force: true }).catch(() => undefined);
  }
}

/** Remplacer l'image d'un emplacement. La description deja saisie est gardee. */
export async function remplacerVisuel(userId: string, emplacementBrut: string, contenu: Buffer): Promise<ParametresVisuelsView> {
  const emplacement = exigerEmplacement(emplacementBrut);
  const format = FORMATS_VISUELS[emplacement];

  let largeurRecue: number;
  let hauteurRecue: number;
  try {
    // `autoOrient` : les dimensions telles qu'affichees, photo de telephone tournee comprise.
    const meta = await sharp(contenu).metadata();
    const tournee = (meta.orientation ?? 1) >= 5;
    largeurRecue = (tournee ? meta.height : meta.width) ?? 0;
    hauteurRecue = (tournee ? meta.width : meta.height) ?? 0;
  } catch {
    throw new ValidationError('Image illisible ou corrompue.');
  }
  if (!largeurRecue || !hauteurRecue) throw new ValidationError('Image illisible ou corrompue.');
  if (largeurRecue < format.minimum) {
    throw new ValidationError(
      `Image trop petite : ${largeurRecue} px de large. Il en faut au moins ${format.minimum} pour qu'elle reste nette à cet endroit.`,
    );
  }
  const rapport = Math.max(largeurRecue / hauteurRecue, hauteurRecue / largeurRecue);
  if (rapport > RAPPORT_MAX) {
    throw new ValidationError("Image trop allongée : choisissez une photo plus proche du carré ou du format paysage.");
  }

  const base = `${prefixe(emplacement)}${Date.now()}-${randomUUID().slice(0, 8)}`;
  const nomGrande = `${base}-${format.largeur}.webp`;
  const nomPetite = `${base}-${format.petite}.webp`;
  try {
    const source = sharp(contenu).rotate();
    await Promise.all([
      source.clone().resize({ width: format.largeur, withoutEnlargement: true }).webp({ quality: 82 })
        .toFile(path.join(VISUELS_DIR, nomGrande)),
      source.clone().resize({ width: format.petite, withoutEnlargement: true }).webp({ quality: 80 })
        .toFile(path.join(VISUELS_DIR, nomPetite)),
    ]);
  } catch {
    await supprimerFichiers(`${VISUELS_PUBLIC_PATH}/${nomGrande}`, `${VISUELS_PUBLIC_PATH}/${nomPetite}`);
    throw new ValidationError('Image illisible ou corrompue.');
  }

  const { visuels } = await getValeursParametres();
  const ancien = visuels[emplacement];
  const resultat = await enregistrerVisuel(userId, emplacement, {
    url: `${VISUELS_PUBLIC_PATH}/${nomGrande}`,
    urlPetite: `${VISUELS_PUBLIC_PATH}/${nomPetite}`,
    description: ancien.description,
  });
  // L'ancienne image reste servie le temps que les pages deja chargees
  // l'oublient ; les plus anciennes partent maintenant.
  await nettoyerAnciennes(emplacement, [resultat[emplacement].url, resultat[emplacement].urlPetite]);
  logger.info('[VISUELS] image remplacee', { emplacement, parQui: userId });
  return resultat;
}

/**
 * Revenir a l'image d'origine. Les fichiers televerses partent apres le delai
 * de conservation, comme ceux d'une image remplacee.
 */
export async function retablirVisuel(userId: string, emplacementBrut: string): Promise<ParametresVisuelsView> {
  const emplacement = exigerEmplacement(emplacementBrut);
  const resultat = await enregistrerVisuel(userId, emplacement, { url: '', urlPetite: '', description: '' });
  await nettoyerAnciennes(emplacement, []);
  logger.info('[VISUELS] image d origine retablie', { emplacement, parQui: userId });
  return resultat;
}

/** Decrire l'image, pour qui ne la voit pas. Vide : la description d'origine. */
export async function decrireVisuel(userId: string, emplacementBrut: string, description: string): Promise<ParametresVisuelsView> {
  const emplacement = exigerEmplacement(emplacementBrut);
  const texte = description.replace(/\s+/g, ' ').trim();
  if (texte.length > DESCRIPTION_MAX) {
    throw new ValidationError(`Une phrase suffit : ${DESCRIPTION_MAX} caractères au plus.`);
  }
  const { visuels } = await getValeursParametres();
  return enregistrerVisuel(userId, emplacement, { ...visuels[emplacement], description: texte });
}
