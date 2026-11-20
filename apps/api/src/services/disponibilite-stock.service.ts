// Ce que la pharmacie a vraiment en rayon, pour une commande qui arrive.
//
// **Le defaut que ce service corrige.** Une commande arrivait et le
// pharmacien devait repondre « j'ai tout / je n'ai pas tout » de memoire : il
// allait fouiller ses rayons avant de confirmer, ou repondait au jugé et se
// retractait ensuite. Le stock etait pourtant dans l'application, produit par
// produit, lot par lot.
//
// Chaque ligne de la commande est donc confrontee a son stock :
//   - **seuls les lots non perimes comptent** : une boite perimee ne se
//     delivre pas, elle ne doit pas faire croire qu'on a le produit ;
//   - une ligne est disponible, insuffisante (il en manque) ou absente ;
//   - quand le produit exact manque, un **equivalent** en stock - meme
//     molecule, meme dosage, autre marque - est signale. Seulement signale :
//     substituer reste un acte du pharmacien, a faire avec le patient.
//
// Le resultat **eclaire** la decision, il ne la prend pas : le stock de
// l'application peut avoir du retard sur le rayon, et c'est le pharmacien qui
// choisit de prendre, de proposer une partie, ou de refuser.
import { prisma } from '../config/prisma';

export type EtatLigneStock = 'DISPONIBLE' | 'INSUFFISANT' | 'ABSENT';
export type EtatDisponibilite = 'COMPLETE' | 'PARTIELLE' | 'AUCUNE';

export interface EquivalentEnStock {
  idMedicament: string;
  libelle: string;
  quantiteEnStock: number;
}

export interface DisponibiliteLigne {
  idLigneOrdonnance: string;
  libelle: string;
  quantiteDemandee: number;
  quantiteEnStock: number;
  etat: EtatLigneStock;
  equivalents: EquivalentEnStock[];
}

export interface DisponibiliteCommande {
  etat: EtatDisponibilite;
  /** Les lignes que la pharmacie peut servir en entier. */
  disponibles: number;
  total: number;
  lignes: DisponibiliteLigne[];
}

/** Une ligne a servir, telle que l'ordonnance la prescrit. */
export interface LigneAServir {
  id: string;
  quantite: number;
  idMedicament: string;
  medicament: { libelle: string; dci: string | null; dosage: string | null };
}

/** Le stock d'un produit dans l'officine, avec ses lots. */
export interface StockProduit {
  idMedicament: string;
  quantite: number;
  medicament: { libelle: string; dci: string | null; dosage: string | null };
  lots: { quantite: number; datePeremption: Date | null }[];
}

/**
 * La quantite qu'on peut reellement delivrer : la somme des lots non perimes.
 *
 * Un lot sans date de peremption compte : la date est facultative a la
 * saisie, et l'ignorer ferait disparaitre du stock des boites bien reelles.
 * Un stock sans aucun lot (saisi avant le suivi par lot) garde son total.
 */
export function quantiteUtilisable(stock: Pick<StockProduit, 'quantite' | 'lots'>, maintenant: Date): number {
  if (stock.lots.length === 0) return Math.max(0, stock.quantite);
  return stock.lots
    .filter((l) => !l.datePeremption || l.datePeremption.getTime() > maintenant.getTime())
    .reduce((total, l) => total + Math.max(0, l.quantite), 0);
}

/** La molecule et le dosage, compares sans casse ni espaces : « 500 mg » = « 500mg ». */
function cle(texte: string | null): string {
  return (texte ?? '').toLocaleLowerCase('fr').replace(/\s+/g, '');
}

function memeEquivalence(a: { dci: string | null; dosage: string | null }, b: { dci: string | null; dosage: string | null }): boolean {
  return cle(a.dci) !== '' && cle(a.dci) === cle(b.dci) && cle(a.dosage) === cle(b.dosage);
}

/**
 * Confronter les lignes d'une commande au stock d'une officine.
 *
 * Fonction pure : le stock lui est donne, elle ne lit rien. C'est elle que
 * les tests eprouvent, ligne par ligne.
 */
export function evaluerDisponibilite(
  lignes: readonly LigneAServir[],
  stocks: readonly StockProduit[],
  maintenant: Date,
): DisponibiliteCommande {
  const parProduit = new Map(stocks.map((s) => [s.idMedicament, s]));

  const resultat = lignes.map<DisponibiliteLigne>((ligne) => {
    const stock = parProduit.get(ligne.idMedicament);
    const enStock = stock ? quantiteUtilisable(stock, maintenant) : 0;
    const etat: EtatLigneStock = enStock >= ligne.quantite ? 'DISPONIBLE' : enStock > 0 ? 'INSUFFISANT' : 'ABSENT';

    // Un equivalent n'est cherche que si le produit exact ne suffit pas, et
    // seulement parmi ce qui est reellement delivrable.
    const equivalents = etat === 'DISPONIBLE'
      ? []
      : stocks
          .filter((s) => s.idMedicament !== ligne.idMedicament && memeEquivalence(s.medicament, ligne.medicament))
          .map((s) => ({ idMedicament: s.idMedicament, libelle: s.medicament.libelle, quantiteEnStock: quantiteUtilisable(s, maintenant) }))
          .filter((e) => e.quantiteEnStock > 0)
          .sort((a, b) => b.quantiteEnStock - a.quantiteEnStock);

    return {
      idLigneOrdonnance: ligne.id,
      libelle: ligne.medicament.libelle,
      quantiteDemandee: ligne.quantite,
      quantiteEnStock: enStock,
      etat,
      equivalents,
    };
  });

  const disponibles = resultat.filter((l) => l.etat === 'DISPONIBLE').length;
  return {
    etat: disponibles === resultat.length ? 'COMPLETE' : disponibles === 0 ? 'AUCUNE' : 'PARTIELLE',
    disponibles,
    total: resultat.length,
    lignes: resultat,
  };
}

/**
 * La disponibilite de plusieurs commandes dans le stock d'une officine, en
 * deux lectures quel que soit leur nombre : les produits prescrits, puis
 * leurs equivalents possibles.
 */
export async function disponibilitesDansMonStock(
  idStructure: string,
  commandes: readonly { id: string; lignes: readonly LigneAServir[] }[],
  maintenant = new Date(),
): Promise<Map<string, DisponibiliteCommande>> {
  const resultat = new Map<string, DisponibiliteCommande>();
  if (commandes.length === 0) return resultat;

  const toutesLignes = commandes.flatMap((c) => c.lignes);
  const idsProduits = [...new Set(toutesLignes.map((l) => l.idMedicament))];
  const molecules = [...new Set(toutesLignes.map((l) => l.medicament.dci?.trim()).filter((d): d is string => !!d))];

  const stocks = await prisma.stock.findMany({
    where: {
      idStructure,
      OR: [
        { idMedicament: { in: idsProduits } },
        ...(molecules.length > 0
          ? [{ medicament: { OR: molecules.map((dci) => ({ dci: { equals: dci, mode: 'insensitive' as const } })) } }]
          : []),
      ],
    },
    select: {
      idMedicament: true,
      quantite: true,
      medicament: { select: { libelle: true, dci: true, dosage: true } },
      lots: { select: { quantite: true, datePeremption: true } },
    },
  });

  for (const c of commandes) resultat.set(c.id, evaluerDisponibilite(c.lignes, stocks, maintenant));
  return resultat;
}
