// Le referentiel geographique (M1), **generique** : un arbre de lieux aux
// niveaux declares par le pays de l'installation (parametres, section `pays`).
//
// **Une installation par pays.** Region > Prefecture > Commune en Guinee,
// State > LGA > Ward au Nigeria, Provincia > Distrito > Posto au Mozambique :
// le code ne connait que des niveaux, et deux roles — le niveau de base (ou
// l'on cherche d'abord une pharmacie ou un motard, champ `commune`) et le
// niveau d'elargissement (ou l'appel s'etend ensuite, champ `prefecture`).
//
// **Il propose, il ne contraint pas.** Les saisies restent du texte libre ;
// `horsReferentiel` montre a l'administrateur ce qui a ete saisi hors liste.
//
// **Le voisinage est tenu dans les deux sens.** Si A a B pour voisin, B a A :
// un appel elargi par voisinage (M1-C) ne doit pas dependre du sens dans
// lequel l'administrateur a saisi le lien.
import type {
  ConfigurationGeoView,
  CreerLieuGeoDto,
  JeuDeDepartGeoView,
  LieuGeoView,
  LieuHorsReferentielView,
  ModifierLieuGeoDto,
  ParametresPaysView,
} from '@baobaoheath/shared-types';
import { prisma } from '../config/prisma';
import { jeuPour, type NoeudJeu } from '../data/geographie/jeux-de-depart';
import { ConflictError, NotFoundError, ValidationError } from '../utils/app-error';
import { getValeursParametres } from './parametres.service';

/** Au-dela, ce n'est plus un voisinage mais une ville entiere. */
export const MAX_VOISINS = 12;

const cle = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('fr');

type Lieu = { id: string; niveau: string; nom: string; idParent: string | null; voisins: string[]; aValider: boolean };
const LIEU_SELECT = { id: true, niveau: true, nom: true, idParent: true, voisins: true, aValider: true } as const;

async function pays(): Promise<ParametresPaysView> {
  return (await getValeursParametres()).pays;
}

/** Tous les lieux, indexes : le referentiel d'un pays tient en memoire. */
async function arbre() {
  const lieux: Lieu[] = await prisma.lieuGeo.findMany({ select: LIEU_SELECT, orderBy: { nom: 'asc' } });
  return { lieux, parId: new Map(lieux.map((l) => [l.id, l])) };
}

function versVue(l: Lieu, parId: Map<string, Lieu>): LieuGeoView {
  return {
    id: l.id,
    niveau: l.niveau,
    nom: l.nom,
    idParent: l.idParent,
    parent: l.idParent ? parId.get(l.idParent)?.nom ?? null : null,
    voisins: l.voisins.map((id) => parId.get(id)).filter((v): v is Lieu => !!v).map((v) => ({ id: v.id, nom: v.nom })),
    aValider: l.aValider,
  };
}

/** L'ancetre d'un lieu au niveau demande (le lieu lui-meme s'il y est). */
function ancetre(l: Lieu, niveau: string, parId: Map<string, Lieu>): Lieu | null {
  let courant: Lieu | undefined = l;
  while (courant) {
    if (courant.niveau === niveau) return courant;
    courant = courant.idParent ? parId.get(courant.idParent) : undefined;
  }
  return null;
}

/**
 * M1-C : les voisins d'un lieu de base saisi en texte (`commune`), dans sa
 * zone d'elargissement (`prefecture`). Les noms sont ceux du referentiel ;
 * un lieu absent du referentiel n'a pas de voisins connus.
 *
 * Les voisins **restent dans la zone d'elargissement** : l'etape suivante
 * l'ouvre de toute facon, et un appel ne doit pas passer d'une prefecture a
 * l'autre avant d'avoir epuise la sienne.
 */
export async function voisinsDe(zone: string | null | undefined, lieu: string | null | undefined): Promise<string[]> {
  if (!cle(zone) || !cle(lieu)) return [];
  const p = await pays();
  const { lieux, parId } = await arbre();
  const dansZone = (l: Lieu) => cle(ancetre(l, p.niveauElargissement, parId)?.nom) === cle(zone);
  const trouve = lieux.find((l) => l.niveau === p.niveauBase && cle(l.nom) === cle(lieu) && dansZone(l));
  if (!trouve) return [];
  return trouve.voisins
    .map((id) => parId.get(id))
    .filter((v): v is Lieu => !!v && dansZone(v))
    .map((v) => v.nom);
}

/**
 * R8 : la zone d'elargissement (la prefecture en Guinee) qu'un patient
 * declare en demenageant, sous le nom exact du referentiel. Tant que le
 * referentiel n'a aucun lieu a ce niveau, le texte saisi est garde tel quel ;
 * ensuite, une zone inconnue rend `null` : elle n'enverrait l'ordonnance a
 * aucune pharmacie.
 */
export async function zoneElargissementConnue(texte: string): Promise<string | null> {
  const saisi = texte.trim();
  if (!saisi) return null;
  const p = await pays();
  const zones = await prisma.lieuGeo.findMany({ where: { niveau: p.niveauElargissement }, select: { nom: true } });
  if (zones.length === 0) return saisi;
  return zones.find((z) => cle(z.nom) === cle(saisi))?.nom ?? null;
}

export async function configuration(): Promise<ConfigurationGeoView> {
  const p = await pays();
  return { ...p, jeuDeDepartDisponible: jeuPour(p) !== null };
}

/**
 * Les lieux d'un niveau. `parent` restreint aux enfants d'un lieu ; `dans`
 * restreint aux descendants d'un lieu designe par son nom, a n'importe quel
 * niveau au-dessus (« les communes de la prefecture Conakry »).
 */
export async function listerLieux(filtre: { niveau?: string; parent?: string; dans?: string }): Promise<LieuGeoView[]> {
  const { lieux, parId } = await arbre();
  const dans = cle(filtre.dans);
  const descendDe = (l: Lieu) => {
    let courant = l.idParent ? parId.get(l.idParent) : undefined;
    while (courant) {
      if (cle(courant.nom) === dans) return true;
      courant = courant.idParent ? parId.get(courant.idParent) : undefined;
    }
    return false;
  };
  return lieux
    .filter((l) => !filtre.niveau || l.niveau === filtre.niveau)
    .filter((l) => !filtre.parent || l.idParent === filtre.parent)
    .filter((l) => !dans || descendDe(l))
    .map((l) => versVue(l, parId));
}

/**
 * Ajoute par un administrateur : confirme d'emblee. Un lieu se range sous un
 * lieu du niveau **immediatement** au-dessus ; le niveau le plus large n'a
 * pas de parent.
 */
export async function creerLieu(dto: CreerLieuGeoDto): Promise<LieuGeoView> {
  const p = await pays();
  const rang = p.niveaux.findIndex((n) => n.code === dto.niveau);
  if (rang < 0) throw new ValidationError(`Niveau « ${dto.niveau} » absent du decoupage du pays`);

  let parent: Lieu | null = null;
  if (rang === 0) {
    if (dto.idParent) throw new ValidationError(`Le niveau « ${dto.niveau} » est le plus large : il n'a pas de parent`);
  } else {
    if (!dto.idParent) throw new ValidationError(`Un lieu de niveau « ${dto.niveau} » doit etre range sous un lieu parent`);
    parent = await prisma.lieuGeo.findUnique({ where: { id: dto.idParent }, select: LIEU_SELECT });
    if (!parent) throw new NotFoundError('Lieu parent non trouve');
    const attendu = p.niveaux[rang - 1]!.code;
    if (parent.niveau !== attendu) {
      throw new ValidationError(`Le parent d'un lieu « ${dto.niveau} » doit etre de niveau « ${attendu} »`);
    }
  }

  const nom = dto.nom.trim();
  const freres = await prisma.lieuGeo.findMany({
    where: { niveau: dto.niveau, idParent: parent?.id ?? null, nom: { equals: nom, mode: 'insensitive' } },
    select: { id: true },
  });
  if (freres.length > 0) {
    throw new ConflictError(`« ${nom} » existe deja${parent ? ` dans ${parent.nom}` : ''}`);
  }

  const cree = await prisma.lieuGeo.create({
    data: { niveau: dto.niveau, nom, idParent: parent?.id ?? null, aValider: false },
    select: LIEU_SELECT,
  });
  return versVue(cree, new Map(parent ? [[parent.id, parent]] : []));
}

export async function modifierLieu(id: string, dto: ModifierLieuGeoDto): Promise<LieuGeoView> {
  const { parId } = await arbre();
  const lieu = parId.get(id);
  if (!lieu) throw new NotFoundError('Lieu non trouve');

  if (dto.voisins === undefined) {
    const maj = await prisma.lieuGeo.update({
      where: { id },
      data: { ...(dto.aValider !== undefined && { aValider: dto.aValider }) },
      select: LIEU_SELECT,
    });
    return versVue(maj, parId);
  }

  const demandes = [...new Set(dto.voisins)].filter((v) => v !== id);
  const invalides = demandes.filter((v) => parId.get(v)?.niveau !== lieu.niveau);
  if (invalides.length > 0) {
    throw new ValidationError(`Voisin(s) inconnu(s) ou d'un autre niveau que « ${lieu.niveau} » : ${invalides.join(', ')}`);
  }
  if (demandes.length > MAX_VOISINS) throw new ValidationError(`${MAX_VOISINS} voisins au plus`);

  const nouveaux = new Set(demandes);
  const memeNiveau = [...parId.values()].filter((l) => l.niveau === lieu.niveau && l.id !== id);

  const maj = await prisma.$transaction(async (tx) => {
    // L'autre sens du lien : ajoute chez les nouveaux voisins, retire chez
    // ceux qui ne le sont plus.
    for (const autre of memeNiveau) {
      const aLeLien = autre.voisins.includes(id);
      const doitLAvoir = nouveaux.has(autre.id);
      if (doitLAvoir && !aLeLien) {
        await tx.lieuGeo.update({ where: { id: autre.id }, data: { voisins: [...autre.voisins, id] } });
      } else if (!doitLAvoir && aLeLien) {
        await tx.lieuGeo.update({ where: { id: autre.id }, data: { voisins: autre.voisins.filter((v) => v !== id) } });
      }
    }
    return tx.lieuGeo.update({
      where: { id },
      data: { voisins: demandes, ...(dto.aValider !== undefined && { aValider: dto.aValider }) },
      select: LIEU_SELECT,
    });
  });
  return versVue(maj, parId);
}

/**
 * Charge le jeu de depart du pays installe, s'il en existe un qui correspond
 * exactement a son decoupage. Sans effet sur ce qui existe deja : relancer ne
 * cree pas de doublon.
 */
export async function chargerJeuDeDepart(): Promise<JeuDeDepartGeoView> {
  const p = await pays();
  const jeu = jeuPour(p);
  if (!jeu) {
    throw new ValidationError(`Aucun jeu de depart pour ${p.nom} avec ce decoupage : saisissez les lieux depuis l'administration`);
  }

  const { lieux } = await arbre();
  const existant = new Map(lieux.map((l) => [`${l.niveau}|${l.idParent ?? ''}|${cle(l.nom)}`, l.id]));
  let crees = 0;
  let dejaPresents = 0;

  const charger = async (noeuds: NoeudJeu[], rang: number, idParent: string | null): Promise<void> => {
    const niveau = jeu.niveaux[rang]!;
    for (const n of noeuds) {
      const k = `${niveau}|${idParent ?? ''}|${cle(n.nom)}`;
      let id = existant.get(k);
      if (id) {
        dejaPresents++;
      } else {
        id = (await prisma.lieuGeo.create({ data: { niveau, nom: n.nom, idParent }, select: { id: true } })).id;
        existant.set(k, id);
        crees++;
      }
      if (n.enfants?.length) await charger(n.enfants, rang + 1, id);
    }
  };
  await charger(jeu.lieux, 0, null);
  return { crees, dejaPresents };
}

type Saisie = { prefecture: string | null; commune: string | null; _count: { _all: number } };

/**
 * Les lieux du niveau de base saisis et absents du referentiel, les plus
 * frequents d'abord : ce sont ceux qu'il est le plus utile d'ajouter. La
 * comparaison ignore la casse et les espaces, comme les zones (utils/zone.ts).
 */
export async function horsReferentiel(): Promise<LieuHorsReferentielView[]> {
  const p = await pays();
  const ouLieu = { commune: { not: null } };
  const [patients, structures, livreurs, { lieux, parId }] = await Promise.all([
    prisma.patientProfile.groupBy({ by: ['prefecture', 'commune'], where: ouLieu, _count: { _all: true } }),
    prisma.structureSante.groupBy({ by: ['prefecture', 'commune'], where: ouLieu, _count: { _all: true } }),
    prisma.livreurProfile.groupBy({ by: ['prefecture', 'commune'], where: ouLieu, _count: { _all: true } }),
    arbre(),
  ]);

  // Chaque lieu de base, avec la zone d'elargissement qui le contient.
  const connus = new Set(
    lieux.filter((l) => l.niveau === p.niveauBase)
      .map((l) => `${cle(ancetre(l, p.niveauElargissement, parId)?.nom)}|${cle(l.nom)}`),
  );
  const hors = new Map<string, LieuHorsReferentielView>();

  const compter = (lignes: Saisie[], source: 'patients' | 'structures' | 'livreurs') => {
    for (const l of lignes) {
      if (!cle(l.commune)) continue;
      const k = `${cle(l.prefecture)}|${cle(l.commune)}`;
      if (connus.has(k)) continue;
      const entree = hors.get(k) ?? {
        zone: (l.prefecture ?? '').trim(), lieu: (l.commune ?? '').trim(),
        patients: 0, structures: 0, livreurs: 0, total: 0,
      };
      entree[source] += l._count._all;
      entree.total += l._count._all;
      hors.set(k, entree);
    }
  };
  compter(patients as Saisie[], 'patients');
  compter(structures as Saisie[], 'structures');
  compter(livreurs as Saisie[], 'livreurs');

  return [...hors.values()].sort((a, b) => b.total - a.total || a.lieu.localeCompare(b.lieu, 'fr'));
}
