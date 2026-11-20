// features/hopital/alertes — resultats critiques adresses au prescripteur :
// accuse de lecture obligatoire, qui libere la diffusion au patient (EF-04-08/09).
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { AlerteCritiqueView } from '@baobaoheath/shared-types';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { RACINE_ACCUEIL } from '../../../core/navigation/racines';

@Component({
  selector: 'app-hopital-alertes',
  standalone: true,
  imports: [RouterLink, DatePipe, MatButtonModule, TranslatePipe],
  templateUrl: './alertes.component.html',
})
export class AlertesComponent implements OnInit {
  /** /hopital, ou l'interface de l'administrateur : voir core/navigation/racines.ts. */
  readonly racine = inject(RACINE_ACCUEIL);

  private labo   = inject(LaboratoireService);
  private toastr = inject(ToastrService);
  private i18n   = inject(I18nService);

  alertes   = signal<AlerteCritiqueView[]>([]);
  isLoading = signal(true);
  enCours   = signal<string | null>(null);

  readonly ouvertes = computed(() => this.alertes().filter((a) => !a.accuseeLe));
  readonly accusees = computed(() => this.alertes().filter((a) => a.accuseeLe));

  ngOnInit() { this.charger(); }

  charger() {
    this.labo.mesAlertes().subscribe({
      next: (r) => { this.alertes.set(r.data ?? []); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  accuser(a: AlerteCritiqueView) {
    if (this.enCours()) return;
    this.enCours.set(a.id);
    this.labo.accuserAlerte(a.id).subscribe({
      next: (r) => {
        this.enCours.set(null);
        this.alertes.update((liste) => liste.map((x) => (x.id === a.id ? (r.data ?? { ...x, accuseeLe: new Date().toISOString() }) : x)));
        this.toastr.success(this.i18n.t('HOPITAL.ALERTES.ACCUSE_OK'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.enCours.set(null); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  compteRendu(a: AlerteCritiqueView) { this.labo.ouvrirCompteRendu(a.demande.id, 'prescripteur'); }

  reference(a: AlerteCritiqueView): string {
    const r = a.resultat;
    if (r.refMin !== null && r.refMax !== null) return `${r.refMin} – ${r.refMax}`;
    if (r.refMin !== null) return `≥ ${r.refMin}`;
    if (r.refMax !== null) return `≤ ${r.refMax}`;
    return '—';
  }
}
