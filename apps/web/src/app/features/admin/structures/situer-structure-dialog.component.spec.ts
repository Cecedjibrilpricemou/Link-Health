import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import * as L from 'leaflet';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { StructureAdminView } from '@baobaoheath/shared-types';
import { AdminService } from '../../../core/services/admin.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { ToastrService } from 'ngx-toastr';
import { SituerStructureDialogComponent } from './situer-structure-dialog.component';

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

const STRUCTURE: StructureAdminView = {
  id: 'chu-1',
  nom: 'CHU Donka',
  type: 'CHU',
  prefecture: 'Conakry',
  adresse: 'Dixinn',
  latitude: null,
  longitude: null,
  estActive: true,
  creeLe: '2026-01-01',
};

function clicCarte(latitude: number, longitude: number): void {
  const gestionnaire = mocks.carte.on.mock.calls.find(([evenement]) => evenement === 'click')?.[1] as
    | ((event: L.LeafletMouseEvent) => void)
    | undefined;
  gestionnaire?.({ latlng: { lat: latitude, lng: longitude } } as L.LeafletMouseEvent);
}

async function stabiliser(fixture: ComponentFixture<SituerStructureDialogComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

async function monter(structure: StructureAdminView = STRUCTURE) {
  const appels: { id: string; payload: Record<string, unknown> }[] = [];
  const admin = {
    updateStructure: (id: string, payload: Record<string, unknown>) => {
      appels.push({ id, payload });
      return of({ success: true });
    },
  };

  TestBed.configureTestingModule({
    imports: [SituerStructureDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AdminService, useValue: admin },
      { provide: I18nService, useValue: { lang: () => 'fr', t: (key: string) => key } },
      { provide: ToastrService, useValue: { success() {}, error() {} } },
    ],
  });

  const fixture = TestBed.createComponent(SituerStructureDialogComponent);
  fixture.componentRef.setInput('structure', structure);
  await stabiliser(fixture);
  return { fixture, c: fixture.componentInstance, appels };
}

describe('dialogue de position des structures', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('sans coordonnées, ne pose pas d’épingle et désactive Enregistrer', async () => {
    const { fixture } = await monter();

    expect(L.marker).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement.querySelector('[data-action="enregistrer"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fixture.destroy();
  });

  it('cadre sur une structure déjà située et y pose une épingle déplaçable', async () => {
    const { fixture } = await monter({
      ...STRUCTURE,
      latitude: 9.545,
      longitude: -13.682,
    });

    expect(mocks.carte.setView).toHaveBeenCalledWith([9.545, -13.682], 16);
    expect(L.marker).toHaveBeenCalledWith(
      [9.545, -13.682],
      expect.objectContaining({ draggable: true }),
    );
    fixture.destroy();
  });

  it('au clic sur la carte, pose une épingle et active Enregistrer', async () => {
    const { fixture } = await monter();

    clicCarte(9.5123456, -13.6123456);
    fixture.detectChanges();

    expect(L.marker).toHaveBeenCalledWith(
      [9.5123456, -13.6123456],
      expect.objectContaining({ draggable: true }),
    );
    expect(
      (fixture.nativeElement.querySelector('[data-action="enregistrer"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fixture.destroy();
  });

  it('envoie uniquement les coordonnées retenues à updateStructure', async () => {
    const { fixture, c, appels } = await monter();
    clicCarte(9.5123456, -13.6123456);

    c.enregistrer();

    expect(appels).toEqual([
      {
        id: 'chu-1',
        payload: { latitude: 9.5123456, longitude: -13.6123456 },
      },
    ]);
    fixture.destroy();
  });

  it('refuse le point (0, 0), ou la carte s ouvre par defaut', async () => {
    // Au zoom 5 la vue est centree la : un clic distrait y tombe, et le
    // serveur le refuserait de toute facon.
    const { c, appels, fixture } = await monter();

    clicCarte(0, 0);

    expect(c.pointInterdit()).toBe(true);
    expect(c.enregistrementDesactive()).toBe(true);
    c.enregistrer();
    expect(appels).toEqual([]);
    fixture.destroy();
  });

  it('détruit la carte à la fermeture de la boîte de dialogue', async () => {
    const { fixture } = await monter();
    fixture.componentInstance.fermer.subscribe(() => fixture.destroy());

    (fixture.nativeElement.querySelector('[data-action="annuler"]') as HTMLButtonElement).click();

    expect(mocks.carte.remove).toHaveBeenCalledTimes(1);
  });
});
