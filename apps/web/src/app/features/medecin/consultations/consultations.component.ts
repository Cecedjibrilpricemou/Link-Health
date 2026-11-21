// features/medecin/consultations/consultations.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MedecinService } from '../../../core/services/medecin.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import type { ConsultationAValiderView, HorodatageApi } from '@baobaoheath/shared-types';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

@Component({
  selector: 'app-medecin-consultations',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, TranslatePipe, ExportListeComponent],
  templateUrl: './consultations.component.html',
  styleUrl: './consultations.component.scss'
})
export class MedecinConsultationsComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private medecinService = inject(MedecinService);
  private i18n = inject(I18nService);

  consultations   = signal<ConsultationAValiderView[]>([]);

  /**
   * Ce que le medecin a sous les yeux, sur une feuille.
   *
   * Le motif y figure : c'est ce qui rend la liste utilisable pour trier sa
   * journee, et le medecin traitant le voit deja a l'ecran. Les diagnostics
   * et les ordonnances n'y sont pas — une liste n'est pas un dossier, et une
   * feuille de tri qui circule n'a pas a porter les traitements.
   */
  readonly colonnes: ColonneExport<ConsultationAValiderView>[] = [
    { titre: 'EXPORT.COL.PATIENT', valeur: (c) => {
        const u = c.patient?.utilisateur;
        return u ? `${u.prenom} ${u.nom}` : '';
      } },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (c) => c.patient?.utilisateur?.telephone },
    { titre: 'EXPORT.COL.MOTIF', valeur: (c) => c.motifPrincipal },
    { titre: 'EXPORT.COL.CONSULTEE_LE', valeur: (c) => new Date(c.consulteeLE) },
    { titre: 'EXPORT.COL.AGENT', valeur: (c) => (c.asc ? `${c.asc.utilisateur.prenom} ${c.asc.utilisateur.nom}` : '') },
    { titre: 'EXPORT.COL.DIAGNOSTICS', valeur: (c) => c.diagnostics.length, nombre: true },
    { titre: 'EXPORT.COL.ORDONNANCES', valeur: (c) => c.ordonnances.length, nombre: true },
    { titre: 'EXPORT.COL.STATUT', valeur: (c) => c.statut },
  ];
  selected        = signal<ConsultationAValiderView | null>(null);
  isLoading       = signal(true);
  isValidating    = signal(false);
  successMessage  = signal('');
  errorMessage    = signal('');
  total           = signal(0);

  // Formulaire validation
  notesMedecin    = '';
  ordonnancesSelectionnees: string[] = [];

  ngOnInit() { this.loadConsultations(); }

  private loadConsultations() {
    this.isLoading.set(true);
    this.medecinService.getConsultations().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const data = response.data as ConsultationAValiderView[];
          this.consultations.set(data);
          this.total.set(response.meta?.total ?? data.length);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });
  }

  selectionner(c: ConsultationAValiderView) {
    this.selected.set(c);
    this.notesMedecin = '';
    this.ordonnancesSelectionnees = [];
    this.errorMessage.set('');
  }

  fermerDetail() { this.selected.set(null); }

  toggleOrdonnance(id: string) {
    const idx = this.ordonnancesSelectionnees.indexOf(id);
    if (idx === -1) this.ordonnancesSelectionnees.push(id);
    else this.ordonnancesSelectionnees.splice(idx, 1);
  }

  isOrdonnanceSelectionnee(id: string): boolean {
    return this.ordonnancesSelectionnees.includes(id);
  }

  valider() {
    const c = this.selected();
    if (!c) return;
    this.isValidating.set(true);
    // On utilise validerConsultation du service
    // **Trois des quatre champs envoyes ici n'existaient pas.** Le schema est
    // `.strict()` : `diagnosticConfirme` et `commentaires` faisaient rejeter
    // tout le corps, et la validation repondait 400 a chaque fois — dans le
    // seul ecran ou le medecin peut signer.
    this.medecinService.validerConsultation(c.id, {
      notesMedecin: this.notesMedecin.trim() || undefined,
      idOrdonnances: this.ordonnancesSelectionnees,
    }).subscribe({
      next: () => {
        this.isValidating.set(false);
        this.selected.set(null);
        this.showSuccess(this.i18n.t('MEDECIN.CONSULTATIONS.SUCCESS_VALIDATE'));
        this.loadConsultations();
      },
      error: (err) => {
        this.isValidating.set(false);
        this.showError(err?.error?.error ?? err?.error?.message ?? this.i18n.t('MEDECIN.CONSULTATIONS.ERR_VALIDATE'));
      }
    });
  }

  getPatientNom(c: ConsultationAValiderView): string {
    const u = c.patient?.utilisateur;
    return u ? `${u.prenom} ${u.nom}` : '—';
  }

  getAscNom(c: ConsultationAValiderView): string {
    const u = c.asc?.utilisateur;
    return u ? `${u.prenom} ${u.nom}` : '—';
  }

  getInitiales(c: ConsultationAValiderView): string {
    const u = c.patient?.utilisateur;
    if (!u) return '?';
    return `${u.prenom?.charAt(0) ?? ''}${u.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  formatDate(d: HorodatageApi): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private showSuccess(msg: string) {
    this.successMessage.set(msg);
    setTimeout(() => this.successMessage.set(''), 3000);
  }

  private showError(msg: string) {
    this.errorMessage.set(msg);
    setTimeout(() => this.errorMessage.set(''), 4000);
  }
}
