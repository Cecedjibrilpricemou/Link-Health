import {
  Component,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import * as L from 'leaflet';
import type { DefinirPositionDto, PositionOfficineView } from '@baobaoheath/shared-types';
import { ToastrService } from 'ngx-toastr';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

function marqueurDessine(): L.DivIcon {
  return L.divIcon({
    className: 'pharmacien-position__epingle',
    html: '<span class="pharmacien-position__epingle-point" aria-hidden="true"></span>',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
  });
}

@Component({
  selector: 'app-pharmacien-position',
  standalone: true,
  imports: [MatButtonModule, TranslatePipe],
  encapsulation: ViewEncapsulation.None,
  templateUrl: './position.component.html',
  styleUrl: './position.component.scss',
})
export class PositionComponent implements OnInit {
  private readonly service = inject(PharmacienService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);
  private readonly plateforme = inject(PLATFORM_ID);
  private readonly conteneurCarte = viewChild<ElementRef<HTMLDivElement>>('conteneurCarte');

  readonly chargement = signal(true);
  readonly enregistrement = signal(false);
  readonly localisationEnCours = signal(false);
  readonly officine = signal<PositionOfficineView | null>(null);
  readonly positionEnregistree = signal(false);
  readonly latitude = signal<number | null>(null);
  readonly longitude = signal<number | null>(null);
  readonly erreurGeolocalisation = signal('');

  readonly epinglePosee = computed(
    () => this.latitude() !== null && this.longitude() !== null,
  );
  readonly pointInterdit = computed(
    () => this.latitude() === 0 && this.longitude() === 0,
  );
  readonly coordonneesAffichees = computed(() => {
    const latitude = this.latitude();
    const longitude = this.longitude();
    return latitude === null || longitude === null
      ? null
      : { latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) };
  });
  readonly peutEnregistrer = computed(
    () =>
      this.epinglePosee() &&
      !this.pointInterdit() &&
      !this.chargement() &&
      !this.enregistrement(),
  );

  private carte: L.Map | null = null;
  private marqueur: L.Marker | null = null;
  private positionInitiale: [number, number] | null = null;

  constructor() {
    effect((onCleanup) => {
      const conteneur = this.conteneurCarte()?.nativeElement;
      if (!conteneur || !isPlatformBrowser(this.plateforme)) return;

      const carte = L.map(conteneur);
      this.carte = carte;
      onCleanup(() => {
        carte.remove();
        if (this.carte === carte) {
          this.carte = null;
          this.marqueur = null;
        }
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(carte);

      if (this.positionInitiale) {
        const [latitude, longitude] = this.positionInitiale;
        carte.setView([latitude, longitude], 16);
        this.mettreAJourEpingle(latitude, longitude);
      } else {
        carte.setView([0, 0], 5);
      }

      carte.on('click', (event: L.LeafletMouseEvent) => {
        this.mettreAJourEpingle(event.latlng.lat, event.latlng.lng);
      });
    });
  }

  ngOnInit(): void {
    this.service.getPosition().subscribe({
      next: (r) => {
        if (!r.data) {
          this.chargement.set(false);
          this.toastr.error(
            this.i18n.t('COMMON.ERROR_GENERIC'),
            this.i18n.t('COMMON.ERROR_TITLE'),
          );
          return;
        }

        this.officine.set(r.data);
        const point = this.lireCoordonnees(r.data);
        this.positionInitiale = point;
        this.positionEnregistree.set(point !== null);
        this.latitude.set(point?.[0] ?? null);
        this.longitude.set(point?.[1] ?? null);
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

  utiliserPositionActuelle(): void {
    if (!navigator.geolocation) {
      this.erreurGeolocalisation.set(this.i18n.t('PHARMACIEN.POSITION.GEOLOCALISATION_ERREUR'));
      return;
    }

    this.localisationEnCours.set(true);
    this.erreurGeolocalisation.set('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        this.localisationEnCours.set(false);
        this.mettreAJourEpingle(coords.latitude, coords.longitude);
      },
      () => {
        this.localisationEnCours.set(false);
        this.erreurGeolocalisation.set(
          this.i18n.t('PHARMACIEN.POSITION.GEOLOCALISATION_ERREUR'),
        );
      },
    );
  }

  enregistrer(): void {
    if (!this.peutEnregistrer()) return;

    const dto: DefinirPositionDto = {
      latitude: this.latitude(),
      longitude: this.longitude(),
    };
    this.envoyerPosition(dto, 'PHARMACIEN.POSITION.ENREGISTREE');
  }

  retirerPosition(): void {
    if (this.enregistrement()) return;
    this.envoyerPosition(
      { latitude: null, longitude: null },
      'PHARMACIEN.POSITION.RETIREE',
    );
  }

  private envoyerPosition(dto: DefinirPositionDto, cleSucces: string): void {
    this.enregistrement.set(true);
    this.service.definirPosition(dto).subscribe({
      next: (r) => {
        if (!r.data) {
          this.enregistrement.set(false);
          this.toastr.error(
            this.i18n.t('COMMON.ERROR_GENERIC'),
            this.i18n.t('COMMON.ERROR_TITLE'),
          );
          return;
        }

        this.officine.set(r.data);
        const point = this.lireCoordonnees(r.data);
        this.positionEnregistree.set(point !== null);
        if (point) {
          this.mettreAJourEpingle(point[0], point[1]);
        } else {
          this.effacerEpingle();
        }
        this.enregistrement.set(false);
        this.toastr.success(this.i18n.t(cleSucces));
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

  private mettreAJourEpingle(latitude: number, longitude: number): void {
    this.latitude.set(latitude);
    this.longitude.set(longitude);
    this.erreurGeolocalisation.set('');

    if (!this.carte) return;
    if (this.marqueur) {
      this.marqueur.setLatLng([latitude, longitude]);
      return;
    }

    const marqueur = L.marker([latitude, longitude], {
      icon: marqueurDessine(),
      draggable: true,
    }).addTo(this.carte);
    this.marqueur = marqueur;
    marqueur.on('dragend', () => {
      const point = marqueur.getLatLng();
      this.latitude.set(point.lat);
      this.longitude.set(point.lng);
    });
  }

  private effacerEpingle(): void {
    this.marqueur?.remove();
    this.marqueur = null;
    this.latitude.set(null);
    this.longitude.set(null);
  }

  private lireCoordonnees(
    position: PositionOfficineView,
  ): [number, number] | null {
    const { latitude, longitude } = position;
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }
    return [latitude, longitude];
  }
}
