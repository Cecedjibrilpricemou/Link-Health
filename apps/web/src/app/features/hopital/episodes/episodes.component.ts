// features/hopital/episodes — liste des episodes de la structure, filtres par statut.
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ToastrService } from 'ngx-toastr';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import type { EpisodeSoinsResumeView, StatutEpisode } from '@baobaoheath/shared-types';
import { HopitalService } from '../../../core/services/hopital.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { statutEpisodeClasse } from '../hopital.utils';
import { RACINE_ACCUEIL } from '../../../core/navigation/racines';
import { NomPraticienPipe } from '../../../shared/pipes/nom-praticien.pipe';

type Filtre = 'TOUS' | StatutEpisode;

@Component({
  selector: 'app-hopital-episodes',
  standalone: true,
  imports: [NomPraticienPipe, RouterLink, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, TranslatePipe, ExportListeComponent],
  templateUrl: './episodes.component.html',
})
export class EpisodesComponent implements OnInit {
  /** /hopital, ou l'interface de l'administrateur : voir core/navigation/racines.ts. */
  readonly racine = inject(RACINE_ACCUEIL);

  private hopital = inject(HopitalService);
  private toastr  = inject(ToastrService);
  private i18n    = inject(I18nService);

  readonly filtres: Filtre[] = ['TOUS', 'OUVERT', 'EN_COURS', 'CLOS', 'ANNULE'];
  readonly statutClasse = statutEpisodeClasse;

  filtre    = signal<Filtre>('TOUS');
  recherche = '';
  page      = signal(1);
  limit     = 20;
  total     = signal(0);
  items     = signal<EpisodeSoinsResumeView[]>([]);

  readonly colonnes: ColonneExport<EpisodeSoinsResumeView>[] = [
    { titre: 'EXPORT.COL.NUMERO', valeur: (e) => e.numero },
    { titre: 'EXPORT.COL.PATIENT', valeur: (e) => e.patient.prenom + ' ' + e.patient.nom },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (e) => e.patient.telephone },
    { titre: 'EXPORT.COL.MOTIF', valeur: (e) => e.motif },
    { titre: 'EXPORT.COL.SERVICE', valeur: (e) => e.service },
    { titre: 'EXPORT.COL.STATUT', valeur: (e) => e.statut },
    { titre: 'EXPORT.COL.OUVERT_LE', valeur: (e) => new Date(e.ouvertLe) },
    { titre: 'EXPORT.COL.CLOS_LE', valeur: (e) => (e.closLe ? new Date(e.closLe) : null) },
    { titre: 'EXPORT.COL.RESPONSABLE', valeur: (e) => (e.responsable ? e.responsable.prenom + ' ' + e.responsable.nom : '') },
    { titre: 'EXPORT.COL.CONSULTATIONS', valeur: (e) => e.nbConsultations, nombre: true },
    { titre: 'EXPORT.COL.ANALYSES', valeur: (e) => e.nbDemandesAnalyse, nombre: true },
  ];
  isLoading = signal(true);

  private terme$ = new Subject<string>();

  ngOnInit() {
    this.terme$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => { this.page.set(1); this.charger(); });
    this.charger();
  }

  charger() {
    this.isLoading.set(true);
    this.hopital.listerEpisodes({ statut: this.filtre() === 'TOUS' ? undefined : this.filtre(), q: this.recherche.trim() || undefined, page: this.page(), limit: this.limit }).subscribe({
      next: (r) => { this.items.set(r.data?.items ?? []); this.total.set(r.data?.total ?? 0); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  setFiltre(f: Filtre) { this.filtre.set(f); this.page.set(1); this.charger(); }
  onRecherche(v: string) { this.recherche = v; this.terme$.next(v); }
  pageSuivante() { if (this.page() * this.limit < this.total()) { this.page.update((p) => p + 1); this.charger(); } }
  pagePrecedente() { if (this.page() > 1) { this.page.update((p) => p - 1); this.charger(); } }
  get nbPages() { return Math.max(1, Math.ceil(this.total() / this.limit)); }

  initiales(e: EpisodeSoinsResumeView): string {
    return `${e.patient.prenom.charAt(0)}${e.patient.nom.charAt(0)}`.toUpperCase();
  }
}
