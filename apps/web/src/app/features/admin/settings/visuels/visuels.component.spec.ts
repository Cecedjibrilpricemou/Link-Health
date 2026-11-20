// Parametres > Images : remplacer, retablir, decrire.
//
// Ce que ce fichier tient :
//   - un emplacement par carte, avec son apercu (image ou icone) ;
//   - un mauvais fichier est refuse avant l'envoi ;
//   - « Revenir a l'image d'origine » n'existe que pour une image televersee ;
//   - la description ne s'envoie que si elle a change ;
//   - chaque reponse met a jour les pages publiques ouvertes.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import { EMPLACEMENTS_VISUELS } from '@baobaoheath/shared-types';
import type { ParametresVisuelsView } from '@baobaoheath/shared-types';

import { VisuelsComponent } from './visuels.component';
import { AdminService } from '../../../../core/services/admin.service';
import { PlateformeService } from '../../../../shared/services/plateforme.service';
import { I18nService } from '../../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string {
    return p ? `${cle} ${JSON.stringify(p)}` : cle;
  }
}

const vide = { url: '', urlPetite: '', description: '' };
function visuels(sur: Partial<ParametresVisuelsView> = {}): ParametresVisuelsView {
  return { ...Object.fromEntries(EMPLACEMENTS_VISUELS.map((e) => [e, vide])), ...sur } as ParametresVisuelsView;
}
const PERSO = { url: '/uploads/visuels/a-1600.webp', urlPetite: '/uploads/visuels/a-800.webp', description: '' };

function monter(initiaux: ParametresVisuelsView) {
  const apres = visuels({ ACCUEIL: PERSO });
  const admin = {
    remplacerVisuel: vi.fn(() => of({ success: true, data: apres })),
    retablirVisuel: vi.fn(() => of({ success: true, data: visuels() })),
    decrireVisuel: vi.fn(() => of({ success: true, data: apres })),
  };
  const plateforme = { appliquerVisuels: vi.fn() };
  const toastr = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [VisuelsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      { provide: AdminService, useValue: admin },
      { provide: PlateformeService, useValue: plateforme },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: toastr },
    ],
  });
  const fixture = TestBed.createComponent(VisuelsComponent);
  fixture.componentRef.setInput('initiaux', initiaux);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, c: fixture.componentInstance, admin, plateforme, toastr };
}

const carte = (el: HTMLElement, e: string) => el.querySelector<HTMLElement>(`[data-emplacement="${e}"]`)!;

function choisir(el: HTMLElement, e: string, fichier: File) {
  const champ = carte(el, e).querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(champ, 'files', { value: [fichier], configurable: true });
  champ.dispatchEvent(new Event('change'));
}

describe('Parametres > Images', () => {
  it('une carte par emplacement, image d origine ou icone', () => {
    const { el, plateforme } = monter(visuels());
    expect(el.querySelectorAll('.bb-vis__carte')).toHaveLength(9);
    expect(carte(el, 'ACCUEIL').querySelector('.bb-vis__apercu img')).not.toBeNull();
    expect(carte(el, 'ETAPE_1').querySelector('.bb-vis__apercu img')).toBeNull();
    expect(carte(el, 'ETAPE_1').querySelector('.bb-vis__icone')).not.toBeNull();
    expect(plateforme.appliquerVisuels).toHaveBeenCalledTimes(1);
  });

  it('remplace une image, et les pages publiques suivent', () => {
    const { el, fixture, admin, plateforme, toastr } = monter(visuels());
    const fichier = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    choisir(el, 'ACCUEIL', fichier);
    fixture.detectChanges();
    expect(admin.remplacerVisuel).toHaveBeenCalledWith('ACCUEIL', fichier);
    expect(plateforme.appliquerVisuels).toHaveBeenLastCalledWith(visuels({ ACCUEIL: PERSO }));
    expect(toastr.success).toHaveBeenCalled();
    expect(carte(el, 'ACCUEIL').querySelector('.bb-vis__etat')?.getAttribute('data-etat')).toBe('perso');
  });

  it('refuse un fichier qui n est pas une photo, ou trop lourd, sans rien envoyer', () => {
    const { el, admin, toastr } = monter(visuels());
    choisir(el, 'ACCUEIL', new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    const lourd = new File([new Uint8Array(1)], 'grosse.jpg', { type: 'image/jpeg' });
    Object.defineProperty(lourd, 'size', { value: 9 * 1024 * 1024 });
    choisir(el, 'ACCUEIL', lourd);
    expect(admin.remplacerVisuel).not.toHaveBeenCalled();
    expect(toastr.error).toHaveBeenCalledTimes(2);
  });

  it('retablir n existe que pour une image televersee', () => {
    const { el, fixture, admin } = monter(visuels({ ACCUEIL: PERSO }));
    expect(carte(el, 'ETAPE_3').querySelector('.bb-vis__retablir')).toBeNull();
    carte(el, 'ACCUEIL').querySelector<HTMLButtonElement>('.bb-vis__retablir')!.click();
    fixture.detectChanges();
    expect(admin.retablirVisuel).toHaveBeenCalledWith('ACCUEIL');
    expect(carte(el, 'ACCUEIL').querySelector('.bb-vis__retablir')).toBeNull();
  });

  it('la description ne s envoie que si elle a change', () => {
    const { el, fixture, c, admin } = monter(visuels({ ACCUEIL: PERSO }));
    const bouton = () => carte(el, 'ACCUEIL').querySelector<HTMLButtonElement>('.bb-vis__decrire')!;
    expect(bouton().disabled).toBe(true);

    c.saisir('ACCUEIL', '  Une infirmiere accueille un patient  ');
    fixture.detectChanges();
    expect(bouton().disabled).toBe(false);
    bouton().click();
    expect(admin.decrireVisuel).toHaveBeenCalledWith('ACCUEIL', 'Une infirmiere accueille un patient');
  });

  it('demande une description pour une image televersee qui n en a pas', () => {
    const { el } = monter(visuels({ ACCUEIL: PERSO }));
    expect(carte(el, 'ACCUEIL').querySelector('.bb-vis__note--attention')).not.toBeNull();
  });

  it('le panneau de connexion est decoratif : rien a decrire', () => {
    const { el } = monter(visuels());
    expect(carte(el, 'CONNEXION').querySelector('input[matInput]')).toBeNull();
    expect(carte(el, 'CONNEXION').textContent).toContain('ADMIN.SETTINGS.VISUELS_DECORATIVE');
  });
});
