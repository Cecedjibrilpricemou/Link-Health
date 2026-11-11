import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/role.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/admin-layout/admin-layout.component')
        .then(m => m.AdminLayoutComponent),
    children: [
      { path: '', redirectTo: 'analytics', pathMatch: 'full' },
      {
        path: 'analytics',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./analytics/analytics.component').then(m => m.AnalyticsComponent)
      },
      {
        path: 'structures',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./structures/structures.component').then(m => m.StructuresComponent)
      },
      {
        path: 'export',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./export/export.component').then(m => m.ExportComponent)
      },
      {
        path: 'demandes-rgpd',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./demandes-rgpd/demandes-rgpd.component').then(m => m.DemandesRgpdComponent)
      },
      {
        path: 'comptes',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./comptes/comptes.component').then(m => m.ComptesComponent)
      },
      // Recruter l'encadrement n'appartient qu'au super administrateur : un
      // administrateur national qui nommerait ses pairs se donnerait des
      // collegues sans que personne l'ait decide.
      {
        path: 'administrateurs',
        canActivate: [roleGuard],
        data: { roles: ['SUPER_ADMIN'] },
        loadComponent: () =>
          import('./administrateurs/administrateurs.component').then(m => m.AdministrateursComponent)
      },
      {
        path: 'livreurs',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./livreurs/livreurs.component').then(m => m.LivreursComponent)
      },
      {
        // L'espace /admin accueille aussi l'admin regional et l'admin de
        // structure ; l'API d'assurance ne repond qu'a l'administration
        // nationale. Cacher l'entree de menu ne suffit pas : l'URL se tape.
        path: 'assurance',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./assurance/assurance.component').then(m => m.AssuranceComponent)
      },
      {
        path: 'journal',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./journal/journal.component').then(m => m.JournalComponent)
      },
      // M1 : le referentiel geographique vaut pour toute l'installation ;
      // l'API ne l'ouvre en ecriture qu'a l'administration nationale.
      {
        path: 'geographie',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./geographie/geographie.component').then(m => m.GeographieComponent)
      },
      {
        path: 'bris-de-glace',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
        loadComponent: () =>
          import('./bris-de-glace/bris-de-glace-revue.component').then(m => m.BrisDeGlaceRevueComponent)
      },
      {
        path: 'settings',
        canActivate: [roleGuard],
        data: { roles: ['SUPER_ADMIN'] },
        loadComponent: () =>
          import('./settings/settings.component').then(m => m.SettingsComponent)
      }
    ]
  }
];
