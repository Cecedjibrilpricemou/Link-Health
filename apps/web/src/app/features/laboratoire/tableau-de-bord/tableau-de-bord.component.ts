// features/laboratoire/tableau-de-bord — activite du laboratoire : file par
// etape, urgences, critiques a accuser, prochains prelevements.
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { DemandeAnalyseView, TableauDeBordLaboView } from '@baobaoheath/shared-types';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { statutDemandeClasse, urgenceClasse } from '../../hopital/hopital.utils';

@Component({
  selector: 'app-labo-tableau-de-bord',
  standalone: true,
  imports: [RouterLink, DatePipe, MatButtonModule, TranslatePipe],
  templateUrl: './tableau-de-bord.component.html',
  styleUrl: './tableau-de-bord.component.scss',
})
export class LaboTableauDeBordComponent implements OnInit {
  private labo   = inject(LaboratoireService);
  private toastr = inject(ToastrService);
  private i18n   = inject(I18nService);

  isLoading = signal(true);
  data      = signal<TableauDeBordLaboView | null>(null);

  readonly demandeClasse = statutDemandeClasse;
  readonly urgenceClasse = urgenceClasse;

  ngOnInit() {
    this.labo.tableauDeBord().subscribe({
      next: (r) => { this.data.set(r.data ?? null); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  initiales(d: DemandeAnalyseView): string {
    return `${d.patient.prenom.charAt(0)}${d.patient.nom.charAt(0)}`.toUpperCase();
  }
}
