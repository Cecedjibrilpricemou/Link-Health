// Les metiers du personnel d'une structure.
//
// **Le role dit ce que le compte peut faire, la specialite dit le metier.**
// Un pediatre et un chirurgien-dentiste ont tous deux les ecrans du medecin ;
// l'administrateur choisit pourtant un metier, pas un role technique, et
// l'accueil reconnait chacun a sa specialite pour orienter un patient.
//
// Les metiers proposes suivent ce que fait la structure : la meme regle que
// l'API (`rolesCreablesPour`), qui refuse le reste.
import { SPECIALITES_MEDICALES } from '@baobaoheath/shared-types';
import type { RoleAgentStructure, SpecialiteMedicale, TypeStructure } from '@baobaoheath/shared-types';

export const METIERS = [
  'MEDECIN_GENERALISTE', 'MEDECIN_SPECIALISTE', 'CHIRURGIEN_DENTISTE', 'SAGE_FEMME',
  'AGENT_ACCUEIL', 'TECHNICIEN_LABO', 'ASC', 'ASC_SUPERVISOR',
] as const;
export type Metier = (typeof METIERS)[number];

const ROLE_DU_METIER: Record<Metier, RoleAgentStructure> = {
  MEDECIN_GENERALISTE: 'MEDECIN',
  MEDECIN_SPECIALISTE: 'MEDECIN',
  CHIRURGIEN_DENTISTE: 'MEDECIN',
  SAGE_FEMME: 'SAGE_FEMME',
  AGENT_ACCUEIL: 'AGENT_ACCUEIL',
  TECHNICIEN_LABO: 'TECHNICIEN_LABO',
  ASC: 'ASC',
  ASC_SUPERVISOR: 'ASC_SUPERVISOR',
};

/** Les roles qu'une structure cree : copie de `rolesCreablesPour` (API). */
export function rolesCreablesPour(type: TypeStructure | null | undefined): RoleAgentStructure[] {
  switch (type) {
    case 'POSTE': return ['ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'AGENT_ACCUEIL'];
    case 'CENTRE': return ['ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO'];
    case 'HOPITAL_PREF':
    case 'HOPITAL_REG':
    case 'CHU':
    case 'CLINIQUE': return ['MEDECIN', 'SAGE_FEMME', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO'];
    case 'LABORATOIRE': return ['TECHNICIEN_LABO'];
    default: return [];
  }
}

/** Les metiers proposes a la creation, selon la structure. */
export function metiersPour(type: TypeStructure | null | undefined): Metier[] {
  const roles = rolesCreablesPour(type);
  return METIERS.filter((m) => roles.includes(ROLE_DU_METIER[m]));
}

/**
 * Un metier de praticien : medecin ou sage-femme. Il porte un numero d'ordre,
 * un service et un bureau ; seul le medecin a en plus une specialite.
 */
export function estMetierMedical(m: Metier): boolean {
  return estRolePraticien(ROLE_DU_METIER[m]);
}

/** Les roles qui ont les ecrans et les actes du medecin : copie de `ROLES_PRATICIENS` (API). */
export function estRolePraticien(role: string | null | undefined): boolean {
  return role === 'MEDECIN' || role === 'SAGE_FEMME';
}

/** Les specialites qu'on choisit pour un specialiste : ni generaliste, ni dentaire. */
export const SPECIALITES_DE_SPECIALISTE: SpecialiteMedicale[] =
  SPECIALITES_MEDICALES.filter((s) => s !== 'MEDECINE_GENERALE' && s !== 'DENTAIRE');

/** Ce que l'API recoit pour un metier. */
export function versCreation(metier: Metier, specialite?: SpecialiteMedicale): { role: RoleAgentStructure; specialite?: SpecialiteMedicale } {
  const role = ROLE_DU_METIER[metier];
  if (metier === 'MEDECIN_GENERALISTE') return { role, specialite: 'MEDECINE_GENERALE' };
  if (metier === 'CHIRURGIEN_DENTISTE') return { role, specialite: 'DENTAIRE' };
  if (metier === 'MEDECIN_SPECIALISTE') return { role, specialite };
  return { role };
}

/** Le metier d'un compte existant, d'apres son role et sa specialite. */
export function metierDe(role: string, specialite?: string | null): Metier | null {
  if (role === 'MEDECIN') {
    if (!specialite || specialite === 'MEDECINE_GENERALE') return 'MEDECIN_GENERALISTE';
    if (specialite === 'DENTAIRE') return 'CHIRURGIEN_DENTISTE';
    return 'MEDECIN_SPECIALISTE';
  }
  return (METIERS as readonly string[]).includes(role) ? (role as Metier) : null;
}

/**
 * Le libelle d'une specialite : traduit si c'est un code connu, tel quel
 * sinon (une specialite saisie a la main avant la liste fermee).
 */
export function libelleSpecialite(t: (cle: string) => string, specialite: string | null | undefined): string | undefined {
  if (!specialite) return undefined;
  return (SPECIALITES_MEDICALES as readonly string[]).includes(specialite) ? t('SPECIALITE.' + specialite) : specialite;
}
