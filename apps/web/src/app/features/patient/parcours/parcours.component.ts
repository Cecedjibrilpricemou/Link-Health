// features/patient/parcours — mon parcours de soins : chaque visite, sa frise,
// et son fil (P5, EF-06-01) : chaque etape datee, du rendez-vous demande a la
// livraison. Les analyses et les rendez-vous gardent leur detail en dessous.
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { DemandeAnalyseView, EpisodePatientView, EtapeFilView, TypeEtapeFil } from '@baobaoheath/shared-types';
import { HopitalService } from '../../../core/services/hopital.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { statutDemandeClasse, statutEpisodeClasse, urgenceClasse } from '../../hopital/hopital.utils';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { interpretationClasse, referenceLisible } from '../../laboratoire/laboratoire.utils';
import { RouterLink } from '@angular/router';
import { NomPraticienPipe } from '../../../shared/pipes/nom-praticien.pipe';

type Etape = { cle: string; etat: 'done' | 'now' | 'todo' };

/** Ou mene chaque etape du fil : l'ecran ou le patient la retrouve en detail. */
const LIEN_DU_FIL: Partial<Record<TypeEtapeFil, string>> = {
  RENDEZ_VOUS: '/patient/rendez-vous',
  RESULTATS: '/patient/resultats',
  ORDONNANCE: '/patient/ordonnances',
  COMMANDE: '/patient/commandes',
  PAIEMENT: '/patient/paiements',
};

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

  /**
   * La frise de la visite, lue sur son fil : chaque etape est faite quand le
   * fil la porte, en cours quand la precedente l'est. Plus de « bientot » :
   * l'ordonnance, la pharmacie et la livraison sont suivies pour de vrai.
   */
  etapes(e: EpisodePatientView): Etape[] {
    const a = new Set(e.fil.filter((x) => !x.aVenir).map((x) => x.type));
    const prescrites = e.demandesAnalyse.filter((d) => d.statut !== 'ANNULEE').length;
    const analysesFaites = prescrites > 0 && e.demandesAnalyse.every((d) => d.statut === 'ANNULEE' || !!d.diffuseePatientLe);
    const close = a.has('VISITE_CLOSE') || a.has('VISITE_ANNULEE');
    const etat = (fait: boolean, enCours: boolean): Etape['etat'] => (fait ? 'done' : enCours && !close ? 'now' : 'todo');
    return [
      { cle: 'ETAPE_ADMISSION', etat: 'done' },
      { cle: 'ETAPE_ANALYSES', etat: etat(analysesFaites, prescrites > 0) },
      { cle: 'ETAPE_CONSULTATION', etat: etat(a.has('CONSULTATION'), e.rendezVous.some((r) => r.statut === 'PLANIFIE')) },
      { cle: 'ETAPE_ORDONNANCE', etat: etat(a.has('ORDONNANCE'), false) },
      { cle: 'ETAPE_PHARMACIE', etat: etat(a.has('PRETE'), a.has('COMMANDE')) },
      { cle: 'ETAPE_LIVRAISON', etat: etat(a.has('LIVREE') || a.has('RETIREE'), a.has('PRETE')) },
    ];
  }

  /** Le texte d'une etape du fil : le mode de remise se traduit, le reste est un nom ou un numero. */
  texteDuFil(x: EtapeFilView): string {
    const detail = x.type === 'PRETE' ? this.i18n.t('PATIENT.FIL.MODE_' + (x.detail ?? 'RETRAIT')) : (x.detail ?? '');
    return this.i18n.t('PATIENT.FIL.' + x.type, { detail });
  }

  lienDuFil(x: EtapeFilView): string | null {
    return LIEN_DU_FIL[x.type] ?? null;
  }

  bonExamen(d: DemandeAnalyseView) { this.hopital.ouvrirBonExamen(d.id, true); }
  compteRendu(d: DemandeAnalyseView) { this.labo.ouvrirCompteRendu(d.id, 'patient'); }
  /** Resultats visibles seulement une fois diffuses (validation, et accuse du prescripteur si critique). */
  resultatsDisponibles(d: DemandeAnalyseView) { return !!d.diffuseePatientLe && d.lignes.some((l) => l.resultat); }
}
