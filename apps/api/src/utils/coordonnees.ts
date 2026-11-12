// Position GPS d'une structure : les deux coordonnees, ou aucune.
//
// Une latitude sans longitude ne place rien sur une carte, et ferait croire a
// une position connue. Les bornes (-90..90, -180..180) sont deja verifiees par
// les schemas ; ici, on verifie qu'elles vont par paire.
import { ValidationError } from './app-error';

export function verifierCoordonnees(latitude?: number | null, longitude?: number | null): void {
  const aLat = latitude !== undefined && latitude !== null;
  const aLng = longitude !== undefined && longitude !== null;
  if (aLat !== aLng) {
    throw new ValidationError('La position doit avoir une latitude ET une longitude, ou aucune des deux');
  }
}

/**
 * R4 : la position du patient est stockee chiffree, en une chaine
 * « latitude,longitude ». Ces deux fonctions sont les seules a la composer et
 * a la lire.
 */
export function positionEnTexte(latitude: number, longitude: number): string {
  return `${latitude},${longitude}`;
}

/**
 * Une chaine illisible (tronquee, ou encore chiffree faute de cle) rend une
 * position absente plutot que fausse : mieux vaut ne pas guider le motard
 * que l'envoyer ailleurs.
 */
export function lirePosition(texte: string | null | undefined): { latitude: number; longitude: number } | null {
  if (!texte) return null;
  const morceaux = texte.split(',');
  if (morceaux.length !== 2) return null;
  const [latitude, longitude] = morceaux.map((m) => Number(m.trim())) as [number, number];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Distance a vol d'oiseau en kilometres (formule de haversine), arrondie au metre. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1000) / 1000;
}
