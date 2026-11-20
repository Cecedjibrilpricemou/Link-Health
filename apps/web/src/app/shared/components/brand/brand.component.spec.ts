// La marque : la plateforme sur les pages publiques et pour l'administration
// nationale ; la structure de l'utilisateur dans son espace.
//
// Ce que ce fichier tient :
//   - un professionnel voit sa structure, son logo ou ses initiales ;
//   - un patient voit sa structure par defaut, ou « Mon espace santé » ;
//   - le super-admin garde la plateforme, meme dans un espace ;
//   - l'onglet du navigateur suit l'espace, et revient a la plateforme
//     quand on le quitte.
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { UserDto } from '@baobaoheath/shared-types';

import { BrandComponent } from './brand.component';
import { AuthService } from '../../../core/services/auth.service';
import { PlateformeService } from '../../services/plateforme.service';
import { I18nService } from '../../services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string): string { return cle; }
}

@Component({
  standalone: true,
  imports: [BrandComponent],
  template: `@if (affiche()) { <app-brand [portee]="portee" /> }`,
})
class Hote {
  portee: 'plateforme' | 'espace' = 'espace';
  affiche = signal(true);
}

function monter(utilisateur: Partial<UserDto> | null, portee: 'plateforme' | 'espace' = 'espace') {
  const plateforme = {
    nom: signal('KÈNÈYA'),
    logoUrl: signal('http://api/uploads/logos/p.png'),
    entrerEspace: vi.fn(),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Hote],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AuthService, useValue: { currentUser: signal(utilisateur) } },
      { provide: PlateformeService, useValue: plateforme },
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });
  const fixture = TestBed.createComponent(Hote);
  fixture.componentInstance.portee = portee;
  fixture.detectChanges();
  TestBed.tick();
  return { fixture, el: fixture.nativeElement as HTMLElement, plateforme };
}

const nom = (el: HTMLElement) => el.querySelector('.bb-brand__name')?.textContent?.trim();
const STRUCTURE = { id: 's1', nom: 'CHU Donka', type: 'CHU' as const, logoUrl: '' };

describe('la marque en tete de l interface', () => {
  it('un professionnel : le nom de sa structure, et ses initiales sans logo', () => {
    const { el, plateforme } = monter({ role: 'MEDECIN', structure: STRUCTURE });
    expect(nom(el)).toBe('CHU Donka');
    expect(el.querySelector('.bb-brand__mono')?.textContent?.trim()).toBe('CHU');
    expect(el.textContent).not.toContain('KÈNÈYA');
    expect(plateforme.entrerEspace).toHaveBeenLastCalledWith({ nom: 'CHU Donka', logo: '' });
  });

  it('avec un logo televerse : le logo de la structure', () => {
    const { el } = monter({ role: 'ADMIN_STRUCTURE', structure: { ...STRUCTURE, logoUrl: '/uploads/structures/s.png' } });
    expect(el.querySelector('img')?.getAttribute('src')).toMatch(/\/uploads\/structures\/s\.png$/);
    expect(el.querySelector('.bb-brand__mono')).toBeNull();
  });

  it('un patient : sa structure par defaut, sinon son espace sante', () => {
    expect(nom(monter({ role: 'PATIENT', structure: STRUCTURE }).el)).toBe('CHU Donka');
    const sans = monter({ role: 'PATIENT', structure: null });
    expect(nom(sans.el)).toBe('ESPACE.PATIENT');
    expect(sans.el.querySelector('.bb-brand__mono i.pi-heart')).not.toBeNull();
  });

  it('le super-admin garde la plateforme', () => {
    const { el, plateforme } = monter({ role: 'SUPER_ADMIN', structure: STRUCTURE });
    expect(nom(el)).toBe('KÈNÈYA');
    expect(plateforme.entrerEspace).toHaveBeenLastCalledWith(null);
  });

  it('hors espace (pages publiques), toujours la plateforme', () => {
    const { el, plateforme } = monter({ role: 'MEDECIN', structure: STRUCTURE }, 'plateforme');
    expect(nom(el)).toBe('KÈNÈYA');
    expect(plateforme.entrerEspace).not.toHaveBeenCalled();
  });

  it('quitter l espace rend l onglet a la plateforme', () => {
    const { fixture, plateforme } = monter({ role: 'MEDECIN', structure: STRUCTURE });
    fixture.componentInstance.affiche.set(false);
    fixture.detectChanges();
    expect(plateforme.entrerEspace).toHaveBeenLastCalledWith(null);
  });
});
