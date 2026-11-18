import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AdminService } from '../../../core/services/admin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import type { CreationPharmacieView, StructureAdminView } from '@baobaoheath/shared-types';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';
import { GeographieService } from '../../../core/services/geographie.service';

@Component({
  selector: 'app-admin-structure-pharmacies',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, TranslatePipe, SuggestionsLieuxComponent],
  styleUrl: './pharmacies.component.scss',
  template: `
    <header class="bb-page-head">
      <div class="bb-page-head__text">
        <span class="bb-page-head__tag"><i class="pi pi-building" aria-hidden="true"></i> {{ 'ADMIN_STRUCTURE.ROLE' | translate }}</span>
        <h1 class="bb-page-head__title">{{ 'ADMIN_STRUCTURE.PHARMACIES.TITLE' | translate }}</h1>
        <p class="bb-page-head__sub">{{ 'ADMIN_STRUCTURE.PHARMACIES.SUBTITLE' | translate }}</p>
      </div>
      <div class="bb-page-head__actions">
        <button class="bb-agents__add-btn" type="button" (click)="showForm.update(v => !v)">
          <i class="pi pi-plus" aria-hidden="true"></i> {{ 'ADMIN_STRUCTURE.PHARMACIES.ADD_BTN' | translate }}
        </button>
      </div>
    </header>

    @if (error()) { <div class="bb-agents__alert bb-agents__alert--error" role="alert">{{ error() }}</div> }
    @if (created()) {
      <section class="bb-agents__form" role="status">
        <h2>{{ 'ADMIN_STRUCTURE.PHARMACIES.CREATED' | translate }} — {{ created()!.structure.nom }}</h2>
        @if (created()!.motDePasseTemporaire) {
          <p>{{ 'ADMIN_STRUCTURE.PHARMACIES.TEMP_PASSWORD' | translate }}: <strong>{{ created()!.motDePasseTemporaire }}</strong></p>
        }
        <button class="bb-agents__cancel-btn" type="button" (click)="created.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
      </section>
    }
    @if (showForm()) {
      <section class="bb-agents__form">
        <h2 class="bb-agents__form-title">{{ 'ADMIN_STRUCTURE.PHARMACIES.FORM_TITLE' | translate }}</h2>
        <div class="bb-agents__form-grid">
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.NAME' | translate }}</mat-label><input matInput [(ngModel)]="form.nom" required /></mat-form-field>
          <!-- R9 : les zones du referentiel sont proposees ; le texte libre reste accepte. -->
          <mat-form-field appearance="outline"><mat-label>{{ geo.libelle('elargissement') }}</mat-label><input matInput id="pharmacie-prefecture" [(ngModel)]="form.prefecture" required maxlength="80" autocomplete="off" list="pharmacie-liste-zones" /></mat-form-field>
          <app-suggestions-lieux idListe="pharmacie-liste-zones" role="elargissement" />
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADDRESS' | translate }}</mat-label><input matInput [(ngModel)]="form.adresse" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.PHONE' | translate }}</mat-label><input matInput [(ngModel)]="form.telephone" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_FIRST_NAME' | translate }}</mat-label><input matInput [(ngModel)]="form.prenom" required /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_LAST_NAME' | translate }}</mat-label><input matInput [(ngModel)]="form.nomPharmacien" required /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_PHONE' | translate }}</mat-label><input matInput [(ngModel)]="form.telephonePharmacien" required /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_EMAIL' | translate }}</mat-label><input matInput type="email" [(ngModel)]="form.email" /></mat-form-field>
        </div>
        <div class="bb-agents__form-actions">
          <button class="bb-agents__cancel-btn" type="button" (click)="showForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
          <button class="bb-agents__save-btn" type="button" [disabled]="saving()" (click)="create()">
            {{ (saving() ? 'ADMIN_STRUCTURE.PHARMACIES.CREATING' : 'ADMIN_STRUCTURE.PHARMACIES.CREATE_BTN') | translate }}
          </button>
        </div>
      </section>
    }
    @if (loading()) {
      @for (i of [1,2,3]; track i) { <div class="bb-skeleton" style="height:72px;border-radius:8px"></div> }
    } @else if (pharmacies().length === 0) {
      <div class="bb-agents__empty"><i class="pi pi-building" aria-hidden="true"></i><p>{{ 'ADMIN_STRUCTURE.PHARMACIES.EMPTY' | translate }}</p></div>
    } @else {
      <div class="bb-agents__list">
        @for (pharmacy of pharmacies(); track pharmacy.id) {
          <article class="bb-agents__item">
            <div class="bb-agents__avatar" aria-hidden="true"><i class="pi pi-building"></i></div>
            <div class="bb-agents__info"><h2 class="bb-agents__name">{{ pharmacy.nom }}</h2><p class="bb-agents__contact">{{ pharmacy.prefecture }}@if (pharmacy.telephone) { · {{ pharmacy.telephone }} }</p></div>
            <span class="bb-badge bb-badge--info">{{ pharmacy.estActive ? ('ADMIN_STRUCTURE.PHARMACIES.ACTIVE' | translate) : ('ADMIN_STRUCTURE.PHARMACIES.INACTIVE' | translate) }}</span>
          </article>
        }
      </div>
    }
  `,
})
export class PharmaciesComponent implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly i18n = inject(I18nService);
  /** R9 : le nom du niveau (« Prefecture », « LGA »...) et ses lieux viennent du pays installe. */
  readonly geo = inject(GeographieService);
  pharmacies = signal<StructureAdminView[]>([]);
  loading = signal(true);
  saving = signal(false);
  showForm = signal(false);
  error = signal('');
  created = signal<CreationPharmacieView | null>(null);
  form = { nom: '', prefecture: '', adresse: '', telephone: '', prenom: '', nomPharmacien: '', telephonePharmacien: '', email: '' };

  ngOnInit(): void {
    this.admin.getPharmaciesHospitalieres().subscribe({
      next: response => { this.pharmacies.set(response.data ?? []); this.loading.set(false); },
      error: err => { this.error.set(err?.error?.error ?? this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.LOAD_ERROR')); this.loading.set(false); },
    });
  }

  create(): void {
    this.error.set('');
    const { nom, prefecture, prenom, nomPharmacien, telephonePharmacien } = this.form;
    if (![nom, prefecture, prenom, nomPharmacien, telephonePharmacien].every(value => value.trim())) {
      this.error.set(this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.REQUIRED_ERROR'));
      return;
    }
    this.saving.set(true);
    this.admin.creerPharmacieHospitaliere({
      nom: nom.trim(),
      prefecture: prefecture.trim(),
      adresse: this.form.adresse.trim() || undefined,
      telephone: this.form.telephone.trim() || undefined,
      pharmacien: {
        prenom: prenom.trim(),
        nom: nomPharmacien.trim(),
        telephone: telephonePharmacien.trim(),
        email: this.form.email.trim() || undefined,
      },
    }).subscribe({
      next: response => {
        const data = response.data;
        if (!data) {
          this.error.set(this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.CREATE_ERROR'));
          this.saving.set(false);
          return;
        }
        this.created.set(data);
        this.pharmacies.update(current => [data.structure, ...current]);
        this.form = { nom: '', prefecture: '', adresse: '', telephone: '', prenom: '', nomPharmacien: '', telephonePharmacien: '', email: '' };
        this.showForm.set(false);
        this.saving.set(false);
      },
      error: err => {
        this.error.set(err?.error?.error ?? this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.CREATE_ERROR'));
        this.saving.set(false);
      },
    });
  }
}
