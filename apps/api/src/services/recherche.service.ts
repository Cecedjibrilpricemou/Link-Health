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
import { ValidationError } from '../utils/app-error';
import { empreinteCatalogue, etatDuStock, prixDeVenteGnf } from '../utils/catalogue';
import type { EtatStock } from '../utils/catalogue';
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

export interface ResultatRecherche {
  zoneUtilisee: ZoneRecherche;
  prefecture: string | null;
  commune: string | null;
  communesVoisines: string[];
  produits: ProduitTrouve[];
}

/** Au-dela, ce n'est plus une recherche mais un balayage du catalogue. */
const PRODUITS_MAX = 20;
/** Assez pour choisir, pas au point de noyer : on garde les mieux classees. */
const PHARMACIES_MAX = 10;
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
      prixGnf: prixDeVenteGnf(produit.prixUnitaireGnf, s.margeGnf),
      etatStock: etatDuStock(s.quantite, s.seuilAlerte),
      declareLe: s.modifieLe,
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
      };
    }
  }

  return {
    zoneUtilisee: 'PAYS',
    prefecture: prefecture || null,
    commune: commune || null,
    communesVoisines: [],
    produits: [],
  };
}
