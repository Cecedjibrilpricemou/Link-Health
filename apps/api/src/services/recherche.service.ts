// src/services/recherche.service.ts
// A1 et A2 : la recherche publique de produits, et les pharmacies qui les ont.
//
// Trois regles la gouvernent, et chacune repond a une decision prise le
// 12 novembre :
//
//   - **On ne montre que ce qu'on sait.** Un produit n'apparait que s'il est
//     en stock, declare par une pharmacie. Une officine qui ne tient pas son
//     stock sur la plateforme n'est pas listee ici : annoncer un produit sans
//     savoir s'il y est ferait deplacer quelqu'un pour rien.
//   - **Les produits reglementes n'apparaissent jamais.** Dire publiquement
//     quelle officine detient des stupefiants, c'est designer une cible.
//   - **Jamais la quantite exacte**, seulement « disponible » ou « stock
//     faible », avec la date a laquelle l'officine l'a declaree.
//
// **La zone n'est pas un prealable.** On tape un produit, on cherche. Exiger
// de choisir sa prefecture avant de pouvoir ecrire arretait net quelqu'un qui
// voulait juste savoir ou trouver du paracetamol. Quand la zone est connue,
// elle resserre et classe ; quand elle ne l'est pas, on cherche dans tout le
// pays et chaque pharmacie dit ou elle se trouve.
//
// La recherche n'est pas journalisee : `shouldAudit` ne retient les GET que
// pour quelques chemins, et celui-ci n'en fait pas partie. C'est voulu. Ce
// qu'une personne cherche en pharmacie dit souvent ce dont elle souffre, et
// une ligne de journal reliant un compte a « test de grossesse » serait une
// donnee de sante creee par nous. Le test « la recherche ne laisse aucune
// trace nominative » verrouille ce choix.
import { prisma } from '../config/prisma';
import { NotFoundError, ValidationError } from '../utils/app-error';
import { empreinteCatalogue, etatDuStock, prixDeVenteGnf } from '../utils/catalogue';
import type { EtatStock } from '../utils/catalogue';
import { etatOuverture, horairesDepuisLaBase } from '../utils/horaires';
import type { EtatOuverture, Horaires } from '../utils/horaires';
import { filtrePrefecture, filtreZones } from '../utils/zone';
import type { Lieu } from '../utils/zone';
import { voisinsDe } from './geographie.service';

/** Jusqu'ou l'appel a du s'etendre pour trouver quelque chose. */
export type ZoneRecherche = 'COMMUNE' | 'VOISINES' | 'PREFECTURE' | 'PAYS';

export interface CritereRecherche {
  q: string;
  /** Facultative : sans elle, on cherche dans tout le pays. */
  prefecture?: string | null;
  commune?: string | null;
}

/** Une officine qui declare avoir le produit, et a quel prix chez elle. */
export interface PharmacieProduit {
  id: string;
  nom: string;
  prefecture: string;
  commune: string | null;
  quartier: string | null;
  telephone: string | null;
  prixGnf: number;
  etatStock: EtatStock;
  declareLe: Date;
  /** Pour poser un marqueur sur la carte ; nul quand l'officine n'est pas situee. */
  latitude: number | null;
  longitude: number | null;
  /** Ouvert maintenant ? Le visiteur va se deplacer. */
  ouverture: EtatOuverture;
}

export interface ProduitTrouve {
  id: string;
  libelle: string;
  molecule: string | null;
  nomCommercial: string | null;
  forme: string | null;
  dosage: string | null;
  categorie: string;
  /// Un medicament se delivre parfois sur ordonnance. Tant que le catalogue
  /// ne porte pas cette information produit par produit, l'ecran invite a
  /// demander conseil plutot que de laisser croire a une vente libre.
  estMedicament: boolean;
  nombrePharmacies: number;
  prixMinGnf: number;
  prixMaxGnf: number;
  etatStock: EtatStock;
  declareLe: Date;
  pharmacies: PharmacieProduit[];
}

/** Une officine trouvee par son nom. */
export interface PharmacieTrouvee {
  id: string;
  nom: string;
  prefecture: string;
  commune: string | null;
  quartier: string | null;
  telephone: string | null;
  /** Ce qu'elle a en rayon aujourd'hui, pour savoir si la visite vaut le coup. */
  nombreProduits: number;
  /** Pour poser un marqueur sur la carte ; nul quand l'officine n'est pas situee. */
  latitude: number | null;
  longitude: number | null;
  ouverture: EtatOuverture;
}

/** Un produit tel qu'il se presente dans le rayon d'une officine. */
export interface ProduitEnRayon {
  id: string;
  libelle: string;
  molecule: string | null;
  forme: string | null;
  dosage: string | null;
  categorie: string;
  estMedicament: boolean;
  prixGnf: number;
  etatStock: EtatStock;
  declareLe: Date;
}

export interface PharmacieDetail {
  id: string;
  nom: string;
  prefecture: string;
  commune: string | null;
  quartier: string | null;
  adresse: string | null;
  telephone: string | null;
  /** Tout ce qu'elle a en rayon, meme si la liste rendue est filtree. */
  nombreProduits: number;
  produits: ProduitEnRayon[];
  /** Les sept jours, pour que le visiteur sache quand revenir. */
  horaires: Horaires | null;
  /** Pour poser un marqueur sur la carte ; nul quand l'officine n'est pas situee. */
  latitude: number | null;
  longitude: number | null;
  ouverture: EtatOuverture;
}

export interface ResultatRecherche {
  zoneUtilisee: ZoneRecherche;
  prefecture: string | null;
  commune: string | null;
  communesVoisines: string[];
  produits: ProduitTrouve[];
  /** Les officines dont le nom ressemble a ce qui a ete tape. */
  pharmaciesTrouvees: PharmacieTrouvee[];
}

/** Au-dela, ce n'est plus une recherche mais un balayage du catalogue. */
const PRODUITS_MAX = 20;
/** Assez pour choisir, pas au point de noyer : on garde les mieux classees. */
const PHARMACIES_MAX = 10;
/** Une recherche de nom ne doit pas rendre l'annuaire entier. */
const OFFICINES_MAX = 8;
/** Le rayon d'une officine se parcourt, il ne se deverse pas. */
const RAYON_MAX = 100;
/** Un mot d'une lettre ramenerait la moitie du catalogue. */
const LONGUEUR_MOT_MIN = 2;
const MOTS_MAX = 4;

/**
 * Les mots sur lesquels chercher, normalises comme l'est `rechercheTexte`.
 *
 * Tous doivent se retrouver dans le produit : « doliprane 500 » ne ramene pas
 * tous les Doliprane. Les mots trop courts sont ecartes plutot que refuses,
 * sinon « vitamine b 12 » ne chercherait rien.
 */
export function motsDeLaRecherche(q: string): string[] {
  return empreinteCatalogue({ libelle: q })
    .split(' ')
    .filter((m) => m.length >= LONGUEUR_MOT_MIN)
    .slice(0, MOTS_MAX);
}

/** Le filtre d'un stock servable au public, dans la zone donnee. */
function stockEnZone(zone: Record<string, unknown>) {
  return {
    quantite: { gt: 0 },
    structure: {
      is: {
        type: 'PHARMACIE' as const,
        estActive: true,
        ...zone,
      },
    },
  };
}

/**
 * Un mot peut etre cherche dans le texte normalise **ou** dans les champs
 * bruts. Le repli sur les champs bruts sert les produits enregistres avant la
 * colonne : ils restent trouvables quand on les ecrit avec leurs accents.
 */
function filtreMot(mot: string) {
  return {
    OR: [
      { rechercheTexte: { contains: mot } },
      { libelle: { contains: mot, mode: 'insensitive' as const } },
      { nomCommercial: { contains: mot, mode: 'insensitive' as const } },
      { dci: { contains: mot, mode: 'insensitive' as const } },
    ],
  };
}

type Etape = { zone: ZoneRecherche; filtre: Record<string, unknown>; voisines: string[] };

/**
 * Les etapes d'elargissement, dans l'ordre ou on les essaie.
 *
 * La derniere est toujours le pays entier : mieux vaut dire « c'est loin »
 * que « il n'y en a nulle part », qui serait faux.
 */
async function etapes(critere: CritereRecherche): Promise<Etape[]> {
  const prefecture = (critere.prefecture ?? '').trim();
  const commune = (critere.commune ?? '').trim();
  const partout: Etape = { zone: 'PAYS', filtre: {}, voisines: [] };

  if (!prefecture) return [partout];

  const parPrefecture: Etape = {
    zone: 'PREFECTURE',
    filtre: filtrePrefecture(prefecture),
    voisines: [],
  };
  if (!commune) return [parPrefecture, partout];

  const ici: Lieu = { prefecture, commune };
  const voisines = await voisinsDe(prefecture, commune);
  const avecVoisines = voisines.map((c): Lieu => ({ prefecture, commune: c }));

  return [
    { zone: 'COMMUNE', filtre: filtreZones([ici]), voisines: [] },
    ...(voisines.length > 0
      ? [{ zone: 'VOISINES' as const, filtre: filtreZones([ici, ...avecVoisines]), voisines }]
      : []),
    parPrefecture,
    partout,
  ];
}

type LigneStock = {
  quantite: number;
  seuilAlerte: number;
  margeGnf: number;
  modifieLe: Date;
  structure: {
    id: string;
    nom: string;
    prefecture: string;
    commune: string | null;
    quartier: string | null;
    telephone: string | null;
    latitude: number | null;
    longitude: number | null;
    horaires: unknown;
  } | null;
};

/** La zone du visiteur, telle qu'elle sert a classer. */
interface Contexte {
  prefecture: string;
  commune: string;
  voisines: string[];
}

const cle = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/**
 * A quelle distance administrative une officine se trouve du visiteur.
 *
 * Sans zone connue, tout le monde est a egalite et c'est le prix qui classe :
 * on ne fait pas traverser Conakry a quelqu'un dont on ignore ou il habite.
 */
export function rangProximite(
  officine: { prefecture: string; commune: string | null },
  contexte: Contexte,
): number {
  if (contexte.commune && cle(officine.commune) === cle(contexte.commune)) return 0;
  if (contexte.voisines.some((v) => cle(v) === cle(officine.commune))) return 1;
  if (contexte.prefecture && cle(officine.prefecture) === cle(contexte.prefecture)) return 2;
  return 3;
}

/**
 * L'ordre dans lequel les officines sont proposees : la plus proche d'abord,
 * et a distance egale la moins chere. Traverser la ville pour 500 GNF n'a de
 * sens pour personne.
 */
export function comparerPharmacies(
  a: PharmacieProduit,
  b: PharmacieProduit,
  contexte: Contexte,
): number {
  const parDistance = rangProximite(a, contexte) - rangProximite(b, contexte);
  if (parDistance !== 0) return parDistance;
  if (a.prixGnf !== b.prixGnf) return a.prixGnf - b.prixGnf;
  return a.nom.localeCompare(b.nom);
}

/** Ce que le public apprend d'un produit, a partir des stocks de la zone. */
function resumer(
  produit: {
    id: string;
    libelle: string;
    dci: string | null;
    nomCommercial: string | null;
    forme: string | null;
    dosage: string | null;
    categorie: string;
    prixUnitaireGnf: number;
    stocks: LigneStock[];
  },
  contexte: Contexte,
): ProduitTrouve | null {
  const lignes = produit.stocks.filter((s) => s.structure !== null);
  if (lignes.length === 0) return null;

  const pharmacies: PharmacieProduit[] = lignes.map((s) => {
    const structure = s.structure!;
    return {
      id: structure.id,
      nom: structure.nom,
      prefecture: structure.prefecture,
      commune: structure.commune,
      quartier: structure.quartier,
      telephone: structure.telephone,
      latitude: structure.latitude,
      longitude: structure.longitude,
      prixGnf: prixDeVenteGnf(produit.prixUnitaireGnf, s.margeGnf),
      etatStock: etatDuStock(s.quantite, s.seuilAlerte),
      declareLe: s.modifieLe,
      ouverture: etatOuverture(horairesDepuisLaBase(structure.horaires)),
    };
  });
  pharmacies.sort((a, b) => comparerPharmacies(a, b, contexte));

  const prix = pharmacies.map((p) => p.prixGnf);
  const officines = new Set(pharmacies.map((p) => p.id));
  // Le meilleur etat de la zone : si une seule officine est bien fournie, le
  // visiteur n'a pas a se decourager parce qu'une autre est presque a sec.
  const disponible = pharmacies.some((p) => p.etatStock === 'DISPONIBLE');
  const declareLe = pharmacies.map((p) => p.declareLe).reduce((a, b) => (a > b ? a : b));

  return {
    id: produit.id,
    libelle: produit.libelle,
    molecule: produit.dci,
    nomCommercial: produit.nomCommercial,
    forme: produit.forme,
    dosage: produit.dosage,
    categorie: produit.categorie,
    estMedicament: produit.categorie === 'MEDICAMENT',
    nombrePharmacies: officines.size,
    prixMinGnf: Math.min(...prix),
    prixMaxGnf: Math.max(...prix),
    etatStock: disponible ? 'DISPONIBLE' : 'FAIBLE',
    declareLe,
    pharmacies: pharmacies.slice(0, PHARMACIES_MAX),
  };
}

export async function chercherProduits(critere: CritereRecherche): Promise<ResultatRecherche> {
  const mots = motsDeLaRecherche(critere.q);
  if (mots.length === 0) {
    throw new ValidationError('Tapez au moins deux lettres du nom du produit ou de la molecule');
  }
  const prefecture = (critere.prefecture ?? '').trim();
  const commune = (critere.commune ?? '').trim();

  for (const etape of await etapes(critere)) {
    const filtreStock = stockEnZone(etape.filtre);
    const produits = await prisma.medicament.findMany({
      where: {
        estActif: true,
        // Jamais publiquement : voir l'en-tete de ce fichier.
        estReglemente: false,
        AND: mots.map(filtreMot),
        stocks: { some: filtreStock },
      },
      select: {
        id: true,
        libelle: true,
        dci: true,
        nomCommercial: true,
        forme: true,
        dosage: true,
        categorie: true,
        prixUnitaireGnf: true,
        stocks: {
          where: filtreStock,
          select: {
            quantite: true,
            seuilAlerte: true,
            margeGnf: true,
            modifieLe: true,
            structure: {
              select: {
                id: true,
                nom: true,
                prefecture: true,
                commune: true,
                quartier: true,
                telephone: true,
                latitude: true,
                longitude: true,
                horaires: true,
              },
            },
          },
        },
      },
      orderBy: { libelle: 'asc' },
      take: PRODUITS_MAX,
    });

    const contexte: Contexte = { prefecture, commune, voisines: etape.voisines };
    const vues = produits
      .map((p) => resumer(p, contexte))
      .filter((v): v is ProduitTrouve => v !== null);

    // On s'arrete a la premiere etape qui donne quelque chose. Elargir encore
    // n'ajouterait que des officines plus lointaines.
    if (vues.length > 0) {
      return {
        zoneUtilisee: etape.zone,
        prefecture: prefecture || null,
        commune: commune || null,
        communesVoisines: etape.voisines,
        produits: vues,
        pharmaciesTrouvees: await chercherPharmacies(critere.q),
      };
    }
  }

  // Aucun produit : l'officine cherchee par son nom reste une reponse utile.
  return {
    zoneUtilisee: 'PAYS',
    prefecture: prefecture || null,
    commune: commune || null,
    communesVoisines: [],
    produits: [],
    pharmaciesTrouvees: await chercherPharmacies(critere.q),
  };
}

// ── A3 : les officines elles-memes ──────────────────────────────────

/** Le filtre d'un produit servable au public : actif, et jamais reglemente. */
const PRODUIT_PUBLIC = { estActif: true, estReglemente: false };

/**
 * Les officines dont le nom contient les mots cherches.
 *
 * Quelqu'un qui tape « pharmacie du port » cherche un lieu, pas une molecule.
 * La meme barre sert aux deux : il n'y a rien a choisir avant de taper.
 *
 * La comparaison ignore la casse. Elle ne rapproche pas les accents, faute de
 * colonne normalisee sur les structures : « Hopital » se trouve, « Hôpital »
 * suppose d'ecrire l'accent. Les noms d'officines en portent rarement, et on
 * n'a pas voulu toucher a une table utilisee partout pour ce seul besoin.
 */
export async function chercherPharmacies(q: string): Promise<PharmacieTrouvee[]> {
  const mots = motsDeLaRecherche(q);
  if (mots.length === 0) return [];

  const officines = await prisma.structureSante.findMany({
    where: {
      type: 'PHARMACIE',
      estActive: true,
      AND: mots.map((mot) => ({ nom: { contains: mot, mode: 'insensitive' as const } })),
    },
    select: {
      id: true,
      nom: true,
      prefecture: true,
      commune: true,
      quartier: true,
      telephone: true,
      latitude: true,
      longitude: true,
      horaires: true,
    },
    orderBy: { nom: 'asc' },
    take: OFFICINES_MAX,
  });
  if (officines.length === 0) return [];

  // Combien chacune a en rayon : une seule requete, pas une par officine.
  const comptes = await prisma.stock.groupBy({
    by: ['idStructure'],
    where: {
      idStructure: { in: officines.map((o) => o.id) },
      quantite: { gt: 0 },
      medicament: PRODUIT_PUBLIC,
    },
    _count: { _all: true },
  });
  const parOfficine = new Map(comptes.map((c) => [c.idStructure, c._count._all]));

  return officines.map((o) => ({
    id: o.id,
    nom: o.nom,
    prefecture: o.prefecture,
    commune: o.commune,
    quartier: o.quartier,
    telephone: o.telephone,
    latitude: o.latitude,
    longitude: o.longitude,
    nombreProduits: parOfficine.get(o.id) ?? 0,
    ouverture: etatOuverture(horairesDepuisLaBase(o.horaires)),
  }));
}

/**
 * Une officine et ce qu'elle a en rayon.
 *
 * `q` filtre dans son rayon : on arrive souvent ici depuis la recherche d'un
 * produit, et retrouver ce produit dans une liste de deux cents lignes serait
 * une corvee.
 *
 * Une officine fermee ou qui n'est pas une pharmacie n'existe pas ici : son
 * adresse et son telephone ne sont pas des informations a servir au public
 * sous pretexte qu'on connait son identifiant.
 */
export async function catalogueDe(idPharmacie: string, q?: string | null): Promise<PharmacieDetail> {
  const officine = await prisma.structureSante.findFirst({
    where: { id: idPharmacie, type: 'PHARMACIE', estActive: true },
    select: {
      id: true,
      nom: true,
      prefecture: true,
      commune: true,
      quartier: true,
      adresse: true,
      telephone: true,
      latitude: true,
      longitude: true,
      horaires: true,
    },
  });
  if (!officine) throw new NotFoundError('Pharmacie introuvable');

  const mots = motsDeLaRecherche(q ?? '');
  const enRayon = { idStructure: officine.id, quantite: { gt: 0 } };

  const [nombreProduits, stocks] = await Promise.all([
    prisma.stock.count({ where: { ...enRayon, medicament: PRODUIT_PUBLIC } }),
    prisma.stock.findMany({
      where: {
        ...enRayon,
        medicament: { ...PRODUIT_PUBLIC, ...(mots.length > 0 ? { AND: mots.map(filtreMot) } : {}) },
      },
      select: {
        quantite: true,
        seuilAlerte: true,
        margeGnf: true,
        modifieLe: true,
        medicament: {
          select: {
            id: true,
            libelle: true,
            dci: true,
            forme: true,
            dosage: true,
            categorie: true,
            prixUnitaireGnf: true,
          },
        },
      },
      orderBy: { medicament: { libelle: 'asc' } },
      take: RAYON_MAX,
    }),
  ]);

  const horaires = horairesDepuisLaBase(officine.horaires);
  return {
    ...officine,
    horaires,
    ouverture: etatOuverture(horaires),
    nombreProduits,
    produits: stocks.map((s) => ({
      id: s.medicament.id,
      libelle: s.medicament.libelle,
      molecule: s.medicament.dci,
      forme: s.medicament.forme,
      dosage: s.medicament.dosage,
      categorie: s.medicament.categorie,
      estMedicament: s.medicament.categorie === 'MEDICAMENT',
      prixGnf: prixDeVenteGnf(s.medicament.prixUnitaireGnf, s.margeGnf),
      etatStock: etatDuStock(s.quantite, s.seuilAlerte),
      declareLe: s.modifieLe,
    })),
  };
}
