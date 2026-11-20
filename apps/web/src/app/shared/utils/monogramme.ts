// Le monogramme d'une structure : ce qui tient lieu de logo tant qu'elle n'en
// a pas televerse. « CHU Donka » → « CHU », « Clinique Pasteur » → « CP »,
// « Centre de santé de Matam » → « CS ».

/** Les petits mots qu'on ne garde pas dans des initiales. */
const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'd', 'l', 'au', 'aux', 'en', 'sur', 'a', 'à']);

export function monogramme(nom: string): string {
  const mots = (nom ?? '').replace(/[’'`]/g, ' ').split(/[\s\-–—,.;:/()]+/).filter(Boolean);
  if (mots.length === 0) return '?';
  // Un sigle en tete (CHU, CMC, CSU) se garde tel quel : c'est ainsi qu'on
  // nomme l'etablissement.
  const premier = mots[0]!;
  if (/^[A-ZÀ-Ý]{2,4}$/.test(premier)) return premier;
  const utiles = mots.filter((m) => !MOTS_VIDES.has(m.toLocaleLowerCase('fr')));
  return (utiles.length ? utiles : mots)
    .slice(0, 2)
    .map((m) => m.charAt(0).toLocaleUpperCase('fr'))
    .join('');
}
