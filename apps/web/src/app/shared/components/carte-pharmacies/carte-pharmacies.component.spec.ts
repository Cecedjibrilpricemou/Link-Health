import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import * as L from 'leaflet';
import { vi } from 'vitest';
import type { PharmacieCarteView } from './carte-pharmacies.component';
import { CartePharmaciesComponent } from './carte-pharmacies.component';
import { I18nService } from '../../services/i18n.service';

const mocks = vi.hoisted(() => {
  const carte = {
    setView: vi.fn(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
  };
  const coucheTuiles = { addTo: vi.fn() };
  const epingle = { options: {} };
  const marqueur = {
    bindPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
  };

  return {
    carte,
    coucheTuiles,
    marqueur,
    epingle,
    map: vi.fn(() => carte),
    tileLayer: vi.fn(() => coucheTuiles),
    marker: vi.fn((_point: unknown, _options?: unknown) => marqueur),
    divIcon: vi.fn(() => epingle),
    latLng: vi.fn((latitude: number, longitude: number) => ({ latitude, longitude })),
    latLngBounds: vi.fn((points: unknown[]) => points),
  };
});

vi.mock('leaflet', () => mocks);

const HORAIRES = { ouvert: null, fermeA: null, prochaine: null };

function pharmacie(
  id: string,
  latitude: number | null,
  longitude: number | null,
): PharmacieCarteView {
  return {
    id,
    nom: `Pharmacie ${id}`,
    adresse: 'Route du Niger',
    latitude,
    longitude,
    ouverture: HORAIRES,
  };
}

async function monter(pharmacies: PharmacieCarteView[]) {
  TestBed.configureTestingModule({
    imports: [CartePharmaciesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: I18nService,
        useValue: {
          lang: () => 'fr',
          t: (cle: string) =>
            ({
              'PUBLIC.MAP.HOURS_UNKNOWN': 'Horaires non renseignés',
              'PUBLIC.MAP.CLOSED': 'Fermé',
              'PUBLIC.MAP.OPEN_UNTIL': 'Ouvert jusqu’à',
              'PUBLIC.MAP.OPEN': 'Ouvert',
            })[cle] ?? cle,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(CartePharmaciesComponent);
  fixture.componentRef.setInput('pharmacies', pharmacies);
  await stabiliser(fixture);
  return fixture;
}

/**
 * Deux passes, et non une.
 *
 * L'effet qui monte la carte lit le conteneur rendu par le gabarit. A la
 * premiere passe ce conteneur n'existe pas encore : l'effet sort, puis se
 * redeclenche quand le viewChild se resout. Une seule passe laisse l'ordre de
 * ces deux etapes a la vitesse de la machine — vert ici, rouge sur le serveur
 * d'integration.
 */
async function stabiliser(fixture: ComponentFixture<CartePharmaciesComponent>): Promise<void> {
  for (let passe = 0; passe < 2; passe += 1) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

describe('CartePharmaciesComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ne rend aucune carte pour une liste vide', async () => {
    const fixture = await monter([]);

    expect(fixture.nativeElement.querySelector('.carte-pharmacies')).toBeNull();
    expect(L.map).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('ne rend aucune carte si aucune pharmacie ne possède de coordonnées', async () => {
    const fixture = await monter([pharmacie('1', null, null), pharmacie('2', 9.5, null)]);

    expect(fixture.nativeElement.querySelector('.carte-pharmacies')).toBeNull();
    expect(L.map).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('crée un marqueur par pharmacie localisable', async () => {
    const fixture = await monter([
      pharmacie('1', 9.5, -13.6),
      pharmacie('2', 9.6, -13.7),
      pharmacie('3', 9.7, null),
    ]);

    expect(L.marker).toHaveBeenCalledTimes(2);
    expect(L.map).toHaveBeenCalledTimes(1);
    expect(mocks.carte.fitBounds).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('n’affiche pas « fermé » quand les horaires ne sont pas renseignés', async () => {
    const fixture = await monter([pharmacie('1', 9.5, -13.6)]);
    const popup = mocks.marqueur.bindPopup.mock.calls[0]?.[0] as HTMLElement;

    expect(popup.textContent?.toLocaleLowerCase()).not.toContain('fermé');
    expect(popup.textContent).toContain('Horaires non renseignés');
    fixture.destroy();
  });

  it('pose une epingle dessinee, sans dependre des images de Leaflet', async () => {
    // Leaflet devine l'adresse de ses PNG a partir du nom des fichiers, que
    // le bundler renomme : les marqueurs par defaut disparaissent sans erreur.
    const fixture = await monter([pharmacie('1', 9.5, -13.6)]);

    expect(L.divIcon).toHaveBeenCalledTimes(1);
    expect(mocks.marker.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ icon: mocks.epingle }),
    );
    fixture.destroy();
  });

  it('détruit la carte à la destruction du composant', async () => {
    const fixture = await monter([pharmacie('1', 9.5, -13.6)]);

    fixture.destroy();

    expect(mocks.carte.remove).toHaveBeenCalledTimes(1);
  });

  it('reconstruit la carte quand la liste change', async () => {
    const fixture = await monter([pharmacie('1', 9.5, -13.6)]);

    fixture.componentRef.setInput('pharmacies', [pharmacie('2', 9.6, -13.7)]);
    await stabiliser(fixture);

    expect(mocks.carte.remove).toHaveBeenCalledTimes(1);
    expect(L.map).toHaveBeenCalledTimes(2);
    fixture.destroy();
  });
});
