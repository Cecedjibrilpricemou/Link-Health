// La file d'attente du medecin.
//
// Ce que ce fichier tient :
//   - la file suit l'ordre d'ARRIVEE, pas celui des creneaux : un patient venu
//     en avance pour 11 h ne passe pas devant celui qui attend depuis 9 h ;
//   - « Appeler le suivant » prend le premier arrive, et rien tant qu'un
//     patient est dans le cabinet ;
//   - le temps d'attente se lit en clair et avance tout seul ;
//   - un pointage a l'accueil met la file a jour sans rechargement.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { RendezVousMedecinView, StatutRendezVous } from '@baobaoheath/shared-types';

import { AgendaComponent, EVENEMENT_RENDEZ_VOUS } from './agenda.component';
import { MedecinService } from '../../../core/services/medecin.service';
import { SocketService } from '../../../core/services/socket.service';
import { I18nService } from '../../../shared/services/i18n.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string {
    return p ? `${cle} ${JSON.stringify(p)}` : cle;
  }
}

/** Aujourd'hui a l'heure dite, pour des arrivees et des creneaux lisibles. */
function aujourdhui(h: number, m = 0): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function rdv(id: string, statut: StatutRendezVous, prevu: string, arrivee: string | null): RendezVousMedecinView {
  return {
    id, statut, prevuLe: prevu, arriveeLe: arrivee, motif: null,
    patient: { id: `pat-${id}`, prenom: `Prenom-${id}`, nom: 'Bah', dateNaissance: '1990-01-01', sexe: 'F', telephone: '620000000' },
    idEpisode: `ep-${id}`, numeroEpisode: null,
  };
}

function monter(liste: RendezVousMedecinView[]) {
  const evenements = new Subject<unknown>();
  let donnees = liste;
  const getAgenda = vi.fn(() => of({ success: true, data: donnees }));
  const changerStatutRendezVous = vi.fn((id: string, statut: StatutRendezVous) =>
    of({ success: true, data: { ...donnees.find((r) => r.id === id)!, statut } }));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AgendaComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: MedecinService, useValue: { getAgenda, changerStatutRendezVous } },
      { provide: SocketService, useValue: { on: vi.fn((nom: string) => (nom === EVENEMENT_RENDEZ_VOUS ? evenements : new Subject())) } },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(AgendaComponent);
  fixture.detectChanges();
  return {
    fixture, c: fixture.componentInstance, getAgenda, changerStatutRendezVous, evenements,
    remplacer: (l: RendezVousMedecinView[]) => { donnees = l; },
  };
}

afterEach(() => vi.useRealTimers());

describe('la file d attente du medecin', () => {
  it('suit l ordre d arrivee, pas celui des creneaux', () => {
    const { c } = monter([
      // Creneau de 11 h, mais arrive a 9 h 40.
      rdv('tot', 'PRESENT', aujourdhui(11), aujourdhui(9, 40)),
      // Creneau de 9 h, arrive a 9 h 55.
      rdv('tard', 'PRESENT', aujourdhui(9), aujourdhui(9, 55)),
      rdv('pas-la', 'PLANIFIE', aujourdhui(10), null),
    ]);

    expect(c.fileAttente().map((r) => r.id)).toEqual(['tot', 'tard']);
  });

  it('n y met ni les patients pas encore arrives, ni ceux deja vus', () => {
    const { c } = monter([
      rdv('attendu', 'PLANIFIE', aujourdhui(10), null),
      rdv('vu', 'TERMINE', aujourdhui(8), aujourdhui(7, 50)),
      rdv('absent', 'ABSENT', aujourdhui(8), null),
      rdv('la', 'PRESENT', aujourdhui(9), aujourdhui(8, 55)),
    ]);

    expect(c.fileAttente().map((r) => r.id)).toEqual(['la']);
  });

  it('appelle le premier arrive', () => {
    const { c, changerStatutRendezVous } = monter([
      rdv('b', 'PRESENT', aujourdhui(9), aujourdhui(9, 30)),
      rdv('a', 'PRESENT', aujourdhui(10), aujourdhui(9, 10)),
    ]);

    c.appelerSuivant();

    expect(changerStatutRendezVous).toHaveBeenCalledWith('a', 'EN_CONSULTATION');
  });

  // Un medecin ne recoit qu'un patient a la fois : l'accueil croirait sinon
  // le bureau libre pour deux.
  it('n appelle personne tant qu un patient est dans le cabinet, et le dit', () => {
    const { c, fixture, changerStatutRendezVous } = monter([
      rdv('dedans', 'EN_CONSULTATION', aujourdhui(9), aujourdhui(8, 50)),
      rdv('attend', 'PRESENT', aujourdhui(10), aujourdhui(9, 20)),
    ]);
    fixture.detectChanges();

    c.appelerSuivant();
    expect(changerStatutRendezVous).not.toHaveBeenCalled();

    const el = fixture.nativeElement as HTMLElement;
    expect((el.querySelector('.bb-agenda__suivant') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('.bb-agenda__appeler') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('.bb-agenda__card--consultation')?.textContent).toContain('Prenom-dedans');
    expect(el.textContent).toContain('MEDECIN.AGENDA.TERMINER_AVANT');
  });

  it('affiche le rang de chacun dans la file', () => {
    const { fixture } = monter([
      rdv('a', 'PRESENT', aujourdhui(9), aujourdhui(9, 10)),
      rdv('b', 'PRESENT', aujourdhui(9), aujourdhui(9, 20)),
    ]);
    fixture.detectChanges();

    const rangs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.bb-agenda__file .bb-agenda__rang')]
      .map((e) => e.textContent?.trim());
    expect(rangs).toEqual(['1', '2']);
  });

  it('dit depuis combien de temps chacun attend, et l heure avance toute seule', () => {
    vi.useFakeTimers();
    const arrivee = new Date();
    vi.setSystemTime(arrivee);
    const { c } = monter([rdv('a', 'PRESENT', arrivee.toISOString(), arrivee.toISOString())]);
    const r = c.fileAttente()[0]!;

    expect(c.attente(r)).toBe('MEDECIN.AGENDA.ATTENTE_INSTANT');

    vi.advanceTimersByTime(12 * 60_000);
    expect(c.attente(r)).toBe('MEDECIN.AGENDA.ATTENTE_MIN {"n":12}');

    vi.advanceTimersByTime(53 * 60_000);
    expect(c.attente(r)).toBe('MEDECIN.AGENDA.ATTENTE_H {"h":1,"m":"05"}');
  });

  it('se met a jour quand l accueil pointe un patient, sans rechargement', async () => {
    vi.useFakeTimers();
    const { c, getAgenda, evenements, remplacer } = monter([]);
    expect(c.fileAttente()).toEqual([]);

    remplacer([rdv('nouveau', 'PRESENT', aujourdhui(10), new Date().toISOString())]);
    evenements.next({ idRendezVous: 'nouveau', statut: 'PRESENT' });
    vi.advanceTimersByTime(300);

    expect(getAgenda).toHaveBeenCalledTimes(2);
    expect(c.fileAttente().map((r) => r.id)).toEqual(['nouveau']);
    // Un rechargement venu de la socket ne fait pas clignoter l'ecran.
    expect(c.isLoading()).toBe(false);
  });

  it('dit quand personne n attend', () => {
    const { fixture } = monter([rdv('a', 'PLANIFIE', aujourdhui(10), null)]);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('MEDECIN.AGENDA.FILE_VIDE');
  });

  it.each([['fr', fr], ['en', en]] as const)('%s porte les textes de la file', (_langue, catalogue) => {
    const agenda = (catalogue as Record<string, any>)['MEDECIN']['AGENDA'];
    for (const cle of ['FILE_TITRE', 'FILE_VIDE', 'APPELER_SUIVANT', 'APPELER', 'EN_CONSULTATION',
      'TERMINER_AVANT', 'RANG', 'PREVU', 'ATTENTE_INSTANT', 'ATTENTE_MIN', 'ATTENTE_H']) {
      expect(agenda[cle], cle).toBeTruthy();
    }
    expect(agenda['ATTENTE_MIN']).toContain('{{n}}');
    expect(agenda['ATTENTE_H']).toContain('{{h}}');
  });
});
