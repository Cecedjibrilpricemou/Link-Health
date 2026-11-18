// L'adresse du patient (M3). Ce qui compte : la position n'est enregistree
// que d'un geste du patient, il la voit avant, et il peut l'effacer ; changer
// son point de repere n'efface pas sa position en silence.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { AdressePatientView, DefinirAdresseDto } from '@baobaoheath/shared-types';

import { AdressePatientComponent } from './adresse.component';
import { PatientService } from '../../../../core/services/patient.service';

const VIDE: AdressePatientView = {
  prefecture: 'Conakry', commune: null, quartier: null, pointRepere: null,
  latitude: null, longitude: null, positionLe: null,
};
const AVEC_POSITION: AdressePatientView = {
  prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee',
  latitude: 9.64, longitude: -13.58, positionLe: '2026-11-11T10:00:00.000Z',
};

function monter(adresse: AdressePatientView) {
  const envois: DefinirAdresseDto[] = [];
  const service = {
    monAdresse: () => of({ success: true, data: adresse }),
    definirAdresse: (dto: DefinirAdresseDto) => {
      envois.push(dto);
      return of({ success: true, data: { ...adresse, ...dto, latitude: dto.latitude ?? (dto.effacerPosition ? null : adresse.latitude),
        longitude: dto.longitude ?? (dto.effacerPosition ? null : adresse.longitude) } });
    },
  };
  TestBed.configureTestingModule({
    imports: [AdressePatientComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PatientService, useValue: service },
      { provide: ToastrService, useValue: { success() {}, error() {} } },
    ],
  });
  const fixture = TestBed.createComponent(AdressePatientComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, envois };
}

function simulerGps(lat: number, lng: number) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition) },
  });
}

describe('adresse du patient', () => {
  const geoOrigine = navigator.geolocation;
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geoOrigine }));

  it('invite a completer une adresse vide, et n enregistre pas sans commune ni quartier', () => {
    const { c, el, envois } = monter(VIDE);
    expect(el.querySelector('.adresse__alerte')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('#adresse-enregistrer')!.disabled).toBe(true);

    c.enregistrer();
    expect(envois).toHaveLength(0);
  });

  it('enregistre commune, quartier et repere, sans position tant que le patient n en donne pas', () => {
    const { c, envois } = monter(VIDE);
    c.form = { commune: ' Ratoma ', quartier: 'Kipé', pointRepere: 'Portail bleu' };

    c.enregistrer();

    expect(envois).toEqual([{ commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Portail bleu' }]);
  });

  it('montre la position trouvee avant de l enregistrer, et l envoie avec l adresse', () => {
    simulerGps(9.6412345678, -13.5787654321);
    const { c, el, rendre, envois } = monter(VIDE);
    c.form = { commune: 'Ratoma', quartier: 'Kipé', pointRepere: '' };

    el.querySelector<HTMLButtonElement>('#adresse-gps')!.click();
    rendre();

    // Vue, mais pas encore envoyee.
    expect(el.querySelector('#adresse-position-proposee')!.textContent).toContain('9.641235');
    expect(envois).toHaveLength(0);

    c.enregistrer();
    expect(envois[0]).toMatchObject({ latitude: 9.641235, longitude: -13.578765 });
  });

  it('une position trouvee puis ecartee n est pas envoyee', () => {
    simulerGps(9.64, -13.58);
    const { c, el, rendre, envois } = monter({ ...VIDE, commune: 'Ratoma', quartier: 'Kipé' });

    el.querySelector<HTMLButtonElement>('#adresse-gps')!.click();
    rendre();
    c.oublierPositionProposee();
    c.enregistrer();

    expect(envois[0]).not.toHaveProperty('latitude');
  });

  // Changer de repere ne doit pas effacer le GPS en silence.
  it('modifier le repere garde la position deja enregistree', () => {
    const { c, envois } = monter(AVEC_POSITION);
    c.form.pointRepere = 'Pres du marche';

    c.enregistrer();

    expect(envois[0]).not.toHaveProperty('latitude');
    expect(envois[0]).not.toHaveProperty('effacerPosition');
  });

  it('effacer sa position l envoie explicitement, et propose de nouveau d en donner une', () => {
    const { el, rendre, envois } = monter(AVEC_POSITION);

    el.querySelector<HTMLButtonElement>('#adresse-effacer-position')!.click();
    rendre();

    expect(envois).toEqual([{ commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee', effacerPosition: true }]);
    expect(el.querySelector('#adresse-gps')).not.toBeNull();
  });

  // R8 : un patient qui demenage change lui-meme de prefecture.
  it('sans changement de prefecture, elle ne part pas et rien n est annonce', () => {
    const { c, el, envois } = monter(AVEC_POSITION);
    c.changerPrefecture(' conakry ');
    expect(c.demenage).toBe(false);
    expect(el.querySelector('#adresse-demenagement')).toBeNull();

    c.enregistrer();
    expect(envois[0]).not.toHaveProperty('prefecture');
  });

  it('changer de prefecture vide l ancienne adresse, l annonce, puis l envoie', () => {
    const { c, el, rendre, envois } = monter(AVEC_POSITION);

    c.changerPrefecture('Kindia');
    rendre();

    expect(c.prefecture()).toBe('Kindia');
    expect(c.form).toEqual({ commune: '', quartier: '', pointRepere: '' });
    expect(el.querySelector('#adresse-demenagement')!.textContent).toContain('Kindia');
    // Pas d'envoi tant que la nouvelle adresse n'est pas complete.
    c.enregistrer();
    expect(envois).toHaveLength(0);

    c.form.commune = 'Kindia-Centre';
    c.form.quartier = 'Banlieue';
    c.enregistrer();
    expect(envois).toEqual([{ prefecture: 'Kindia', commune: 'Kindia-Centre', quartier: 'Banlieue', pointRepere: '' }]);
  });

  it('revenir a l ancienne prefecture rend l ancienne adresse', () => {
    const { c } = monter(AVEC_POSITION);
    c.changerPrefecture('Kindia');
    c.changerPrefecture('Conakry');
    expect(c.prefecture()).toBe('Conakry');
    expect(c.form).toEqual({ commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee' });
  });

  it('une prefecture vide bloque l enregistrement', () => {
    const { c, envois } = monter(AVEC_POSITION);
    c.changerPrefecture('  ');
    expect(c.complete).toBe(false);
    c.enregistrer();
    expect(envois).toHaveLength(0);
  });

  it('signale une position introuvable sans rien enregistrer', () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, ko: PositionErrorCallback) => ko({} as GeolocationPositionError) },
    });
    const { el, rendre, envois } = monter(VIDE);

    el.querySelector<HTMLButtonElement>('#adresse-gps')!.click();
    rendre();

    expect(el.querySelector('.adresse__erreur')).not.toBeNull();
    expect(envois).toHaveLength(0);
  });
});
