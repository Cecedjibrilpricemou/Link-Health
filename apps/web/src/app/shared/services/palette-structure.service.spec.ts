// La palette de la structure, posee sur le document.
//
// Ce que ce fichier tient :
//   - le compte connecte dit la palette, l'interface la prend aussitot ;
//   - la palette par defaut ne pose rien : la feuille de style d'origine ;
//   - choisir repeint tout de suite, puis enregistre ; un echec ramene
//     l'ancienne palette ;
//   - a la deconnexion, la palette tombe.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';
import type { PaletteStructure, UserDto } from '@baobaoheath/shared-types';

import { ID_FEUILLE_PALETTE, PaletteStructureService } from './palette-structure.service';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';

function monter(palette: PaletteStructure | null, put: () => unknown = () => of({ success: true, data: { palette: 'INDIGO' } })) {
  const utilisateur = signal<Partial<UserDto> | null>({ id: 'u', role: 'ADMIN_STRUCTURE', paletteStructure: palette });
  const auth = {
    currentUser: utilisateur,
    definirPaletteStructure: vi.fn((p: PaletteStructure | null) => utilisateur.update((u) => (u ? { ...u, paletteStructure: p } : u))),
  };
  const api = { get: vi.fn(), put: vi.fn(put) };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: AuthService, useValue: auth },
      { provide: ApiService, useValue: api },
    ],
  });
  const service = TestBed.inject(PaletteStructureService);
  TestBed.tick();
  return { service, utilisateur, auth, api };
}

const racine = () => document.documentElement;
const feuille = () => document.getElementById(ID_FEUILLE_PALETTE);

afterEach(() => {
  racine().removeAttribute('data-palette');
  feuille()?.remove();
});

describe('la palette de la structure', () => {
  it('celle du compte s applique des le demarrage', () => {
    monter('OCEAN');
    expect(racine().getAttribute('data-palette')).toBe('OCEAN');
    expect(feuille()?.textContent).toContain('html[data-palette="OCEAN"]');
  });

  it('la palette par defaut ne pose rien', () => {
    monter(null);
    expect(racine().hasAttribute('data-palette')).toBe(false);
    expect(feuille()).toBeNull();
  });

  it('une seule feuille, quelle que soit la suite de changements', () => {
    const { utilisateur } = monter('OCEAN');
    utilisateur.update((u) => ({ ...u!, paletteStructure: 'ARDOISE' }));
    TestBed.tick();
    expect(document.querySelectorAll(`#${ID_FEUILLE_PALETTE}`).length).toBe(1);
    expect(feuille()?.textContent).toContain('html[data-palette="ARDOISE"]');
    expect(feuille()?.textContent).not.toContain('OCEAN');
  });

  it('a la deconnexion, la palette tombe', () => {
    const { utilisateur } = monter('SARCELLE');
    utilisateur.set(null);
    TestBed.tick();
    expect(racine().hasAttribute('data-palette')).toBe(false);
    expect(feuille()).toBeNull();
  });

  it('choisir repeint avant meme la reponse, puis enregistre', () => {
    const reponse = new Subject<unknown>();
    const { service, api, auth } = monter(null, () => reponse);
    service.choisir('INDIGO').subscribe();
    TestBed.tick();
    expect(racine().getAttribute('data-palette')).toBe('INDIGO');
    expect(api.put).toHaveBeenCalledWith('/apparence', { palette: 'INDIGO' });

    reponse.next({ success: true, data: { palette: 'INDIGO' } });
    reponse.complete();
    TestBed.tick();
    expect(auth.definirPaletteStructure).toHaveBeenCalledWith('INDIGO');
    expect(racine().getAttribute('data-palette')).toBe('INDIGO');
  });

  it('revenir a l emeraude enregistre une absence de choix', () => {
    const { service, auth } = monter('OCEAN', () => of({ success: true, data: { palette: 'EMERAUDE' } }));
    service.choisir('EMERAUDE').subscribe();
    TestBed.tick();
    expect(auth.definirPaletteStructure).toHaveBeenCalledWith(null);
    expect(racine().hasAttribute('data-palette')).toBe(false);
  });

  it('un echec ramene la palette d avant', () => {
    const { service } = monter('OCEAN', () => throwError(() => ({ status: 403 })));
    service.choisir('AMETHYSTE').subscribe({ error: () => undefined });
    TestBed.tick();
    expect(racine().getAttribute('data-palette')).toBe('OCEAN');
  });
});
