// Une compagnie d'assurance ne se cree plus depuis l'ecran des structures.
//
// **Deux portes pour la meme chose finissent par diverger.** Creer une
// structure ASSURANCE ici ne faisait que la structure : qui s'arretait la
// laissait un responsable devant « Cette structure n'est rattachee a aucune
// compagnie d'assurance ». La creation vit desormais dans l'onglet
// Assurances, en une fois. Les assurances existantes, elles, restent
// visibles, filtrables et nommees dans cette liste.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { StructureAdminView } from '@baobaoheath/shared-types';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';

// La boite de dialogue de position charge Leaflet a l'import.
vi.mock('leaflet', () => ({
  map: vi.fn(() => ({ setView: vi.fn(), on: vi.fn(), remove: vi.fn() })),
  tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
  marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis() })),
  divIcon: vi.fn(() => ({})),
}));

const ASSURANCE_EXISTANTE = {
  id: 's-assu', nom: 'Sunu Assurances', type: 'ASSURANCE', prefecture: 'Conakry',
  telephone: '620111222', estActive: true, creeLe: '2026-10-01T00:00:00.000Z',
} as StructureAdminView;

function monter() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [StructuresComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AdminService, useValue: { getStructures: () => of({ success: true, data: [ASSURANCE_EXISTANTE] }) } },
      { provide: DemandeAgrementService, useValue: { piecesAttendues: () => of({ success: true, data: [] }) } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(StructuresComponent);
  fixture.detectChanges();
  const rendre = () => { fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };
  return { c: fixture.componentInstance, rendre };
}

describe('structures : l assurance a quitte la creation', () => {
  // (7)
  it('ne propose plus ASSURANCE dans les types de « Nouvelle structure »', () => {
    const { c } = monter();
    expect(c.typeOptions.map((t) => t.value)).not.toContain('ASSURANCE');
  });

  it('garde ASSURANCE dans le filtre de la liste', () => {
    const { rendre } = monter();
    const options = [...rendre().querySelectorAll<HTMLOptionElement>('.bb-struct__filtre-type option')].map((o) => o.value);
    expect(options).toContain('ASSURANCE');
  });

  it('nomme encore une assurance existante dans la liste', () => {
    const { c, rendre } = monter();
    const libelle = c.getTypeLabel('ASSURANCE');

    expect(libelle).not.toBe('ASSURANCE');
    expect(rendre().querySelector('.bb-struct__meta')?.textContent).toContain(libelle);
  });

  it('filtre encore les assurances existantes', () => {
    const { c } = monter();
    c.filtreType.set('ASSURANCE');
    expect(c.structuresFiltrees().map((s) => s.id)).toEqual(['s-assu']);
  });
});
