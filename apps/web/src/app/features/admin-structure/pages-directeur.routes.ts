// features/admin-structure/pages-directeur.routes.ts — les menus de gestion.
//
// Les pages que le directeur voit en plus, dans l'espace de son
// etablissement : son pilotage, son equipe, son dossier, son apparence. Le
// personnel de l'espace n'y entre pas - la garde le renvoie a son accueil,
// comme la pharmacie cache au caissier les menus du titulaire.
import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/role.guard';

const DIRECTEUR = { canActivate: [roleGuard], data: { roles: ['ADMIN_STRUCTURE'] } };

/** Les pages communes a tous les etablissements. */
export const PAGES_DIRECTEUR: Routes = [
  { path: 'pilotage', ...DIRECTEUR, loadComponent: () => import('./dashboard/dashboard.component').then(m => m.AdminStructureDashboardComponent) },
  { path: 'agents', ...DIRECTEUR, loadComponent: () => import('./agents/agents.component').then(m => m.AgentsComponent) },
  // Le dossier reglementaire de son etablissement : completer un dossier
  // ancien, et remplacer un agrement renouvele.
  { path: 'dossier', ...DIRECTEUR, loadComponent: () => import('./dossier/dossier.component').then(m => m.AdminStructureDossierComponent) },
  { path: 'apparence', ...DIRECTEUR, loadComponent: () => import('../../shared/components/apparence-structure/apparence-structure.component').then(m => m.ApparenceStructureComponent) },
];

/** Les pages d'un etablissement qui recoit des patients. */
export const PAGES_DIRECTEUR_ETABLISSEMENT: Routes = [
  ...PAGES_DIRECTEUR,
  { path: 'services', ...DIRECTEUR, loadComponent: () => import('./services/services.component').then(m => m.ServicesComponent) },
  { path: 'pharmacies', ...DIRECTEUR, loadComponent: () => import('./pharmacies/pharmacies.component').then(m => m.PharmaciesComponent) },
  { path: 'assurances', ...DIRECTEUR, loadComponent: () => import('./assurances/assurances.component').then(m => m.AssurancesComponent) },
  // Le carnet d'adresses : les laboratoires conseilles aux medecins de
  // l'etablissement. Ce n'est pas un contrat, seulement un ordre de liste.
  { path: 'conseillees', ...DIRECTEUR, loadComponent: () => import('./conseillees/conseillees.component').then(m => m.ConseilleesComponent) },
];
