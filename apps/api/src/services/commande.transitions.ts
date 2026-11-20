import { StatutCommande } from '../config/generated/client/client';
import { ConflictError } from '../utils/app-error';

/**
 * Les passages autorises, et eux seuls.
 *
 * Une commande remise au motard ne s'annule pas : les produits sont partis.
 * Avant la remise, le patient peut encore repasser au retrait en changeant le
 * mode et l'etat ensemble.
 */
const TRANSITIONS: Readonly<Record<StatutCommande, readonly StatutCommande[]>> = {
  RECHERCHE_PHARMACIE: ['PRISE_EN_CHARGE', 'ATTENTE_ACCORD_PATIENT', 'SANS_PHARMACIE', 'ANNULEE'],
  PRISE_EN_CHARGE: ['A_PAYER', 'RECHERCHE_PHARMACIE', 'ANNULEE'],
  // Le patient accepte (la partie est servie), refuse ou laisse passer le
  // delai (retour au quartier), ou renonce.
  ATTENTE_ACCORD_PATIENT: ['PRISE_EN_CHARGE', 'RECHERCHE_PHARMACIE', 'ANNULEE'],
  A_PAYER: ['PAYEE', 'ANNULEE'],
  PAYEE: ['EN_PREPARATION', 'ANNULEE'],
  EN_PREPARATION: ['PRETE_POUR_RETRAIT', 'PRETE_POUR_LIVRAISON', 'ANNULEE'],
  PRETE_POUR_RETRAIT: ['CLOTUREE', 'ANNULEE'],
  PRETE_POUR_LIVRAISON: ['PRETE_POUR_RETRAIT', 'RETIREE', 'ANNULEE'],
  RETIREE: ['CLOTUREE'],
  CLOTUREE: [],
  SANS_PHARMACIE: ['RECHERCHE_PHARMACIE', 'ANNULEE'],
  ANNULEE: [],
};

const LIBELLES: Readonly<Record<StatutCommande, string>> = {
  RECHERCHE_PHARMACIE: 'en recherche de pharmacie',
  PRISE_EN_CHARGE: 'prise en charge',
  ATTENTE_ACCORD_PATIENT: "en attente de l'accord du patient",
  A_PAYER: 'en attente de paiement',
  PAYEE: 'payee',
  EN_PREPARATION: 'en preparation',
  PRETE_POUR_RETRAIT: 'prete pour retrait',
  PRETE_POUR_LIVRAISON: 'prete pour livraison',
  RETIREE: 'remise',
  CLOTUREE: 'cloturee',
  SANS_PHARMACIE: 'sans pharmacie',
  ANNULEE: 'annulee',
};

export function transitionPermise(de: StatutCommande, vers: StatutCommande): boolean {
  return TRANSITIONS[de].includes(vers);
}

/** Refuse un passage impossible en le nommant, avec un conflit HTTP 409. */
export function assertTransition(de: StatutCommande, vers: StatutCommande): void {
  if (transitionPermise(de, vers)) return;
  throw new ConflictError(
    TRANSITIONS[de].length === 0
      ? `Cette commande est ${LIBELLES[de]} : rien ne peut plus la faire changer.`
      : `Une commande ${LIBELLES[de]} ne peut pas passer a « ${LIBELLES[vers]} ».`,
  );
}
