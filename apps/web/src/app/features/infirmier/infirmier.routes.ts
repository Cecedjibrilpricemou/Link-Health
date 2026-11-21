// features/infirmier/infirmier.routes.ts — l'espace de l'infirmier.
import { Routes } from '@angular/router';

export const INFIRMIER_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/infirmier-layout/infirmier-layout.component').then(m => m.InfirmierLayoutComponent),
    children: [
      { path: '', redirectTo: 'patients', pathMatch: 'full' },
      { path: 'patients', loadComponent: () => import('./patients/patients.component').then(m => m.InfirmierPatientsComponent) },
      { path: 'visites/:id', loadComponent: () => import('./visite/visite.component').then(m => m.InfirmierVisiteComponent) },
    ],
  },
];
