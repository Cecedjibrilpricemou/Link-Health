// Tableau de bord du laboratoire : 7 cartes dans une seule grille
// automatique tombaient en 5 + 2 sur un ecran moyen, sans ordre lisible.
//
// Deux groupes : le circuit d'une demande (4 etapes, dans l'ordre du
// travail) et les points d'attention (3 cartes). Chaque groupe a sa grille.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { LaboTableauDeBordComponent } from './tableau-de-bord.component';
import { LaboratoireService } from '../../../core/services/laboratoire.service';

const DONNEES = {
  aRecevoir: 3, aPrelever: 2, enAnalyse: 5, aValider: 1,
  urgentes: 1, critiquesNonAccusees: 0, valideesDuJour: 7,
  fileUrgente: [], prochainsPrelevements: [],
};

function monter() {
  TestBed.configureTestingModule({
    imports: [LaboTableauDeBordComponent],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: LaboratoireService, useValue: { tableauDeBord: () => of({ success: true, data: DONNEES }) } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(LaboTableauDeBordComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const valeurs = (g: Element) => [...g.querySelectorAll('.bb-stat__value')].map((v) => v.textContent!.trim());

describe('laboratoire : tableau de bord', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('range les cartes en deux groupes titrés, 4 + 3', () => {
    const el = monter();
    const groupes = [...el.querySelectorAll('.bb-labo-groupe')];
    expect(groupes.length).toBe(2);
    expect(groupes.map((g) => g.querySelectorAll('.bb-stat').length)).toEqual([4, 3]);
    for (const g of groupes) expect(g.querySelector('h2')!.textContent!.trim().length).toBeGreaterThan(3);
  });

  it('suit le circuit d’une demande, dans l’ordre du travail', () => {
    const el = monter();
    const [circuit] = el.querySelectorAll('.bb-labo-groupe');
    // à recevoir, à prélever, en analyse, à valider
    expect(valeurs(circuit)).toEqual(['3', '2', '5', '1']);
  });

  it('met à part ce qui demande de l’attention', () => {
    const el = monter();
    const [, attention] = el.querySelectorAll('.bb-labo-groupe');
    // urgentes, critiques non accusées, validées du jour
    expect(valeurs(attention)).toEqual(['1', '0', '7']);
  });

  it('donne à chaque groupe une grille au nombre de cartes', () => {
    const el = monter();
    const [circuit, attention] = el.querySelectorAll('.bb-labo-groupe .bb-stats');
    expect(circuit.classList).toContain('bb-labo-stats--4');
    expect(attention.classList).toContain('bb-labo-stats--3');
  });
});
