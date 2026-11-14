import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EtatOuvertureView } from '@baobaoheath/shared-types';
import * as L from 'leaflet';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { I18nService } from '../../services/i18n.service';

export interface PharmacieCarteView {
  id: string;
  nom: string;
  adresse?: string | null;
  latitude: number | null;
  longitude: number | null;
  ouverture: EtatOuvertureView;
}

type PharmacieLocalisable = PharmacieCarteView & {
  latitude: number;
  longitude: number;
};

/**
 * Le marqueur est dessine en CSS, pas charge comme image.
 *
 * Leaflet devine sinon l'adresse de ses PNG en lisant une regle de sa propre
 * feuille de style, et attend un nom de fichier exact. Le bundler renomme ces
 * fichiers avec une empreinte : la devinette echoue et les marqueurs
 * disparaissent, sans la moindre erreur a l'ecran. Un marqueur dessin
 * supprime la dependance au nom des fichiers.
 */
function marqueurDessine(): L.DivIcon {
  return L.divIcon({
    className: 'carte-pharmacies__epingle',
    html: '<span class="carte-pharmacies__epingle-point" aria-hidden="true"></span>',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -32],
  });
}

function estLocalisable(pharmacie: PharmacieCarteView): pharmacie is PharmacieLocalisable {
  return (
    typeof pharmacie.latitude === 'number' &&
    Number.isFinite(pharmacie.latitude) &&
    typeof pharmacie.longitude === 'number' &&
    Number.isFinite(pharmacie.longitude)
  );
}

@Component({
  selector: 'app-carte-pharmacies',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './carte-pharmacies.component.html',
  styleUrl: './carte-pharmacies.component.scss',
})
export class CartePharmaciesComponent {
  private readonly plateforme = inject(PLATFORM_ID);
  private readonly i18n = inject(I18nService);
  private readonly conteneurCarte = viewChild<ElementRef<HTMLDivElement>>('conteneurCarte');

  readonly pharmacies = input.required<PharmacieCarteView[]>();
  readonly localisables = computed(() => this.pharmacies().filter(estLocalisable));

  constructor() {
    effect((onCleanup) => {
      const conteneur = this.conteneurCarte()?.nativeElement;
      const pharmacies = this.localisables();
      if (!conteneur || pharmacies.length === 0 || !isPlatformBrowser(this.plateforme)) return;

      const carte = L.map(conteneur);
      onCleanup(() => carte.remove());

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(carte);

      for (const pharmacie of pharmacies) {
        L.marker([pharmacie.latitude, pharmacie.longitude], { icon: marqueurDessine(), title: pharmacie.nom })
          .bindPopup(this.creerInfobulle(pharmacie))
          .addTo(carte);
      }

      if (pharmacies.length === 1) {
        const [pharmacie] = pharmacies;
        carte.setView([pharmacie.latitude, pharmacie.longitude], 15);
      } else {
        const bounds = L.latLngBounds(
          pharmacies.map(({ latitude, longitude }) => L.latLng(latitude, longitude)),
        );
        carte.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
      }
    });
  }

  private creerInfobulle(pharmacie: PharmacieCarteView): HTMLElement {
    const contenu = document.createElement('div');
    const nom = document.createElement('strong');
    nom.textContent = pharmacie.nom;
    contenu.append(nom);

    const adresse = pharmacie.adresse?.trim();
    if (adresse) {
      const ligneAdresse = document.createElement('div');
      ligneAdresse.textContent = adresse;
      contenu.append(ligneAdresse);
    }

    const etat = document.createElement('div');
    etat.textContent = this.etatOuverture(pharmacie.ouverture);
    contenu.append(etat);
    return contenu;
  }

  /**
   * Trois etats, jamais deux : « horaires non renseignes » n'est pas « ferme ».
   * Afficher « ferme » sur une officine qui n'a rien saisi lui ferait perdre
   * des clients sans qu'elle sache pourquoi.
   */
  private etatOuverture(ouverture: EtatOuvertureView): string {
    if (ouverture.ouvert === null) return this.i18n.t('PUBLIC.MAP.HOURS_UNKNOWN');
    if (!ouverture.ouvert) return this.i18n.t('PUBLIC.MAP.CLOSED');
    if (ouverture.fermeA) {
      return this.i18n.t('PUBLIC.MAP.OPEN_UNTIL', { heure: ouverture.fermeA });
    }
    return this.i18n.t('PUBLIC.MAP.OPEN');
  }
}
