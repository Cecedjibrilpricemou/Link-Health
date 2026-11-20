// L'ecran « Apparence » : choisir les couleurs de sa structure.
//
// Ce que ce fichier tient :
//   - les six palettes sont proposees, la palette active est cochee ;
//   - le responsable choisit d'un clic ; un membre voit sans pouvoir changer ;
//   - la palette conseillee pour son metier est signalee.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { ApparenceStructureView, PaletteStructure } from '@baobaoheath/shared-types';

import { ApparenceStructureComponent } from './apparence-structure.component';
import { PaletteStructureService } from '../../services/palette-structure.service';
import { I18nService } from '../../services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string {
    return p ? `${cle} ${JSON.stringify(p)}` : cle;
  }
}

function monter(vue: Partial<ApparenceStructureView>) {
  const active = signal<PaletteStructure>(vue.palette ?? 'EMERAUDE');
  const choisir = vi.fn((p: PaletteStructure) => {
    active.set(p);
    return of({ success: true, data: { ...vue, palette: p } });
  });
  const toastr = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ApparenceStructureComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: PaletteStructureService,
        useValue: {
          active,
          choisir,
          lire: () => of({
            success: true,
            data: { palette: 'EMERAUDE', nomStructure: 'Hôpital de Donka', typeStructure: 'CHU', peutModifier: true, ...vue },
          }),
        },
      },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: toastr },
    ],
  });
  const fixture = TestBed.createComponent(ApparenceStructureComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, choisir, toastr };
}

const cartes = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('.bb-app__carte'));
const carte = (el: HTMLElement, p: string) => el.querySelector<HTMLButtonElement>(`[data-palette-choix="${p}"]`)!;

describe('l ecran apparence', () => {
  it('propose les six palettes, l active cochee', () => {
    const { el } = monter({ palette: 'OCEAN' });
    expect(cartes(el)).toHaveLength(6);
    expect(carte(el, 'OCEAN').getAttribute('aria-checked')).toBe('true');
    expect(carte(el, 'EMERAUDE').getAttribute('aria-checked')).toBe('false');
  });

  it('le responsable choisit d un clic, et c est dit', () => {
    const { el, fixture, choisir, toastr } = monter({ palette: 'EMERAUDE' });
    carte(el, 'SARCELLE').click();
    fixture.detectChanges();
    expect(choisir).toHaveBeenCalledWith('SARCELLE');
    expect(toastr.success).toHaveBeenCalled();
    expect(carte(el, 'SARCELLE').getAttribute('aria-checked')).toBe('true');
  });

  it('recliquer la palette active ne fait rien', () => {
    const { el, choisir } = monter({ palette: 'OCEAN' });
    carte(el, 'OCEAN').click();
    expect(choisir).not.toHaveBeenCalled();
  });

  it('un membre voit la palette sans pouvoir la changer', () => {
    const { el, choisir } = monter({ palette: 'INDIGO', peutModifier: false });
    expect(cartes(el).every((b) => b.disabled)).toBe(true);
    carte(el, 'OCEAN').click();
    expect(choisir).not.toHaveBeenCalled();
    expect(el.querySelector('.bb-app__intro')?.textContent).toContain('APPARENCE.INTRO_MEMBRE');
  });

  it('signale la palette conseillee pour le metier de la structure', () => {
    const { el } = monter({ typeStructure: 'CHU' });
    expect(carte(el, 'OCEAN').querySelector('.bb-app__conseil')).not.toBeNull();
    expect(el.querySelectorAll('.bb-app__conseil')).toHaveLength(1);
  });
});
