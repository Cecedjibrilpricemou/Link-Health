// Page Structures (admin) : un bouton rouge « Desactiver » sur chaque ligne,
// sans recherche ni filtre, et la meme icone pour un poste de sante et un CHU.
//
// L'action qui coupe une structure passe dans un menu, toujours suivie d'une
// confirmation ; on peut chercher et filtrer ; chaque type a son icone.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';

const STRUCTURES = [
  { id: 'chu', nom: 'CHU Donka', type: 'CHU', prefecture: 'Conakry', telephone: '620000001', estActive: true, creeLe: '2026-01-01' },
  { id: 'poste', nom: 'Poste de santé de Bantignel', type: 'POSTE', prefecture: 'Pita', telephone: null, estActive: true, creeLe: '2026-01-02' },
  { id: 'pharma', nom: 'Pharmacie du Port', type: 'PHARMACIE', prefecture: 'Conakry', telephone: null, estActive: false, creeLe: '2026-01-03' },
  { id: 'labo', nom: 'Laboratoire Mamou Analyses', type: 'LABORATOIRE', prefecture: 'Mamou', telephone: null, estActive: true, creeLe: '2026-01-04' },
];

function monter() {
  const appels: string[] = [];
  const admin = {
    getStructures: () => of({ success: true, data: STRUCTURES }),
    deleteStructure: (id: string) => { appels.push(`desactiver:${id}`); return of({ success: true }); },
    updateStructure: (id: string) => { appels.push(`reactiver:${id}`); return of({ success: true }); },
  };
  TestBed.configureTestingModule({
    imports: [StructuresComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AdminService, useValue: admin },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(StructuresComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, appels };
}

const noms = (el: HTMLElement) =>
  [...el.querySelectorAll('.bb-struct__item .bb-struct__name')].map((n) => n.textContent?.trim());
const ligne = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`.bb-struct__item[data-id="${id}"]`)!;
const saisir = (input: HTMLInputElement | HTMLSelectElement, valeur: string) => {
  input.value = valeur;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('admin : page Structures', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('ne montre plus de bouton « Désactiver » sur chaque ligne', () => {
    const { el } = monter();
    expect(el.querySelector('.bb-struct__deactivate-btn')).toBeNull();
    const menu = ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!;
    expect(menu.getAttribute('aria-haspopup')).toBe('menu');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('désactive par le menu, et seulement après confirmation', () => {
    const { el, rendre, appels } = monter();
    ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    const menu = el.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    menu.querySelector<HTMLButtonElement>('[data-action="desactiver"]')!.click();
    rendre();
    expect(appels).toEqual([]);
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(el.querySelector('#struct-deactivate-title')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.bb-logout-modal__btn--confirm')!.click();
    expect(appels).toEqual(['desactiver:chu']);
  });

  it('propose « Réactiver » pour une structure inactive', () => {
    const { el, rendre, appels } = monter();
    ligne(el, 'pharma').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    expect(el.querySelector('[role="menu"] [data-action="desactiver"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[role="menu"] [data-action="reactiver"]')!.click();
    expect(appels).toEqual(['reactiver:pharma']);
  });

  it('ferme le menu avec Échap', () => {
    const { el, rendre } = monter();
    ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(rendre().querySelector('[role="menu"]')).toBeNull();
  });

  it('cherche par nom ou par préfecture', () => {
    const { el, rendre } = monter();
    const champ = el.querySelector<HTMLInputElement>('.bb-struct__recherche input')!;
    saisir(champ, 'donka');
    expect(noms(rendre())).toEqual(['CHU Donka']);
    saisir(champ, 'conakry');
    expect(noms(rendre())).toEqual(['CHU Donka', 'Pharmacie du Port']);
  });

  it('filtre par type et par état, et annonce le nombre de résultats', () => {
    const { el, rendre } = monter();
    saisir(el.querySelector<HTMLSelectElement>('select.bb-struct__filtre-type')!, 'LABORATOIRE');
    expect(noms(rendre())).toEqual(['Laboratoire Mamou Analyses']);
    saisir(el.querySelector<HTMLSelectElement>('select.bb-struct__filtre-type')!, '');
    el.querySelector<HTMLButtonElement>('[data-etat="INACTIVES"]')!.click();
    expect(noms(rendre())).toEqual(['Pharmacie du Port']);
    expect(el.querySelector('.bb-struct__resultats')!.textContent).toContain('1');
  });

  it('dit quand aucun résultat ne correspond', () => {
    const { el, rendre } = monter();
    saisir(el.querySelector<HTMLInputElement>('.bb-struct__recherche input')!, 'zzz');
    expect(rendre().querySelector('.bb-struct__aucun')).not.toBeNull();
  });

  it('donne à chaque type sa propre icône', () => {
    const { el } = monter();
    const icone = (id: string) => ligne(el, id).querySelector('.bb-struct__icon i')!.className;
    const icones = new Set(['chu', 'poste', 'pharma', 'labo'].map(icone));
    expect(icones.size).toBe(4);
  });

  it('exporte les structures affichées', () => {
    const { c, el, rendre } = monter();
    el.querySelector<HTMLButtonElement>('[data-etat="INACTIVES"]')!.click();
    rendre();
    expect(c.structuresFiltrees().map((s) => s.id)).toEqual(['pharma']);
  });
});
