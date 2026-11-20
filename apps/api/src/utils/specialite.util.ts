// Les specialites medicales : une liste fermee, et les valeurs d'avant.
//
// **Avant la liste, la specialite etait un texte libre** (« Medecine
// generale », « pediatre », « Gyneco »). Ces comptes existent. Plutot que de
// les reecrire en base, on les lit : un texte qui correspond a une specialite
// connue est rendu sous son code ; sinon, tel quel - mieux vaut un libelle
// brut qu'une specialite devinee a tort.
import { SPECIALITES_MEDICALES } from '@baobaoheath/shared-types';
import type { SpecialiteMedicale } from '@baobaoheath/shared-types';

/** Minuscules, sans accents, mots separes par une espace. */
function cle(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ce qu'on a pu ecrire pour chaque specialite, en plus de son code. */
const SYNONYMES: Record<SpecialiteMedicale, string[]> = {
  MEDECINE_GENERALE: ['medecine generale', 'generaliste', 'medecin generaliste', 'mg'],
  DENTAIRE: ['dentaire', 'dentiste', 'chirurgien dentiste', 'chirurgie dentaire', 'odontologie', 'odontostomatologie'],
  PEDIATRIE: ['pediatrie', 'pediatre'],
  GYNECO_OBSTETRIQUE: ['gynecologie', 'gynecologue', 'obstetrique', 'gyneco', 'gyneco obstetrique', 'gynecologie obstetrique', 'maternite'],
  CHIRURGIE_GENERALE: ['chirurgie', 'chirurgie generale', 'chirurgien'],
  CARDIOLOGIE: ['cardiologie', 'cardiologue'],
  MEDECINE_INTERNE: ['medecine interne', 'interniste'],
  ORL: ['orl', 'oto rhino laryngologie'],
  OPHTALMOLOGIE: ['ophtalmologie', 'ophtalmologue'],
  DERMATOLOGIE: ['dermatologie', 'dermatologue'],
  PSYCHIATRIE: ['psychiatrie', 'psychiatre'],
  NEUROLOGIE: ['neurologie', 'neurologue'],
  RADIOLOGIE: ['radiologie', 'radiologue', 'imagerie', 'imagerie medicale'],
  ANESTHESIE_REANIMATION: ['anesthesie', 'reanimation', 'anesthesie reanimation', 'anesthesiste'],
  TRAUMATO_ORTHOPEDIE: ['traumatologie', 'orthopedie', 'traumatologie orthopedie', 'orthopediste'],
  UROLOGIE: ['urologie', 'urologue'],
  GASTRO_ENTEROLOGIE: ['gastro enterologie', 'gastroenterologie', 'gastro enterologue', 'gastroenterologue'],
  PNEUMOLOGIE: ['pneumologie', 'pneumologue'],
  NEPHROLOGIE: ['nephrologie', 'nephrologue'],
  ENDOCRINOLOGIE: ['endocrinologie', 'endocrinologue', 'diabetologie'],
  INFECTIOLOGIE: ['infectiologie', 'maladies infectieuses'],
  URGENCES: ['urgences', 'urgentiste', 'medecine d urgence', 'medecine urgence'],
};

const PAR_CLE = new Map<string, SpecialiteMedicale>();
for (const code of SPECIALITES_MEDICALES) {
  PAR_CLE.set(cle(code), code);
  for (const s of SYNONYMES[code]) PAR_CLE.set(cle(s), code);
}

/**
 * La specialite d'un medecin, sous son code quand on la reconnait ; le texte
 * d'origine sinon ; `null` quand il n'y en a pas.
 */
export function normaliserSpecialite(valeur: string | null | undefined): SpecialiteMedicale | string | null {
  const brut = (valeur ?? '').trim();
  if (!brut) return null;
  if ((SPECIALITES_MEDICALES as readonly string[]).includes(brut)) return brut as SpecialiteMedicale;
  return PAR_CLE.get(cle(brut)) ?? brut;
}
