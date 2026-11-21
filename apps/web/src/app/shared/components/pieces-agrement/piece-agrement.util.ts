// Les deux contrôles locaux d'une pièce d'agrément.
//
// **Partagés par les deux écrans** — celui qui crée et celui qui complète.
// Les écrire deux fois aurait laissé la limite ou le format diverger : une
// pièce refusée ici et acceptée là, ou l'inverse, pour la même règle.
//
// Ils **ne remplacent pas le serveur**, qui lit les octets de tête de chaque
// fichier. Ils existent pour une raison pratique : sur un réseau guinéen,
// découvrir après dix minutes de téléversement qu'un fichier était trop gros
// ou n'était pas un PDF se paie en temps perdu.

/** 5 Mo, comme le serveur : un agrément scanné à plat dépasse souvent 2 Mo. */
export const TAILLE_MAX_PIECE = 5 * 1024 * 1024;

/**
 * Renvoie la clé i18n du refus, ou `null` si la pièce peut partir.
 *
 * Une clé plutôt qu'un message : l'appelant l'affiche dans la langue de
 * l'utilisateur, et le catalogue reste le seul endroit où le texte vit.
 */
export function refusLocal(fichier: File, image = false): string | null {
  if (fichier.size === 0) return 'AGREMENT.PIECE.VIDE';
  if (fichier.size > TAILLE_MAX_PIECE) return 'AGREMENT.PIECE.TROP_GROS';

  // La photo du responsable : une image JPEG ou PNG, pas un PDF.
  if (image) {
    const nomImage = /\.(jpe?g|png)$/i.test(fichier.name);
    return fichier.type === 'image/jpeg' || fichier.type === 'image/png' || nomImage ? null : 'AGREMENT.PIECE.PAS_UNE_IMAGE';
  }

  // Certains navigateurs ne renseignent pas `type` : l'extension sert alors de
  // dernier indice. Le serveur, lui, ne croit que les octets.
  const nomPdf = fichier.name.toLowerCase().endsWith('.pdf');
  if (fichier.type !== 'application/pdf' && !nomPdf) return 'AGREMENT.PIECE.PAS_UN_PDF';

  return null;
}

/** Les pièces qui sont des images : la photo du responsable. Même liste que l'API. */
export const PIECES_IMAGE: readonly string[] = ['PHOTO_RESPONSABLE'];

export function estImage(piece: string): boolean {
  return PIECES_IMAGE.includes(piece);
}

/** `200 Ko`, `2.0 Mo` — jamais `0 Ko`, qui ressemble à un téléversement raté. */
export function tailleLisible(octets: number): string {
  return octets >= 1024 * 1024
    ? `${(octets / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(octets / 1024))} Ko`;
}
