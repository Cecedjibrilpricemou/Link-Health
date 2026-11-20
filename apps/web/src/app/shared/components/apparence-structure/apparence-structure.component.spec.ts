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

function vueDe(vue: Partial<ApparenceStructureView>): ApparenceStructureView {
  return { palette: 'EMERAUDE', logoUrl: '', nomStructure: 'Hôpital de Donka', typeStructure: 'CHU', peutModifier: true, ...vue };
}

function monter(vue: Partial<ApparenceStructureView>) {
  const active = signal<PaletteStructure>(vue.palette ?? 'EMERAUDE');
  const choisir = vi.fn((p: PaletteStructure) => {
    active.set(p);
    return of({ success: true, data: { ...vue, palette: p } });
  });
  const toastr = { success: vi.fn(), error: vi.fn() };
  const televerserLogo = vi.fn(() => of({ success: true, data: { ...vueDe(vue), logoUrl: '/uploads/structures/l.png' } }));
  const retirerLogo = vi.fn(() => of({ success: true, data: { ...vueDe(vue), logoUrl: '' } }));
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
          televerserLogo,
          retirerLogo,
          lire: () => of({
            success: true,
            data: vueDe(vue),
          }),
        },
      },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: toastr },
    ],
  });
  const fixture = TestBed.createComponent(ApparenceStructureComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, choisir, toastr, televerserLogo, retirerLogo };
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

describe('le logo de la structure', () => {
  it('sans logo, les initiales ; le responsable peut en ajouter un', () => {
    const { el } = monter({ nomStructure: 'Clinique Pasteur' });
    expect(el.querySelector('.bb-app__logo-mono')?.textContent?.trim()).toBe('CP');
    expect(el.querySelector('.bb-app__logo-envoyer')).not.toBeNull();
    expect(el.querySelector('.bb-app__logo-retirer')).toBeNull();
  });

  it('televerse, puis montre le logo', () => {
    const { el, fixture, televerserLogo } = monter({});
    const champ = el.querySelector<HTMLInputElement>('.bb-app__logo input[type=file]')!;
    const fichier = new File([new Uint8Array(8)], 'logo.png', { type: 'image/png' });
    Object.defineProperty(champ, 'files', { value: [fichier] });
    champ.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(televerserLogo).toHaveBeenCalledWith(fichier);
    expect(el.querySelector('.bb-app__logo-apercu img')?.getAttribute('src')).toMatch(/l\.png$/);
    expect(el.querySelector('.bb-app__logo-retirer')).not.toBeNull();
  });

  it('refuse un SVG avant tout envoi', () => {
    const { el, televerserLogo, toastr } = monter({});
    const champ = el.querySelector<HTMLInputElement>('.bb-app__logo input[type=file]')!;
    Object.defineProperty(champ, 'files', { value: [new File(['<svg/>'], 'l.svg', { type: 'image/svg+xml' })] });
    champ.dispatchEvent(new Event('change'));
    expect(televerserLogo).not.toHaveBeenCalled();
    expect(toastr.error).toHaveBeenCalled();
  });

  it('un membre voit le logo, sans pouvoir le changer', () => {
    const { el } = monter({ peutModifier: false, logoUrl: '/uploads/structures/l.png' });
    expect(el.querySelector('.bb-app__logo-apercu img')).not.toBeNull();
    expect(el.querySelector('.bb-app__logo-envoyer')).toBeNull();
  });
});

