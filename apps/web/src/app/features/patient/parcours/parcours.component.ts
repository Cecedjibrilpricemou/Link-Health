// features/patient/parcours — mon parcours de soins : episodes, analyses,
// rendez-vous (P1). La frise s'etoffera avec ordonnance, pharmacie, livraison.
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { DemandeAnalyseView, EpisodePatientView } from '@baobaoheath/shared-types';
import { HopitalService } from '../../../core/services/hopital.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { statutDemandeClasse, statutEpisodeClasse, urgenceClasse } from '../../hopital/hopital.utils';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { interpretationClasse, referenceLisible } from '../../laboratoire/laboratoire.utils';
import { RouterLink } from '@angular/router';
import { NomPraticienPipe } from '../../../shared/pipes/nom-praticien.pipe';

type Etape = { cle: string; etat: 'done' | 'now' | 'todo' | 'soon' };

@Component({
  selector: 'app-patient-parcours',
  standalone: true,
  imports: [NomPraticienPipe, DatePipe, MatButtonModule, TranslatePipe, RouterLink],
  templateUrl: './parcours.component.html',
})
export class ParcoursComponent implements OnInit {
  private hopital = inject(HopitalService);
  private labo    = inject(LaboratoireService);
  private toastr  = inject(ToastrService);
  private i18n    = inject(I18nService);

  readonly statutClasse = statutEpisodeClasse;
  readonly demandeClasse = statutDemandeClasse;
  readonly urgenceClasse = urgenceClasse;
  readonly lectureClasse = interpretationClasse;
  readonly reference = referenceLisible;

  episodes  = signal<EpisodePatientView[]>([]);
  isLoading = signal(true);

  ngOnInit() {
    this.hopital.mesEpisodes().subscribe({
      next: (r) => { this.episodes.set(r.data ?? []); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  /** Frise des etapes du parcours (les etapes a venir arrivent avec les blocs suivants). */
  etapes(e: EpisodePatientView): Etape[] {
    const analysesEnCours = e.demandesAnalyse.some((d) => d.statut !== 'VALIDEE' && d.statut !== 'ANNULEE');
    const analysesFaites = e.demandesAnalyse.length > 0 && !analysesEnCours;
    const rdv = e.rendezVous.some((r) => r.statut === 'PLANIFIE');
    return [
      { cle: 'ETAPE_ADMISSION', etat: 'done' },
      { cle: 'ETAPE_ANALYSES', etat: e.demandesAnalyse.length === 0 ? 'todo' : analysesFaites ? 'done' : 'now' },
      { cle: 'ETAPE_CONSULTATION', etat: rdv ? 'now' : 'todo' },
      { cle: 'ETAPE_ORDONNANCE', etat: 'soon' },
      { cle: 'ETAPE_PHARMACIE', etat: 'soon' },
      { cle: 'ETAPE_LIVRAISON', etat: 'soon' },
    ];
  }

  bonExamen(d: DemandeAnalyseView) { this.hopital.ouvrirBonExamen(d.id, true); }
  compteRendu(d: DemandeAnalyseView) { this.labo.ouvrirCompteRendu(d.id, 'patient'); }
  /** Resultats visibles seulement une fois diffuses (validation, et accuse du prescripteur si critique). */
  resultatsDisponibles(d: DemandeAnalyseView) { return !!d.diffuseePatientLe && d.lignes.some((l) => l.resultat); }
}
