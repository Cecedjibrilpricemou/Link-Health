// core/navigation/accueil-par-role.ts
//
// La page d'arrivee de chaque role : apres la connexion, et quand un role
// tente d'ouvrir un espace qui n'est pas le sien.
//
// **Une seule table.** Il y en avait deux (connexion et garde de role), et
// elles avaient diverge : le livreur manquait au garde. Le pharmacien
// arrivait sur les ordonnances, page que le caissier d'officine n'a pas dans
// son menu ; le tableau de bord est ouvert aux quatre roles d'officine.
export const ACCUEIL_PAR_ROLE: Readonly<Record<string, string>> = {
  PATIENT:         '/patient/dashboard',
  ASC:             '/asc/consultations',
  ASC_SUPERVISOR:  '/asc/consultations',
  MEDECIN:         '/medecin/dashboard',
  PHARMACIEN:      '/pharmacien/tableau-de-bord',
  AGENT_ACCUEIL:   '/hopital/tableau-de-bord',
  TECHNICIEN_LABO: '/laboratoire/tableau-de-bord',
  ASSUREUR:        '/assureur/tableau-de-bord',
  LIVREUR:         '/livreur/courses',
  ADMIN_STRUCTURE: '/admin-structure/dashboard',
  ADMIN_REGIONAL:  '/admin/analytics',
  ADMIN_NATIONAL:  '/admin/analytics',
  SUPER_ADMIN:     '/admin/analytics',
};

/** La page d'arrivee du role, ou `undefined` s'il n'a pas d'espace. */
export function accueilDuRole(role: string | null | undefined): string | undefined {
  return role ? ACCUEIL_PAR_ROLE[role] : undefined;
}
