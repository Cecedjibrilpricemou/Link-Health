// Liste deroulante avec recherche.
//
// Une liste de 500 produits se parcourait a la molette. La liste reste (un
// clic montre tous les choix) et on peut taper pour la filtrer : « creme »
// trouve « Crème », « doli » trouve « Doliprane ».
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import { ListeRechercheComponent, OptionListe } from './liste-recherche.component';

const OPTIONS: OptionListe[] = [
  { valeur: 'a', libelle: 'Doliprane 500 mg', detail: '495 boîtes', recherche: 'paracetamol' },
  { valeur: 'b', libelle: 'Crème hydratante 100 ml', detail: '260 boîtes' },
  { valeur: 'c', libelle: 'Savon antiseptique', detail: '22 boîtes' },
];

@Component({
  standalone: true,
  imports: [FormsModule, ListeRechercheComponent],
  template: `<app-liste-recherche inputId="champ" [options]="options" [ngModel]="choix()" (ngModelChange)="choix.set($event)" videLibelle="—" />`,
})
class HoteComponent {
  options = OPTIONS;
  choix = signal<string | null>('c');
}

function monter() {
  TestBed.configureTestingModule({ imports: [HoteComponent], providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(HoteComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const champ = () => el.querySelector<HTMLInputElement>('#champ')!;
  const rendre = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  const libelles = () => [...el.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.lr__libelle')?.textContent?.trim());
  const taper = async (texte: string) => {
    champ().value = texte;
    champ().dispatchEvent(new Event('input'));
    await rendre();
  };
  const touche = async (key: string) => {
    champ().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await rendre();
  };
  return { fixture, el, champ, rendre, libelles, taper, touche, hote: fixture.componentInstance };
}

describe('liste déroulante avec recherche', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('affiche le choix courant et reste fermée au départ', async () => {
    const { champ, el, rendre } = monter();
    await rendre();
    expect(champ().value).toBe('Savon antiseptique');
    expect(champ().getAttribute('role')).toBe('combobox');
    expect(champ().getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  it('montre tous les choix au clic, comme une liste déroulante', async () => {
    const { champ, libelles, rendre } = monter();
    champ().click();
    await rendre();
    expect(champ().getAttribute('aria-expanded')).toBe('true');
    expect(libelles()).toEqual(['—', 'Doliprane 500 mg', 'Crème hydratante 100 ml', 'Savon antiseptique']);
  });

  it('filtre en tapant, sans tenir compte des accents ni des majuscules', async () => {
    const { taper, libelles } = monter();
    await taper('CREME');
    expect(libelles()).toEqual(['Crème hydratante 100 ml']);
  });

  it('cherche aussi dans les mots-clés (DCI)', async () => {
    const { taper, libelles } = monter();
    await taper('paracétamol');
    expect(libelles()).toEqual(['Doliprane 500 mg']);
  });

  it('dit quand rien ne correspond', async () => {
    const { taper, el } = monter();
    await taper('zzz');
    expect(el.querySelector('.lr__aucun')).not.toBeNull();
  });

  it('tape puis Entrée choisit la première correspondance', async () => {
    const { taper, touche, hote, champ, el } = monter();
    await taper('doli');
    await touche('Enter');
    expect(hote.choix()).toBe('a');
    expect(champ().value).toBe('Doliprane 500 mg');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  it('se parcourt aux flèches depuis le choix courant', async () => {
    const { champ, touche, rendre, hote } = monter();
    await rendre();
    champ().click();
    await rendre();
    await touche('ArrowUp');   // Savon -> Crème
    await touche('Enter');
    expect(hote.choix()).toBe('b');
  });

  it('se choisit à la souris', async () => {
    const { champ, el, rendre, hote } = monter();
    champ().click();
    await rendre();
    const option = [...el.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent!.includes('Doliprane'))!;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await rendre();
    expect(hote.choix()).toBe('a');
    expect(champ().value).toBe('Doliprane 500 mg');
  });

  it('Échap referme et remet le choix courant', async () => {
    const { taper, touche, champ, hote, el } = monter();
    await taper('dol');
    await touche('Escape');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    expect(champ().value).toBe('Savon antiseptique');
    expect(hote.choix()).toBe('c');
  });

  it('une saisie abandonnée ne change pas le choix', async () => {
    const { taper, champ, rendre, hote } = monter();
    await taper('dol');
    champ().dispatchEvent(new FocusEvent('blur'));
    await rendre();
    expect(hote.choix()).toBe('c');
    expect(champ().value).toBe('Savon antiseptique');
  });

  it('suit un changement du modèle venu de l’écran', async () => {
    const { fixture, champ, rendre } = monter();
    fixture.componentInstance.choix.set('b');
    await rendre();
    expect(champ().value).toBe('Crème hydratante 100 ml');
  });

  it('annonce l’option active aux lecteurs d’écran', async () => {
    const { champ, touche, rendre } = monter();
    champ().click();
    await rendre();
    await touche('ArrowDown');
    const actif = champ().getAttribute('aria-activedescendant');
    expect(actif).toBeTruthy();
    expect(document.getElementById(actif!)?.getAttribute('role')).toBe('option');
  });
});
