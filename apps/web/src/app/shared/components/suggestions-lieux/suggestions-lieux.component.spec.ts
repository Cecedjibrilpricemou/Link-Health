// Suggestions de lieux (M1) : une <datalist> remplie depuis le referentiel,
// restreinte a la zone englobante, et rechargee quand elle change.
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { ConfigurationGeoView } from '@baobaoheath/shared-types';

import { SuggestionsLieuxComponent } from './suggestions-lieux.component';
import { ApiService } from '../../../core/services/api.service';

const GUINEE: ConfigurationGeoView = {
  code: 'GN', nom: 'Guinée', indicatifTelephone: '+224',
  niveaux: [{ code: 'prefecture', libelles: { fr: 'Préfecture' } }, { code: 'commune', libelles: { fr: 'Commune' } }],
  niveauBase: 'commune', niveauElargissement: 'prefecture', jeuDeDepartDisponible: true,
};

@Component({
  standalone: true,
  imports: [SuggestionsLieuxComponent],
  template: `<app-suggestions-lieux idListe="liste-test" role="base" [dans]="zone()" />`,
})
class Hote {
  readonly zone = signal('Conakry');
}

describe('suggestions de lieux', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('liste les lieux du niveau de base de la zone, et suit la zone', async () => {
    const appels: Record<string, string>[] = [];
    const api = {
      get: (url: string, params: Record<string, string> = {}) => {
        if (url === '/geographie/configuration') return of({ success: true, data: GUINEE });
        appels.push(params);
        const noms = params['dans'] === 'Kindia' ? ['Mambia'] : ['Ratoma', 'Dixinn'];
        return of({ success: true, data: noms.map((nom) => ({ nom })) });
      },
    };
    TestBed.configureTestingModule({
      imports: [Hote],
      providers: [provideZonelessChangeDetection(), { provide: ApiService, useValue: api }],
    });
    const fixture = TestBed.createComponent(Hote);
    fixture.detectChanges();
    await fixture.whenStable();
    const options = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('datalist#liste-test option')]
      .map((o) => (o as HTMLOptionElement).value);

    expect(options()).toEqual(['Ratoma', 'Dixinn']);
    expect(appels[0]).toEqual({ niveau: 'commune', dans: 'Conakry' });

    fixture.componentInstance.zone.set('Kindia');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(options()).toEqual(['Mambia']);
  });
});
