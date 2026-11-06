// Tableau de bord patient : chaque consultation achevee propose son compte
// rendu imprimable (EF-05-03). Une consultation en cours n'en a pas encore.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { DashboardComponent } from './dashboard.component';
import { AuthService } from '../../../core/services/auth.service';
import { PatientService } from '../../../core/services/patient.service';
import { VaccinationService } from '../../../core/services/vaccination.service';
import { PaiementService } from '../../../core/services/paiement.service';
import { ConsultationService } from '../../../core/services/consultation.service';

const CONSULTATIONS = [
  { id: 'c-finie', consulteeLE: '2026-11-05T09:00:00.000Z', statut: 'TERMINEE', motifPrincipal: 'Fievre', asc: null },
  { id: 'c-referee', consulteeLE: '2026-11-04T09:00:00.000Z', statut: 'REFERENCEE', motifPrincipal: 'Toux', asc: null },
  { id: 'c-en-cours', consulteeLE: '2026-11-06T09:00:00.000Z', statut: 'EN_COURS', motifPrincipal: 'Douleur', asc: null },
];

function monter() {
  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal({ prenom: 'Fanta', nom: 'Camara' }) } },
      {
        provide: PatientService,
        useValue: {
          getMe: () => of({ success: true, data: null }),
          getMyConsultations: () => of({ success: true, data: CONSULTATIONS, meta: { total: 3 } }),
        },
      },
      { provide: VaccinationService, useValue: { getMyVaccinations: () => of({ success: true, data: [] }) } },
      { provide: PaiementService, useValue: { getHistorique: () => of({ success: true, data: [] }) } },
      { provide: ConsultationService, useValue: { urlCompteRendu: (id: string) => `/api-test/consultations/${id}/compte-rendu` } },
    ],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement };
}

describe('patient : compte rendu depuis le tableau de bord', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  it('propose le compte rendu des seules consultations achevees', () => {
    const { el } = monter();
    expect(el.querySelectorAll('.list-item__print').length).toBe(2);
  });

  it('ouvre le document de la bonne consultation', () => {
    const ouvrir = vi.spyOn(window, 'open').mockReturnValue(null);
    const { el } = monter();

    el.querySelector<HTMLButtonElement>('.list-item__print')!.click();

    expect(ouvrir).toHaveBeenCalledWith('/api-test/consultations/c-finie/compte-rendu', '_blank', 'noopener');
  });
});
