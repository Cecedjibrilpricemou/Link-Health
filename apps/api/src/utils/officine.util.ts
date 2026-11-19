import { Role, TypeStructure } from '../config/generated/client/client';

export const TYPES_STRUCTURES_HOSPITALIERES: TypeStructure[] = [
  TypeStructure.HOPITAL_PREF,
  TypeStructure.HOPITAL_REG,
  TypeStructure.CHU,
  TypeStructure.CLINIQUE,
];

export function estStructureHospitaliere(type: TypeStructure): boolean {
  return TYPES_STRUCTURES_HOSPITALIERES.includes(type);
}

export function estStructureOfficinale(type: TypeStructure): boolean {
  return type === TypeStructure.PHARMACIE;
}

export function filtreStructuresOfficinales() {
  return { type: TypeStructure.PHARMACIE };
}

/**
 * Le role que porte le responsable d'une structure, selon son metier.
 *
 * **Il ne suffit pas de creer un compte : il faut le creer au bon endroit.**
 * Un responsable recevait `ADMIN_STRUCTURE` quel que soit le type, et se
 * retrouvait dans un espace d'administration ou son metier n'existe pas. Le
 * titulaire d'une officine ne pouvait pas tenir son comptoir ; le responsable
 * d'une compagnie d'assurance arrivait sur un tableau de bord d'etablissement
 * de soins, alors que son propre espace - contrats, assures, reglements - lui
 * restait ferme, aucun compte n'ayant jamais porte le role `ASSUREUR`.
 *
 * Les deux metiers se reconnaissent au type de leur structure, et c'est le
 * seul endroit ou cette correspondance est ecrite : les trois portes de
 * creation la lisent ici plutot que de la redecider chacune a sa facon.
 */
export function roleDuResponsable(type: TypeStructure): Role {
  if (estStructureOfficinale(type)) return Role.PHARMACIEN;
  if (type === TypeStructure.ASSURANCE) return Role.ASSUREUR;
  return Role.ADMIN_STRUCTURE;
}
