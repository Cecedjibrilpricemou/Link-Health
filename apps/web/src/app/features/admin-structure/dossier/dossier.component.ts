// features/admin-structure/dossier — le dossier réglementaire de son propre
// établissement.
//
// **Il manquait une porte de sortie.** La création d'une structure privée
// exige désormais ses quatre pièces, mais les établissements entrés avant
// cette règle n'en ont aucune, et un agrément se renouvelle. Sans cet écran,
// compléter ou remplacer une pièce passait par la ligne de commande.
//
// L'identifiant de sa propre structure vient de `GET /admin-structure/stats`,
// que le tableau de bord appelle déjà : inutile d'ajouter une route pour une
// information que le serveur donne déjà.
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import type { StatsStructureView } from '@baobaoheath/shared-types';

import { ApiService } from '../../../core/services/api.service';
import { DossierAgrementComponent } from '../../../shared/components/dossier-agrement/dossier-agrement.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-admin-structure-dossier',
  standalone: true,
  imports: [RouterLink, MatButtonModule, DossierAgrementComponent, TranslatePipe],
  template: `
    <header class="bb-page-head">
      <div class="bb-page-head__text">
        <span class="bb-page-head__tag">
          <i class="pi pi-sitemap" aria-hidden="true"></i> {{ 'ADMIN_STRUCTURE.ROLE' | translate }}
        </span>
        <h1 class="bb-page-head__title">{{ 'AGREMENT.DOSSIER.TITRE' | translate }}</h1>
        <p class="bb-page-head__sub">{{ nomStructure() || ('COMMON.LOADING' | translate) }}</p>
      </div>
    </header>

    <section class="bb-card">
      @if (idStructure(); as id) {
        <app-dossier-agrement [idStructure]="id" />
      } @else if (!chargement()) {
        <!-- Le compte n'est rattaché à aucune structure : déposer une pièce
             n'aurait nulle part où la ranger. -->
        <div class="bb-banner bb-banner--offline" role="alert">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <div class="bb-banner__text">
            <span class="bb-banner__title">{{ 'AGREMENT.DOSSIER.SANS_STRUCTURE' | translate }}</span>
          </div>
        </div>
        <a matButton routerLink="../pilotage">{{ 'COMMON.BACK' | translate }}</a>
      } @else {
        <p>{{ 'COMMON.LOADING' | translate }}</p>
      }
    </section>
  `,
})
export class AdminStructureDossierComponent implements OnInit {
  private api = inject(ApiService);

  readonly idStructure = signal<string | null>(null);
  readonly nomStructure = signal('');
  readonly chargement = signal(true);

  ngOnInit() {
    // Le meme appel que le tableau de bord, avec le meme contrat : c'est lui
    // qui porte la structure de l'appelant, inutile d'ajouter une route.
    this.api.get<{ data?: StatsStructureView }>('/admin-structure/stats').subscribe({
      next: (r) => {
        this.chargement.set(false);
        this.idStructure.set(r.data?.structure?.id ?? null);
        this.nomStructure.set(r.data?.structure?.nom ?? '');
      },
      // Silencieux : le bandeau ci-dessus dit déjà ce qui manque, et un toast
      // en plus n'apprendrait rien.
      error: () => this.chargement.set(false),
    });
  }
}
