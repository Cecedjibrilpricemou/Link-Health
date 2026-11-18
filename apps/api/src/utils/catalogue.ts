import { normaliserPourEmpreinte } from './encryption.utils';

/**
 * Les champs d'un produit sur lesquels porte la recherche publique (A1).
 * Tous facultatifs : un lait infantile n'a ni DCI ni classe therapeutique.
 */
export interface TexteCatalogue {
  libelle?: string | null;
  nomCommercial?: string | null;
  dci?: string | null;
  classeTherapeutique?: string | null;
}

/**
 * Le texte normalise enregistre dans `Medicament.rechercheTexte`.
 *
 * **Un seul endroit le calcule**, et toutes les voies d'ecriture du catalogue
 * passent par lui : article local d'une officine, import CSV du referentiel,
 * semences. Une voie qui l'oublierait rendrait le produit introuvable des
 * qu'on l'ecrit sans ses accents, sans que rien ne le signale.
 *
 * La normalisation est celle de `normaliserPourEmpreinte`, deja eprouvee pour
 * rapprocher les noms de mere : accents retires, minuscules, espaces reduits.
 * La migration `20261112200000_recherche_catalogue` reproduit exactement la
 * meme transformation en SQL pour les lignes deja en base.
 */
export function empreinteCatalogue(produit: TexteCatalogue): string {
  const parties = [produit.libelle, produit.nomCommercial, produit.dci, produit.classeTherapeutique]
    .map((v) => (v ?? '').trim())
    .filter((v) => v !== '');
  return normaliserPourEmpreinte(parties.join(' '));
}

/**
 * Le prix de vente d'un produit dans une officine : le prix national de
 * reference, plus la marge que l'officine applique.
 *
 * La regle vivait deja en deux exemplaires (comptoir et caisse). Elle est
 * ecrite ici pour que la recherche publique annonce **exactement** le prix
 * que le client paiera : un prix affiche qui ne serait pas celui du ticket
 * ferait plus de tort que pas de prix du tout.
 */
export function prixDeVenteGnf(prixUnitaireGnf: number, margeGnf: number): number {
  return prixUnitaireGnf + margeGnf;
}

/**
 * Ce que le public apprend d'un stock. **Jamais la quantite exacte** : elle
 * renseigne un concurrent et, pour un produit rare, designe l'officine a
 * devaliser.
 */
export type EtatStock = 'DISPONIBLE' | 'FAIBLE';

export function etatDuStock(quantite: number, seuilAlerte: number): EtatStock {
  return quantite <= seuilAlerte ? 'FAIBLE' : 'DISPONIBLE';
}
