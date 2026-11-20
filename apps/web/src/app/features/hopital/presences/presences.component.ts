// features/hopital/presences — les patients attendus aujourd'hui.
//
// Addendum du 2026-09-28, point 2 : l'assistante pointe l'arrivée, voit avec
// quel médecin le patient a rendez-vous, et le redirige au moment opportun.
//
// C'est son seul geste sur un rendez-vous : elle ne le crée pas et n'en change
// pas l'heure — cela appartient au médecin.
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { PresenceDuJourView } from '@baobaoheath/shared-types';

import { HopitalService } from '../../../core/services/hopital.service';
import { SocketService } from '../../../core/services/socket.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

@Component({
  selector: 'app-hopital-presences',
  standalone: true,
  imports: [DatePipe, MatButtonModule, TranslatePipe, ExportListeComponent],
  templateUrl: './presences.component.html',
  styleUrl: './presences.component.scss',
})
export class PresencesComponent implements OnInit {
  private hopital = inject(HopitalService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);
  private socket = inject(SocketService);
  private destroyRef = inject(DestroyRef);

  presences = signal<PresenceDuJourView[]>([]);
  isLoading = signal(true);
  enCours = signal<string | null>(null);

  /** Ceux qu'on attend encore : c'est là que le geste se fait. */
  readonly attendus = computed(() => this.presences().filter((p) => p.statut === 'PLANIFIE'));

  /** Déjà là — on les garde à l'écran pour savoir qui patiente. */
  readonly arrives = computed(() =>
    this.presences().filter((p) => p.statut !== 'PLANIFIE')
  );

  /** Les colonnes du document imprime **et** du fichier : les memes.
   * C'est ce qui empeche la feuille et le tableur de se contredire. */
  /** La date du jour, pour situer le document : un gabarit ne sait pas
   * construire une date. */
  /** La date du jour, dans la langue choisie : le document la porte. */
  leJour(): string {
    return new Date().toLocaleDateString(this.i18n.lang() === 'en' ? 'en-GB' : 'fr-FR');
  }

  readonly colonnes: ColonneExport<PresenceDuJourView>[] = [
    { titre: 'EXPORT.COL.PATIENT', valeur: (p) => `${p.patient.prenom} ${p.patient.nom}` },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (p) => p.patient.telephone },
    { titre: 'EXPORT.COL.HEURE_PREVUE', valeur: (p) => new Date(p.prevuLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) },
    { titre: 'EXPORT.COL.MEDECIN', valeur: (p) => (p.medecin ? `${p.medecin.prenom} ${p.medecin.nom}` : null) },
    // Le bureau est facultatif : beaucoup d'hopitaux ne les numerotent pas.
    { titre: 'EXPORT.COL.BUREAU', valeur: (p) => p.medecin?.bureau },
    { titre: 'EXPORT.COL.STATUT', valeur: (p) => p.statut },
  ];

  ngOnInit() {
    this.charger();

    // Le medecin appelle un patient, ou un collegue en pointe un autre :
    // l'ecran le montre aussitot, sans rechargement. L'agent sait vers quel
    // bureau orienter, et qui attend encore.
    this.socket
      .on('rendez-vous:maj')
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.charger());
  }

  private charger() {
    this.isLoading.set(true);
    this.hopital.presencesDuJour().subscribe({
      next: (r) => {
        this.presences.set(r.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('HOPITAL.PRESENCES.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      },
    });
  }

  pointer(p: PresenceDuJourView) {
    if (this.enCours()) return;
    this.enCours.set(p.idRendezVous);
    this.hopital.pointerPresence(p.idRendezVous).subscribe({
      next: (r) => {
        this.enCours.set(null);
        const maj = r.data;
        if (maj) this.presences.update((l) => l.map((x) => (x.idRendezVous === maj.idRendezVous ? maj : x)));
        this.toastr.success(
          this.i18n.t('HOPITAL.PRESENCES.OK', { patient: `${p.patient.prenom} ${p.patient.nom}` }),
          this.i18n.t('COMMON.SUCCESS')
        );
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { status?: number; error?: { error?: string } };
        this.toastr.error(
          e?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : e?.error?.error ?? this.i18n.t('HOPITAL.PRESENCES.ERR_POINTER'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
        // Un autre agent a pu pointer entre-temps : on se resynchronise.
        this.charger();
      },
    });
  }

  libelleStatut(s: string): string {
    return this.i18n.t('MEDECIN.STATUT_RDV.' + s);
  }

  /** Le créneau est passé et le patient n'est pas là. */
  enRetard(p: PresenceDuJourView): boolean {
    return p.statut === 'PLANIFIE' && new Date(p.prevuLe).getTime() < Date.now();
  }
}
