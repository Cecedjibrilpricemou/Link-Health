// src/services/recherche.service.ts
// A1 : la recherche publique de produits, sans compte.
//
// Trois regles la gouvernent, et chacune repond a une decision prise le
// 12 novembre :
//
//   - **On ne montre que ce qu'on sait.** Un produit n'apparait que s'il est
//     en stock, declare par une pharmacie, dans la zone demandee. Une
//     officine qui ne tient pas son stock sur la plateforme n'est pas listee
//     ici : annoncer un produit sans savoir s'il y est ferait deplacer
//     quelqu'un pour rien.
//   - **Les produits reglementes n'apparaissent jamais.** Dire publiquement
//     quelle officine detient des stupefiants, c'est designer une cible.
//   - **Jamais la quantite exacte**, seulement « disponible » ou « stock
//     faible », avec la date a laquelle l'officine l'a declaree.
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
export type ZoneRecherche = 'COMMUNE' | 'VOISINES' | 'PREFECTURE';

export interface CritereRecherche {
  q: string;
  prefecture: string;
  commune?: string | null;
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
}

export interface ResultatRecherche {
  zoneUtilisee: ZoneRecherche;
  prefecture: string;
  commune: string | null;
  communesVoisines: string[];
  produits: ProduitTrouve[];
}

/** Au-dela, ce n'est plus une recherche mais un balayage du catalogue. */
const PRODUITS_MAX = 20;
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

/** Les etapes d'elargissement, dans l'ordre ou on les essaie. */
async function etapes(critere: CritereRecherche): Promise<
  { zone: ZoneRecherche; filtre: Record<string, unknown>; voisines: string[] }[]
> {
  const prefecture = critere.prefecture.trim();
  const commune = (critere.commune ?? '').trim();
  const parPrefecture = {
    zone: 'PREFECTURE' as const,
    filtre: filtrePrefecture(prefecture),
    voisines: [] as string[],
  };
  if (!commune) return [parPrefecture];

  const ici: Lieu = { prefecture, commune };
  const voisines = await voisinsDe(prefecture, commune);
  const avecVoisines = voisines.map((c): Lieu => ({ prefecture, commune: c }));

  return [
    { zone: 'COMMUNE', filtre: filtreZones([ici]), voisines: [] },
    ...(voisines.length > 0
      ? [{ zone: 'VOISINES' as const, filtre: filtreZones([ici, ...avecVoisines]), voisines }]
      : []),
    parPrefecture,
  ];
}

type LigneStock = {
  quantite: number;
  seuilAlerte: number;
  margeGnf: number;
  modifieLe: Date;
  idStructure: string | null;
};

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
): ProduitTrouve | null {
  if (produit.stocks.length === 0) return null;
  const prix = produit.stocks.map((s) => prixDeVenteGnf(produit.prixUnitaireGnf, s.margeGnf));
  const officines = new Set(produit.stocks.map((s) => s.idStructure));
  // Le meilleur etat de la zone : si une seule officine est bien fournie, le
  // visiteur n'a pas a se decourager parce qu'une autre est presque a sec.
  const disponible = produit.stocks.some((s) => etatDuStock(s.quantite, s.seuilAlerte) === 'DISPONIBLE');
  const declareLe = produit.stocks
    .map((s) => s.modifieLe)
    .reduce((a, b) => (a > b ? a : b));

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
  };
}

export async function chercherProduits(critere: CritereRecherche): Promise<ResultatRecherche> {
  const mots = motsDeLaRecherche(critere.q);
  if (mots.length === 0) {
    throw new ValidationError('Tapez au moins deux lettres du nom du produit ou de la molecule');
  }
  const prefecture = critere.prefecture.trim();
  if (!prefecture) {
    throw new ValidationError('Choisissez d\'abord votre zone');
  }

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
            idStructure: true,
          },
        },
      },
      orderBy: { libelle: 'asc' },
      take: PRODUITS_MAX,
    });

    const vues = produits
      .map((p) => resumer(p))
      .filter((v): v is ProduitTrouve => v !== null);

    // On s'arrete a la premiere etape qui donne quelque chose. Elargir encore
    // n'ajouterait que des officines plus lointaines.
    if (vues.length > 0) {
      return {
        zoneUtilisee: etape.zone,
        prefecture,
        commune: (critere.commune ?? '').trim() || null,
        communesVoisines: etape.voisines,
        produits: vues,
      };
    }
  }

  return {
    zoneUtilisee: 'PREFECTURE',
    prefecture,
    commune: (critere.commune ?? '').trim() || null,
    communesVoisines: [],
    produits: [],
  };
}
