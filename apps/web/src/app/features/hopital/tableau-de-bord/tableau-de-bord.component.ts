// features/hopital/tableau-de-bord — activite de l'etablissement (EF-03-07)
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { TableauDeBordHopitalView } from '@baobaoheath/shared-types';
import { HopitalService } from '../../../core/services/hopital.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { statutEpisodeClasse } from '../hopital.utils';
import { RACINE_ACCUEIL } from '../../../core/navigation/racines';

@Component({
  selector: 'app-hopital-tableau-de-bord',
  standalone: true,
  imports: [RouterLink, DatePipe, MatButtonModule, TranslatePipe],
  templateUrl: './tableau-de-bord.component.html',
})
export class TableauDeBordComponent implements OnInit {
  /** /hopital, ou l'interface de l'administrateur : voir core/navigation/racines.ts. */
  readonly racine = inject(RACINE_ACCUEIL);

  private hopital = inject(HopitalService);
  private toastr  = inject(ToastrService);
  private i18n    = inject(I18nService);

  isLoading = signal(true);
  data      = signal<TableauDeBordHopitalView | null>(null);

  readonly statutClasse = statutEpisodeClasse;

  ngOnInit() {
    this.hopital.tableauDeBord().subscribe({
      next: (r) => { this.data.set(r.data ?? null); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  initiales(prenom: string, nom: string): string {
    return `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();
  }
}
