// « Mon parcours » : la frise et le fil de chaque visite (P5, EF-06-01).
//
// Ce que ce fichier tient :
//   - le fil s'affiche dans l'ordre recu, date, avec un lien vers l'ecran de
//     l'etape quand il en a un ;
//   - un rendez-vous a venir est dit « a venir » ;
//   - la frise suit le fil : l'ordonnance, la pharmacie et la livraison ne
//     sont plus « bientot », elles sont faites, en cours ou a faire.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { EpisodePatientView, EtapeFilView } from '@baobaoheath/shared-types';

import { ParcoursComponent } from './parcours.component';
import { HopitalService } from '../../../core/services/hopital.service';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string { return p?.['detail'] ? `${cle}|${p['detail']}` : cle; }
}

const etape = (type: EtapeFilView['type'], le: string, detail: string | null = null, aVenir?: boolean): EtapeFilView =>
  ({ type, le, detail, ...(aVenir ? { aVenir } : {}) });

function visite(fil: EtapeFilView[], o: Partial<EpisodePatientView> = {}): EpisodePatientView {
  return {
    id: 'ep-1', numero: 'EP-1', motif: 'Fièvre', service: null, statut: 'EN_COURS',
    ouvertLe: '2026-11-10T09:00:00.000Z', closLe: null,
    structure: { id: 's', nom: 'Centre', type: 'CENTRE', prefecture: 'Conakry' },
    responsable: null, demandesAnalyse: [], rendezVous: [], fil, ...o,
  } as EpisodePatientView;
}

function monter(episodes: EpisodePatientView[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ParcoursComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: HopitalService, useValue: { mesEpisodes: () => of({ success: true, data: episodes }) } },
      { provide: LaboratoireService, useValue: {} },
      { provide: ToastrService, useValue: { error: () => {} } },
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });
  const fixture = TestBed.createComponent(ParcoursComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

const LIVREE = [
  etape('VISITE_OUVERTE', '2026-11-10T09:00:00.000Z'),
  etape('CONSULTATION', '2026-11-11T10:00:00.000Z'),
  etape('ORDONNANCE', '2026-11-11T10:05:00.000Z', 'OR-1'),
  etape('COMMANDE', '2026-11-11T10:06:00.000Z', 'CM-1'),
  etape('PAIEMENT', '2026-11-11T11:00:00.000Z', 'CM-1'),
  etape('PRETE', '2026-11-11T12:00:00.000Z', 'LIVRAISON'),
  etape('LIVREE', '2026-11-11T15:00:00.000Z'),
];

describe('le fil de la visite', () => {
  it('chaque etape, dans l ordre, avec un lien vers son ecran', () => {
    const { el } = monter([visite(LIVREE)]);
    const lignes = [...el.querySelectorAll<HTMLElement>('.bb-fil__etape')];
    expect(lignes.map((l) => l.dataset['type'])).toEqual(['VISITE_OUVERTE', 'CONSULTATION', 'ORDONNANCE', 'COMMANDE', 'PAIEMENT', 'PRETE', 'LIVREE']);
    expect(lignes[2]!.textContent).toContain('PATIENT.FIL.ORDONNANCE|OR-1');
    expect(lignes[2]!.querySelector('a')?.getAttribute('href')).toBe('/patient/ordonnances');
    expect(lignes[4]!.querySelector('a')?.getAttribute('href')).toBe('/patient/paiements');
    // Le mode de remise se traduit.
    expect(lignes[5]!.textContent).toContain('PATIENT.FIL.PRETE|PATIENT.FIL.MODE_LIVRAISON');
  });

  it('un rendez-vous a venir est dit tel', () => {
    const { el } = monter([visite([etape('VISITE_OUVERTE', '2026-11-10T09:00:00.000Z'), etape('RENDEZ_VOUS', '2026-12-01T09:00:00.000Z', null, true)])]);
    const rdv = el.querySelector<HTMLElement>('[data-type="RENDEZ_VOUS"]')!;
    expect(rdv.classList).toContain('bb-fil__etape--avenir');
    expect(rdv.textContent).toContain('PATIENT.FIL.A_VENIR');
  });

  // La responsable de la visite peut etre une sage-femme : ni « Medecin »,
  // ni « Dr » devant son nom.
  it('une sage-femme responsable est nommee comme telle', () => {
    const { el } = monter([visite([], { responsable: { id: 'sf', prenom: 'Awa', nom: 'Keita', role: 'SAGE_FEMME' } })]);
    const ligne = el.querySelector('.bb-hop-sub__line')!.textContent!;
    expect(ligne).toContain('ROLE.SAGE_FEMME');
    expect(ligne).not.toContain('PATIENT.PARCOURS.RESPONSABLE');
    expect(ligne).not.toContain('Dr ');
  });

  it('sans fil, pas de bloc vide', () => {
    const { el } = monter([visite([])]);
    expect(el.querySelector('.bb-fil')).toBeNull();
  });
});

describe('la frise suit le fil', () => {
  it('commande livree : ordonnance, pharmacie et livraison faites', () => {
    const { c } = monter([]);
    const etats = Object.fromEntries(c.etapes(visite(LIVREE)).map((s) => [s.cle, s.etat]));
    expect(etats).toEqual(expect.objectContaining({
      ETAPE_CONSULTATION: 'done', ETAPE_ORDONNANCE: 'done', ETAPE_PHARMACIE: 'done', ETAPE_LIVRAISON: 'done',
    }));
  });

  it('commande envoyee : la pharmacie en cours, la livraison a faire', () => {
    const { c } = monter([]);
    const etats = Object.fromEntries(c.etapes(visite(LIVREE.slice(0, 4))).map((s) => [s.cle, s.etat]));
    expect(etats['ETAPE_PHARMACIE']).toBe('now');
    expect(etats['ETAPE_LIVRAISON']).toBe('todo');
  });

  it('une visite close n a plus d etape en cours', () => {
    const { c } = monter([]);
    const fil = [...LIVREE.slice(0, 4), etape('VISITE_CLOSE', '2026-11-12T09:00:00.000Z')];
    expect(c.etapes(visite(fil, { statut: 'CLOS' })).some((s) => s.etat === 'now')).toBe(false);
  });
});
