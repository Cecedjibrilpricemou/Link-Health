import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AdminService } from '../../../core/services/admin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import type { DemandePharmacieView, StatutDemandeAgrement, StructureAdminView } from '@baobaoheath/shared-types';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';
import { GeographieService } from '../../../core/services/geographie.service';

/** La couleur de chaque etat, celle des badges du reste de l'application. */
const BADGE: Record<StatutDemandeAgrement, string> = {
  RECUE: 'bb-badge--info',
  EN_ANALYSE: 'bb-badge--warning',
  VALIDEE: 'bb-badge--success',
  REFUSEE: 'bb-badge--danger',
};

const FORMULAIRE_VIDE = { nom: '', prefecture: '', adresse: '', telephone: '', prenom: '', nomPharmacien: '', telephonePharmacien: '', email: '' };

/**
 * Les pharmacies de l'hopital.
 *
 * **L'administrateur ne les cree plus : il les demande.** La demande part a
 * l'administration de la plateforme, qui la met en analyse, la valide ou la
 * refuse, toujours avec un motif ; l'administrateur le recoit par courriel et
 * le lit ici. C'est la validation qui fait naitre la pharmacie et le compte
 * de son titulaire, lequel recoit seul ses identifiants : aucun mot de passe
 * ne passe plus par cet ecran.
 */
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
    @if (envoyee()) {
      <section class="bb-agents__form bb-pharma__envoyee" role="status">
        <h2>{{ 'ADMIN_STRUCTURE.PHARMACIES.SENT' | translate: { numero: envoyee()! } }}</h2>
        <p>{{ 'ADMIN_STRUCTURE.PHARMACIES.SENT_HINT' | translate }}</p>
        <button class="bb-agents__cancel-btn" type="button" (click)="envoyee.set(null)">{{ 'COMMON.CLOSE' | translate }}</button>
      </section>
    }
    @if (showForm()) {
      <section class="bb-agents__form">
        <h2 class="bb-agents__form-title">{{ 'ADMIN_STRUCTURE.PHARMACIES.FORM_TITLE' | translate }}</h2>
        <div class="bb-agents__form-grid">
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.NAME' | translate }}</mat-label><input matInput id="pharmacie-nom" [(ngModel)]="form.nom" required /></mat-form-field>
          <!-- R9 : les zones du referentiel sont proposees ; le texte libre reste accepte. -->
          <mat-form-field appearance="outline"><mat-label>{{ geo.libelle('elargissement') }}</mat-label><input matInput id="pharmacie-prefecture" [(ngModel)]="form.prefecture" required maxlength="80" autocomplete="off" list="pharmacie-liste-zones" /></mat-form-field>
          <app-suggestions-lieux idListe="pharmacie-liste-zones" role="elargissement" />
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADDRESS' | translate }}</mat-label><input matInput [(ngModel)]="form.adresse" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.PHONE' | translate }}</mat-label><input matInput [(ngModel)]="form.telephone" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_FIRST_NAME' | translate }}</mat-label><input matInput id="pharmacie-prenom" [(ngModel)]="form.prenom" required /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_LAST_NAME' | translate }}</mat-label><input matInput id="pharmacie-nom-titulaire" [(ngModel)]="form.nomPharmacien" required /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_PHONE' | translate }}</mat-label><input matInput id="pharmacie-tel-titulaire" [(ngModel)]="form.telephonePharmacien" required /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'ADMIN_STRUCTURE.PHARMACIES.ADMIN_EMAIL' | translate }}</mat-label><input matInput id="pharmacie-email-titulaire" type="email" [(ngModel)]="form.email" required /></mat-form-field>
        </div>
        <div class="bb-agents__form-actions">
          <button class="bb-agents__cancel-btn" type="button" (click)="showForm.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
          <button class="bb-agents__save-btn" type="button" [disabled]="saving()" (click)="create()">
            {{ (saving() ? 'ADMIN_STRUCTURE.PHARMACIES.CREATING' : 'ADMIN_STRUCTURE.PHARMACIES.CREATE_BTN') | translate }}
          </button>
        </div>
      </section>
    }

    @if (demandes().length) {
      <h2 class="bb-pharma__section">{{ 'ADMIN_STRUCTURE.PHARMACIES.DEMANDES_TITLE' | translate }}</h2>
      <div class="bb-agents__list">
        @for (d of demandes(); track d.id) {
          <article class="bb-agents__item bb-pharma__demande" [attr.data-numero]="d.numero">
            <div class="bb-agents__avatar" aria-hidden="true"><i class="pi pi-file"></i></div>
            <div class="bb-agents__info">
              <h3 class="bb-agents__name">{{ d.nom }}</h3>
              <p class="bb-agents__contact">{{ d.numero }} · {{ 'ADMIN_STRUCTURE.PHARMACIES.TITULAIRE' | translate: { nom: d.titulaire } }} · {{ d.deposeLe | date: 'dd/MM/yyyy' }}</p>
              @if (d.dernierMotif) {
                <p class="bb-pharma__motif"><strong>{{ 'ADMIN_STRUCTURE.PHARMACIES.MOTIF' | translate }}</strong> {{ d.dernierMotif }}</p>
              }
            </div>
            <span class="bb-badge bb-pharma__statut" [ngClass]="badge(d.statut)">{{ ('ADMIN.AGREMENT_REQUESTS.STATE_' + d.statut) | translate }}</span>
          </article>
        }
      </div>
      <h2 class="bb-pharma__section">{{ 'ADMIN_STRUCTURE.PHARMACIES.OUVERTES_TITLE' | translate }}</h2>
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
  demandes = signal<DemandePharmacieView[]>([]);
  loading = signal(true);
  saving = signal(false);
  showForm = signal(false);
  error = signal('');
  /** Le numero de la demande qui vient de partir. */
  envoyee = signal<string | null>(null);
  form = { ...FORMULAIRE_VIDE };

  ngOnInit(): void {
    this.admin.getPharmaciesHospitalieres().subscribe({
      next: response => { this.pharmacies.set(response.data ?? []); this.loading.set(false); },
      error: err => { this.error.set(err?.error?.error ?? this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.LOAD_ERROR')); this.loading.set(false); },
    });
    this.chargerDemandes();
  }

  badge(statut: StatutDemandeAgrement): string {
    return BADGE[statut] ?? 'bb-badge--neutral';
  }

  private chargerDemandes(): void {
    this.admin.getDemandesPharmacie().subscribe({
      next: response => this.demandes.set(response.data ?? []),
      // Le suivi n'empeche pas de voir les pharmacies ouvertes : son echec se tait.
      error: () => this.demandes.set([]),
    });
  }

  create(): void {
    this.error.set('');
    const { nom, prefecture, prenom, nomPharmacien, telephonePharmacien, email } = this.form;
    if (![nom, prefecture, prenom, nomPharmacien, telephonePharmacien, email].every(value => value.trim())) {
      this.error.set(this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.REQUIRED_ERROR'));
      return;
    }
    this.saving.set(true);
    this.admin.demanderPharmacieHospitaliere({
      nom: nom.trim(),
      prefecture: prefecture.trim(),
      ...(this.form.adresse.trim() ? { adresse: this.form.adresse.trim() } : {}),
      ...(this.form.telephone.trim() ? { telephone: this.form.telephone.trim() } : {}),
      pharmacien: {
        prenom: prenom.trim(),
        nom: nomPharmacien.trim(),
        telephone: telephonePharmacien.trim(),
        email: email.trim(),
      },
    }).subscribe({
      next: response => {
        const data = response.data;
        if (!data) {
          this.error.set(this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.CREATE_ERROR'));
          this.saving.set(false);
          return;
        }
        this.envoyee.set(data.numero);
        this.form = { ...FORMULAIRE_VIDE };
        this.showForm.set(false);
        this.saving.set(false);
        this.chargerDemandes();
      },
      error: err => {
        this.error.set(err?.error?.error ?? this.i18n.t('ADMIN_STRUCTURE.PHARMACIES.CREATE_ERROR'));
        this.saving.set(false);
      },
    });
  }
}
