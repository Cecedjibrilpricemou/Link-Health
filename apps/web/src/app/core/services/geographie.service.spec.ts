// Le decoupage du pays (M1) cote web : les noms de niveaux suivent la langue
// de l'utilisateur, et les suggestions se mettent en cache.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { ConfigurationGeoView } from '@baobaoheath/shared-types';

import { GeographieService } from './geographie.service';
import { ApiService } from './api.service';
import { I18nService } from '../../shared/services/i18n.service';

const NIGERIA: ConfigurationGeoView = {
  code: 'NG', nom: 'Nigeria', indicatifTelephone: '+234',
  niveaux: [
    { code: 'state', libelles: { fr: 'État', en: 'State' } },
    { code: 'lga', libelles: { fr: 'Zone de gouvernement local', en: 'LGA' } },
    { code: 'ward', libelles: { fr: 'Quartier' } },
  ],
  niveauBase: 'ward', niveauElargissement: 'lga', jeuDeDepartDisponible: false,
};

function monter(config: ConfigurationGeoView | null = NIGERIA) {
  const get: { url: string; params?: Record<string, string> }[] = [];
  const api = {
    get: (url: string, params?: Record<string, string>) => {
      get.push({ url, params });
      if (url === '/geographie/configuration') return of({ success: true, data: config });
      return of({ success: true, data: [{ nom: 'Ikeja' }, { nom: 'Ikeja' }, { nom: 'Surulere' }] });
    },
  };
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: ApiService, useValue: api }],
  });
  return { geo: TestBed.inject(GeographieService), i18n: TestBed.inject(I18nService), get };
}

describe('GeographieService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('nomme chaque role selon le pays et la langue, en retombant sur le francais', () => {
    const { geo, i18n } = monter();
    geo.chargerConfiguration().subscribe();

    i18n.setLang('en');
    expect(geo.libelle('elargissement')).toBe('LGA');
    // Pas de nom anglais pour ce niveau : le francais sert de repli.
    expect(geo.libelle('base')).toBe('Quartier');

    i18n.setLang('fr');
    expect(geo.libelle('elargissement')).toBe('Zone de gouvernement local');
  });

  it('sans decoupage, garde les libelles par defaut', () => {
    const { geo, i18n } = monter(null);
    i18n.setLang('fr');
    geo.chargerConfiguration().subscribe();
    expect(geo.libelle('base')).toBe('Commune');
    expect(geo.libelle('elargissement')).toBe('Préfecture');
  });

  it('ne charge le decoupage qu une fois', () => {
    const { geo, get } = monter();
    geo.chargerConfiguration().subscribe();
    geo.chargerConfiguration().subscribe();
    expect(get.filter((g) => g.url === '/geographie/configuration')).toHaveLength(1);
  });

  it('suggere les noms du niveau voulu, sans doublon, et les met en cache par zone', () => {
    const { geo, get } = monter();
    geo.chargerConfiguration().subscribe();
    let noms: string[] = [];

    geo.nomsSuggeres('elargissement', ' Lagos ').subscribe((n) => (noms = n));
    geo.nomsSuggeres('elargissement', 'lagos').subscribe();

    expect(noms).toEqual(['Ikeja', 'Surulere']);
    const appels = get.filter((g) => g.url === '/geographie/lieux');
    expect(appels).toEqual([{ url: '/geographie/lieux', params: { niveau: 'lga', dans: 'Lagos' } }]);
  });

  it('sans decoupage charge, ne suggere rien', () => {
    const { geo } = monter();
    let noms: string[] | undefined;
    geo.nomsSuggeres('base').subscribe((n) => (noms = n));
    expect(noms).toEqual([]);
  });
});
