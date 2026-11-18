// Compte rendu de consultation (EF-05-03) : un bouton dans l'en-tete de la
// consultation, pour l'ASC comme pour le medecin, qui ouvre le document rendu
// par l'API.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ConsultationDetailComponent } from './consultation-detail.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { MedecinService } from '../../../core/services/medecin.service';
import { ConsultationService } from '../../../core/services/consultation.service';
import { OrdonnanceService } from '../../../core/services/ordonnance.service';
import { environment } from '../../../../environments/environment';

const CONSULTATION = {
  id: 'c1', statut: 'TERMINEE', motifPrincipal: 'Fievre', consulteeLE: '2026-11-05T09:00:00.000Z',
  constantes: null, diagnostics: [], ordonnances: [],
  patient: { allergies: [], utilisateur: { prenom: 'Aissatou', nom: 'Diallo', telephone: '620000000' } },
};

function monter(role = 'ASC') {
  TestBed.configureTestingModule({
    imports: [ConsultationDetailComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: ConsultationService,
        useValue: {
          getConsultationById: () => of({ success: true, data: structuredClone(CONSULTATION) }),
          urlCompteRendu: (id: string) => `/api-test/consultations/${id}/compte-rendu`,
        },
      },
      { provide: ApiService, useValue: { get: () => of({ success: true, data: [] }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'c1' } } } },
      { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      { provide: AuthService, useValue: { userRole: signal(role) } },
      { provide: MedecinService, useValue: {} },
      { provide: OrdonnanceService, useValue: { urlDocument: () => '' } },
    ],
  });
  const fixture = TestBed.createComponent(ConsultationDetailComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('consultation : compte rendu imprimable', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  for (const role of ['ASC', 'MEDECIN']) {
    it(`ouvre le compte rendu rendu par l API (${role})`, () => {
      const ouvrir = vi.spyOn(window, 'open').mockReturnValue(null);
      const { el } = monter(role);

      const bouton = el.querySelector<HTMLButtonElement>('.bb-detail__cr-print');
      expect(bouton).not.toBeNull();
      bouton!.click();

      expect(ouvrir).toHaveBeenCalledWith('/api-test/consultations/c1/compte-rendu', '_blank', 'noopener');
    });
  }

  it('l adresse du document est celle de l API', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: ApiService, useValue: {} }],
    });
    const service = TestBed.inject(ConsultationService);
    expect(service.urlCompteRendu('c9')).toBe(`${environment.apiUrl}/consultations/c9/compte-rendu`);
  });
});
