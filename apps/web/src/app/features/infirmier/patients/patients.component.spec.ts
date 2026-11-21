// Les patients en visite, cote infirmier : la liste, le filtre, et quand
// chacun a ete vu pour la derniere fois.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { PatientEnVisiteView } from '@baobaoheath/shared-types';

import { InfirmierPatientsComponent } from './patients.component';
import { InfirmierService } from '../../../core/services/infirmier.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string { return p ? `${cle} ${JSON.stringify(p)}` : cle; }
}

const p = (o: Partial<PatientEnVisiteView>): PatientEnVisiteView => ({
  idEpisode: 'ep', numero: 'EP-1', motif: 'Fièvre', service: null, statut: 'EN_COURS', ouvertLe: '2026-11-21T08:00:00.000Z',
  patient: { id: 'p', prenom: 'Fanta', nom: 'Camara', dateNaissance: '1990-01-01T00:00:00.000Z', sexe: 'F' },
  responsable: null, dernierSoinLe: null, nombreSoins: 0, ...o,
});

function monter(liste: PatientEnVisiteView[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [InfirmierPatientsComponent],
    providers: [
      provideZonelessChangeDetection(), provideNoopAnimations(), provideRouter([]),
      { provide: InfirmierService, useValue: { patients: vi.fn(() => of({ success: true, data: liste })) } },
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });
  const fixture = TestBed.createComponent(InfirmierPatientsComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('les patients en visite', () => {
  it('chaque patient mene a sa visite, et dit s il a ete vu', () => {
    const { el } = monter([p({ idEpisode: 'ep-1' }), p({ idEpisode: 'ep-2', patient: { id: 'q', prenom: 'Alpha', nom: 'Bah', dateNaissance: '1980-01-01T00:00:00.000Z', sexe: 'M' }, dernierSoinLe: '2026-11-21T09:30:00.000Z' })]);
    const cartes = el.querySelectorAll<HTMLAnchorElement>('.bb-inf-patient');
    expect(cartes).toHaveLength(2);
    expect(cartes[0]!.getAttribute('href')).toBe('/infirmier/visites/ep-1');
    expect(cartes[0]!.textContent).toContain('INFIRMIER.PATIENTS.JAMAIS_VU');
    expect(cartes[1]!.textContent).toContain('INFIRMIER.PATIENTS.VU_A');
  });

  it('le filtre porte sur le nom, le numero, le motif et le service', () => {
    const { c } = monter([p({ idEpisode: 'a', service: 'Pédiatrie' }), p({ idEpisode: 'b', motif: 'Plaie', numero: 'EP-9' })]);
    c.recherche.set('pédia');
    expect(c.visibles().map((x) => x.idEpisode)).toEqual(['a']);
    c.recherche.set('ep-9');
    expect(c.visibles().map((x) => x.idEpisode)).toEqual(['b']);
  });
});
