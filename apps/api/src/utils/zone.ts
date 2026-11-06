// La zone d'une ordonnance ou d'une course : qui doit etre sollicite.
//
// **La maille est la commune, dans sa prefecture.** Elle etait le quartier
// seul, ce qui ratait des deux cotes :
//   - trop etroit : une pharmacie a 300 m, dans le quartier voisin, ne
//     recevait jamais l'ordonnance ; un motard ne voyait que les courses de
//     son propre quartier ;
//   - trop large : la prefecture n'etait pas regardee, donc deux villes ayant
//     un quartier du meme nom (« Madina », « Dixinn »…) s'echangeaient leurs
//     ordonnances.
//
// **Repli sur le quartier** quand l'une des deux parties n'a pas de commune :
// les comptes crees avant l'ajout du champ continuent de fonctionner comme
// avant, au lieu de ne plus rien recevoir.
//
// La comparaison ignore la casse et les espaces autour (« Ratoma » et
// « ratoma » sont la meme commune). Les accents ne sont pas encore
// rapproches : ce sera le role du referentiel geographique (feuille de route,
// M1), qui remplacera ces champs libres par des identifiants.

/** Ce qu'on sait du lieu d'une personne ou d'une structure. */
export interface Lieu {
  prefecture?: string | null;
  commune?: string | null;
  quartier?: string | null;
}

function propre(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/** Le lieu ramene a ce qui sert a comparer ; null si on ne peut rien en dire. */
export function zoneDe(lieu: Lieu): { prefecture: string; commune: string | null; quartier: string | null } | null {
  const prefecture = (lieu.prefecture ?? '').trim();
  const commune = (lieu.commune ?? '').trim() || null;
  const quartier = (lieu.quartier ?? '').trim() || null;
  // Sans prefecture, ou sans commune ni quartier, chercher serait deviner.
  if (!prefecture || (!commune && !quartier)) return null;
  return { prefecture, commune, quartier };
}

/**
 * Deux lieux sont dans la meme zone : meme prefecture, puis meme commune si
 * les deux en ont une, sinon meme quartier.
 *
 * Une prefecture absente d'un cote ne bloque pas (anciennes commandes, qui ne
 * l'enregistraient pas) : on compare alors comme avant.
 */
export function memeZone(a: Lieu, b: Lieu): boolean {
  const pa = propre(a.prefecture), pb = propre(b.prefecture);
  if (pa && pb && pa !== pb) return false;
  const ca = propre(a.commune), cb = propre(b.commune);
  if (ca && cb) return ca === cb;
  const qa = propre(a.quartier), qb = propre(b.quartier);
  return !!qa && qa === qb;
}

type Egal = { equals: string; mode: 'insensitive' };
const egal = (v: string): Egal => ({ equals: v.trim(), mode: 'insensitive' });

/**
 * Le meme critere, ecrit pour Prisma, sur un modele qui porte ses champs sous
 * les noms donnes (`prefecture`/`commune`/`quartier` pour une structure ou un
 * livreur, `prefectureRecherche`/… pour une commande).
 */
export function filtreZone(
  zone: Lieu,
  champs: { prefecture: string; commune: string; quartier: string } = CHAMPS_LIEU,
  options: { prefectureFacultative?: boolean } = {},
): Record<string, unknown> {
  const z = zoneDe(zone);
  if (!z) return AUCUNE_ZONE;
  const parQuartier = z.quartier ? { [champs.quartier]: egal(z.quartier) } : AUCUNE_ZONE;
  // `prefectureFacultative` : les commandes anterieures a ce champ ne l'ont
  // pas ; elles restent visibles, comparees par le quartier comme avant.
  const prefecture = options.prefectureFacultative
    ? { OR: [{ [champs.prefecture]: egal(z.prefecture) }, { [champs.prefecture]: null }] }
    : { [champs.prefecture]: egal(z.prefecture) };
  const lieu = z.commune
    ? {
        OR: [
          { [champs.commune]: egal(z.commune) },
          // Repli : en face, pas de commune renseignee, meme quartier.
          { [champs.commune]: null, ...parQuartier },
        ],
      }
    : parQuartier;
  // Un `AND` explicite : le filtre se combine avec un autre `OR` de
  // l'appelant sans l'ecraser.
  return { AND: [prefecture, lieu] };
}

/** Les noms de champs d'une structure, d'un livreur ou d'une course. */
export const CHAMPS_LIEU = { prefecture: 'prefecture', commune: 'commune', quartier: 'quartier' };
/** Les noms de champs de la zone figee sur une commande. */
export const CHAMPS_RECHERCHE = { prefecture: 'prefectureRecherche', commune: 'communeRecherche', quartier: 'quartierRecherche' };

/** Ne retient rien, sans erreur : chercher sans zone serait deviner. */
const AUCUNE_ZONE = { id: '__aucune_zone__' };

/** La zone figee sur une commande, sous la forme d'un lieu. */
export function zoneDeLaCommande(c: {
  prefectureRecherche?: string | null; communeRecherche?: string | null; quartierRecherche?: string | null;
}): Lieu {
  return { prefecture: c.prefectureRecherche, commune: c.communeRecherche, quartier: c.quartierRecherche };
}
