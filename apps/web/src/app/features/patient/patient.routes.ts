// features/patient/patient.routes.ts
// CORRIGÉ : ajout du PatientLayoutComponent comme parent (comme ASC)

import { Routes } from '@angular/router';

export const PATIENT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/patient-layout/patient-layout.component')
        .then(m => m.PatientLayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'commandes',
        loadComponent: () =>
          import('./commandes/commandes.component').then(m => m.PatientCommandesComponent)
      },
      {
        path: 'paiements',
        loadComponent: () =>
          import('./paiements/paiements.component').then(m => m.PatientPaiementsComponent)
      },
      {
        path: 'profil',
        loadComponent: () =>
          import('./profil/profil.component').then(m => m.ProfilComponent)
      },
      {
        path: 'qr-code',
        loadComponent: () =>
          import('./qr-code/qr-code.component').then(m => m.QrCodeComponent)
      },
      {
        path: 'cartes-assurance',
        loadComponent: () =>
          import('./cartes-assurance/cartes-assurance.component').then(m => m.CartesAssuranceComponent)
      },
      {
        path: 'carnet-vaccinal',
        loadComponent: () =>
          import('./dossier/dossier').then(m => m.Dossier)
      },
      {
        path: 'parcours',
        loadComponent: () =>
          import('./parcours/parcours.component').then(m => m.ParcoursComponent)
      },
      {
        path: 'rendez-vous',
        loadComponent: () =>
          import('./rendez-vous/rendez-vous.component').then(m => m.RendezVousComponent)
      },
      {
        path: 'ordonnances',
        loadComponent: () =>
          import('./ordonnances/ordonnances.component').then(m => m.OrdonnancesComponent)
      },
      {
        path: 'resultats',
        loadComponent: () =>
          import('./resultats/resultats.component').then(m => m.ResultatsComponent)
      },
      {
        path: 'consentements',
        loadComponent: () =>
          import('./consentements/consentements.component').then(m => m.ConsentementsComponent)
      },
      {
        path: 'acces-dossier',
        loadComponent: () =>
          import('./acces-dossier/acces-dossier.component').then(m => m.AccesDossierComponent)
      }
    ]
  }
];
