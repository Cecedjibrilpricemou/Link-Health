// features/hopital/hopital.routes.ts — espace Accueil hopital (P1, EF-03)
import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/role.guard';
import { RACINE_LABO } from '../../core/navigation/racines';
import { PAGES_DIRECTEUR_ETABLISSEMENT } from '../admin-structure/pages-directeur.routes';

export const HOPITAL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/hopital-layout/hopital-layout.component').then(m => m.HopitalLayoutComponent),
    children: [
      { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
      { path: 'tableau-de-bord', loadComponent: () => import('./tableau-de-bord/tableau-de-bord.component').then(m => m.TableauDeBordComponent) },
      { path: 'admission', loadComponent: () => import('./admission/admission.component').then(m => m.AdmissionComponent) },
      {
        path: 'demandes',
        loadComponent: () =>
          import('./demandes/demandes.component').then(m => m.DemandesComponent)
      },
      {
        path: 'presences',
        loadComponent: () =>
          import('./presences/presences.component').then(m => m.PresencesComponent)
      },
      { path: 'identites', loadComponent: () => import('./identites/identites.component').then(m => m.IdentitesComponent) },
      { path: 'episodes', loadComponent: () => import('./episodes/episodes.component').then(m => m.EpisodesComponent) },
      { path: 'episodes/:id', loadComponent: () => import('./episode-detail/episode-detail.component').then(m => m.EpisodeDetailComponent) },
      { path: 'alertes', loadComponent: () => import('./alertes/alertes.component').then(m => m.AlertesComponent) },
      // ── Le directeur : ses menus de gestion, dans cet espace ──────────
      ...PAGES_DIRECTEUR_ETABLISSEMENT,
      // Le laboratoire de l'etablissement, suivi par son directeur sans
      // changer d'espace. L'API lui retire toute valeur d'analyse.
      {
        path: 'laboratoire',
        canActivate: [roleGuard],
        data: { roles: ['ADMIN_STRUCTURE'] },
        providers: [{ provide: RACINE_LABO, useValue: '/hopital/laboratoire' }],
        children: [
          { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
          { path: 'tableau-de-bord', loadComponent: () => import('../laboratoire/tableau-de-bord/tableau-de-bord.component').then(m => m.LaboTableauDeBordComponent) },
          { path: 'plateau-technique', loadComponent: () => import('../laboratoire/plateau/plateau.component').then(m => m.LaboPlateauComponent) },
          { path: 'demandes', loadComponent: () => import('../laboratoire/demandes/demandes.component').then(m => m.LaboDemandesComponent) },
          { path: 'demandes/:id', loadComponent: () => import('../laboratoire/demande-detail/demande-detail.component').then(m => m.LaboDemandeDetailComponent) },
        ],
      },
    ]
  }
];
