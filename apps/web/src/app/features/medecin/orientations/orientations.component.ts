// features/medecin/orientations — les patients que l'accueil a orientés vers
// ce médecin (EF-03-05).
//
// Cet écran comble un défaut constaté en usage : l'orientation s'écrivait bien
// en base, mais le médecin n'en voyait jamais rien. Le patient était envoyé
// vers quelqu'un qui ne le voyait pas arriver.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import type { OrientationMedecinView } from '@baobaoheath/shared-types';

import { MedecinService } from '../../../core/services/medecin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

@Component({
  selector: 'app-medecin-orientations',
  standalone: true,
  imports: [DatePipe, FormsModule, NgTemplateOutlet, RouterLink, TranslatePipe],
  templateUrl: './orientations.component.html',
  styleUrl: './orientations.component.scss',
})
export class OrientationsComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private service = inject(MedecinService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  orientations = signal<OrientationMedecinView[]>([]);
  isLoading = signal(true);

  /**
   * Ceux qui ont un rendez-vous d'abord, et par date la plus proche : c'est
   * l'ordre dans lequel le médecin va les voir arriver.
   */
  readonly avecRendezVous = computed(() =>
    this.orientations()
      .filter((o) => o.rendezVous)
      .sort((a, b) => +new Date(a.rendezVous!.prevuLe) - +new Date(b.rendezVous!.prevuLe))
  );

  readonly sansRendezVous = computed(() => this.orientations().filter((o) => !o.rendezVous));

  /**
   * Poser le creneau (addendum du 2026-09-28, point 3). C'est le geste qui
   * manquait : l'accueil oriente sans heure, et c'est ici que le medecin en
   * fixe une — la seule que le patient recevra.
   */
  ouverte = signal<string | null>(null);
  quand = '';
  motifRdv = '';
  enCours = signal<string | null>(null);

  ouvrirRdv(idEpisode: string) {
    this.ouverte.set(this.ouverte() === idEpisode ? null : idEpisode);
    this.quand = this.creneauParDefaut();
    this.motifRdv = '';
  }

  /** Demain a 9 h : une proposition plausible, pas une contrainte. */
  private creneauParDefaut(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const deuxChiffres = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`
      + `T${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
  }

  fixer(o: OrientationMedecinView) {
    if (this.enCours() || !this.quand) return;
    this.enCours.set(o.idEpisode);

    this.service.fixerRendezVous(o.idEpisode, {
      prevuLe: new Date(this.quand).toISOString(),
      motif: this.motifRdv.trim() || undefined,
    }).subscribe({
      next: () => {
        this.enCours.set(null);
        this.ouverte.set(null);
        this.toastr.success(
          this.i18n.t('MEDECIN.RDV.OK', { patient: `${o.patient.prenom} ${o.patient.nom}` }),
          this.i18n.t('COMMON.SUCCESS')
        );
        // Recharger : l'orientation bascule de « a planifier » vers « planifies ».
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { status?: number; error?: { error?: string } };
        this.toastr.error(
          e?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : e?.error?.error ?? this.i18n.t('MEDECIN.RDV.ERR'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
      },
    });
  }

  ngOnInit() {
    this.charger();
  }

  private charger() {
    this.isLoading.set(true);
    this.service.getOrientations().subscribe({
      next: (res) => {
        this.orientations.set(res.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(
          this.i18n.t('MEDECIN.ORIENTATIONS.ERR_LOAD'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
      },
    });
  }

  age(dateNaissance: string | Date): number | null {
    const n = new Date(dateNaissance);
    if (Number.isNaN(n.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - n.getFullYear();
    if (now < new Date(now.getFullYear(), n.getMonth(), n.getDate())) a -= 1;
    return a;
  }

  /** Un rendez-vous déjà passé se signale : le patient aurait dû être vu. */
  estEnRetard(prevuLe: string | Date): boolean {
    return new Date(prevuLe).getTime() < Date.now();
  }
}
