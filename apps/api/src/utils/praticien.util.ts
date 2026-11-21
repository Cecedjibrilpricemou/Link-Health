// Qui exerce comme un medecin.
//
// **La sage-femme a les ecrans et les actes du medecin** : elle consulte,
// prescrit, demande des analyses, libere des resultats, clot une prise en
// charge, et lit l'historique sur l'accord de la patiente. Son role est a
// part parce que son metier l'est - l'accueil l'oriente comme sage-femme, le
// numero d'ordre n'est pas celui d'un medecin -, mais ses droits sont ceux du
// medecin.
//
// **Une seule liste, lue partout.** Chaque garde qui ecrivait `'MEDECIN'` en
// dur fermait la porte a la sage-femme sans le dire : elle tombait dans la
// branche « agent communautaire » d'un `if`, et se voyait refuser une
// consultation qu'elle avait elle-meme ouverte.
import { Role } from '../config/generated/client/client';

export const ROLES_PRATICIENS: readonly Role[] = [Role.MEDECIN, Role.SAGE_FEMME];

export function estPraticien(role: string | null | undefined): boolean {
  return !!role && (ROLES_PRATICIENS as readonly string[]).includes(role);
}

/**
 * Le nom d'un praticien, tel qu'on l'ecrit au patient : « Dr » pour le
 * medecin, et pour lui seul. Une sage-femme n'est pas docteur ; l'appeler
 * ainsi sur un compte rendu, c'est lui preter un titre qu'elle n'a pas.
 * Sans role connu, on garde l'usage d'avant : le medecin.
 */
export function nomDuPraticien(p: { prenom: string; nom: string; role?: string | null }): string {
  return p.role === Role.SAGE_FEMME ? `${p.prenom} ${p.nom}` : `Dr ${p.prenom} ${p.nom}`;
}

/** « Médecin » ou « Sage-femme » : ce qu'il est, pour un document. */
export function qualiteDuPraticien(role: string | null | undefined): string {
  return role === Role.SAGE_FEMME ? 'Sage-femme' : 'Médecin';
}
