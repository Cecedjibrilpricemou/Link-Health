// Tableau de bord pharmacien : « Chiffre du jour » et « Ventes » apparaissaient
// deux fois (bandeau du jour, puis rapport financier reglé sur « Jour »), et
// les encaissements par moyen de paiement aussi. Deux sources pour le meme
// chiffre, c'est deux chiffres qui finissent par differer.
//
// Une seule section d'activite, pilotee par la periode ; les alertes de stock
// a part.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { TableauDeBordComponent } from './tableau-de-bord.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';

const TB = {
  jour: '2026-11-04T00:00:00.000Z', chiffreDuJourGnf: 90000, nombreVentesDuJour: 3, panierMoyenGnf: 30000,
  encaissementsParMode: [{ modePaiement: 'ESPECES', montantGnf: 90000, nombre: 3 }],
  produitsLesPlusVendus: [],
  ruptures: [{ medicament: { id: 'm1', libelle: 'Zinc', categorie: 'MEDICAMENT' }, quantite: 0, seuilAlerte: 5, unite: 'boite' }],
  lotsAPerimer: 2,
};

function rapport(periode: string, ca: number, payees: number) {
  return {
    periode, dateDebut: '2026-11-01T00:00:00.000Z', dateFin: '2026-11-30T23:59:59.999Z',
    chiffreAffairesGnf: ca, nombreVentesPayees: payees, nombreVentesEnAttente: 1, nombreVentesAnnulees: 0,
    encaissementsParMode: [
      { modePaiement: 'ESPECES', montantGnf: ca * 0.75, nombre: payees - 1 },
      { modePaiement: 'ORANGE_MONEY', montantGnf: ca * 0.25, nombre: 1 },
    ],
    parUtilisateur: [], sessions: [],
  };
}

function monter() {
  const periodes: string[] = [];
  const pharma = {
    getTableauDeBord: () => of({ success: true, data: TB }),
    getRapportCaisse: (p: string) => {
      periodes.push(p);
      return of({ success: true, data: p === 'MOIS' ? rapport(p, 1000000, 40) : rapport(p, 90000, 3) });
    },
  };
  TestBed.configureTestingModule({
    imports: [TableauDeBordComponent],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: PharmacienService, useValue: pharma },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(TableauDeBordComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, rendre: () => { fixture.detectChanges(); return el; }, periodes };
}

const stat = (el: HTMLElement, cle: string) =>
  el.querySelector(`.bb-tdb__stat[data-stat="${cle}"] .bb-tdb__stat-valeur`)?.textContent?.replace(/\D/g, '');
const titres = (el: HTMLElement) => [...el.querySelectorAll('h2, h3')].map((h) => h.textContent!.trim());

describe('tableau de bord pharmacien', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('n’affiche chaque indicateur de vente qu’une seule fois', () => {
    const { el } = monter();
    for (const cle of ['chiffre', 'ventes', 'panier', 'attente', 'annulees']) {
      expect(el.querySelectorAll(`.bb-tdb__stat[data-stat="${cle}"]`).length).toBe(1);
    }
  });

  it('ne montre qu’une seule section des encaissements', () => {
    const { el } = monter();
    expect(titres(el).filter((t) => t.includes('Encaissements')).length).toBe(1);
  });

  it('suit la période choisie, libellés compris', () => {
    const { el, rendre, periodes } = monter();
    expect(stat(el, 'chiffre')).toBe('90000');
    const bouton = [...el.querySelectorAll<HTMLButtonElement>('.bb-tdb__rapport-filtres button')]
      .find((b) => b.textContent!.includes('Mois'))!;
    bouton.click();
    rendre();
    expect(periodes).toEqual(['JOUR', 'MOIS']);
    expect(stat(el, 'chiffre')).toBe('1000000');
    expect(stat(el, 'ventes')).toBe('40');
    // « Chiffre du jour » sur une periode d'un mois serait faux.
    expect(el.querySelector('.bb-tdb__stat[data-stat="chiffre"] .bb-tdb__stat-label')!.textContent)
      .not.toContain('jour');
  });

  it('calcule le panier moyen sur la période', () => {
    const { el, rendre } = monter();
    expect(stat(el, 'panier')).toBe('30000');
    [...el.querySelectorAll<HTMLButtonElement>('.bb-tdb__rapport-filtres button')]
      .find((b) => b.textContent!.includes('Mois'))!.click();
    expect(stat(rendre(), 'panier')).toBe('25000');
  });

  it('garde les alertes de stock', () => {
    const { el } = monter();
    expect(stat(el, 'ruptures')).toBe('1');
    expect(stat(el, 'peremptions')).toBe('2');
  });
});
