// A1 : l'ecran de recherche publique.
//
// Ce qui compte ici : on ne lance pas une recherche sans zone (elle serait
// refusee par l'API et le visiteur ne comprendrait pas pourquoi), changer de
// zone n'affiche pas des resultats qui ne la concernent plus, et les prix
// comme la fraicheur se lisent sans ambiguite.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import type { ProduitTrouveView, RechercheProduitsView } from '@baobaoheath/shared-types';

import { RechercheComponent } from './recherche.component';
import { GeographieService } from '../../../core/services/geographie.service';
import { RechercheService } from '../../../core/services/recherche.service';
import { I18nService } from '../../../shared/services/i18n.service';

const PRODUIT: ProduitTrouveView = {
  id: 'med-1',
  libelle: 'Doliprane 500 mg',
  molecule: 'Paracétamol',
  nomCommercial: 'Doliprane',
  forme: 'comprimé',
  dosage: '500 mg',
  categorie: 'MEDICAMENT',
  estMedicament: true,
  nombrePharmacies: 2,
  prixMinGnf: 11_500,
  prixMaxGnf: 11_500,
  etatStock: 'DISPONIBLE',
  declareLe: new Date().toISOString(),
};

const RESULTAT: RechercheProduitsView = {
  zoneUtilisee: 'COMMUNE',
  prefecture: 'Conakry',
  commune: 'Ratoma',
  communesVoisines: [],
  produits: [PRODUIT],
};

function monter(recherche: Partial<RechercheService> = {}) {
  const appels: { q: string; prefecture: string; commune?: string }[] = [];
  const geo = {
    chargerConfiguration: () => of(null),
    nomsSuggeres: (role: string) => of(role === 'elargissement' ? ['Conakry'] : ['Ratoma', 'Dixinn']),
    libelle: (role: string) => (role === 'base' ? 'Commune' : 'Préfecture'),
  };
  const service = {
    produits: (q: string, prefecture: string, commune?: string) => {
      appels.push({ q, prefecture, commune });
      return of({ success: true, data: RESULTAT });
    },
    ...recherche,
  };

  TestBed.configureTestingModule({
    imports: [RechercheComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: GeographieService, useValue: geo },
      { provide: RechercheService, useValue: service },
      // On verifie quelle phrase est choisie, pas sa traduction.
      {
        provide: I18nService,
        useValue: {
          lang: () => 'fr',
          t: (cle: string, params?: Record<string, string | number>) =>
            params ? cle + ' ' + Object.values(params).join(' ') : cle,
        },
      },
    ],
  });
  TestBed.overrideComponent(RechercheComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(RechercheComponent);
  fixture.detectChanges();
  return { composant: fixture.componentInstance, appels };
}

describe('recherche publique : quand peut-on chercher', () => {
  it('pas avant d avoir choisi sa zone', () => {
    const { composant } = monter();
    composant.q.set('paracetamol');
    expect(composant.peutChercher()).toBe(false);
  });

  it('pas avec une seule lettre', () => {
    const { composant } = monter();
    composant.changerPrefecture('Conakry');
    composant.q.set('p');
    expect(composant.peutChercher()).toBe(false);
  });

  it('des que les deux sont la', () => {
    const { composant } = monter();
    composant.changerPrefecture('Conakry');
    composant.q.set('pa');
    expect(composant.peutChercher()).toBe(true);
  });

  it('ne lance rien tant que ce n est pas le cas', () => {
    const { composant, appels } = monter();
    composant.q.set('paracetamol');
    composant.chercher();
    expect(appels).toEqual([]);
  });
});

describe('recherche publique : la zone', () => {
  it('propose les communes de la zone choisie', () => {
    const { composant } = monter();
    composant.changerPrefecture('Conakry');
    expect(composant.communes()).toEqual(['Ratoma', 'Dixinn']);
  });

  it('changer de zone efface les resultats precedents', () => {
    const { composant } = monter();
    composant.changerPrefecture('Conakry');
    composant.commune.set('Ratoma');
    composant.q.set('paracetamol');
    composant.chercher();
    expect(composant.resultat()).not.toBeNull();

    // Sinon le visiteur lirait des prix d'une autre ville que celle affichee.
    composant.changerPrefecture('Kindia');
    expect(composant.resultat()).toBeNull();
    expect(composant.commune()).toBe('');
  });

  it('transmet la commune quand elle est choisie, et rien quand elle ne l est pas', () => {
    const { composant, appels } = monter();
    composant.changerPrefecture('Conakry');
    composant.q.set('paracetamol');
    composant.chercher();
    composant.commune.set('Ratoma');
    composant.chercher();
    expect(appels[0]?.commune).toBe('');
    expect(appels[1]?.commune).toBe('Ratoma');
  });
});

describe('recherche publique : ce qui s affiche', () => {
  it('donne un prix unique quand toutes les officines s alignent', () => {
    const { composant } = monter();
    expect(composant.prix(PRODUIT)).toMatch(/11\s?500/);
  });

  it('donne une fourchette quand elles different', () => {
    const { composant } = monter();
    const texte = composant.prix({ ...PRODUIT, prixMaxGnf: 13_000 });
    expect(texte).toMatch(/11\s?500/);
    expect(texte).toMatch(/13\s?000/);
  });

  it('dit la fraicheur du stock en clair', () => {
    const { composant } = monter();
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    const vieux = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(composant.declare(PRODUIT)).toBe('PUBLIC.SEARCH.DECLARED_TODAY');
    expect(composant.declare({ ...PRODUIT, declareLe: hier })).toBe('PUBLIC.SEARCH.DECLARED_YESTERDAY');
    expect(composant.declare({ ...PRODUIT, declareLe: vieux })).toBe('PUBLIC.SEARCH.DECLARED_DAYS 3');
  });

  it('une erreur de l API s affiche au lieu de laisser la page muette', () => {
    const { composant } = monter({
      produits: () => throwError(() => ({ error: { message: 'Service indisponible' } })),
    } as Partial<RechercheService>);
    composant.changerPrefecture('Conakry');
    composant.q.set('paracetamol');
    composant.chercher();
    expect(composant.erreur()).toBe('Service indisponible');
    expect(composant.chargement()).toBe(false);
  });
});
