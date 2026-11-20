// features/patient/acces-dossier — qui peut lire mon historique.
//
// Le médecin qui reçoit le patient voit la visite en cours sans rien demander.
// Au-delà — consultations passées, résultats, vaccinations — c'est le patient
// qui choisit, médecin par médecin, pour une prise en charge. La demande lui
// arrive avec le rendez-vous ; il répond ici, et peut retirer un accord à
// tout moment.
//
// Tous les champs sont des signaux : l'application est zoneless.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import type { AutorisationAccesDossierView } from '@baobaoheath/shared-types';

import { PatientService } from '../../../core/services/patient.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

type Geste = 'accorder' | 'refuser' | 'retirer';

@Component({
  selector: 'app-patient-acces-dossier',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatDialogModule, TranslatePipe],
  templateUrl: './acces-dossier.component.html',
  styleUrl: './acces-dossier.component.scss',
})
export class AccesDossierComponent implements OnInit {
  private patient = inject(PatientService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);
  private dialog = inject(MatDialog);

  autorisations = signal<AutorisationAccesDossierView[]>([]);
  isLoading = signal(true);
  /** L'autorisation en cours d'envoi : ses boutons attendent la réponse. */
  enCours = signal<string | null>(null);

  readonly enAttente = computed(() => this.autorisations().filter((a) => a.statut === 'DEMANDEE'));
  readonly decidees = computed(() => this.autorisations().filter((a) => a.statut !== 'DEMANDEE'));

  ngOnInit() {
    this.charger();
  }

  private charger() {
    this.patient.mesAccesDossier().subscribe({
      next: (r) => { this.autorisations.set(r.data ?? []); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.erreur(err); },
    });
  }

  accorder(a: AutorisationAccesDossierView) { this.envoyer(a, 'accorder', 'PATIENT.ACCES_DOSSIER.ACCORDE_OK'); }
  refuser(a: AutorisationAccesDossierView) { this.envoyer(a, 'refuser', 'PATIENT.ACCES_DOSSIER.REFUSE_OK'); }

  /** Retirer se confirme : l'effet est immédiat, et le médecin le verra. */
  retirer(a: AutorisationAccesDossierView) {
    const data: ConfirmDialogData = {
      titre: this.i18n.t('PATIENT.ACCES_DOSSIER.RETIRER_TITRE'),
      texte: this.i18n.t('PATIENT.ACCES_DOSSIER.RETIRER_TEXTE', { medecin: a.medecin }),
      confirmer: this.i18n.t('PATIENT.ACCES_DOSSIER.RETIRER'),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: 'pi-lock',
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '420px', autoFocus: false })
      .afterClosed().subscribe((ok) => { if (ok) this.envoyer(a, 'retirer', 'PATIENT.ACCES_DOSSIER.RETIRE_OK'); });
  }

  /** Un accord est possible après un refus ou un retrait : on change d'avis. */
  peutAccorder(a: AutorisationAccesDossierView) { return a.statut === 'REFUSEE' || a.statut === 'RETIREE'; }

  private envoyer(a: AutorisationAccesDossierView, geste: Geste, succes: string) {
    if (this.enCours()) return;
    this.enCours.set(a.id);
    this.patient.repondreAccesDossier(a.id, geste).subscribe({
      next: (r) => {
        this.enCours.set(null);
        const vue = r.data;
        if (vue) this.autorisations.update((l) => l.map((x) => (x.id === vue.id ? vue : x)));
        this.toastr.success(this.i18n.t(succes), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.enCours.set(null); this.erreur(err); this.charger(); },
    });
  }

  private erreur(err: unknown) {
    const e = err as { status?: number; error?: { error?: string; message?: string } };
    if (e?.status === 0) {
      this.toastr.error(this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    this.toastr.error(
      e?.error?.error ?? e?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
      this.i18n.t('COMMON.ERROR_TITLE'),
    );
  }
}
