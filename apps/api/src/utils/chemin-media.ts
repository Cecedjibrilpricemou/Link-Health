// Les fichiers televerses (avatars, logo) s'enregistrent par leur chemin
// public, /uploads/<dossier>/<fichier>, jamais avec l'hote qui les a recus.
//
// Une adresse complete fige l'hote du moment : televerse depuis
// http://localhost:3000, le logo restait introuvable sur l'application mobile
// (pour qui « localhost » est le telephone), et une image en http:// est
// bloquee par le navigateur sur un site servi en HTTPS. Le chemin, lui, se
// resout la ou on l'affiche : sur l'origine de l'API pour les documents
// imprimes, et par le site pour ses pages.

/** Un fichier televerse dans un dossier donne : pas de sous-dossier, pas de « .. ». */
export function cheminTeleverse(dossier: 'avatars' | 'logos'): RegExp {
  return new RegExp(`^/uploads/${dossier}/[A-Za-z0-9_-][A-Za-z0-9._-]*$`);
}

/** Une adresse web absolue, en http ou https. */
export const ADRESSE_HTTP = /^https?:\/\/[^\s/]+\S*$/i;

/**
 * Ramene une adresse d'un fichier televerse a son chemin, quel que soit
 * l'hote qu'elle porte. Sert aux adresses deja enregistrees ; tout le reste
 * est rendu tel quel.
 */
export function versChemin(adresse: string): string {
  const m = /^https?:\/\/[^/]+(\/uploads\/(?:avatars|logos)\/[^/?#]+)$/i.exec(adresse);
  return m ? m[1] : adresse;
}
