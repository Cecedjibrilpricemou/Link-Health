// Le stock d'une officine compte des centaines de produits. Affiche en
// cartes, il fallait faire defiler des ecrans entiers pour trouver ce qu'il
// faut commander, et les noms longs etaient coupes.
//
// L'ecran est un tableau : une ligne par produit, nom complet, colonnes
// triables, filtre par etat. Les produits a commander viennent en premier.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { of } from 'rxjs';

import { PharmacienStocksComponent } from './stocks.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { AuthService } from '../../../core/services/auth.service';

const DANS_10_JOURS = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
const DANS_1_AN = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

function stock(id: string, libelle: string, quantite: number, seuilAlerte: number, prix: number, peremption: string | null) {
  return {
    id, quantite, seuilAlerte, unite: 'boite', margeGnf: 0, peremptionLaPlusProche: peremption,
    medicament: {
      id: `m-${id}`, libelle, dci: null, nomCommercial: null, classeTherapeutique: null,
      forme: null, dosage: null, categorie: 'MEDICAMENT', prixUnitaireGnf: prix,
    },
  };
}

const STOCKS = [
  stock('a', 'Amoxicilline 500 mg gélules boîte de 16 — laboratoire de référence', 120, 10, 15000, DANS_1_AN), // normal
  stock('b', 'Paracétamol 500 mg', 3, 10, 5000, DANS_1_AN),                                                        // critique
  stock('c', 'Ibuprofène 400 mg', 15, 10, 8000, DANS_10_JOURS),                                                    // faible, perime bientot
  stock('d', 'Zinc 20 mg', 0, 5, 3000, null),                                                                     // rupture = critique
];

function monter(roleOfficine: string = 'TITULAIRE') {
  const pharma = {
    getStocks: () => of({ success: true, data: STOCKS }),
    getMedicaments: () => of({ success: true, data: [] }),
    getMouvementsStock: () => of({ success: true, data: [] }),
  };
  TestBed.configureTestingModule({
    imports: [PharmacienStocksComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PharmacienService, useValue: pharma },
      { provide: AuthService, useValue: { currentUser: signal({ roleOfficine }) } },
    ],
  });
  const fixture = TestBed.createComponent(PharmacienStocksComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre };
}

const produits = (el: HTMLElement) =>
  [...el.querySelectorAll('table.bb-ph-stocks__table tbody tr')].map(
    (tr) => tr.querySelector('.bb-ph-stocks__produit-nom')?.textContent?.trim(),
  );

describe('stocks pharmacien : tableau', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('affiche un tableau, une ligne par produit, sans cartes', () => {
    const { el } = monter();
    expect(el.querySelector('table.bb-ph-stocks__table')).not.toBeNull();
    expect(el.querySelectorAll('table.bb-ph-stocks__table tbody tr').length).toBe(4);
    expect(el.querySelector('.bb-ph-stocks__card')).toBeNull();
  });

  it('montre le nom complet, sans le couper', () => {
    const { el } = monter();
    const nom = [...el.querySelectorAll('.bb-ph-stocks__produit-nom')]
      .find((n) => n.textContent?.includes('Amoxicilline'))!;
    expect(nom.textContent).toContain('laboratoire de référence');
  });

  it('met d’abord ce qu’il faut commander : critique, puis faible, puis normal', () => {
    const { el } = monter();
    expect(produits(el)).toEqual(['Zinc 20 mg', 'Paracétamol 500 mg', 'Ibuprofène 400 mg',
      'Amoxicilline 500 mg gélules boîte de 16 — laboratoire de référence']);
  });

  it('trie par colonne, et inverse au second clic', () => {
    const { el, rendre } = monter();
    const entete = () => el.querySelector<HTMLButtonElement>('th[data-colonne="quantite"] button')!;
    entete().click();
    expect(produits(rendre())[0]).toBe('Zinc 20 mg');
    expect(el.querySelector('th[data-colonne="quantite"]')!.getAttribute('aria-sort')).toBe('ascending');
    entete().click();
    expect(produits(rendre())[0]).toContain('Amoxicilline');
    expect(el.querySelector('th[data-colonne="quantite"]')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('filtre par état', () => {
    const { el, rendre } = monter();
    el.querySelector<HTMLButtonElement>('[data-filtre="CRITIQUE"]')!.click();
    expect(produits(rendre())).toEqual(['Zinc 20 mg', 'Paracétamol 500 mg']);
    el.querySelector<HTMLButtonElement>('[data-filtre="PEREMPTION"]')!.click();
    expect(produits(rendre())).toEqual(['Ibuprofène 400 mg']);
    el.querySelector<HTMLButtonElement>('[data-filtre="TOUS"]')!.click();
    expect(produits(rendre()).length).toBe(4);
  });

  it('indique le nombre de produits de chaque filtre', () => {
    const { el } = monter();
    const texte = (f: string) => el.querySelector(`[data-filtre="${f}"]`)!.textContent!;
    expect(texte('CRITIQUE')).toContain('2');
    expect(texte('FAIBLE')).toContain('1');
    expect(texte('NORMAL')).toContain('1');
    expect(texte('PEREMPTION')).toContain('1');
  });

  it('exporte ce que le tableau affiche, dans le même ordre', () => {
    const { c, el, rendre } = monter();
    el.querySelector<HTMLButtonElement>('[data-filtre="CRITIQUE"]')!.click();
    rendre();
    expect(c.stocksFiltres().map((s) => s.id)).toEqual(['d', 'b']);
  });

  it('réserve l’inventaire au titulaire', () => {
    expect(monter('TITULAIRE').el.querySelectorAll('tbody .bb-ph-stocks__inventaire-btn').length).toBe(4);
    TestBed.resetTestingModule();
    expect(monter('CAISSIER').el.querySelectorAll('tbody .bb-ph-stocks__inventaire-btn').length).toBe(0);
  });
});
