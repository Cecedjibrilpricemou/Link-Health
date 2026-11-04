// Analytics : un graphique a une seule barre, « Structures de sante : 2 » a
// cote d'une liste de 8 structures, et une jauge de vaccination qui divisait
// des doses par des patients. Chaque indicateur dit desormais ce qu'il compte.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AnalyticsComponent } from './analytics.component';
import { AdminService } from '../../../core/services/admin.service';

function monter(statuts: { statut: string; count: number }[]) {
  const admin = {
    getAnalyticsDashboard: () => of({ success: true, data: {
      kpis: { totalPatients: 10, totalConsultations: 30, totalVaccinations: 25, patientsVaccines: 4, totalReferencements: 3, totalAsc: 2 },
      consultationsParStatut: statuts, topPathologies: [],
    } }),
    getAnalyticsHeatmap: () => of({ success: true, data: [] }),
    getAnalyticsAlertes: () => of({ success: true, data: [] }),
    getAnalyticsTendances: () => of({ success: true, data: [] }),
    getAnalyticsCouverture: () => of({ success: true, data: { couverture: [] } }),
    getPublicStructures: () => of({ success: true, data: [
      { id: '1', nom: 'CHU', type: 'CHU', prefecture: 'Conakry' },
      { id: '2', nom: 'Centre', type: 'CENTRE', prefecture: 'Pita' },
    ] }),
  };
  TestBed.configureTestingModule({
    imports: [AnalyticsComponent],
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: AdminService, useValue: admin }],
  });
  const fixture = TestBed.createComponent(AnalyticsComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('analytics : indicateurs définis', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('jauge : patients vaccinés au moins une fois / patients (4/10), pas doses / patients', () => {
    const el = monter([]);
    expect(el.querySelector('.bb-gauge__pct')!.textContent!.trim()).toBe('40%');
  });

  it('ne dessine pas de graphique pour un seul statut, et le dit en clair', () => {
    const el = monter([{ statut: 'TERMINEE', count: 30 }]);
    expect(el.querySelector('.bb-cols')).toBeNull();
    const phrase = el.querySelector('.bb-unique')!.textContent!;
    expect(phrase).toContain('30');
    expect(phrase).toContain('Terminée');
  });

  it('garde le graphique dès deux statuts', () => {
    const el = monter([{ statut: 'TERMINEE', count: 20 }, { statut: 'EN_COURS', count: 10 }]);
    expect(el.querySelectorAll('.bb-cols__item').length).toBe(2);
  });

  it('définit chaque carte de synthèse', () => {
    const el = monter([]);
    const cartes = [...el.querySelectorAll('.bb-kpi')];
    expect(cartes.length).toBe(5);
    for (const c of cartes) expect(c.querySelector('.bb-kpi__def')?.textContent?.trim().length ?? 0).toBeGreaterThan(10);
  });

  it('dit ce que compte le panneau des structures', () => {
    const el = monter([]);
    const panneau = [...el.querySelectorAll('.bb-panel')].find((p) => p.querySelector('.bb-chip'))!;
    expect(panneau.querySelector('.bb-panel__title')!.textContent).toContain('actives');
    expect(panneau.querySelector('.bb-panel__def')!.textContent).toMatch(/pharmacies/i);
  });
});
