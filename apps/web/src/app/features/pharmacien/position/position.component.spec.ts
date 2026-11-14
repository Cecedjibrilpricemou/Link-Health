import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import * as L from 'leaflet';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { DefinirPositionDto, PositionOfficineView } from '@baobaoheath/shared-types';
import { ToastrService } from 'ngx-toastr';
import { I18nService } from '../../../shared/services/i18n.service';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { PositionComponent } from './position.component';

const mocks = vi.hoisted(() => {
  const carte = {
    setView: vi.fn(),
    on: vi.fn(),
    remove: vi.fn(),
  };
  const coucheTuiles = { addTo: vi.fn() };
  const epingle = {};
  const marqueur = {
    addTo: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    setLatLng: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 9.5, lng: -13.6 })),
  };

  return {
    carte,
    coucheTuiles,
    epingle,
    marqueur,
    map: vi.fn(() => carte),
    tileLayer: vi.fn(() => coucheTuiles),
    marker: vi.fn(() => marqueur),
    divIcon: vi.fn(() => epingle),
  };
});

vi.mock('leaflet', () => mocks);

const OFFICINE: PositionOfficineView = {
  latitude: null,
  longitude: null,
  nom: 'Pharmacie Kènèya',
  adresse: 'Route du Niger',
  commune: 'Matam',
};

function clicCarte(latitude: number, longitude: number): void {
  const gestionnaire = mocks.carte.on.mock.calls.find(([evenement]) => evenement === 'click')?.[1] as
    | ((event: L.LeafletMouseEvent) => void)
    | undefined;
  gestionnaire?.({ latlng: { lat: latitude, lng: longitude } } as L.LeafletMouseEvent);
}

/** Le gestionnaire pose par le composant sur un evenement de la carte. */
function gestionnaire(evenement: string): ((...args: never[]) => void) | undefined {
  return mocks.carte.on.mock.calls.find(([nom]) => nom === evenement)?.[1];
}

async function stabiliser(fixture: ComponentFixture<PositionComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

async function monter(position: PositionOfficineView = OFFICINE) {
  const appels = { lecture: 0, ecriture: [] as DefinirPositionDto[] };
  const messages = { succes: [] as string[], erreur: [] as string[] };
  const pharma = {
    getPosition: () => {
      appels.lecture += 1;
      return of({ success: true, data: position });
    },
    definirPosition: (dto: DefinirPositionDto) => {
      appels.ecriture.push(dto);
      return of({
        success: true,
        data: { ...position, latitude: dto.latitude, longitude: dto.longitude },
      });
    },
  };

  TestBed.configureTestingModule({
    imports: [PositionComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PharmacienService, useValue: pharma },
      {
        provide: ToastrService,
        useValue: {
          success: (message: string) => messages.succes.push(message),
          error: (message: string) => messages.erreur.push(message),
        },
      },
      { provide: I18nService, useValue: { lang: () => 'fr', t: (key: string) => key } },
    ],
  });

  const fixture = TestBed.createComponent(PositionComponent);
  await stabiliser(fixture);
  return { fixture, c: fixture.componentInstance, appels, messages };
}

describe('position pharmacien', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('appelle getPosition à l’initialisation', async () => {
    const { c, appels, fixture } = await monter();

    expect(appels.lecture).toBe(1);
    expect(c.chargement()).toBe(false);
    fixture.destroy();
  });

  it('sans position, ne pose pas de marqueur et désactive Enregistrer', async () => {
    const { fixture } = await monter();

    expect(L.marker).not.toHaveBeenCalled();
    const boutons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(boutons.find((bouton) => bouton.textContent?.includes('COMMON.SAVE'))?.disabled).toBe(true);
    expect(boutons.some((bouton) => bouton.textContent?.includes('PHARMACIEN.POSITION.RETIRER'))).toBe(false);
    fixture.destroy();
  });

  it('pose une épingle au clic sur la carte et active Enregistrer', async () => {
    const { c, fixture } = await monter();

    clicCarte(9.5123456, -13.6123456);
    fixture.detectChanges();

    expect(L.marker).toHaveBeenCalledWith(
      [9.5123456, -13.6123456],
      expect.objectContaining({ draggable: true }),
    );
    expect(c.peutEnregistrer()).toBe(true);
    fixture.destroy();
  });

  it('enregistre exactement les coordonnées de l’épingle', async () => {
    const { c, appels, fixture } = await monter();
    clicCarte(9.5123456, -13.6123456);

    c.enregistrer();

    expect(appels.ecriture).toEqual([{ latitude: 9.5123456, longitude: -13.6123456 }]);
    fixture.destroy();
  });

  it('retire la position avec deux coordonnées nulles', async () => {
    const { fixture, appels, c } = await monter({
      ...OFFICINE,
      latitude: 9.5,
      longitude: -13.6,
    });

    c.retirerPosition();

    expect(appels.ecriture).toEqual([{ latitude: null, longitude: null }]);
    fixture.destroy();
  });

  it('montre sur la carte la position deja enregistree', async () => {
    // C'est le cas courant : une officine situee doit se revoir a l'ouverture
    // de l'ecran, pas sur une vue du monde vide.
    const { fixture } = await monter({ ...OFFICINE, latitude: 9.545, longitude: -13.682 });

    expect(mocks.carte.setView).toHaveBeenCalledWith([9.545, -13.682], 16);
    expect(L.marker).toHaveBeenCalledWith([9.545, -13.682], expect.objectContaining({ draggable: true }));
    fixture.destroy();
  });

  it('deplacer l epingle a la souris met a jour les coordonnees', async () => {
    const { c, fixture } = await monter();
    clicCarte(9.5, -13.6);

    // getLatLng du mock rend le point deplacé.
    mocks.marqueur.getLatLng.mockReturnValueOnce({ lat: 9.6, lng: -13.7 });
    const finDeGlisse = mocks.marqueur.on.mock.calls.find(([nom]) => nom === 'dragend')?.[1] as
      | (() => void)
      | undefined;
    finDeGlisse?.();

    expect(c.coordonneesAffichees()).toEqual({ latitude: '9.600000', longitude: '-13.700000' });
    fixture.destroy();
  });

  it('refuse d enregistrer le point (0, 0)', async () => {
    // La vue par defaut est centree la : un clic distrait au zoom 5 y tombe,
    // et le serveur le refuserait de toute facon.
    const { c, appels, fixture } = await monter();

    clicCarte(0, 0);

    expect(c.pointInterdit()).toBe(true);
    expect(c.peutEnregistrer()).toBe(false);
    c.enregistrer();
    expect(appels.ecriture).toEqual([]);
    fixture.destroy();
  });

  it('détruit la carte à la destruction du composant', async () => {
    const { fixture } = await monter();

    fixture.destroy();

    expect(mocks.carte.remove).toHaveBeenCalledTimes(1);
  });
});
