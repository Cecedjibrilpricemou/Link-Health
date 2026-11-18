// Ou livrer (M3) : le motard voit le quartier, le point de repere et, si le
// patient l'a donnee, un itineraire jusqu'a sa position.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { CourseLivreurView } from '@baobaoheath/shared-types';

import { LivreurMesCoursesComponent } from './mes-courses.component';
import { CourseService } from '../../../core/services/course.service';

const COURSE = {
  id: 'course-1', numero: 'LV-2026-000001', statut: 'EN_COURS', quartier: 'Kipé', prefecture: 'Conakry',
  prixGnf: 15000, delaiAnnonceMinutes: 25, creeeLe: '2026-11-11T09:00:00.000Z',
  attribueeLe: null, remiseLe: null, livreeLe: null, pharmacie: { id: 'ph-1', nom: 'Pharmacie Nounie' },
  patient: { prenom: 'Awa', nom: 'Diallo', telephone: '+224600000000' },
} as CourseLivreurView;

function monter(course: CourseLivreurView) {
  TestBed.configureTestingModule({
    imports: [LivreurMesCoursesComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: CourseService, useValue: { mesCourses: () => of({ success: true, data: { qrCode: '', courses: [course] } }) } },
      { provide: ToastrService, useValue: { success() {}, error() {} } },
    ],
  });
  const fixture = TestBed.createComponent(LivreurMesCoursesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('mes courses : ou livrer', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('montre quartier, commune, repere et un itineraire vers la position du patient', () => {
    const { el } = monter({
      ...COURSE,
      adresseLivraison: { commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee', latitude: 9.64, longitude: -13.58 },
    });

    const bloc = el.querySelector('.bb-livreur__adresse')!;
    expect(bloc.textContent).toContain('Kipé, Ratoma');
    expect(bloc.textContent).toContain('Derriere la mosquee');
    const lien = el.querySelector<HTMLAnchorElement>('.bb-livreur__itineraire')!;
    expect(lien.href).toBe('https://www.google.com/maps/dir/?api=1&destination=9.64,-13.58');
    expect(lien.rel).toContain('noopener');
  });

  it('sans position, pas d itineraire, mais le repere reste', () => {
    const { el } = monter({
      ...COURSE,
      adresseLivraison: { commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Portail bleu', latitude: null, longitude: null },
    });

    expect(el.querySelector('.bb-livreur__itineraire')).toBeNull();
    expect(el.querySelector('.bb-livreur__adresse')!.textContent).toContain('Portail bleu');
  });

  it('sans adresse fournie par l API (course finie), rien n est affiche', () => {
    const { el } = monter({ ...COURSE, statut: 'LIVREE' } as CourseLivreurView);
    expect(el.querySelector('.bb-livreur__adresse')).toBeNull();
  });
});
