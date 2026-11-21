// Les patients en visite dans la structure : qui attend, pour quoi, et quand
// l'infirmier l'a vu pour la derniere fois. Memes cartes que la liste des
// visites de l'accueil.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { PatientEnVisiteView } from '@baobaoheath/shared-types';

import { InfirmierService } from '../../../core/services/infirmier.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-infirmier-patients',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MatFormFieldModule, MatInputModule, TranslatePipe],
  template: `
    <header class="bb-page-head">
      <div class="bb-page-head__text">
        <span class="bb-page-head__tag"><i class="pi pi-heart" aria-hidden="true"></i> {{ 'INFIRMIER.ROLE' | translate }}</span>
        <h1 class="bb-page-head__title">{{ 'INFIRMIER.PATIENTS.TITLE' | translate }}</h1>
        <p class="bb-page-head__sub">{{ 'INFIRMIER.PATIENTS.SUB' | translate: { count: patients().length } }}</p>
      </div>
    </header>

    <div class="bb-hop-toolbar">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" style="flex:1;min-width:220px">
        <i matPrefix class="pi pi-search" style="padding:0 6px 0 14px;color:var(--bb-primary)"></i>
        <input matInput type="search" id="inf-recherche" [placeholder]="'INFIRMIER.PATIENTS.SEARCH_PH' | translate"
               [ngModel]="recherche()" (ngModelChange)="recherche.set($event)" />
      </mat-form-field>
    </div>

    @if (chargement()) {
      <div class="bb-hop-list">@for (i of [1,2,3]; track i) { <div class="bb-skeleton" style="height:84px;border-radius:18px"></div> }</div>
    } @else if (visibles().length === 0) {
      <div class="bb-hop-empty"><i class="pi pi-users"></i><p>{{ 'INFIRMIER.PATIENTS.EMPTY' | translate }}</p><span>{{ 'INFIRMIER.PATIENTS.EMPTY_SUB' | translate }}</span></div>
    } @else {
      <div class="bb-hop-list">
        @for (p of visibles(); track p.idEpisode) {
          <a class="bb-hop-item bb-inf-patient" [routerLink]="['/infirmier/visites', p.idEpisode]">
            <span class="bb-hop-item__avatar" aria-hidden="true">{{ initiales(p) }}</span>
            <div class="bb-hop-item__body">
              <p class="bb-hop-item__title">{{ p.patient.prenom }} {{ p.patient.nom }}</p>
              <p class="bb-hop-item__sub">{{ p.motif }}</p>
              <p class="bb-hop-item__meta">
                <span class="bb-hop-item__num">{{ p.numero }}</span>
                @if (p.service) { <span><i class="pi pi-sitemap"></i>{{ p.service }}</span> }
                @if (p.responsable) { <span><i class="pi pi-user"></i>{{ p.responsable }}</span> }
                <span class="bb-inf-patient__vu">
                  <i class="pi pi-clock"></i>
                  @if (p.dernierSoinLe) {
                    {{ 'INFIRMIER.PATIENTS.VU_A' | translate: { heure: (p.dernierSoinLe | date: 'HH:mm') ?? '' } }}
                  } @else {
                    {{ 'INFIRMIER.PATIENTS.JAMAIS_VU' | translate }}
                  }
                </span>
              </p>
            </div>
            <i class="pi pi-chevron-right" aria-hidden="true"></i>
          </a>
        }
      </div>
    }
  `,
})
export class InfirmierPatientsComponent implements OnInit {
  private readonly service = inject(InfirmierService);

  readonly patients = signal<PatientEnVisiteView[]>([]);
  readonly chargement = signal(true);
  readonly recherche = signal('');

  /** Filtre local : nom, numero de visite, motif ou service. */
  readonly visibles = computed(() => {
    const q = this.recherche().trim().toLocaleLowerCase('fr');
    if (!q) return this.patients();
    return this.patients().filter((p) =>
      [p.patient.prenom, p.patient.nom, p.numero, p.motif, p.service ?? '']
        .some((v) => v.toLocaleLowerCase('fr').includes(q)));
  });

  ngOnInit(): void {
    this.service.patients().subscribe({
      next: (r) => { this.patients.set(r.data ?? []); this.chargement.set(false); },
      error: () => this.chargement.set(false),
    });
  }

  initiales(p: PatientEnVisiteView): string {
    return `${p.patient.prenom.charAt(0)}${p.patient.nom.charAt(0)}`.toUpperCase();
  }
}
