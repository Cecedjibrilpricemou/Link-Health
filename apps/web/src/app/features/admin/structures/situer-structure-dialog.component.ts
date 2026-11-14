import {
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import * as L from 'leaflet';
import type { StructureAdminView } from '@baobaoheath/shared-types';
import { AdminService } from '../../../core/services/admin.service';
import { ToastrService } from 'ngx-toastr';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

function marqueurDessine(): L.DivIcon {
  return L.divIcon({
    className: 'situer-structure__epingle',
    html: '<span class="situer-structure__epingle-point" aria-hidden="true"></span>',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
  });
}

@Component({
  selector: 'app-situer-structure-dialog',
  standalone: true,
  imports: [MatButtonModule, TranslatePipe],
  encapsulation: ViewEncapsulation.None,
  templateUrl: './situer-structure-dialog.component.html',
  styleUrl: './situer-structure-dialog.component.scss',
})
export class SituerStructureDialogComponent {
  private readonly adminService = inject(AdminService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);
  private readonly conteneurCarte = viewChild<ElementRef<HTMLDivElement>>('conteneurCarte');

  readonly structure = input.required<StructureAdminView>();
  readonly fermer = output<void>();
  readonly positionEnregistree = output<{ id: string; latitude: number; longitude: number }>();

  readonly latitude = signal<number | null>(null);
  readonly longitude = signal<number | null>(null);
  readonly enregistrement = signal(false);
  readonly gpsEnCours = signal(false);
  readonly erreurGps = signal<string | null>(null);

  readonly epinglePosee = computed(
    () => this.latitude() !== null && this.longitude() !== null,
  );
  readonly coordonneesAffichees = computed(() => {
    const latitude = this.latitude();
    const longitude = this.longitude();
    return latitude === null || longitude === null
      ? null
      : { latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) };
  });
  /**
   * Le point (0, 0) est en pleine mer, et c'est la ou la carte s'ouvre quand
   * la structure n'a pas de position : un clic distrait au zoom 5 y tombe.
   * Le serveur le refuse aussi ; autant le dire avant l'aller-retour.
   */
  readonly pointInterdit = computed(
    () => this.latitude() === 0 && this.longitude() === 0,
  );
  readonly enregistrementDesactive = computed(
    () => !this.epinglePosee() || this.pointInterdit() || this.enregistrement(),
  );

  private carte: L.Map | null = null;
  private marqueur: L.Marker | null = null;

  constructor() {
    afterRenderEffect((onCleanup) => {
      const conteneur = this.conteneurCarte()?.nativeElement;
      const structure = this.structure();
      if (!conteneur) return;

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

      const position = this.lirePosition(structure);
      if (position) {
        carte.setView(position, 16);
        this.mettreAJourEpingle(position[0], position[1]);
      } else {
        carte.setView([0, 0], 5);
      }

      carte.on('click', (event: L.LeafletMouseEvent) => {
        this.mettreAJourEpingle(event.latlng.lat, event.latlng.lng);
      });
    });
  }

  utiliserPositionActuelle(): void {
    if (!navigator.geolocation) {
      this.erreurGps.set(this.i18n.t('ADMIN.STRUCTURES.SITUER_GPS_ERR'));
      return;
    }

    this.gpsEnCours.set(true);
    this.erreurGps.set(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        this.gpsEnCours.set(false);
        this.mettreAJourEpingle(coords.latitude, coords.longitude);
      },
      () => {
        this.gpsEnCours.set(false);
        this.erreurGps.set(this.i18n.t('ADMIN.STRUCTURES.SITUER_GPS_ERR'));
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  enregistrer(): void {
    if (this.enregistrementDesactive()) return;

    const latitude = this.latitude();
    const longitude = this.longitude();
    if (latitude === null || longitude === null) return;

    this.enregistrement.set(true);
    this.adminService
      .updateStructure(this.structure().id, { latitude, longitude })
      .subscribe({
        next: () => {
          this.enregistrement.set(false);
          this.positionEnregistree.emit({
            id: this.structure().id,
            latitude,
            longitude,
          });
          this.toastr.success(
            this.i18n.t('ADMIN.STRUCTURES.SITUER_SUCCESS'),
            this.i18n.t('ADMIN.STRUCTURES.SUCCESS_TITLE'),
          );
          this.fermer.emit();
        },
        error: (e: { error?: { error?: string; message?: string } }) => {
          this.enregistrement.set(false);
          this.toastr.error(
            e.error?.error ??
              e.error?.message ??
              this.i18n.t('ADMIN.STRUCTURES.SITUER_ERROR'),
            this.i18n.t('COMMON.ERROR_TITLE'),
          );
        },
      });
  }

  fermerDialogue(): void {
    if (!this.enregistrement()) this.fermer.emit();
  }

  @HostListener('document:keydown.escape')
  echapper(): void {
    this.fermerDialogue();
  }

  private mettreAJourEpingle(latitude: number, longitude: number): void {
    this.latitude.set(latitude);
    this.longitude.set(longitude);
    this.erreurGps.set(null);

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
      const position = marqueur.getLatLng();
      this.latitude.set(position.lat);
      this.longitude.set(position.lng);
    });
  }

  private lirePosition(structure: StructureAdminView): [number, number] | null {
    const { latitude, longitude } = structure;
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
