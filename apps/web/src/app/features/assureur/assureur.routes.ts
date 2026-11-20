// features/assureur/assureur.routes.ts
//
// L'espace de la compagnie d'assurance (addendum du 2026-09-28, point 5.2).
import { Routes } from '@angular/router';

export const ASSUREUR_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/assureur-layout/assureur-layout.component')
        .then(m => m.AssureurLayoutComponent),
    children: [
      { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
      {
        path: 'tableau-de-bord',
        loadComponent: () =>
          import('./tableau-de-bord/tableau-de-bord.component')
            .then(m => m.AssureurTableauDeBordComponent)
      },
      {
        path: 'assures',
        loadComponent: () =>
          import('./assures/assures.component').then(m => m.AssureurAssuresComponent)
      },
      {
        path: 'contrats',
        loadComponent: () =>
          import('./contrats/contrats.component').then(m => m.AssureurContratsComponent)
      },
      {
        path: 'pharmacies',
        loadComponent: () =>
          import('./pharmacies/pharmacies.component').then(m => m.AssureurPharmaciesComponent)
      },
      {
        path: 'apparence',
        loadComponent: () =>
          import('../../shared/components/apparence-structure/apparence-structure.component').then(m => m.ApparenceStructureComponent)
      }
    ]
  }
];
