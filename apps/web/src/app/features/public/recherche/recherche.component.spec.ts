// A1 et A2 : l'ecran de recherche publique.
//
// Ce qui compte ici : on peut chercher **sans avoir dit ou l'on est**, la
// zone choisie n'est pas redemandee a chaque visite, changer de zone
// n'affiche pas des resultats qui ne la concernent plus, et les officines se
// deplient sous le produit sans quitter la liste.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import type {
  PharmacieProduitView,
  PharmacieTrouveeView,
  ProduitTrouveView,
  RechercheProduitsView,
} from '@baobaoheath/shared-types';

import { RechercheComponent } from './recherche.component';
import { GeographieService } from '../../../core/services/geographie.service';
import { RechercheService } from '../../../core/services/recherche.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';

const PHARMACIE: PharmacieProduitView = {
  id: 'ph-1',
  nom: 'Pharmacie Pricemou',
  prefecture: 'Conakry',
  commune: 'Dixinn',
  quartier: 'Belle-Vue',
  telephone: '620000000',
  prixGnf: 11_500,
  etatStock: 'DISPONIBLE',
  declareLe: new Date().toISOString(),
  latitude: 9.545,
  longitude: -13.682,
  ouverture: { ouvert: null, fermeA: null, prochaine: null },
};

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
  pharmacies: [PHARMACIE, { ...PHARMACIE, id: 'ph-2', nom: 'Pharmacie Donka', prixGnf: 13_000 }],
};

const OFFICINE_TROUVEE: PharmacieTrouveeView = {
  id: 'ph-1',
  nom: 'Pharmacie Pricemou',
  prefecture: 'Conakry',
  commune: 'Dixinn',
  quartier: 'Belle-Vue',
  telephone: '620000000',
  nombreProduits: 42,
  latitude: 9.545,
  longitude: -13.682,
  ouverture: { ouvert: null, fermeA: null, prochaine: null },
};

const RESULTAT: RechercheProduitsView = {
  zoneUtilisee: 'COMMUNE',
  prefecture: 'Conakry',
  commune: 'Dixinn',
  communesVoisines: [],
  produits: [PRODUIT],
  pharmaciesTrouvees: [OFFICINE_TROUVEE],
};

function monter(recherche: Partial<RechercheService> = {}) {
  const appels: { q: string; prefecture: string; commune?: string }[] = [];
  const geo = {
    chargerConfiguration: () => of(null),
    nomsSuggeres: (role: string) => of(role === 'elargissement' ? ['Conakry'] : ['Dixinn', 'Ratoma']),
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
      { provide: PlateformeService, useValue: { devise: () => 'GNF' } },
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

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Pas de stockage dans cet environnement : les tests qui en dependent
    // le disent eux-memes.
  }
});

describe('recherche publique : quand peut-on chercher', () => {
  it('sans avoir choisi sa zone : taper le produit suffit', () => {
    const { composant } = monter();
    composant.q.set('paracetamol');
    expect(composant.peutChercher()).toBe(true);
  });

  it('pas avec une seule lettre', () => {
    const { composant } = monter();
    composant.q.set('p');
    expect(composant.peutChercher()).toBe(false);
  });

  it('une recherche sans zone part quand meme vers l API', () => {
    const { composant, appels } = monter();
    composant.q.set('paracetamol');
    composant.chercher();
    expect(appels).toEqual([{ q: 'paracetamol', prefecture: '', commune: '' }]);
  });

  it('ne lance rien tant que le mot est trop court', () => {
    const { composant, appels } = monter();
    composant.q.set('p');
    composant.chercher();
    expect(appels).toEqual([]);
  });
});

describe('recherche publique : la zone', () => {
  it('propose les communes de la zone choisie', () => {
    const { composant } = monter();
    composant.changerPrefecture('Conakry');
    expect(composant.communes()).toEqual(['Dixinn', 'Ratoma']);
  });

  it('changer de zone efface les resultats precedents', () => {
    const { composant } = monter();
    composant.changerPrefecture('Conakry');
    composant.q.set('paracetamol');
    composant.chercher();
    expect(composant.resultat()).not.toBeNull();

    // Sinon le visiteur lirait des prix d'une autre ville que celle affichee.
    composant.changerPrefecture('Kindia');
    expect(composant.resultat()).toBeNull();
    expect(composant.commune()).toBe('');
  });

  it('retient la zone pour la visite suivante, sans la redemander', () => {
    const premier = monter();
    premier.composant.changerPrefecture('Conakry');
    premier.composant.commune.set('Dixinn');
    premier.composant.q.set('paracetamol');
    premier.composant.chercher();

    TestBed.resetTestingModule();
    const second = monter();
    expect(second.composant.prefecture()).toBe('Conakry');
    expect(second.composant.commune()).toBe('Dixinn');
  });

  it('oublie une zone qui n existe plus au referentiel', () => {
    localStorage.setItem(
      'keneya.recherche.zone',
      JSON.stringify({ prefecture: 'Prefecture supprimee', commune: 'Ailleurs' }),
    );
    const { composant } = monter();
    expect(composant.prefecture()).toBe('');
  });
});

describe('recherche publique : les officines sous le produit', () => {
  it('reste fermee tant qu on ne la demande pas', () => {
    const { composant } = monter();
    expect(composant.estDeplie(PRODUIT.id)).toBe(false);
  });

  it('s ouvre et se referme au meme bouton', () => {
    const { composant } = monter();
    composant.basculerPharmacies(PRODUIT.id);
    expect(composant.estDeplie(PRODUIT.id)).toBe(true);
    composant.basculerPharmacies(PRODUIT.id);
    expect(composant.estDeplie(PRODUIT.id)).toBe(false);
  });

  it('se referme quand une nouvelle recherche part', () => {
    const { composant } = monter();
    composant.q.set('paracetamol');
    composant.chercher();
    composant.basculerPharmacies(PRODUIT.id);
    composant.chercher();
    expect(composant.estDeplie(PRODUIT.id)).toBe(false);
  });

  it('dit ou se trouve l officine, sans repeter ce qu on ignore', () => {
    const { composant } = monter();
    expect(composant.lieuDe(PHARMACIE)).toBe('Dixinn · Belle-Vue');
    expect(composant.lieuDe({ ...PHARMACIE, quartier: null })).toBe('Dixinn');
    expect(composant.lieuDe({ ...PHARMACIE, commune: null, quartier: null })).toBe('');
  });

  it('sert aussi aux officines trouvees par leur nom (A3)', () => {
    const { composant } = monter();
    expect(composant.lieuDe(OFFICINE_TROUVEE)).toBe('Dixinn · Belle-Vue');
  });

  it('regroupe les pharmacies de la recherche pour la carte sans doublons', () => {
    const { composant } = monter();
    composant.resultat.set(RESULTAT);

    expect(composant.pharmaciesCarte().map((pharmacie) => pharmacie.id)).toEqual(['ph-1', 'ph-2']);
  });

  it('affiche le prix de chaque officine, pas seulement le plus bas', () => {
    const { composant } = monter();
    expect(composant.prixPharmacie(PHARMACIE)).toMatch(/11\s?500/);
    expect(composant.prixPharmacie({ ...PHARMACIE, prixGnf: 13_000 })).toMatch(/13\s?000/);
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
    composant.q.set('paracetamol');
    composant.chercher();
    expect(composant.erreur()).toBe('Service indisponible');
    expect(composant.chargement()).toBe(false);
  });
});
