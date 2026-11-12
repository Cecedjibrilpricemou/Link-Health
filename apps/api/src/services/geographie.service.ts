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
  RenommageLieuGeoView,
  UtilisationLieuGeoView,
} from '@baobaoheath/shared-types';
import { StatutCommande, StatutCourse } from '../config/generated/client/client';
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

// ── R7 : renommer et supprimer un lieu ─────────────────────────────────
//
// Le nom d'une commune ou d'une prefecture n'est pas une reference : il est
// recopie en texte dans les adresses (pharmacies, patients, motards) et dans
// les appels en cours, et c'est ce texte que comparent les recherches. Un
// renommage qui ne toucherait que le referentiel laisserait ces adresses sous
// l'ancien nom, hors referentiel et sans voisinage.
//
// - Renommer **propage** le nouveau nom aux adresses actuelles et aux appels
//   en cours, dans la meme transaction, et le journalise. Les commandes et
//   courses terminees gardent le nom de leur epoque : c'est leur histoire.
// - Supprimer n'est permis qu'a un lieu **inutilise** : sans enfant, et dont
//   aucune adresse ni aucun appel en cours ne porte le nom.

// Le client est etendu (chiffrement) : `Prisma.TransactionClient` ne lui
// correspond pas. On prend le type que `$transaction` passe vraiment.
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Client = Pick<Tx, 'structureSante' | 'patientProfile' | 'livreurProfile' | 'commande' | 'course'>;

/** Ou le nom d'un lieu est recopie, selon son niveau. Les autres niveaux ne le sont nulle part. */
type Portee = { champ: 'commune'; zone: string } | { champ: 'prefecture' };

function porteeDe(l: Lieu, p: ParametresPaysView, parId: Map<string, Lieu>): Portee | null {
  if (l.niveau === p.niveauBase) {
    const zone = ancetre(l, p.niveauElargissement, parId)?.nom;
    return zone ? { champ: 'commune', zone } : null;
  }
  if (l.niveau === p.niveauElargissement) return { champ: 'prefecture' };
  return null;
}

/** Meme comparaison que les zones : sans casse ni espaces autour. */
const egal = (s: string) => ({ equals: s.trim(), mode: 'insensitive' as const });

/** Les adresses de structures et de patients qui portent ce nom. */
function filtreAdresses(portee: Portee, nom: string) {
  return portee.champ === 'commune'
    ? { prefecture: egal(portee.zone), commune: egal(nom) }
    : { prefecture: egal(nom) };
}

/** Les motards concernes : par leur adresse, ou (niveau de base) par une commune desservie. */
async function motardsConcernes(client: Client, portee: Portee, nom: string) {
  const livreurs = await client.livreurProfile.findMany({
    where: { prefecture: egal(portee.champ === 'commune' ? portee.zone : nom) },
    select: { id: true, commune: true, communesDesservies: true },
  });
  if (portee.champ === 'prefecture') return livreurs;
  return livreurs.filter((l) => cle(l.commune) === cle(nom) || l.communesDesservies.some((c) => cle(c) === cle(nom)));
}

/**
 * Les appels encore ouverts qui portent ce nom. Les voisines y sont gardees
 * en cle (minuscules), comme les compare la recherche.
 */
async function appelsConcernes(client: Client, portee: Portee, nom: string) {
  const zone = egal(portee.champ === 'commune' ? portee.zone : nom);
  const commandes = await client.commande.findMany({
    where: { statut: StatutCommande.RECHERCHE_PHARMACIE, prefectureRecherche: zone },
    select: { id: true, communeRecherche: true, communesVoisines: true },
  });
  const courses = await client.course.findMany({
    where: { statut: StatutCourse.APPEL_OFFRES, prefecture: zone },
    select: { id: true, commune: true, communesVoisines: true },
  });
  if (portee.champ === 'prefecture') return { commandes, courses };
  const porte = (commune: string | null, voisines: string[]) => cle(commune) === cle(nom) || voisines.includes(cle(nom));
  return {
    commandes: commandes.filter((c) => porte(c.communeRecherche, c.communesVoisines)),
    courses: courses.filter((c) => porte(c.commune, c.communesVoisines)),
  };
}

async function compterUtilisation(client: Client, lieu: Lieu, lieux: Lieu[], portee: Portee | null): Promise<UtilisationLieuGeoView> {
  const enfants = lieux.filter((l) => l.idParent === lieu.id).length;
  if (!portee) return { enfants, structures: 0, patients: 0, motards: 0, appelsEnCours: 0 };
  const where = filtreAdresses(portee, lieu.nom);
  const structures = await client.structureSante.count({ where });
  const patients = await client.patientProfile.count({ where });
  const motards = (await motardsConcernes(client, portee, lieu.nom)).length;
  const appels = await appelsConcernes(client, portee, lieu.nom);
  return { enfants, structures, patients, motards, appelsEnCours: appels.commandes.length + appels.courses.length };
}

/** Ce qui porte le nom d'un lieu : l'ecran le montre avant de renommer ou de supprimer. */
export async function utilisationLieu(id: string): Promise<UtilisationLieuGeoView> {
  const p = await pays();
  const { lieux, parId } = await arbre();
  const lieu = parId.get(id);
  if (!lieu) throw new NotFoundError('Lieu non trouve');
  return compterUtilisation(prisma, lieu, lieux, porteeDe(lieu, p, parId));
}

/**
 * Renomme un lieu et propage le nouveau nom (R7).
 *
 * Refuse ce qui melangerait deux lieux : un frere du meme nom ; et, pour un
 * nom recopie dans les adresses, un autre lieu de la meme zone qui porte deja
 * le nouveau nom (ses adresses et celles-ci deviendraient indiscernables) ou
 * l'ancien (on ne saurait pas a qui sont les adresses).
 */
export async function renommerLieu(
  idAuteur: string,
  id: string,
  nomDemande: string,
  maintenant = new Date(),
): Promise<RenommageLieuGeoView> {
  const nom = nomDemande.trim();
  if (!nom) throw new ValidationError('Le nouveau nom est vide');
  const p = await pays();
  const { lieux, parId } = await arbre();
  const lieu = parId.get(id);
  if (!lieu) throw new NotFoundError('Lieu non trouve');
  if (nom === lieu.nom) throw new ValidationError('Le nom est inchange');

  const autres = lieux.filter((l) => l.id !== id && l.niveau === lieu.niveau);
  const parent = lieu.idParent ? parId.get(lieu.idParent)?.nom : null;
  if (autres.some((l) => l.idParent === lieu.idParent && cle(l.nom) === cle(nom))) {
    throw new ConflictError(`« ${nom} » existe deja${parent ? ` dans ${parent}` : ''}`);
  }

  const portee = porteeDe(lieu, p, parId);
  if (portee) {
    const dansZone = (l: Lieu) =>
      portee.champ === 'prefecture' || cle(ancetre(l, p.niveauElargissement, parId)?.nom) === cle(portee.zone);
    const zone = portee.champ === 'commune' ? ` dans ${portee.zone}` : '';
    if (autres.some((l) => dansZone(l) && cle(l.nom) === cle(nom))) {
      throw new ConflictError(`Un autre lieu s'appelle deja « ${nom} »${zone} : leurs adresses ne se distingueraient plus`);
    }
    if (autres.some((l) => dansZone(l) && cle(l.nom) === cle(lieu.nom))) {
      throw new ConflictError(
        `Un autre lieu s'appelle aussi « ${lieu.nom} »${zone} : les adresses ne disent pas lequel est concerne. `
        + "Renommez d'abord l'autre, ou corrigez ces adresses une a une",
      );
    }
  }

  const ancien = lieu.nom;
  const resultat = await prisma.$transaction(async (tx) => {
    const maj = await tx.lieuGeo.update({ where: { id }, data: { nom }, select: LIEU_SELECT });
    const renommes = portee
      ? await propagerNom(tx, portee, ancien, nom)
      : { structures: 0, patients: 0, motards: 0, appelsEnCours: 0 };
    await tx.journalAudit.create({
      data: {
        action: 'RENOMMAGE_LIEU',
        ressource: 'geo_lieux',
        idRessource: id,
        idUtilisateur: idAuteur,
        creeLe: maintenant,
        metadonnees: { niveau: lieu.niveau, avant: ancien, apres: nom, renommes },
      },
    });
    return { maj, renommes };
  });
  return { lieu: versVue(resultat.maj, parId), renommes: resultat.renommes };
}

async function propagerNom(
  tx: Tx,
  portee: Portee,
  ancien: string,
  nom: string,
): Promise<RenommageLieuGeoView['renommes']> {
  const where = filtreAdresses(portee, ancien);
  const appels = await appelsConcernes(tx, portee, ancien);
  const motards = await motardsConcernes(tx, portee, ancien);

  if (portee.champ === 'prefecture') {
    const structures = await tx.structureSante.updateMany({ where, data: { prefecture: nom } });
    const patients = await tx.patientProfile.updateMany({ where, data: { prefecture: nom } });
    const livreurs = await tx.livreurProfile.updateMany({ where, data: { prefecture: nom } });
    for (const c of appels.commandes) await tx.commande.update({ where: { id: c.id }, data: { prefectureRecherche: nom } });
    for (const c of appels.courses) await tx.course.update({ where: { id: c.id }, data: { prefecture: nom } });
    return {
      structures: structures.count, patients: patients.count, motards: livreurs.count,
      appelsEnCours: appels.commandes.length + appels.courses.length,
    };
  }

  const remplacer = (v: string | null) => (cle(v) === cle(ancien) ? nom : v);
  const remplacerCles = (cles: string[]) => cles.map((c) => (c === cle(ancien) ? cle(nom) : c));
  const structures = await tx.structureSante.updateMany({ where, data: { commune: nom } });
  const patients = await tx.patientProfile.updateMany({ where, data: { commune: nom } });
  for (const l of motards) {
    await tx.livreurProfile.update({
      where: { id: l.id },
      data: {
        commune: remplacer(l.commune),
        communesDesservies: l.communesDesservies.map((c) => (cle(c) === cle(ancien) ? nom : c)),
      },
    });
  }
  for (const c of appels.commandes) {
    await tx.commande.update({
      where: { id: c.id },
      data: { communeRecherche: remplacer(c.communeRecherche), communesVoisines: remplacerCles(c.communesVoisines) },
    });
  }
  for (const c of appels.courses) {
    await tx.course.update({
      where: { id: c.id },
      data: { commune: remplacer(c.commune), communesVoisines: remplacerCles(c.communesVoisines) },
    });
  }
  return {
    structures: structures.count, patients: patients.count, motards: motards.length,
    appelsEnCours: appels.commandes.length + appels.courses.length,
  };
}

/**
 * Supprime un lieu inutilise (R7). Ses liens de voisinage sont retires des
 * deux cotes. Un lieu encore porte par des adresses se renomme, il ne se
 * supprime pas : ces adresses perdraient leur lieu sans que personne le sache.
 */
export async function supprimerLieu(idAuteur: string, id: string, maintenant = new Date()): Promise<void> {
  const p = await pays();
  const { lieux, parId } = await arbre();
  const lieu = parId.get(id);
  if (!lieu) throw new NotFoundError('Lieu non trouve');
  const portee = porteeDe(lieu, p, parId);

  await prisma.$transaction(async (tx) => {
    const u = await compterUtilisation(tx, lieu, lieux, portee);
    if (u.enfants > 0) {
      throw new ConflictError(`« ${lieu.nom} » contient ${u.enfants} lieu(x) : supprimez-les d'abord`);
    }
    if (u.structures + u.patients + u.motards + u.appelsEnCours > 0) {
      throw new ConflictError(
        `« ${lieu.nom} » est encore utilise : ${u.structures} structure(s), ${u.patients} patient(s), `
        + `${u.motards} motard(s), ${u.appelsEnCours} appel(s) en cours. Renommez-le plutot.`,
      );
    }
    for (const autre of lieux.filter((l) => l.voisins.includes(id))) {
      await tx.lieuGeo.update({ where: { id: autre.id }, data: { voisins: autre.voisins.filter((v) => v !== id) } });
    }
    await tx.lieuGeo.delete({ where: { id } });
    await tx.journalAudit.create({
      data: {
        action: 'SUPPRESSION_LIEU',
        ressource: 'geo_lieux',
        idRessource: id,
        idUtilisateur: idAuteur,
        creeLe: maintenant,
        metadonnees: { niveau: lieu.niveau, nom: lieu.nom, parent: lieu.idParent ? parId.get(lieu.idParent)?.nom ?? null : null },
      },
    });
  });
}
