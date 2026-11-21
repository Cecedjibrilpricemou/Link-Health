// Les constantes d'un passage de l'infirmier : l'ordre, l'unite et le pas de
// saisie de chacune. Lues par le formulaire de l'infirmier et par la carte
// des soins du praticien : une seule liste, pour qu'ils disent la meme chose.
import type { ConstantesSoinView } from '@baobaoheath/shared-types';

export type Constante = keyof ConstantesSoinView;

export const CONSTANTES: readonly { cle: Constante; unite: string; pas: string }[] = [
  { cle: 'temperature', unite: '°C', pas: '0.1' },
  { cle: 'tensionSystolique', unite: 'mmHg', pas: '1' },
  { cle: 'tensionDiastolique', unite: 'mmHg', pas: '1' },
  { cle: 'frequenceCardiaque', unite: '/min', pas: '1' },
  { cle: 'frequenceRespiratoire', unite: '/min', pas: '1' },
  { cle: 'spo2', unite: '%', pas: '1' },
  { cle: 'poidsKg', unite: 'kg', pas: '0.1' },
  { cle: 'glycemie', unite: 'g/L', pas: '0.01' },
];

/** Les constantes renseignees d'un passage, avec leur unite. */
export function constantesRenseignees(c: ConstantesSoinView): { cle: Constante; valeur: number; unite: string }[] {
  return CONSTANTES.filter(({ cle }) => c[cle] !== null && c[cle] !== undefined)
    .map(({ cle, unite }) => ({ cle, valeur: c[cle] as number, unite }));
}
