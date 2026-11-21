import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import type { StatsStructureView } from '@baobaoheath/shared-types';

@Component({
  selector: 'app-admin-structure-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, TranslatePipe],
  // Classes partagees (styles/_hopital.scss) : en-tete, compteurs, carte.
  template: `
<header class="bb-page-head">
  <div class="bb-page-head__text">
    <span class="bb-page-head__tag"><i class="pi pi-building" aria-hidden="true"></i> {{ 'ADMIN_STRUCTURE.ROLE' | translate }}</span>
    <!-- La structure vient d'un findUnique : le contrat en garde la
         nullabilite, l'alias evite de la supposer presente partout. -->
    @if (stats()?.structure; as structure) {
      <h1 class="bb-page-head__title">{{ structure.nom }}</h1>
      <p class="bb-page-head__sub">{{ structure.prefecture }} · {{ 'ADMIN.STRUCTURES.TYPE_' + structure.type | translate }}</p>
    } @else {
      <div class="bb-skeleton" style="width:300px;height:32px"></div>
    }
  </div>
  <div class="bb-page-head__actions">
    <a matButton="filled" routerLink="../agents"><i class="pi pi-users" aria-hidden="true"></i> {{ 'ADMIN_STRUCTURE.DASHBOARD.MANAGE_LINK' | translate }}</a>
    @if (estHospital()) {
      <a matButton="outlined" routerLink="../pharmacies"><i class="pi pi-plus" aria-hidden="true"></i> {{ 'ADMIN_STRUCTURE.PHARMACIES.MANAGE_LINK' | translate }}</a>
    }
  </div>
</header>

<div class="bb-stats">
  <a class="bb-stat bb-stat--primary bb-stat--link" routerLink="../agents">
    <span class="bb-stat__icon"><i class="pi pi-users"></i></span>
    <div><div class="bb-stat__value">{{ stats()?.totalAgents ?? 0 }}</div><div class="bb-stat__label">{{ 'ADMIN_STRUCTURE.DASHBOARD.ACTIVE_AGENTS' | translate }}</div></div>
  </a>
  <div class="bb-stat">
    <span class="bb-stat__icon"><i class="pi pi-heart-fill"></i></span>
    <div><div class="bb-stat__value">{{ stats()?.totalConsultations ?? 0 }}</div><div class="bb-stat__label">{{ 'ADMIN_STRUCTURE.DASHBOARD.CONSULTATIONS' | translate }}</div></div>
  </div>
  <div class="bb-stat bb-stat--info">
    <span class="bb-stat__icon"><i class="pi pi-user"></i></span>
    <div><div class="bb-stat__value">{{ stats()?.totalPatients ?? 0 }}</div><div class="bb-stat__label">{{ 'ADMIN_STRUCTURE.DASHBOARD.PATIENTS_LINKED' | translate }}</div></div>
  </div>
</div>`
})
export class AdminStructureDashboardComponent implements OnInit {
  private api = inject(ApiService);
  stats = signal<StatsStructureView | null>(null);
  estHospital(): boolean {
    return ['HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'].includes(this.stats()?.structure?.type ?? '');
  }
  ngOnInit() {
    this.api.get<{ data?: StatsStructureView }>('/admin-structure/stats').subscribe({
      next: r => this.stats.set(r?.data ?? null),
      error: () => {}
    });
  }
}
