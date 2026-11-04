// features/asc/consultations/consultations.component.ts
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AscService } from '../../../core/services/asc.service';
import { AuthService } from '../../../core/services/auth.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { Consultation } from '../../../core/models/asc.model';
import { Patient } from '../../../core/models/patient.model';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';

@Component({
  selector: 'app-consultations',
  standalone: true,
  imports: [ListeRechercheComponent, 
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    TranslatePipe,
  ExportListeComponent],
  templateUrl: './consultations.component.html',
  styleUrl: './consultations.component.scss'
})
export class ConsultationsComponent implements OnInit {
  /** Les patients : on cherche par nom ou par telephone. */
  readonly optionsPatients = computed<OptionListe[]>(() =>
    this.patients().map((p) => ({
      valeur: p.id,
      libelle: `${p.utilisateur?.prenom ?? ''} ${p.utilisateur?.nom ?? ''}`.trim(),
      detail: p.utilisateur?.telephone ?? undefined,
    })));

  private ascService = inject(AscService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  currentUser = this.authService.currentUser;
  consultations = signal<Consultation[]>([]);

  /** Ce que l'agent a fait sur le terrain, et chez qui. */
  readonly colonnes: ColonneExport<Consultation>[] = [
    { titre: 'EXPORT.COL.PATIENT', valeur: (c) => {
        const p = c.patient;
        if (!p) return '';
        return p.utilisateur ? p.utilisateur.prenom + ' ' + p.utilisateur.nom
                             : ((p.prenom ?? '') + ' ' + (p.nom ?? '')).trim();
      } },
    { titre: 'EXPORT.COL.MOTIF', valeur: (c) => c.motif },
    { titre: 'EXPORT.COL.STATUT', valeur: (c) => c.statut },
    { titre: 'EXPORT.COL.MEDECIN', valeur: (c) => (c.medecin?.utilisateur
        ? c.medecin.utilisateur.prenom + ' ' + c.medecin.utilisateur.nom : '') },
  ];
  patients = signal<Patient[]>([]);
  isLoading = signal(true);
  showNewForm = signal(false);
  isSaving = signal(false);
  successMessage = signal('');
  errorMessage = signal('');
  totalConsultations = signal(0);
  enCours = signal(0);
  terminees = signal(0);
  filtreStatut = signal('TOUS');

  statuts = ['TOUS', 'PLANIFIEE', 'EN_COURS', 'TERMINEE', 'ANNULEE'];

  statutOptions = this.statuts.map(s => ({
    label: s === 'TOUS' ? 'Tous' : this.getStatutLabel(s),
    value: s
  }));

  newConsultation = { patientId: '', motif: '' };

  ngOnInit() { this.loadConsultations(); this.loadPatients(); }

  private loadConsultations() {
    this.isLoading.set(true);
    this.ascService.getHistoriqueConsultations(1, 100).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const data = response.data ?? [];
          this.consultations.set(data);
          this.totalConsultations.set(data.length);
          this.enCours.set(data.filter((c: Consultation) => c.statut === 'EN_COURS').length);
          this.terminees.set(data.filter((c: Consultation) => c.statut === 'TERMINEE').length);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });
  }

  private loadPatients() {
    this.ascService.searchPatients('').subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.patients.set(response.data);
        }
      },
      error: () => { }
    });
  }

  /**
   * La liste telle qu'elle est affichee, filtre applique.
   *
   * `computed` et non un accesseur : l'accesseur refabriquait le tableau a
   * chaque cycle de detection, donc l'entree de `<app-export-liste>`
   * changeait d'identite sans arret.
   */
  readonly consultationsFiltrees = computed<Consultation[]>(() => {
    const f = this.filtreStatut();
    return f === 'TOUS' ? this.consultations() : this.consultations().filter(c => c.statut === f);
  });

  // ── Navigation vers le détail ─────────────────────────────
  voirDetail(consultation: Consultation) {
    this.router.navigate(['/asc/consultations', consultation.id]);
  }

  getMotif(c: Consultation & { motifPrincipal?: string }): string {
    return c.motifPrincipal ?? c.motif ?? '—';
  }

  openNewForm() { this.showNewForm.set(true); this.newConsultation = { patientId: '', motif: '' }; this.errorMessage.set(''); }
  closeNewForm() { this.showNewForm.set(false); this.errorMessage.set(''); }

  createConsultation() {
    if (!this.newConsultation.patientId) { this.errorMessage.set(this.i18n.t('ASC.CONSULTATIONS.ERR_PATIENT')); return; }
    this.isSaving.set(true); this.errorMessage.set('');
    
    this.ascService.saveConsultation({
      idPatient: this.newConsultation.patientId,
      motifPrincipal: this.newConsultation.motif,
      symptomes: [] // Require symptoms to be captured in the detail view or logic later
    }).subscribe({
      next: (resultat) => {
        this.isSaving.set(false); this.showNewForm.set(false);

        if (!resultat.synchronise) {
          // Hors connexion : la saisie est conservée localement. Pas de
          // navigation vers le détail, la consultation n'a pas encore d'id
          // serveur.
          this.successMessage.set(this.i18n.t('ASC.CONSULTATIONS.SUCCESS_QUEUED'));
          setTimeout(() => this.successMessage.set(''), 5000);
          return;
        }

        this.successMessage.set(this.i18n.t('ASC.CONSULTATIONS.SUCCESS_CREATE'));
        setTimeout(() => this.successMessage.set(''), 3000);
        // Naviguer directement vers le détail de la nouvelle consultation
        const id = resultat.data?.data?.id;
        if (id) {
          this.router.navigate(['/asc/consultations', id]);
        } else {
          this.loadConsultations();
        }
      },
      error: (err) => { this.isSaving.set(false); this.errorMessage.set(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.CONSULTATIONS.ERR_CREATE')); }
    });
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Variante de badge correspondant au statut d'une consultation. */
  getStatutVariante(statut: string): string {
    const map: Record<string, string> = {
      'EN_COURS': 'warning', 'TERMINEE': 'success', 'PLANIFIEE': 'info',
      'ANNULEE': 'danger', 'REFERENCEE': 'neutral'
    };
    return map[statut] ?? 'neutral';
  }

  getStatutSeverity(statut: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
      'EN_COURS': 'warn', 'TERMINEE': 'success', 'PLANIFIEE': 'info', 'ANNULEE': 'danger', 'REFERENCEE': 'secondary'
    };
    return map[statut] ?? 'secondary';
  }

  getStatutLabel(statut: string): string {
    const map: Record<string, string> = {
      'EN_COURS': 'En cours', 'TERMINEE': 'Terminée', 'PLANIFIEE': 'Planifiée', 'ANNULEE': 'Annulée', 'REFERENCEE': 'Référencée'
    };
    return map[statut] ?? statut;
  }

  getPatientInitiales(c: Consultation): string {
    const u = c.patient;
    if (!u) return '??';
    return `${u.utilisateur?.prenom?.charAt(0) ?? u.prenom?.charAt(0) ?? ''}${u.utilisateur?.nom?.charAt(0) ?? u.nom?.charAt(0) ?? ''}`.toUpperCase();
  }
}
