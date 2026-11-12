// R9 : le filtre de l'ecran Analytique ne connait plus de liste guineenne.
// Ce qui compte : les zones viennent du referentiel du pays installe et des
// donnees elles-memes (une zone saisie avant le referentiel reste
// filtrable), sans doublon de casse, triees, et un autre pays n'y voit
// jamais de nom guineen.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AnalyticsComponent } from './analytics.component';
import { AdminService } from '../../../core/services/admin.service';
import { GeographieService } from '../../../core/services/geographie.service';

function monter(referentiel: string[], heatmap: string[], pays = 'Guinée') {
  const admin = {
    getAnalyticsDashboard: () => of({ success: true, data: { kpis: {}, consultationsParStatut: [], topPathologies: [] } }),
    getAnalyticsHeatmap: () => of({ success: true, data: heatmap.map((prefecture) => ({ prefecture, consultations: 1, intensite: 0.5 })) }),
    getAnalyticsAlertes: () => of({ success: true, data: [] }),
    getAnalyticsTendances: () => of({ success: true, data: [] }),
    getAnalyticsCouverture: () => of({ success: true, data: { couverture: [] } }),
    getPublicStructures: () => of({ success: true, data: [] }),
  };
  const geo = {
    configuration: signal({ nom: pays }),
    chargerConfiguration: () => of(null),
    nomsSuggeres: (role: string) => of(role === 'elargissement' ? referentiel : []),
    libelle: () => 'Zone',
  };
  TestBed.configureTestingModule({
    imports: [AnalyticsComponent],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: AdminService, useValue: admin },
      { provide: GeographieService, useValue: geo },
    ],
  });
  const fixture = TestBed.createComponent(AnalyticsComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('analytics : zones du filtre (R9)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('propose les zones du referentiel, puis celles des donnees, sans doublon et triees', () => {
    const { c } = monter(['Kindia', 'Conakry'], ['conakry', 'Pita']);
    expect(c.zonesFiltre()).toEqual(['Conakry', 'Kindia', 'Pita']);
    expect(c.prefiltreOptions.map((o) => o.value)).toEqual(['', 'Conakry', 'Kindia', 'Pita']);
  });

  it('un autre pays ne voit que ses propres zones', () => {
    const { c } = monter(['Dakar', 'Thiès'], [], 'Sénégal');
    expect(c.zonesFiltre()).toEqual(['Dakar', 'Thiès']);
    expect(c.zonesFiltre()).not.toContain('Conakry');
  });

  it('sans referentiel ni donnees, seul « toutes les zones » reste', () => {
    const { c } = monter([], []);
    expect(c.prefiltreOptions.map((o) => o.value)).toEqual(['']);
  });

  it('le sous-titre nomme le pays installe', () => {
    const { el } = monter([], [], 'Sénégal');
    expect(el.querySelector('.bb-page-head__sub')!.textContent).toContain('Sénégal');
  });
});
