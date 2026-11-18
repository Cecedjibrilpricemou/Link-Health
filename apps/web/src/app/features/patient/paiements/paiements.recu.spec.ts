import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ToastrService } from 'ngx-toastr';

import { PatientPaiementsComponent } from './paiements.component';
import { PaiementService } from '../../../core/services/paiement.service';
import { I18nService } from '../../../shared/services/i18n.service';

const FACTURES = [
  { id: 'fac-payee', montantGnf: 150000, statut: 'PAYEE', consultation: { motifPrincipal: 'Consultation' } },
  { id: 'fac-attente', montantGnf: 10000, statut: 'EN_ATTENTE', consultation: { motifPrincipal: 'Consultation' } },
];

describe('patient : reçu de paiement', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientPaiementsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ToastrService, useValue: { error: vi.fn(), info: vi.fn(), success: vi.fn() } },
        { provide: I18nService, useValue: { lang: signal('fr'), t: (key: string) => key } },
        {
          provide: PaiementService,
          useValue: {
            aRegler: () => of({ success: true, data: [] }),
            getHistorique: () => of({ success: true, data: FACTURES, meta: { total: 2 } }),
            urlRecu: (id: string) => `/api-test/paiements/factures/${id}/recu`,
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('n affiche le bouton que sur les factures payees', () => {
    const fixture = TestBed.createComponent(PatientPaiementsComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.bb-pay__btn--plat .pi-print').length).toBe(1);
  });

  it('ouvre le reçu de la facture payée', () => {
    const ouvrir = vi.spyOn(window, 'open').mockReturnValue(null);
    const fixture = TestBed.createComponent(PatientPaiementsComponent);
    fixture.detectChanges();

    const boutonRecu = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.bb-pay__carte--reglee button');
    boutonRecu!.click();

    expect(ouvrir).toHaveBeenCalledWith(
      '/api-test/paiements/factures/fac-payee/recu',
      '_blank',
      'noopener',
    );
  });
});
