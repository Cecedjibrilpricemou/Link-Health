// A3 : la page publique d'une officine.
//
// Ce qui compte : on arrive souvent ici depuis la recherche d'un produit, et
// ce produit doit etre repris sans qu'on le retape ; le visiteur doit pouvoir
// revenir a tout le rayon en un geste ; et une officine indisponible le dit
// au lieu de laisser une page blanche.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { PharmacieDetailView, ProduitEnRayonView } from '@baobaoheath/shared-types';

import { PharmacieComponent } from './pharmacie.component';
import { RechercheService } from '../../../core/services/recherche.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';

const PRODUIT: ProduitEnRayonView = {
  id: 'med-1',
  libelle: 'Doliprane 500 mg',
  molecule: 'Paracétamol',
  forme: 'comprimé',
  dosage: '500 mg',
  categorie: 'MEDICAMENT',
  estMedicament: true,
  prixGnf: 11_500,
  etatStock: 'DISPONIBLE',
  declareLe: new Date().toISOString(),
};

const OFFICINE: PharmacieDetailView = {
  id: 'ph-1',
  nom: 'Pharmacie Pricemou',
  prefecture: 'Conakry',
  commune: 'Dixinn',
  quartier: 'Belle-Vue',
  adresse: 'Route du Niger',
  telephone: '620000000',
  nombreProduits: 42,
  produits: [PRODUIT],
  horaires: null,
  ouverture: { ouvert: null, fermeA: null, prochaine: null },
};

function monter(options: { id?: string | null; q?: string | null; erreur?: boolean } = {}) {
  const { id = 'ph-1', q = null, erreur = false } = options;
  const appels: { id: string; q?: string }[] = [];

  const route = {
    snapshot: {
      paramMap: { get: (nom: string) => (nom === 'id' ? id : null) },
      queryParamMap: { get: (nom: string) => (nom === 'q' ? q : null) },
    },
  };

  const service = {
    pharmacie: (idDemande: string, terme?: string) => {
      appels.push({ id: idDemande, q: terme });
      if (erreur) return throwError(() => ({ error: { message: 'Cette pharmacie n’est pas disponible.' } }));
      return of({ success: true, data: OFFICINE });
    },
  };

  TestBed.configureTestingModule({
    imports: [PharmacieComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ActivatedRoute, useValue: route },
      { provide: RechercheService, useValue: service },
      { provide: PlateformeService, useValue: { devise: () => 'GNF' } },
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
  TestBed.overrideComponent(PharmacieComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(PharmacieComponent);
  fixture.detectChanges();
  return { composant: fixture.componentInstance, appels };
}

describe('page d une officine : l arrivee', () => {
  it('charge le rayon de l officine demandee', () => {
    const { composant, appels } = monter();
    expect(appels).toEqual([{ id: 'ph-1', q: '' }]);
    expect(composant.officine()?.nom).toBe('Pharmacie Pricemou');
    expect(composant.chargement()).toBe(false);
  });

  it('reprend le produit cherche, pour ne pas le faire retaper', () => {
    const { composant, appels } = monter({ q: 'paracetamol' });
    expect(composant.q()).toBe('paracetamol');
    expect(appels[0]?.q).toBe('paracetamol');
  });

  it('sans identifiant, le dit au lieu de laisser une page blanche', () => {
    const { composant, appels } = monter({ id: null });
    expect(appels).toEqual([]);
    expect(composant.erreur()).toBe('PUBLIC.PHARMACY.NOT_FOUND');
    expect(composant.chargement()).toBe(false);
  });

  it('une officine indisponible affiche le motif rendu par l API', () => {
    const { composant } = monter({ erreur: true });
    expect(composant.erreur()).toBe('Cette pharmacie n’est pas disponible.');
    expect(composant.officine()).toBeNull();
  });
});

describe('page d une officine : chercher dans le rayon', () => {
  it('relance la recherche avec le mot tape', () => {
    const { composant, appels } = monter();
    composant.q.set('sirop');
    composant.charger();
    expect(appels[1]).toEqual({ id: 'ph-1', q: 'sirop' });
  });

  it('« tout voir » efface le filtre herite de la recherche', () => {
    const { composant, appels } = monter({ q: 'paracetamol' });
    composant.toutVoir();
    expect(composant.q()).toBe('');
    expect(appels[1]?.q).toBe('');
  });

  it('dit que la liste est partielle quand elle l est', () => {
    // 1 produit montre sur 42 en rayon : sans cette mention, on croirait
    // l'officine presque vide.
    const { composant } = monter({ q: 'paracetamol' });
    expect(composant.filtre()).toBe(true);
  });

  it('ne le dit pas quand on voit tout le rayon', () => {
    const { composant } = monter();
    expect(composant.filtre()).toBe(false);
  });
});

describe('page d une officine : ce qui s affiche', () => {
  it('dit ou elle se trouve, sans repeter ce qu on ignore', () => {
    const { composant } = monter();
    expect(composant.lieu()).toBe('Dixinn · Belle-Vue');
  });

  it('affiche le prix pratique par cette officine', () => {
    const { composant } = monter();
    expect(composant.prix(PRODUIT)).toMatch(/11\s?500/);
  });

  it('dit la fraicheur du stock en clair', () => {
    const { composant } = monter();
    const vieux = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(composant.declare(PRODUIT)).toBe('PUBLIC.SEARCH.DECLARED_TODAY');
    expect(composant.declare({ ...PRODUIT, declareLe: vieux })).toBe('PUBLIC.SEARCH.DECLARED_DAYS 3');
  });
});
