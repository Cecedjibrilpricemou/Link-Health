// features/medecin/referencements/referencements.component.ts
// Referencements diriges vers la structure du medecin : accepter, ou refuser
// avec un motif. Ferme le circuit ASC -> medecin (le backend et la
// notification "referencement accepte/refuse" existaient sans cette page).
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { HorodatageApi, ReferencementATraiterView, ReferralStatus } from '@baobaoheath/shared-types';
import { MedecinService } from '../../../core/services/medecin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

type Filtre = 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';

@Component({
  selector: 'app-medecin-referencements',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, TranslatePipe],
  templateUrl: './referencements.component.html',
  // Meme squelette liste/detail que la page Consultations : on reutilise sa
  // feuille de style (classes bb-med-cons) et on n'ajoute que le specifique.
  styleUrls: ['../consultations/consultations.component.scss', './referencements.component.scss'],
})
export class MedecinReferencementsComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private medecinService = inject(MedecinService);
  private i18n = inject(I18nService);
  private toastr = inject(ToastrService);

  referencements = signal<ReferencementATraiterView[]>([]);
  selected       = signal<ReferencementATraiterView | null>(null);
  filtre         = signal<Filtre>('EN_ATTENTE');
  isLoading      = signal(true);
  isRepondant    = signal(false);
  total          = signal(0);

  // Formulaire de refus
  refusEnCours = signal(false);
  motifRefus = '';

  readonly filtres: Filtre[] = ['EN_ATTENTE', 'ACCEPTE', 'REFUSE'];

  ngOnInit() { this.charger(); }

  setFiltre(f: Filtre) {
    if (f === this.filtre()) return;
    this.filtre.set(f);
    this.selected.set(null);
    this.charger();
  }

  charger() {
    this.isLoading.set(true);
    this.medecinService.getReferencements(1, 50, this.filtre()).subscribe({
      next: res => {
        this.referencements.set(res.data ?? []);
        this.total.set(res.meta?.total ?? res.data?.length ?? 0);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('MEDECIN.REFERENCEMENTS.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  selectionner(r: ReferencementATraiterView) {
    this.selected.set(r);
    this.refusEnCours.set(false);
    this.motifRefus = '';
  }

  fermerDetail() { this.selected.set(null); }

  accepter() { this.repondre('ACCEPTE'); }

  ouvrirRefus() { this.refusEnCours.set(true); }
  annulerRefus() { this.refusEnCours.set(false); this.motifRefus = ''; }

  confirmerRefus() {
    if (!this.motifRefus.trim()) {
      this.toastr.warning(this.i18n.t('MEDECIN.REFERENCEMENTS.MOTIF_REQUIRED'));
      return;
    }
    this.repondre('REFUSE');
  }

  private repondre(statut: Extract<ReferralStatus, 'ACCEPTE' | 'REFUSE'>) {
    const r = this.selected();
    if (!r || this.isRepondant()) return;
    this.isRepondant.set(true);

    const payload = statut === 'REFUSE'
      ? { statut, motifRefus: this.motifRefus.trim() }
      : { statut };

    this.medecinService.repondreReferencement(r.id, payload).subscribe({
      next: () => {
        this.isRepondant.set(false);
        // Traite : il sort de la liste "en attente" ; on recharge plutot que
        // de deviner, le filtre courant decide de sa presence.
        this.selected.set(null);
        this.toastr.success(
          this.i18n.t(statut === 'ACCEPTE' ? 'MEDECIN.REFERENCEMENTS.SUCCESS_ACCEPT' : 'MEDECIN.REFERENCEMENTS.SUCCESS_REFUSE'),
          this.getPatientNom(r)
        );
        this.charger();
      },
      error: err => {
        this.isRepondant.set(false);
        this.toastr.error(err?.error?.error ?? err?.error?.message ?? this.i18n.t('MEDECIN.REFERENCEMENTS.ERR_RESPOND'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  getPatientNom(r: ReferencementATraiterView): string {
    const u = r.consultation.patient?.utilisateur;
    return u ? `${u.prenom} ${u.nom}` : '—';
  }

  getInitiales(r: ReferencementATraiterView): string {
    const u = r.consultation.patient?.utilisateur;
    if (!u) return '?';
    return `${u.prenom?.charAt(0) ?? ''}${u.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  getAge(r: ReferencementATraiterView): number | null {
    const d = r.consultation.patient?.dateNaissance;
    if (!d) return null;
    const naissance = new Date(d);
    const now = new Date();
    let age = now.getFullYear() - naissance.getFullYear();
    if (now < new Date(now.getFullYear(), naissance.getMonth(), naissance.getDate())) age--;
    return age;
  }

  urgenceClasse(r: ReferencementATraiterView): string {
    return {
      URGENCE_VITALE: 'bb-badge--danger',
      URGENT: 'bb-badge--warning',
      ROUTINE: 'bb-badge--neutral',
    }[r.urgence] ?? 'bb-badge--neutral';
  }

  formatDate(d: HorodatageApi | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
