import { Routes } from '@angular/router';
import { RACINE_ACCUEIL, RACINE_LABO } from '../../core/navigation/racines';

export const ADMIN_STRUCTURE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/admin-structure-layout/admin-structure-layout.component')
        .then(m => m.AdminStructureLayoutComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'services', loadComponent: () => import('./services/services.component').then(m => m.ServicesComponent) },
      // ── L'accueil et le laboratoire, dans l'interface de l'administrateur ──
      // Les ecrans du metier, sans changer d'interface : leurs liens restent
      // ici grace a la racine fournie (core/navigation/racines.ts). L'API leur
      // retire toute valeur d'analyse et refuse les actes de soin.
      {
        path: 'accueil',
        providers: [{ provide: RACINE_ACCUEIL, useValue: '/admin-structure/accueil' }],
        children: [
          { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
          { path: 'tableau-de-bord', loadComponent: () => import('../hopital/tableau-de-bord/tableau-de-bord.component').then(m => m.TableauDeBordComponent) },
          { path: 'admission', loadComponent: () => import('../hopital/admission/admission.component').then(m => m.AdmissionComponent) },
          { path: 'demandes', loadComponent: () => import('../hopital/demandes/demandes.component').then(m => m.DemandesComponent) },
          { path: 'presences', loadComponent: () => import('../hopital/presences/presences.component').then(m => m.PresencesComponent) },
          { path: 'episodes', loadComponent: () => import('../hopital/episodes/episodes.component').then(m => m.EpisodesComponent) },
          { path: 'episodes/:id', loadComponent: () => import('../hopital/episode-detail/episode-detail.component').then(m => m.EpisodeDetailComponent) },
        ],
      },
      {
        path: 'laboratoire',
        providers: [{ provide: RACINE_LABO, useValue: '/admin-structure/laboratoire' }],
        children: [
          { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
          { path: 'tableau-de-bord', loadComponent: () => import('../laboratoire/tableau-de-bord/tableau-de-bord.component').then(m => m.LaboTableauDeBordComponent) },
          { path: 'plateau-technique', loadComponent: () => import('../laboratoire/plateau/plateau.component').then(m => m.LaboPlateauComponent) },
          { path: 'demandes', loadComponent: () => import('../laboratoire/demandes/demandes.component').then(m => m.LaboDemandesComponent) },
          { path: 'demandes/:id', loadComponent: () => import('../laboratoire/demande-detail/demande-detail.component').then(m => m.LaboDemandeDetailComponent) },
        ],
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard.component').then(m => m.AdminStructureDashboardComponent)
      },
      {
        path: 'agents',
        loadComponent: () =>
          import('./agents/agents.component').then(m => m.AgentsComponent)
      },
      {
        path: 'pharmacies',
        loadComponent: () =>
          import('./pharmacies/pharmacies.component').then(m => m.PharmaciesComponent)
      },
      {
        path: 'assurances',
        loadComponent: () =>
          import('./assurances/assurances.component').then(m => m.AssurancesComponent)
      },
      // Le dossier reglementaire de son propre etablissement : completer un
      // dossier ancien, et **remplacer un agrement renouvele**.
      {
        path: 'dossier',
        loadComponent: () =>
          import('./dossier/dossier.component').then(m => m.AdminStructureDossierComponent)
      },
      // Le carnet d'adresses : les laboratoires conseilles aux medecins de
      // l'etablissement. Ce n'est pas un contrat, seulement un ordre de liste.
      {
        path: 'conseillees',
        loadComponent: () =>
          import('./conseillees/conseillees.component').then(m => m.ConseilleesComponent)
      },
      // L'ecran des identites, partage avec l'accueil (EF-01-04/05/06).
      //
      // **C'est ici que vit la fusion de dossiers**, reservee a ce role : un
      // agent d'accueil verifie des pieces, melanger deux dossiers medicaux
      // n'est pas son geste. L'ecran etait routable depuis `/hopital`
      // seulement, donc inatteignable par le seul role qui a le droit de
      // fusionner — la fonction aurait ete livree inutilisable.
      {
        path: 'identites',
        loadComponent: () =>
          import('../hopital/identites/identites.component').then(m => m.IdentitesComponent)
      },
      {
        path: 'apparence',
        loadComponent: () =>
          import('../../shared/components/apparence-structure/apparence-structure.component').then(m => m.ApparenceStructureComponent)
      }
    ]
  }
];
