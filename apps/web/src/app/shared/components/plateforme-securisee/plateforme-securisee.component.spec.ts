// Pied des ecrans de connexion. Ce qui compte : il nomme le pays installe et
// son drapeau, jamais un pays ecrit en dur ; tant que la configuration n'est
// pas la, il n'en nomme aucun.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import type { ConfigurationGeoView } from '@baobaoheath/shared-types';

import { PlateformeSecuriseeComponent } from './plateforme-securisee.component';
import { ApiService } from '../../../core/services/api.service';
import { drapeauDe } from '../../../core/services/geographie.service';

const config = (code: string, nom: string) =>
  ({ code, nom, indicatifTelephone: '+0', niveaux: [], niveauBase: 'a', niveauElargissement: 'b', jeuDeDepartDisponible: false }) as ConfigurationGeoView;

function monter(reponse: Observable<unknown>) {
  TestBed.configureTestingModule({
    imports: [PlateformeSecuriseeComponent],
    providers: [provideZonelessChangeDetection(), { provide: ApiService, useValue: { get: () => reponse } }],
  });
  const fixture = TestBed.createComponent(PlateformeSecuriseeComponent);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent!.trim();
}

describe('drapeauDe', () => {
  it('tire le drapeau du code ISO', () => {
    expect(drapeauDe('GN')).toBe('🇬🇳');
    expect(drapeauDe('sn')).toBe('🇸🇳');
    expect(drapeauDe(' NG ')).toBe('🇳🇬');
  });

  it('un code invalide ne donne rien', () => {
    expect(drapeauDe('GIN')).toBe('');
    expect(drapeauDe('G1')).toBe('');
    expect(drapeauDe(null)).toBe('');
  });
});

describe('pied « plateforme sécurisée »', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('nomme le pays installe, avec son drapeau', () => {
    expect(monter(of({ success: true, data: config('GN', 'Guinée') }))).toBe('Plateforme sécurisée · Guinée 🇬🇳');
  });

  it('un autre pays : le sien, jamais la Guinee', () => {
    const texte = monter(of({ success: true, data: config('SN', 'Sénégal') }));
    expect(texte).toBe('Plateforme sécurisée · Sénégal 🇸🇳');
    expect(texte).not.toContain('Guinée');
  });

  it('configuration pas encore chargee : aucun pays nomme', () => {
    expect(monter(new Subject())).toBe('Plateforme sécurisée');
  });
});
