// Structures et referentiel geographique (M1) : les noms de niveaux et les
// zones proposees viennent du pays installe. Le repli guineen ne sert que tant
// que le referentiel est vide, et jamais a un autre pays.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { ConfigurationGeoView } from '@baobaoheath/shared-types';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';
import { ApiService } from '../../../core/services/api.service';

const GUINEE: ConfigurationGeoView = {
  code: 'GN', nom: 'Guinée', indicatifTelephone: '+224',
  niveaux: [
    { code: 'region', libelles: { fr: 'Région' } },
    { code: 'prefecture', libelles: { fr: 'Préfecture' } },
    { code: 'commune', libelles: { fr: 'Commune' } },
  ],
  niveauBase: 'commune', niveauElargissement: 'prefecture', jeuDeDepartDisponible: true,
};
const SENEGAL: ConfigurationGeoView = {
  code: 'SN', nom: 'Sénégal', indicatifTelephone: '+221',
  niveaux: [
    { code: 'region', libelles: { fr: 'Région' } },
    { code: 'departement', libelles: { fr: 'Département' } },
    { code: 'commune', libelles: { fr: 'Commune' } },
  ],
  niveauBase: 'commune', niveauElargissement: 'departement', jeuDeDepartDisponible: false,
};

function monter(config: ConfigurationGeoView, zones: string[]) {
  const api = {
    get: (url: string) => url === '/geographie/configuration'
      ? of({ success: true, data: config })
      : of({ success: true, data: zones.map((nom, i) => ({ id: `z${i}`, nom })) }),
  };
  TestBed.configureTestingModule({
    imports: [StructuresComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ApiService, useValue: api },
      { provide: AdminService, useValue: { getStructures: () => of({ success: true, data: [] }) } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(StructuresComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance };
}

describe('structures : referentiel geographique', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('propose les zones du referentiel quand il est rempli', () => {
    const { c } = monter(GUINEE, ['Conakry', 'Kindia']);
    expect(c.prefectures().map((p) => p.value)).toEqual(['Conakry', 'Kindia']);
  });

  // R9 : plus de liste guineenne ecrite dans le code, meme en Guinee. Tant
  // que le referentiel est vide, la zone se saisit librement.
  it('Guinee sans referentiel : aucune liste ecrite en dur, la zone se saisit', () => {
    const { c } = monter(GUINEE, []);
    expect(c.prefectures()).toEqual([]);
    expect(c.saisieLibreZone()).toBe(true);
  });

  it('referentiel rempli : la zone se choisit dans la liste', () => {
    const { c } = monter(GUINEE, ['Conakry']);
    expect(c.saisieLibreZone()).toBe(false);
  });

  // Un autre pays n'herite jamais de noms guineens.
  it('autre pays sans referentiel : aucune zone guineenne proposee', () => {
    const { c } = monter(SENEGAL, []);
    expect(c.prefectures()).toEqual([]);
  });

  it('nomme les niveaux selon le pays installe', () => {
    const { c } = monter(SENEGAL, ['Dakar']);
    expect(c.geo.libelle('elargissement')).toBe('Département');
    expect(c.geo.libelle('base')).toBe('Commune');
  });
});
