// app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [

  // ── Landing page (publique) ─────────────────────────────────────────
  {
    path: '',
    loadComponent: () =>
      import('./features/landing/landing.component').then(m => m.LandingComponent)
  },

  // ── Recherche publique de produits (A1) ─────────────────────────────
  {
    path: 'recherche',
    loadComponent: () =>
      import('./features/public/recherche/recherche.component').then(m => m.RechercheComponent)
  },

  // ── Page publique d'une officine (A3) ───────────────────────────────
  {
    path: 'pharmacie/:id',
    loadComponent: () =>
      import('./features/public/pharmacie/pharmacie.component').then(m => m.PharmacieComponent)
  },

  // ── Module Auth ─────────────────────────────────────────────────────
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
  },

  // ── Module Patient ──────────────────────────────────────────────────
  {
    path: 'patient',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PATIENT'] },
    loadChildren: () =>
      import('./features/patient/patient.routes').then(m => m.PATIENT_ROUTES)
  },

  // ── Module ASC ──────────────────────────────────────────────────────
  {
    path: 'asc',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ASC', 'ASC_SUPERVISOR'] },
    loadChildren: () =>
      import('./features/asc/asc.routes').then(m => m.ASC_ROUTES)
  },

  // ── Module Médecin ──────────────────────────────────────────────────
  {
    path: 'medecin',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['MEDECIN'] },
    loadChildren: () =>
      import('./features/medecin/medecin.routes').then(m => m.MEDECIN_ROUTES)
  },

  // ── Module Pharmacien ───────────────────────────────────────────────
  {
    path: 'pharmacien',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['PHARMACIEN'] },
    loadChildren: () =>
      import('./features/pharmacien/pharmacien.routes').then(m => m.PHARMACIEN_ROUTES)
  },

  // ── Module Hopital (accueil, P1) ────────────────────────────────────
  {
    path: 'hopital',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['AGENT_ACCUEIL'] },
    loadChildren: () =>
      import('./features/hopital/hopital.routes').then(m => m.HOPITAL_ROUTES)
  },

  // ── Module Laboratoire (P2, EF-04) ──────────────────────────────────
  {
    path: 'laboratoire',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['TECHNICIEN_LABO'] },
    loadChildren: () =>
      import('./features/laboratoire/laboratoire.routes').then(m => m.LABORATOIRE_ROUTES)
  },

  // ── Module Admin Structure ──────────────────────────────────────────
  {
    path: 'admin-structure',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ADMIN_STRUCTURE'] },
    loadChildren: () =>
      import('./features/admin-structure/admin-structure.routes').then(m => m.ADMIN_STRUCTURE_ROUTES)
  },

  // ── Module Admin ────────────────────────────────────────────────────
  {
    // La compagnie d'assurance se connecte elle-meme (addendum, point 5.2).
    // Elle ne partage son espace avec personne : ni l'administration, qui
    // saisit les assureurs, ni le comptoir, qui chiffre les prises en charge.
    path: 'assureur',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ASSUREUR'] },
    loadChildren: () =>
      import('./features/assureur/assureur.routes').then(m => m.ASSUREUR_ROUTES)
  },
  {
    path: 'livreur',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['LIVREUR'] },
    loadChildren: () =>
      import('./features/livreur/livreur.routes').then(m => m.LIVREUR_ROUTES)
  },
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    loadChildren: () =>
      import('./features/admin/admin.routes').then(m => m.ADMIN_ROUTES)
  },

  // ── Pages publiques d'information (sans authentification) ───────────
  {
    path: 'confidentialite',
    data: { doc: 'PRIVACY' },
    loadComponent: () =>
      import('./features/public/legal/legal.component').then(m => m.LegalComponent)
  },
  {
    path: 'conditions-utilisation',
    data: { doc: 'TERMS' },
    loadComponent: () =>
      import('./features/public/legal/legal.component').then(m => m.LegalComponent)
  },
  {
    path: 'securite',
    loadComponent: () =>
      import('./features/public/securite/securite.component').then(m => m.SecuriteComponent)
  },
  {
    path: 'professionnels',
    loadComponent: () =>
      import('./features/public/professionnels/professionnels.component').then(m => m.ProfessionnelsComponent)
  },
  {
    path: 'a-propos',
    loadComponent: () =>
      import('./features/public/a-propos/a-propos.component').then(m => m.AProposComponent)
  },
  {
    path: 'faq',
    loadComponent: () =>
      import('./features/public/faq/faq.component').then(m => m.FaqComponent)
  },

  // ── Unauthorized ────────────────────────────────────────────────────
  {
    path: 'unauthorized',
    loadComponent: () =>
      import('./shared/components/unauthorized/unauthorized.component')
        .then(m => m.UnauthorizedComponent)
  },

  // ── Page introuvable ────────────────────────────────────────────────
  {
    path: '**',
    loadComponent: () =>
      import('./features/public/not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];
