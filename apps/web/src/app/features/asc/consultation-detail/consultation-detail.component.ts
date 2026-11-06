// features/asc/consultation-detail/consultation-detail.component.ts
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { ListeRechercheComponent, OptionListe, OptionsDePipe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { MedecinService } from '../../../core/services/medecin.service';
import { ConsultationService, VitalsPayload } from '../../../core/services/consultation.service';
import { OrdonnanceService } from '../../../core/services/ordonnance.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import type {
  AlertePrescriptionView,
  ConsultationDetailView,
  ConstantesVitalesView,
  HorodatageApi,
  DiagnosticDetailView,
  SeveriteDiagnostic,
  TypeDiagnostic,
  MedicamentView,
  NiveauInteraction,
  OrdonnanceView,
  ReferencementView,
  StructureView,
} from '@baobaoheath/shared-types';

// ─── Interfaces alignées avec le backend ─────────────────

@Component({
  selector: 'app-consultation-detail',
  standalone: true,
  imports: [OptionsDePipe, 
ListeRechercheComponent,     CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatButtonModule,
    TranslatePipe
  ],
  templateUrl: './consultation-detail.component.html',
  styleUrl: './consultation-detail.component.scss'
})
export class ConsultationDetailComponent implements OnInit {
  private api    = inject(ApiService);
  private consultationService = inject(ConsultationService);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private i18n   = inject(I18nService);
  private ordonnanceService = inject(OrdonnanceService);
  private auth   = inject(AuthService);
  private medecin = inject(MedecinService);

  /**
   * **Cet ecran sert deux roles.** L'ASC l'ouvre depuis sa tournee, le medecin
   * depuis une visite de son hopital : meme acte, memes champs, meme API. Ce
   * qui change tient en quatre points — la source du diagnostic, le retour en
   * arriere, le referencement (reserve a l'ASC) et la facon de terminer.
   */
  readonly estMedecin = computed(() => this.auth.userRole() === 'MEDECIN');

  /** Qui pose le diagnostic : c'est inscrit au dossier, pas cosmetique. */
  private get sourceDiagnostic(): 'MEDECIN' | 'ASC' {
    return this.estMedecin() ? 'MEDECIN' : 'ASC';
  }

  /**
   * Le document est rendu par l'API : on l'ouvre dans un onglet et le
   * navigateur se charge de l'impression, comme pour le bon d'examen.
   */
  imprimerOrdonnance(id: string) {
    window.open(this.ordonnanceService.urlDocument(id), '_blank', 'noopener');
  }

  /** Le compte rendu de la consultation (EF-05-03), meme mecanique. */
  imprimerCompteRendu() {
    const c = this.consultation();
    if (!c) return;
    window.open(this.consultationService.urlCompteRendu(c.id), '_blank', 'noopener');
  }

  consultation    = signal<ConsultationDetailView | null>(null);
  isLoading       = signal(true);
  errorMessage    = signal('');
  successMessage  = signal('');
  activeSection   = signal<'vitals' | 'diagnostics' | 'ordonnances' | 'referral'>('vitals');

  // ── Constantes vitales ──────────────────────────────────
  // Le formulaire est une charge d'ecriture, pas la vue de lecture : l'API
  // renvoie `null` pour une constante non saisie, un champ de saisie attend
  // `undefined`. La conversion se fait au chargement (versFormulaire).
  vitalsForm: VitalsPayload = {};
  isSavingVitals  = signal(false);
  vitalsAlerts    = signal<{ level: 'danger' | 'warn'; message: string }[]>([]);

  onVitalsChange() {
    const v = this.vitalsForm;
    const alerts: { level: 'danger' | 'warn'; message: string }[] = [];

    if (v.spo2 != null) {
      if (v.spo2 < 90)       alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_SPO2_CRITICAL', { v: v.spo2 }) });
      else if (v.spo2 < 95)  alerts.push({ level: 'warn',   message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_SPO2_LOW', { v: v.spo2 }) });
    }
    if (v.temperature != null) {
      if (v.temperature >= 39)         alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HYPERTHERMIA_SEVERE', { v: v.temperature }) });
      else if (v.temperature >= 38)    alerts.push({ level: 'warn',   message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_FEVER', { v: v.temperature }) });
      else if (v.temperature < 36)     alerts.push({ level: 'warn',   message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HYPOTHERMIA', { v: v.temperature }) });
    }
    if (v.tensionSystolique != null) {
      if (v.tensionSystolique >= 180)  alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HTA_SEVERE', { v: v.tensionSystolique }) });
      else if (v.tensionSystolique >= 140) alerts.push({ level: 'warn', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HTA', { v: v.tensionSystolique }) });
      else if (v.tensionSystolique < 90)   alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HYPOTENSION', { v: v.tensionSystolique }) });
    }
    if (v.frequenceCardiaque != null) {
      if (v.frequenceCardiaque > 120)  alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_TACHY_SEVERE', { v: v.frequenceCardiaque }) });
      else if (v.frequenceCardiaque > 100) alerts.push({ level: 'warn', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_TACHY', { v: v.frequenceCardiaque }) });
      else if (v.frequenceCardiaque < 60)  alerts.push({ level: 'warn', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_BRADY', { v: v.frequenceCardiaque }) });
    }
    if (v.frequenceRespiratoire != null) {
      if (v.frequenceRespiratoire > 25)  alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_TACHYPNEA_SEVERE', { v: v.frequenceRespiratoire }) });
      else if (v.frequenceRespiratoire < 12) alerts.push({ level: 'warn', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_BRADYPNEA', { v: v.frequenceRespiratoire }) });
    }
    if (v.glycemie != null) {
      if (v.glycemie < 0.70)   alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HYPOGLYCEMIA', { v: v.glycemie }) });
      else if (v.glycemie > 3.0) alerts.push({ level: 'danger', message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HYPERGLYCEMIA_CRITICAL', { v: v.glycemie }) });
      else if (v.glycemie > 2.0) alerts.push({ level: 'warn',   message: this.i18n.t('ASC.CONSULTATION_DETAIL.ALERT_HYPERGLYCEMIA_HIGH', { v: v.glycemie }) });
    }

    this.vitalsAlerts.set(alerts);
  }

  // ── Diagnostic ──────────────────────────────────────────
  diagnosticForm: {
    libelle: string; codeIcd11: string;
    typeDiagnostic: TypeDiagnostic;
    // `''` tant que rien n'est choisi : la severite est facultative.
    severite: SeveriteDiagnostic | ''; source: 'MEDECIN' | 'ASC';
  } = {
    libelle: '', codeIcd11: '', typeDiagnostic: 'PRINCIPAL', severite: '', source: 'ASC'
  };
  isSavingDiagnostic = signal(false);
  get typesDiagnostic() {
    return [
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.TYPE_PRINCIPAL'), value: 'PRINCIPAL' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.TYPE_SECONDAIRE'), value: 'SECONDAIRE' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.TYPE_DIFFERENTIEL'), value: 'DIFFERENTIEL' }
    ];
  }
  /**
   * **Deux de ces quatre valeurs etaient refusees par le serveur.** Le
   * selecteur envoyait `LEGERE` et `MODEREE`, le schema n'accepte que
   * `LEGER` et `MODERE` : choisir « Legere » ou « Moderee » faisait rejeter
   * tout le diagnostic en 400, pour l'ASC comme pour le medecin. Seules
   * « Severe » et « Critique » passaient. Le contrat est `DiagnosticDetailView`
   * (shared-types), aligne sur le schema.
   */
  get severites(): { label: string; value: SeveriteDiagnostic }[] {
    return [
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.SEVERITE_LEGERE'), value: 'LEGER' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.SEVERITE_MODEREE'), value: 'MODERE' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.SEVERITE_SEVERE'), value: 'SEVERE' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.SEVERITE_CRITIQUE'), value: 'CRITIQUE' }
    ];
  }

  // ── Ordonnance ──────────────────────────────────────────
  ordonnanceForm = {
    idMedicament: '',
    posologie: '',
    frequence: '',
    dureeJours: 7,
    instructions: '',
    // EF-05-09 : porte par l'ordonnance entiere, saisi ici parce que c'est le
    // seul formulaire de prescription.
    renouvellementsAutorises: 0
  };
  medicaments     = signal<MedicamentView[]>([]);
  isSavingOrdonnance = signal(false);

  // ── Securite de prescription (EF-05-05/06) ──────────────
  // Les alertes sont demandees des le choix du medicament, pas a
  // l'enregistrement : savoir apres avoir redige la posologie n'aide personne.
  alertes         = signal<AlertePrescriptionView[]>([]);
  motifRequis     = signal(false);
  isAnalysant     = signal(false);
  motifDepassement = '';

  /** Classe de gravite, pour que l'oeil trie avant la lecture. */
  classeAlerte(niveau: NiveauInteraction): string {
    if (niveau === 'CONTRE_INDICATION') return 'bb-alerte--danger';
    if (niveau === 'ASSOCIATION_DECONSEILLEE') return 'bb-alerte--warning';
    return 'bb-alerte--info';
  }

  iconeAlerte(niveau: NiveauInteraction): string {
    if (niveau === 'CONTRE_INDICATION') return 'pi pi-ban';
    if (niveau === 'ASSOCIATION_DECONSEILLEE') return 'pi pi-exclamation-triangle';
    return 'pi pi-info-circle';
  }

  /** Appele au changement de medicament : on interroge, on n'empeche rien. */
  analyserMedicament() {
    const id = this.consultation()?.id;
    this.alertes.set([]);
    this.motifRequis.set(false);
    this.motifDepassement = '';

    const choisi = this.medicaments().find(m => m.id === this.ordonnanceForm.idMedicament);
    this.medicamentReglemente.set(choisi?.estReglemente === true);
    // Un produit reglemente n'est jamais renouvelable : on remet le champ a
    // zero plutot que de laisser une valeur que l'API refusera en silence.
    if (choisi?.estReglemente) this.ordonnanceForm.renouvellementsAutorises = 0;

    if (!id || !this.ordonnanceForm.idMedicament) return;

    this.isAnalysant.set(true);
    this.consultationService.alertesPrescription(id, this.ordonnanceForm.idMedicament).subscribe({
      next: (res) => {
        this.isAnalysant.set(false);
        this.alertes.set(res.data?.alertes ?? []);
        this.motifRequis.set(res.data?.motifRequis ?? false);
      },
      // Une analyse indisponible ne doit pas empecher de prescrire : on le dit
      // au lieu de laisser croire que le dossier est sans particularite.
      error: () => {
        this.isAnalysant.set(false);
        this.showError(this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_ALERTES'));
      },
    });
  }

  // ── Référencement ────────────────────────────────────────
  referralForm: {
    idStructureCible: string;
    urgence: 'ROUTINE' | 'URGENT' | 'URGENCE_VITALE';
    resumeClinique: string;
  } = { idStructureCible: '', urgence: 'ROUTINE', resumeClinique: '' };
  structures      = signal<StructureView[]>([]);
  isSavingReferral = signal(false);
  // Les deux listes deroulantes lisaient opt.value / opt.label directement sur
  // les objets de l'API, qui ne portent pas ces champs : elles etaient vides,
  // rendant impossibles la prescription et le referencement. On expose la meme
  // forme { value, label } que `urgences` ci-dessous.
  /** Affiche lorsqu'un catalogue (medicaments, structures) n'a pas pu etre charge. */
  erreurCatalogue = signal('');

  /**
   * Un prescripteur choisit par molecule : la DCI doit rester visible, meme
   * quand le libelle porte deja le nom commercial. Elle avait disparu du
   * libelle le 2026-10-01, et la liste ne se cherchait plus par molecule.
   */
  readonly optionsMedicaments = computed<OptionListe[]>(() =>
    this.medicamentOptions().map((o) => ({ valeur: o.value, libelle: o.label })));

  readonly medicamentOptions = computed(() =>
    this.medicaments().map(m => ({
      value: m.id,
      label: this.getMedicamentLabel(m) + (m.forme ? ` · ${m.forme}` : ''),
    }))
  );

  /**
   * EF-05-12 : le medicament choisi releve-t-il d'un circuit reglemente ?
   * L'ecran le signale avant la saisie ; l'API applique la regle de toute
   * facon, le front ne fait que l'annoncer.
   *
   * Un `computed` serait ici un piege : il ne suit que des signaux, et
   * `ordonnanceForm.idMedicament` est une propriete ordinaire liee par
   * ngModel. La valeur resterait figee a son premier calcul. On la pose donc
   * explicitement au changement de medicament.
   */
  medicamentReglemente = signal(false);

  readonly structureOptions = computed(() =>
    this.structures().map(s => ({
      value: s.id,
      label: [s.nom, s.prefecture].filter(Boolean).join(' · '),
    }))
  );

  get urgences() {
    return [
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.URGENCE_ROUTINE'), value: 'ROUTINE' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.URGENCE_URGENT'), value: 'URGENT' },
      { label: this.i18n.t('ASC.CONSULTATION_DETAIL.URGENCE_VITALE'), value: 'URGENCE_VITALE' }
    ];
  }

  // ── Clôture ──────────────────────────────────────────────
  isClosing           = signal(false);
  showCloseConfirm    = signal(false);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadConsultation(id);
      this.loadMedicaments();
      this.loadStructures();
    }
  }

  private loadConsultation(id: string) {
    this.isLoading.set(true);
    this.consultationService.getConsultationById(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const data = response.data as unknown as ConsultationDetailView;
          this.consultation.set(data);
          // Pré-remplir le formulaire vitaux si déjà saisis
          if (data.constantes) {
            this.vitalsForm = this.versFormulaire(data.constantes);
            this.onVitalsChange();
          }
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_LOAD'));
        this.isLoading.set(false);
      }
    });
  }

  private loadMedicaments() {
    this.api.get<{ data?: unknown[]; success?: boolean } | unknown[]>('/medicaments').subscribe({
      next: (r) => this.medicaments.set((Array.isArray(r) ? r : (r as { data?: unknown[] })?.data ?? []) as MedicamentView[]),
      // Un echec silencieux laissait la liste vide sans rien signaler : les
      // deux appels renvoyaient 404 et la prescription etait impossible.
      error: () => this.erreurCatalogue.set(this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_CATALOGUE'))
    });
  }

  private loadStructures() {
    // Seule route de structures ouverte aux roles soignants.
    this.api.get<{ data?: unknown[]; success?: boolean } | unknown[]>('/admin-structure/structures/publiques').subscribe({
      next: (r) => this.structures.set((Array.isArray(r) ? r : (r as { data?: unknown[] })?.data ?? []) as StructureView[]),
      error: () => this.erreurCatalogue.set(this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_CATALOGUE'))
    });
  }

  // ── Sauvegarder constantes vitales ──────────────────────
  saveVitals() {
    const id = this.consultation()?.id;
    if (!id) return;
    this.isSavingVitals.set(true);
    this.consultationService.saveVitals(id, this.vitalsForm).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const constantes = response.data;
          const c = this.consultation();
          if (c) this.consultation.set({ ...c, constantes });
          this.isSavingVitals.set(false);
          this.showSuccess(this.i18n.t('ASC.CONSULTATION_DETAIL.SUCCESS_VITALS'));
        }
      },
      error: (err) => {
        this.isSavingVitals.set(false);
        this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_SAVE_GENERIC'));
      }
    });
  }

  // ── Ajouter diagnostic ───────────────────────────────────
  saveDiagnostic() {
    const id = this.consultation()?.id;
    if (!id || !this.diagnosticForm.libelle) return;
    this.isSavingDiagnostic.set(true);
    this.consultationService.saveDiagnostic(id, {
      ...this.diagnosticForm,
      severite: (this.diagnosticForm.severite as 'LEGER' | 'MODERE' | 'SEVERE' | 'CRITIQUE') || undefined
    }).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const data = response.data;
          const c = this.consultation();
          if (c) this.consultation.set({ ...c, diagnostics: [...c.diagnostics, data as unknown as DiagnosticDetailView] });
          this.diagnosticForm = {
            libelle: '', codeIcd11: '', typeDiagnostic: 'PRINCIPAL', severite: '',
            source: this.sourceDiagnostic,
          };
          this.isSavingDiagnostic.set(false);
          this.showSuccess(this.i18n.t('ASC.CONSULTATION_DETAIL.SUCCESS_DIAGNOSTIC'));
        }
      },
      error: (err) => {
        this.isSavingDiagnostic.set(false);
        this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_ADD_GENERIC'));
      }
    });
  }

  // ── Ajouter ordonnance ───────────────────────────────────
  saveOrdonnance() {
    const id = this.consultation()?.id;
    if (!id || !this.ordonnanceForm.idMedicament) return;

    // EF-05-06 : l'alerte ne bloque pas la prescription, elle demande
    // seulement de dire pourquoi. Le seuil vient de l'API, jamais d'ici.
    const motif = this.motifDepassement.trim();
    if (this.motifRequis() && motif.length < 5) {
      this.showError(this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_MOTIF_REQUIS'));
      return;
    }

    this.isSavingOrdonnance.set(true);
    const payload = { ...this.ordonnanceForm, ...(motif ? { motifDepassement: motif } : {}) };

    this.consultationService.saveOrdonnance(id, payload).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          // On relit la consultation : la reponse est une *ligne*, pas une
          // ordonnance. L'ajouter telle quelle a la liste des documents
          // afficherait une carte vide jusqu'au prochain chargement.
          this.loadConsultation(id);
          this.ordonnanceForm = { idMedicament: '', posologie: '', frequence: '', dureeJours: 7, instructions: '', renouvellementsAutorises: 0 };
          this.alertes.set([]);
          this.motifRequis.set(false);
          this.motifDepassement = '';
          this.isSavingOrdonnance.set(false);
          this.showSuccess(this.i18n.t('ASC.CONSULTATION_DETAIL.SUCCESS_ORDONNANCE'));
        }
      },
      error: (err) => {
        this.isSavingOrdonnance.set(false);
        this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_ADD_GENERIC'));
      }
    });
  }

  // ── Créer référencement ──────────────────────────────────
  saveReferral() {
    const id = this.consultation()?.id;
    if (!id || !this.referralForm.idStructureCible || !this.referralForm.resumeClinique) return;
    this.isSavingReferral.set(true);
    this.consultationService.saveReferral(id, this.referralForm).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const ref = response.data;
          const c = this.consultation();
          if (c) this.consultation.set({ ...c, referencement: ref as unknown as ReferencementView, statut: 'REFERENCEE' });
          this.isSavingReferral.set(false);
          this.showSuccess(this.i18n.t('ASC.CONSULTATION_DETAIL.SUCCESS_REFERRAL'));
        }
      },
      error: (err) => {
        this.isSavingReferral.set(false);
        this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_REFERRAL'));
      }
    });
  }

  // ── Terminer la consultation ─────────────────────────────
  //
  // **Deux gestes differents pour deux roles.** `POST /consultations/:id/complete`
  // est reserve a l'ASC : il termine son acte et l'envoie a un medecin pour
  // signature. Le medecin, lui, signe directement — et sa consultation
  // n'apparait dans aucune liste « a valider », qui ne retient que les
  // consultations deja terminees. S'il ne pouvait pas signer ici, il ne
  // pourrait signer nulle part et son ordonnance n'atteindrait jamais le
  // comptoir : le scan du pharmacien ignore les consultations en cours.
  closeConsultation() {
    const id = this.consultation()?.id;
    if (!id) return;
    this.isClosing.set(true);
    this.showCloseConfirm.set(false);

    if (this.estMedecin()) {
      this.medecin.validerConsultation(id, {
        idOrdonnances: (this.consultation()?.ordonnances ?? []).map((o) => o.id),
      }).subscribe({
        next: () => {
          const c = this.consultation();
          if (c) this.consultation.set({ ...c, statut: 'TERMINEE' });
          this.isClosing.set(false);
          this.showSuccess(this.i18n.t('ASC.CONSULTATION_DETAIL.SUCCESS_SIGNEE'));
        },
        error: (err) => {
          this.isClosing.set(false);
          this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_CLOSE'));
        }
      });
      return;
    }

    this.consultationService.closeConsultation(id).subscribe({
      next: () => {
        const c = this.consultation();
        if (c) this.consultation.set({ ...c, statut: 'TERMINEE' });
        this.isClosing.set(false);
        this.showSuccess(this.i18n.t('ASC.CONSULTATION_DETAIL.SUCCESS_CLOSE'));
      },
      error: (err) => {
        this.isClosing.set(false);
        this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATION_DETAIL.ERR_CLOSE'));
      }
    });
  }

  // ── Helpers ──────────────────────────────────────────────
  isConsultationTerminee(): boolean {
    return this.consultation()?.statut === 'TERMINEE' || this.consultation()?.statut === 'REFERENCEE';
  }

  /** Variante de badge correspondant au statut d'une consultation. */
  getStatutVariante(statut: string): string {
    const map: Record<string, string> = {
      'TERMINEE': 'success', 'EN_COURS': 'warning',
      'PLANIFIEE': 'info', 'ANNULEE': 'danger', 'REFERENCEE': 'neutral'
    };
    return map[statut] ?? 'neutral';
  }

  /** Variante de badge correspondant au degre d'urgence d'un referencement. */
  getUrgenceVariante(urgence: string): string {
    const map: Record<string, string> = {
      'ROUTINE': 'info', 'URGENT': 'warning', 'URGENCE_VITALE': 'danger'
    };
    return map[urgence] ?? 'info';
  }

  getStatutSeverity(statut: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<string, any> = {
      'TERMINEE': 'success', 'EN_COURS': 'warn',
      'PLANIFIEE': 'info', 'ANNULEE': 'danger', 'REFERENCEE': 'secondary'
    };
    return map[statut] ?? 'secondary';
  }

  getStatutLabel(statut: string): string {
    const known = ['TERMINEE', 'EN_COURS', 'PLANIFIEE', 'ANNULEE', 'REFERENCEE'];
    return known.includes(statut) ? this.i18n.t(`STATUT.${statut}`) : statut;
  }

  getUrgenceSeverity(urgence: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<string, any> = {
      'ROUTINE': 'info', 'URGENT': 'warn', 'URGENCE_VITALE': 'danger'
    };
    return map[urgence] ?? 'info';
  }

  getMedicamentLabel(m: MedicamentView): string {
    return m.dci && !m.libelle.toLowerCase().includes(m.dci.toLowerCase())
      ? `${m.libelle} (${m.dci})`
      : m.libelle;
  }

  getPatientNom(): string {
    const p = this.consultation()?.patient;
    return p?.utilisateur ? `${p.utilisateur.prenom} ${p.utilisateur.nom}` : '—';
  }

  getInitiales(): string {
    const p = this.consultation()?.patient?.utilisateur;
    if (!p) return '?';
    return `${p.prenom?.charAt(0) ?? ''}${p.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  formatDate(d: HorodatageApi | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Convertit les `null` de l'API en `undefined`, attendus par les champs. */
  private versFormulaire(c: ConstantesVitalesView | null | undefined): VitalsPayload {
    if (!c) return {};
    const n = (v: number | null | undefined) => v ?? undefined;
    return {
      temperature: n(c.temperature),
      poidsKg: n(c.poidsKg),
      tailleCm: n(c.tailleCm),
      perimetreBrachial: n(c.perimetreBrachial),
      tensionSystolique: n(c.tensionSystolique),
      tensionDiastolique: n(c.tensionDiastolique),
      frequenceCardiaque: n(c.frequenceCardiaque),
      frequenceRespiratoire: n(c.frequenceRespiratoire),
      spo2: n(c.spo2),
      glycemie: n(c.glycemie),
    };
  }

  private showSuccess(msg: string) {
    this.successMessage.set(msg);
    this.errorMessage.set('');
    setTimeout(() => this.successMessage.set(''), 3000);
  }

  private showError(msg: string) {
    this.errorMessage.set(msg);
    this.successMessage.set('');
    setTimeout(() => this.errorMessage.set(''), 4000);
  }

  goBack() {
    this.router.navigate([this.estMedecin() ? '/medecin/consultations' : '/asc/consultations']);
  }
}
