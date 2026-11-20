// L'ecran de l'accueil suit la file en direct.
//
// Quand le medecin appelle un patient, ou qu'un collegue en pointe un autre,
// l'ecran se met a jour sans rechargement : l'agent sait vers quel bureau
// orienter, et qui attend encore.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { PresenceDuJourView } from '@baobaoheath/shared-types';

import { PresencesComponent } from './presences.component';
import { HopitalService } from '../../../core/services/hopital.service';
import { SocketService } from '../../../core/services/socket.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string): string { return cle; }
}

function presence(statut: PresenceDuJourView['statut']): PresenceDuJourView {
  return {
    idRendezVous: 'rdv-1', prevuLe: new Date().toISOString(), statut, arriveeLe: null,
    patient: { id: 'pat-1', prenom: 'Awa', nom: 'Bah', telephone: '620000000' },
    medecin: { id: 'med-1', prenom: 'David', nom: 'Camara', bureau: 'Bureau 3' },
    idEpisode: 'ep-1',
  };
}

afterEach(() => vi.useRealTimers());

describe('l accueil suit la file en direct', () => {
  it('se met a jour quand le medecin appelle le patient', () => {
    vi.useFakeTimers();
    const evenements = new Subject<unknown>();
    let donnees = [presence('PRESENT')];
    const presencesDuJour = vi.fn(() => of({ success: true, data: donnees }));

    TestBed.configureTestingModule({
      imports: [PresencesComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: HopitalService, useValue: { presencesDuJour, pointerPresence: vi.fn() } },
        { provide: SocketService, useValue: { on: vi.fn((nom: string) => (nom === 'rendez-vous:maj' ? evenements : new Subject())) } },
        { provide: I18nService, useClass: I18nMaquette },
        { provide: ToastrService, useValue: { error: vi.fn(), success: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(PresencesComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.presences()[0]!.statut).toBe('PRESENT');

    donnees = [presence('EN_CONSULTATION')];
    evenements.next({ idRendezVous: 'rdv-1', statut: 'EN_CONSULTATION' });
    vi.advanceTimersByTime(300);

    expect(presencesDuJour).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.presences()[0]!.statut).toBe('EN_CONSULTATION');
  });
});
