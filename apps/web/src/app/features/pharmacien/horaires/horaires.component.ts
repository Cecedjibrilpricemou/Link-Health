// features/pharmacien/horaires/horaires.component.ts
// Les horaires d'ouverture de l'officine, saisis par le titulaire.
//
// Ces horaires sont publics : un visiteur qui cherche un medicament les lit
// avant de se deplacer. Les annoncer engage l'officine, et quelqu'un qui
// traverse la ville pour trouver porte close ne revient pas.
//
// Un creneau par jour, ou ferme. Les jours s'affichent du lundi au dimanche,
// mais leurs cles suivent `Date.getDay()` — 0 pour dimanche — pour qu'aucune
// conversion ne traine entre l'ecran, l'API et la base.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { EtatOuvertureView, HorairesView } from '@baobaoheath/shared-types';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { PharmacienService } from '../../../core/services/pharmacien.service';

/** Ce que l'ecran manipule pour un jour. */
interface LigneJour {
  /** La cle de `Date.getDay()` : « 1 » pour lundi, « 0 » pour dimanche. */
  cle: string;
  /** La cle de traduction du nom du jour. */
  nom: string;
  ouvert: boolean;
  ouvre: string;
  ferme: string;
}

/** Du lundi au dimanche : l'ordre dans lequel on lit une semaine. */
const JOURS: { cle: string; nom: string }[] = [
  { cle: '1', nom: 'COMMON.DAYS.1' },
  { cle: '2', nom: 'COMMON.DAYS.2' },
  { cle: '3', nom: 'COMMON.DAYS.3' },
  { cle: '4', nom: 'COMMON.DAYS.4' },
  { cle: '5', nom: 'COMMON.DAYS.5' },
  { cle: '6', nom: 'COMMON.DAYS.6' },
  { cle: '0', nom: 'COMMON.DAYS.0' },
];

const PAR_DEFAUT = { ouvre: '08:00', ferme: '20:00' };

@Component({
  selector: 'app-pharmacien-horaires',
  standalone: true,
  imports: [FormsModule, MatButtonModule, TranslatePipe],
  templateUrl: './horaires.component.html',
  styleUrl: './horaires.component.scss',
})
export class HorairesComponent implements OnInit {
  private readonly service = inject(PharmacienService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);

  readonly chargement = signal(true);
  readonly enregistrement = signal(false);
  readonly etat = signal<EtatOuvertureView | null>(null);
  readonly lignes = signal<LigneJour[]>(
    JOURS.map((j) => ({ ...j, ouvert: false, ...PAR_DEFAUT })),
  );

  /** Les jours dont la fermeture ne suit pas l'ouverture. */
  readonly joursFautifs = computed(() =>
    this.lignes().filter((l) => l.ouvert && l.ferme <= l.ouvre).map((l) => l.nom),
  );

  readonly aucunJourOuvert = computed(() => this.lignes().every((l) => !l.ouvert));

  ngOnInit(): void {
    this.service.getHoraires().subscribe({
      next: (r) => {
        this.appliquer(r.data?.horaires ?? null);
        this.etat.set(r.data?.etat ?? null);
        this.chargement.set(false);
      },
      error: () => {
        this.chargement.set(false);
        this.toastr.error(
          this.i18n.t('COMMON.ERROR_GENERIC'),
          this.i18n.t('COMMON.ERROR_TITLE'),
        );
      },
    });
  }

  private appliquer(horaires: HorairesView | null): void {
    this.lignes.set(
      JOURS.map((j) => {
        const creneau = horaires?.[j.cle] ?? null;
        return creneau
          ? { ...j, ouvert: true, ouvre: creneau.ouvre, ferme: creneau.ferme }
          : { ...j, ouvert: false, ...PAR_DEFAUT };
      }),
    );
  }

  /** Modifie une ligne sans muter le tableau : l'affichage suit le signal. */
  majJour(cle: string, champ: 'ouvert' | 'ouvre' | 'ferme', valeur: boolean | string): void {
    this.lignes.update((lignes) =>
      lignes.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)),
    );
  }

  /** Applique les heures du premier jour ouvert a tous les autres. */
  appliquerPartout(): void {
    const modele = this.lignes().find((l) => l.ouvert);
    if (!modele) return;
    this.lignes.update((lignes) =>
      lignes.map((l) => (l.ouvert ? { ...l, ouvre: modele.ouvre, ferme: modele.ferme } : l)),
    );
  }

  enregistrer(): void {
    if (this.enregistrement()) return;
    if (this.joursFautifs().length > 0) {
      this.toastr.error(
        this.i18n.t('PHARMACIEN.HORAIRES.ERREUR_CRENEAU'),
        this.i18n.t('COMMON.ERROR_TITLE'),
      );
      return;
    }

    const horaires: HorairesView = {};
    for (const l of this.lignes()) {
      horaires[l.cle] = l.ouvert ? { ouvre: l.ouvre, ferme: l.ferme } : null;
    }

    this.enregistrement.set(true);
    this.service.definirHoraires({ horaires }).subscribe({
      next: (r) => {
        this.etat.set(r.data?.etat ?? null);
        this.enregistrement.set(false);
        this.toastr.success(this.i18n.t('PHARMACIEN.HORAIRES.ENREGISTRE'));
      },
      error: (e: { error?: { message?: string } }) => {
        this.enregistrement.set(false);
        this.toastr.error(
          e.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
          this.i18n.t('COMMON.ERROR_TITLE'),
        );
      },
    });
  }
}
