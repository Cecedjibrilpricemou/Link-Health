// features/laboratoire/laboratoire.routes.ts — espace Laboratoire (P2, EF-04)
import { Routes } from '@angular/router';
import { PAGES_DIRECTEUR } from '../admin-structure/pages-directeur.routes';

export const LABORATOIRE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/labo-layout/labo-layout.component').then(m => m.LaboLayoutComponent),
    children: [
      { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
      { path: 'tableau-de-bord', loadComponent: () => import('./tableau-de-bord/tableau-de-bord.component').then(m => m.LaboTableauDeBordComponent) },
      { path: 'plateau-technique', loadComponent: () => import('./plateau/plateau.component').then(m => m.LaboPlateauComponent) },
      { path: 'demandes', loadComponent: () => import('./demandes/demandes.component').then(m => m.LaboDemandesComponent) },
      { path: 'demandes/:id', loadComponent: () => import('./demande-detail/demande-detail.component').then(m => m.LaboDemandeDetailComponent) },
      // ── Le directeur du laboratoire : ses menus de gestion, ici ───────
      ...PAGES_DIRECTEUR,
    ]
  }
];
