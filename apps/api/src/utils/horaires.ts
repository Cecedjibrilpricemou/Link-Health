// Les horaires d'ouverture d'une officine, et l'etat qui en decoule.
//
// Le visiteur se deplace : savoir si c'est ouvert lui evite de traverser la
// ville pour trouver porte close. C'est la seule raison d'etre de ce fichier.
//
// **Un creneau par jour, ou ferme.** Les officines qui ferment a midi ne sont
// pas representables ici, et c'est assume : la saisie doublerait pour un cas
// minoritaire. Si le besoin se confirme, le format accepte un second creneau
// sans migration, puisqu'il vit en JSON.
//
// **Le jour suit `Date.getDay()`** : 0 = dimanche, 6 = samedi. Toute autre
// convention obligerait a convertir a chaque lecture, et c'est la que se
// glissent les decalages d'un jour.

/** Un creneau, en heures locales : « 08:00 » a « 20:00 ». */
export interface Creneau {
  ouvre: string;
  ferme: string;
}

/** Les sept jours. Une entree absente ou nulle veut dire ferme. */
export type Horaires = Record<string, Creneau | null>;

export interface EtatOuverture {
  /** Null quand l'officine n'a jamais saisi ses horaires : on ne devine pas. */
  ouvert: boolean | null;
  /** L'heure de fermeture du jour, quand c'est ouvert. */
  fermeA: string | null;
  /** Le prochain creneau, quand c'est ferme : « 0 » pour aujourd'hui. */
  prochaine: { dansJours: number; heure: string } | null;
}

const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Les minutes depuis minuit, ou null si le format n'est pas une heure. */
export function enMinutes(heure: string): number | null {
  const m = HEURE.exec(heure.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Les horaires sont-ils utilisables ? Leve la liste des jours fautifs.
 *
 * Une fermeture avant l'ouverture n'est pas un detail d'ergonomie : l'officine
 * apparaitrait fermee toute la journee sans que personne comprenne pourquoi.
 */
export function joursInvalides(horaires: Horaires): string[] {
  const fautifs: string[] = [];
  for (const [jour, creneau] of Object.entries(horaires)) {
    if (creneau === null || creneau === undefined) continue;
    const debut = enMinutes(creneau.ouvre);
    const fin = enMinutes(creneau.ferme);
    if (debut === null || fin === null || fin <= debut) fautifs.push(jour);
  }
  return fautifs;
}

/** Les horaires d'un jour, en tolerant une entree absente. */
function creneauDu(horaires: Horaires, jour: number): Creneau | null {
  const c = horaires[String(jour)];
  return c ?? null;
}

/**
 * Ouvert maintenant ? Et sinon, quand ?
 *
 * `maintenant` est pris dans le fuseau du serveur, qui est celui du pays
 * installe : la plateforme sert un pays a la fois, et le visiteur est sur
 * place. Le jour de reference vient de la meme date, jamais d'ailleurs, sans
 * quoi « ferme le dimanche » tomberait un samedi soir.
 */
export function etatOuverture(
  horaires: Horaires | null | undefined,
  maintenant: Date = new Date(),
): EtatOuverture {
  // Pas d'horaires saisis : on ne dit ni ouvert ni ferme. Afficher « ferme »
  // ferait fuir les clients d'une officine qui n'a rien rempli.
  if (!horaires || Object.keys(horaires).length === 0) {
    return { ouvert: null, fermeA: null, prochaine: null };
  }

  const jour = maintenant.getDay();
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();

  const aujourdHui = creneauDu(horaires, jour);
  if (aujourdHui) {
    const debut = enMinutes(aujourdHui.ouvre);
    const fin = enMinutes(aujourdHui.ferme);
    if (debut !== null && fin !== null && fin > debut) {
      if (minutes >= debut && minutes < fin) {
        return { ouvert: true, fermeA: aujourdHui.ferme, prochaine: null };
      }
      // Avant l'ouverture : c'est encore pour aujourd'hui.
      if (minutes < debut) {
        return { ouvert: false, fermeA: null, prochaine: { dansJours: 0, heure: aujourdHui.ouvre } };
      }
    }
  }

  // Ferme pour aujourd'hui : on cherche le prochain jour ouvre, une semaine
  // au plus. Au-dela, l'officine n'ouvre jamais et le dire serait plus juste
  // que d'annoncer une date.
  for (let dans = 1; dans <= 7; dans += 1) {
    const creneau = creneauDu(horaires, (jour + dans) % 7);
    if (!creneau) continue;
    const debut = enMinutes(creneau.ouvre);
    const fin = enMinutes(creneau.ferme);
    if (debut === null || fin === null || fin <= debut) continue;
    return { ouvert: false, fermeA: null, prochaine: { dansJours: dans, heure: creneau.ouvre } };
  }

  return { ouvert: false, fermeA: null, prochaine: null };
}

/**
 * Les horaires tels qu'ils sortent de la base : du JSON, donc rien de sur.
 * Une forme inattendue est ignoree plutot que servie, sinon l'ecran afficherait
 * « ouvert » sur la foi de n'importe quoi.
 */
export function horairesDepuisLaBase(valeur: unknown): Horaires | null {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return null;
  const propres: Horaires = {};
  for (const [jour, creneau] of Object.entries(valeur as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(jour)) continue;
    if (creneau === null) {
      propres[jour] = null;
      continue;
    }
    if (typeof creneau !== 'object') continue;
    const { ouvre, ferme } = creneau as { ouvre?: unknown; ferme?: unknown };
    if (typeof ouvre !== 'string' || typeof ferme !== 'string') continue;
    if (enMinutes(ouvre) === null || enMinutes(ferme) === null) continue;
    propres[jour] = { ouvre, ferme };
  }
  return Object.keys(propres).length > 0 ? propres : null;
}
