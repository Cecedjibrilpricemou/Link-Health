// features/pharmacien/dossier — le dossier réglementaire de son officine.
//
// **Le titulaire n'est pas un administrateur de structure.** Depuis qu'une
// demande d'agrément validée lui donne le rôle `PHARMACIEN` et un profil
// d'officine, il travaille dans cet espace-ci : l'envoyer dans l'espace
// d'administration pour redéposer un agrément renouvelé l'aurait mené sur un
// tableau de bord où il n'a rien à faire.
//
// L'écran est le même que celui de l'administrateur à une chose près :
// l'identifiant de sa structure ne vient pas des statistiques de structure,
// qu'il n'a pas, mais d'une route qui ne rend que ce qu'il faut pour ouvrir
// le dossier.
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

import { ApiService } from '../../../core/services/api.service';
import { DossierAgrementComponent } from '../../../shared/components/dossier-agrement/dossier-agrement.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-pharmacien-dossier',
  standalone: true,
  imports: [RouterLink, MatButtonModule, DossierAgrementComponent, TranslatePipe],
  template: `
    <header class="bb-page-head">
      <div class="bb-page-head__text">
        <span class="bb-page-head__tag">
          <i class="pi pi-folder" aria-hidden="true"></i> {{ 'PHARMACIEN.ROLE' | translate }}
        </span>
        <h1 class="bb-page-head__title">{{ 'AGREMENT.DOSSIER.TITRE' | translate }}</h1>
        <p class="bb-page-head__sub">{{ nomStructure() || ('COMMON.LOADING' | translate) }}</p>
      </div>
    </header>

    <section class="bb-card">
      @if (idStructure(); as id) {
        <app-dossier-agrement [idStructure]="id" />
      } @else if (!chargement()) {
        <!-- Un pharmacien qui n'est pas titulaire, ou un compte rattaché à
             aucune officine : déposer une pièce n'aurait nulle part où la
             ranger. -->
        <div class="bb-banner bb-banner--offline" role="alert">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <div class="bb-banner__text">
            <span class="bb-banner__title">{{ 'AGREMENT.DOSSIER.SANS_STRUCTURE' | translate }}</span>
          </div>
        </div>
        <a matButton routerLink="/pharmacien/tableau-de-bord">{{ 'COMMON.BACK' | translate }}</a>
      } @else {
        <p>{{ 'COMMON.LOADING' | translate }}</p>
      }
    </section>
  `,
})
export class PharmacienDossierComponent implements OnInit {
  private api = inject(ApiService);

  readonly idStructure = signal<string | null>(null);
  readonly nomStructure = signal('');
  readonly chargement = signal(true);

  ngOnInit() {
    this.api.get<{ data?: { id: string; nom: string } }>('/admin-structure/mon-dossier/structure').subscribe({
      next: (r) => {
        this.chargement.set(false);
        this.idStructure.set(r.data?.id ?? null);
        this.nomStructure.set(r.data?.nom ?? '');
      },
      // Silencieux : le bandeau ci-dessus dit deja ce qui manque. Un refus du
      // serveur - un adjoint qui force l'URL - aboutit au meme ecran.
      error: () => this.chargement.set(false),
    });
  }
}
