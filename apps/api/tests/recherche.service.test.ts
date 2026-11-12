// A1 et A2 : la recherche publique de produits, et les pharmacies qui les ont.
//
// Ce qui est verrouille ici : ce qui ne doit **jamais** sortir (produits
// reglementes, quantites exactes), ce que le visiteur doit retrouver meme
// mal ecrit, le fait qu'il puisse chercher **sans dire ou il est**, et
// l'ordre dans lequel on lui propose les officines.
import {
  catalogueDe,
  chercherPharmacies,
  chercherProduits,
  comparerPharmacies,
  motsDeLaRecherche,
  rangProximite,
} from '../src/services/recherche.service';
import type { PharmacieProduit } from '../src/services/recherche.service';
import { NotFoundError, ValidationError } from '../src/utils/app-error';
import { empreinteCatalogue, etatDuStock, prixDeVenteGnf } from '../src/utils/catalogue';

const voisines: { valeur: string[] } = { valeur: [] };
jest.mock('../src/services/geographie.service', () => ({
  voisinsDe: jest.fn(async () => voisines.valeur),
}));

jest.mock('../src/config/prisma', () => ({
  prisma: {
    medicament: { findMany: jest.fn() },
    structureSante: { findMany: jest.fn(), findFirst: jest.fn() },
    stock: { groupBy: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  },
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    medicament: { findMany: M };
    structureSante: { findMany: M; findFirst: M };
    stock: { groupBy: M; count: M; findMany: M };
  };
};

const MAINTENANT = new Date('2026-11-12T10:00:00.000Z');

function officine(sur: Partial<{
  id: string; nom: string; prefecture: string; commune: string | null;
  quartier: string | null; telephone: string | null;
}> = {}) {
  return {
    id: 'ph-1',
    nom: 'Pharmacie Pricemou',
    prefecture: 'Conakry',
    commune: 'Dixinn',
    quartier: 'Belle-Vue',
    telephone: '620000000',
    ...sur,
  };
}

function stock(sur: Partial<{
  quantite: number; seuilAlerte: number; margeGnf: number; modifieLe: Date;
  structure: ReturnType<typeof officine> | null;
}> = {}) {
  return {
    quantite: 40,
    seuilAlerte: 10,
    margeGnf: 1_500,
    modifieLe: MAINTENANT,
    structure: officine(),
    ...sur,
  };
}

function produit(sur: Record<string, unknown> = {}) {
  return {
    id: 'med-1',
    libelle: 'Doliprane 500 mg',
    dci: 'Paracétamol',
    nomCommercial: 'Doliprane',
    forme: 'comprimé',
    dosage: '500 mg',
    categorie: 'MEDICAMENT',
    prixUnitaireGnf: 10_000,
    stocks: [stock()],
    ...sur,
  };
}

const CRITERE = { q: 'paracetamol', prefecture: 'Conakry', commune: 'Dixinn' };

beforeEach(() => {
  jest.clearAllMocks();
  voisines.valeur = [];
  // Par defaut aucune officine ne porte le nom cherche : les tests de
  // produits ne s'occupent pas de A3.
  prisma.structureSante.findMany.mockResolvedValue([]);
  prisma.stock.groupBy.mockResolvedValue([]);
});

// ── Ce qu'on cherche ────────────────────────────────────────────────

describe('motsDeLaRecherche', () => {
  it('retire les accents et la casse : on tape rarement « Paracétamol »', () => {
    expect(motsDeLaRecherche('Paracétamol')).toEqual(['paracetamol']);
    expect(motsDeLaRecherche('  SIROP   Toux ')).toEqual(['sirop', 'toux']);
  });

  it('ecarte les mots d une lettre plutot que de refuser la recherche', () => {
    expect(motsDeLaRecherche('vitamine b 12')).toEqual(['vitamine', '12']);
  });

  it('ne retient que les quatre premiers mots', () => {
    expect(motsDeLaRecherche('un deux trois quatre cinq six')).toHaveLength(4);
  });
});

describe('chercherProduits : les refus', () => {
  it('refuse une recherche d une seule lettre', async () => {
    await expect(chercherProduits({ ...CRITERE, q: 'p' })).rejects.toThrow(ValidationError);
    expect(prisma.medicament.findMany).not.toHaveBeenCalled();
  });
});

// ── Chercher sans dire ou l'on est ──────────────────────────────────

describe('chercherProduits : la zone n est pas un prealable', () => {
  it('cherche dans tout le pays quand aucune zone n est donnee', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    const r = await chercherProduits({ q: 'paracetamol' });
    expect(r.zoneUtilisee).toBe('PAYS');
    expect(r.prefecture).toBeNull();
    expect(prisma.medicament.findMany).toHaveBeenCalledTimes(1);
  });

  it('ne pose alors aucun filtre de lieu sur les pharmacies', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    await chercherProduits({ q: 'paracetamol' });
    const structure = prisma.medicament.findMany.mock.calls[0][0].where.stocks.some.structure.is;
    expect(structure).toEqual({ type: 'PHARMACIE', estActive: true });
  });

  it('elargit jusqu au pays plutot que de repondre « rien »', async () => {
    // Commune, puis prefecture, puis pays : trois tentatives avant d'abandonner.
    prisma.medicament.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([produit({ stocks: [stock({ structure: officine({ prefecture: 'Kindia', commune: 'Kindia' }) })] })]);
    const r = await chercherProduits(CRITERE);
    expect(r.zoneUtilisee).toBe('PAYS');
    expect(r.produits[0]?.pharmacies[0]?.prefecture).toBe('Kindia');
  });

  it('rend une liste vide sans rien inventer quand le produit est introuvable', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits).toEqual([]);
    expect(r.commune).toBe('Dixinn');
  });
});

// ── Ce qui ne doit jamais sortir ────────────────────────────────────

describe('chercherProduits : ce que le public ne voit jamais', () => {
  it('exclut les produits reglementes de la requete elle-meme', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await chercherProduits(CRITERE);
    for (const appel of prisma.medicament.findMany.mock.calls) {
      expect(appel[0].where.estReglemente).toBe(false);
    }
  });

  it('exclut les produits retires du catalogue', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await chercherProduits(CRITERE);
    expect(prisma.medicament.findMany.mock.calls[0][0].where.estActif).toBe(true);
  });

  it('ne rend jamais la quantite en stock, ni pour le produit ni par officine', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit({ stocks: [stock({ quantite: 7 })] })]);
    const r = await chercherProduits(CRITERE);
    const rendu = JSON.stringify(r.produits[0]);
    expect(rendu).not.toContain('quantite');
    expect(rendu).not.toContain('seuilAlerte');
    expect(r.produits[0]?.etatStock).toBe('FAIBLE');
    expect(r.produits[0]?.pharmacies[0]?.etatStock).toBe('FAIBLE');
  });

  it('ne sollicite que les pharmacies actives', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await chercherProduits(CRITERE);
    const ou = prisma.medicament.findMany.mock.calls[0][0].where.stocks.some;
    expect(ou.quantite).toEqual({ gt: 0 });
    expect(ou.structure.is.type).toBe('PHARMACIE');
    expect(ou.structure.is.estActive).toBe(true);
  });
});

// ── Ce que le visiteur retrouve ─────────────────────────────────────

describe('chercherProduits : ce qu on retrouve', () => {
  it('cherche le mot dans le texte normalise et dans les champs bruts', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await chercherProduits(CRITERE);
    const et = prisma.medicament.findMany.mock.calls[0][0].where.AND;
    expect(et).toHaveLength(1);
    const champs = et[0].OR.map((c: Record<string, unknown>) => Object.keys(c)[0]);
    expect(champs).toEqual(['rechercheTexte', 'libelle', 'nomCommercial', 'dci']);
    expect(et[0].OR[0].rechercheTexte).toEqual({ contains: 'paracetamol' });
  });

  it('exige tous les mots : « doliprane 500 » ne ramene pas tous les Doliprane', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await chercherProduits({ ...CRITERE, q: 'doliprane 500' });
    expect(prisma.medicament.findMany.mock.calls[0][0].where.AND).toHaveLength(2);
  });

  it('annonce le prix de la caisse : prix de reference plus la marge de l officine', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.prixMinGnf).toBe(prixDeVenteGnf(10_000, 1_500));
    expect(r.produits[0]?.pharmacies[0]?.prixGnf).toBe(11_500);
  });

  it('donne la fourchette quand deux officines ne vendent pas au meme prix', async () => {
    prisma.medicament.findMany.mockResolvedValue([
      produit({
        stocks: [
          stock({ structure: officine({ id: 'ph-1' }), margeGnf: 1_500 }),
          stock({ structure: officine({ id: 'ph-2', nom: 'Pharmacie Donka' }), margeGnf: 3_000 }),
        ],
      }),
    ]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.prixMinGnf).toBe(11_500);
    expect(r.produits[0]?.prixMaxGnf).toBe(13_000);
    expect(r.produits[0]?.nombrePharmacies).toBe(2);
  });

  it('compte les officines, pas les lignes de stock', async () => {
    prisma.medicament.findMany.mockResolvedValue([
      produit({ stocks: [stock(), stock()] }),
    ]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.nombrePharmacies).toBe(1);
  });

  it('retient le meilleur etat de la zone et la declaration la plus recente', async () => {
    const vieux = new Date('2026-11-01T08:00:00.000Z');
    prisma.medicament.findMany.mockResolvedValue([
      produit({
        stocks: [
          stock({ structure: officine({ id: 'ph-1' }), quantite: 2, modifieLe: vieux }),
          stock({ structure: officine({ id: 'ph-2' }), quantite: 80, modifieLe: MAINTENANT }),
        ],
      }),
    ]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.etatStock).toBe('DISPONIBLE');
    expect(r.produits[0]?.declareLe).toEqual(MAINTENANT);
  });

  it('signale un medicament, pour que l ecran invite a demander conseil', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit({ categorie: 'LAIT_INFANTILE', dci: null })]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.estMedicament).toBe(false);
  });
});

// ── A2 : les officines, et dans quel ordre ──────────────────────────

describe('A2 : la liste des pharmacies qui ont le produit', () => {
  it('nomme chaque officine, avec son quartier et son telephone', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.pharmacies[0]).toEqual({
      id: 'ph-1',
      nom: 'Pharmacie Pricemou',
      prefecture: 'Conakry',
      commune: 'Dixinn',
      quartier: 'Belle-Vue',
      // Pour appeler avant de traverser la ville.
      telephone: '620000000',
      prixGnf: 11_500,
      etatStock: 'DISPONIBLE',
      declareLe: MAINTENANT,
    });
  });

  it('propose la plus proche d abord, puis la moins chere', async () => {
    prisma.medicament.findMany.mockResolvedValue([
      produit({
        stocks: [
          // Loin et bon marche.
          stock({ margeGnf: 0, structure: officine({ id: 'loin', nom: 'Kindia', prefecture: 'Kindia', commune: 'Kindia' }) }),
          // Dans la commune, mais la plus chere des deux voisines.
          stock({ margeGnf: 5_000, structure: officine({ id: 'ici-cher', nom: 'Ici cher' }) }),
          // Dans la commune et moins chere.
          stock({ margeGnf: 2_000, structure: officine({ id: 'ici', nom: 'Ici' }) }),
        ],
      }),
    ]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.pharmacies.map((p) => p.id)).toEqual(['ici', 'ici-cher', 'loin']);
  });

  it('place les communes voisines entre la commune et le reste de la zone', () => {
    const contexte = { prefecture: 'Conakry', commune: 'Dixinn', voisines: ['Ratoma'] };
    expect(rangProximite({ prefecture: 'Conakry', commune: 'Dixinn' }, contexte)).toBe(0);
    expect(rangProximite({ prefecture: 'Conakry', commune: 'Ratoma' }, contexte)).toBe(1);
    expect(rangProximite({ prefecture: 'Conakry', commune: 'Matoto' }, contexte)).toBe(2);
    expect(rangProximite({ prefecture: 'Kindia', commune: 'Kindia' }, contexte)).toBe(3);
  });

  it('sans zone connue, c est le prix qui classe : on ne fait traverser personne', () => {
    const vide = { prefecture: '', commune: '', voisines: [] };
    const a = { nom: 'A', prixGnf: 9_000, prefecture: 'Kindia', commune: 'Kindia' } as PharmacieProduit;
    const b = { nom: 'B', prixGnf: 7_000, prefecture: 'Conakry', commune: 'Dixinn' } as PharmacieProduit;
    expect(comparerPharmacies(a, b, vide)).toBeGreaterThan(0);
  });

  it('a prix et distance egaux, l ordre reste stable par le nom', () => {
    const contexte = { prefecture: 'Conakry', commune: 'Dixinn', voisines: [] };
    const a = { nom: 'Amara', prixGnf: 7_000, prefecture: 'Conakry', commune: 'Dixinn' } as PharmacieProduit;
    const b = { nom: 'Zenab', prixGnf: 7_000, prefecture: 'Conakry', commune: 'Dixinn' } as PharmacieProduit;
    expect(comparerPharmacies(a, b, contexte)).toBeLessThan(0);
  });

  it('ne noie pas le visiteur : au plus dix officines par produit', async () => {
    const stocks = Array.from({ length: 14 }, (_, i) =>
      stock({ margeGnf: i * 100, structure: officine({ id: 'ph-' + i, nom: 'Pharmacie ' + i }) }));
    prisma.medicament.findMany.mockResolvedValue([produit({ stocks })]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.pharmacies).toHaveLength(10);
    // Le compte annonce reste celui de toutes les officines, pas des dix.
    expect(r.produits[0]?.nombrePharmacies).toBe(14);
  });

  it('ignore une ligne de stock sans officine rattachee', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit({ stocks: [stock({ structure: null })] })]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits).toEqual([]);
  });
});

// ── L'elargissement ─────────────────────────────────────────────────

describe('chercherProduits : l elargissement', () => {
  it('s arrete a la commune des qu elle donne quelque chose', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.zoneUtilisee).toBe('COMMUNE');
    expect(prisma.medicament.findMany).toHaveBeenCalledTimes(1);
  });

  it('passe aux communes voisines quand la commune ne donne rien', async () => {
    voisines.valeur = ['Ratoma', 'Matam'];
    prisma.medicament.findMany.mockResolvedValueOnce([]).mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.zoneUtilisee).toBe('VOISINES');
    expect(r.communesVoisines).toEqual(['Ratoma', 'Matam']);
  });

  it('puis a la zone entiere', async () => {
    voisines.valeur = ['Ratoma'];
    prisma.medicament.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.zoneUtilisee).toBe('PREFECTURE');
  });

  it('sans commune, interroge directement la zone entiere', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    const r = await chercherProduits({ q: 'paracetamol', prefecture: 'Conakry' });
    expect(r.zoneUtilisee).toBe('PREFECTURE');
    expect(prisma.medicament.findMany).toHaveBeenCalledTimes(1);
  });
});

// ── Le catalogue ────────────────────────────────────────────────────

describe('empreinteCatalogue', () => {
  it('reunit le libelle, la marque, la molecule et la classe', () => {
    expect(
      empreinteCatalogue({
        libelle: 'Doliprane 500 mg',
        nomCommercial: 'Doliprane',
        dci: 'Paracétamol',
        classeTherapeutique: 'Antalgique',
      }),
    ).toBe('doliprane 500 mg doliprane paracetamol antalgique');
  });

  it('ignore les champs absents d un produit non medicamenteux', () => {
    expect(empreinteCatalogue({ libelle: 'Lait infantile 1er âge' })).toBe('lait infantile 1er age');
  });
});

describe('etatDuStock', () => {
  it('passe en stock faible au seuil, pas en dessous', () => {
    expect(etatDuStock(11, 10)).toBe('DISPONIBLE');
    expect(etatDuStock(10, 10)).toBe('FAIBLE');
  });
});

// ── A3 : chercher une officine par son nom ──────────────────────────

const OFFICINE_BASE = {
  id: 'ph-1',
  nom: 'Pharmacie Pricemou',
  prefecture: 'Conakry',
  commune: 'Dixinn',
  quartier: 'Belle-Vue',
  telephone: '620000000',
};

describe('chercherPharmacies', () => {
  it('trouve une officine par un mot de son nom', async () => {
    prisma.structureSante.findMany.mockResolvedValue([OFFICINE_BASE]);
    prisma.stock.groupBy.mockResolvedValue([{ idStructure: 'ph-1', _count: { _all: 42 } }]);

    const trouvees = await chercherPharmacies('pricemou');
    expect(trouvees).toEqual([{ ...OFFICINE_BASE, nombreProduits: 42 }]);
  });

  it('ne cherche que des pharmacies ouvertes', async () => {
    prisma.structureSante.findMany.mockResolvedValue([]);
    await chercherPharmacies('pricemou');
    const ou = prisma.structureSante.findMany.mock.calls[0][0].where;
    expect(ou.type).toBe('PHARMACIE');
    expect(ou.estActive).toBe(true);
  });

  it('exige tous les mots du nom', async () => {
    prisma.structureSante.findMany.mockResolvedValue([]);
    await chercherPharmacies('pharmacie du port');
    expect(prisma.structureSante.findMany.mock.calls[0][0].where.AND).toHaveLength(3);
  });

  it('ne compte dans le rayon ni les produits reglementes ni les retires', async () => {
    prisma.structureSante.findMany.mockResolvedValue([OFFICINE_BASE]);
    prisma.stock.groupBy.mockResolvedValue([]);
    await chercherPharmacies('pricemou');
    const ou = prisma.stock.groupBy.mock.calls[0][0].where;
    expect(ou.medicament).toEqual({ estActif: true, estReglemente: false });
    expect(ou.quantite).toEqual({ gt: 0 });
  });

  it('dit zero plutot que rien quand une officine n a plus de stock', async () => {
    prisma.structureSante.findMany.mockResolvedValue([OFFICINE_BASE]);
    prisma.stock.groupBy.mockResolvedValue([]);
    const trouvees = await chercherPharmacies('pricemou');
    expect(trouvees[0]?.nombreProduits).toBe(0);
  });

  it('ne rend rien sur une recherche trop courte, sans interroger la base', async () => {
    expect(await chercherPharmacies('p')).toEqual([]);
    expect(prisma.structureSante.findMany).not.toHaveBeenCalled();
  });

  it('accompagne les resultats de produits', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    prisma.structureSante.findMany.mockResolvedValue([OFFICINE_BASE]);
    prisma.stock.groupBy.mockResolvedValue([{ idStructure: 'ph-1', _count: { _all: 5 } }]);
    const r = await chercherProduits(CRITERE);
    expect(r.pharmaciesTrouvees[0]?.nom).toBe('Pharmacie Pricemou');
  });

  it('repond encore quand aucun produit ne correspond : l officine est une reponse', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    prisma.structureSante.findMany.mockResolvedValue([OFFICINE_BASE]);
    prisma.stock.groupBy.mockResolvedValue([{ idStructure: 'ph-1', _count: { _all: 5 } }]);
    const r = await chercherProduits({ q: 'pricemou' });
    expect(r.produits).toEqual([]);
    expect(r.pharmaciesTrouvees).toHaveLength(1);
  });
});

// ── A3 : le rayon d'une officine ────────────────────────────────────

describe('catalogueDe', () => {
  const RAYON = [
    {
      quantite: 40,
      seuilAlerte: 10,
      margeGnf: 1_500,
      modifieLe: MAINTENANT,
      medicament: {
        id: 'med-1',
        libelle: 'Doliprane 500 mg',
        dci: 'Paracétamol',
        forme: 'comprimé',
        dosage: '500 mg',
        categorie: 'MEDICAMENT',
        prixUnitaireGnf: 10_000,
      },
    },
  ];

  it('rend l officine et ce qu elle a en rayon', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ ...OFFICINE_BASE, adresse: 'Route du Niger' });
    prisma.stock.count.mockResolvedValue(42);
    prisma.stock.findMany.mockResolvedValue(RAYON);

    const detail = await catalogueDe('ph-1');
    expect(detail.nom).toBe('Pharmacie Pricemou');
    expect(detail.nombreProduits).toBe(42);
    expect(detail.produits[0]).toEqual({
      id: 'med-1',
      libelle: 'Doliprane 500 mg',
      molecule: 'Paracétamol',
      forme: 'comprimé',
      dosage: '500 mg',
      categorie: 'MEDICAMENT',
      estMedicament: true,
      prixGnf: 11_500,
      etatStock: 'DISPONIBLE',
      declareLe: MAINTENANT,
    });
  });

  it('refuse une officine fermee ou qui n est pas une pharmacie', async () => {
    prisma.structureSante.findFirst.mockResolvedValue(null);
    await expect(catalogueDe('ph-inconnue')).rejects.toThrow(NotFoundError);
    const ou = prisma.structureSante.findFirst.mock.calls[0][0].where;
    expect(ou.type).toBe('PHARMACIE');
    expect(ou.estActive).toBe(true);
  });

  it('ne montre jamais un produit reglemente dans un rayon', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ ...OFFICINE_BASE, adresse: null });
    prisma.stock.count.mockResolvedValue(0);
    prisma.stock.findMany.mockResolvedValue([]);
    await catalogueDe('ph-1');
    expect(prisma.stock.findMany.mock.calls[0][0].where.medicament.estReglemente).toBe(false);
  });

  it('filtre le rayon quand on arrive en cherchant un produit precis', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ ...OFFICINE_BASE, adresse: null });
    prisma.stock.count.mockResolvedValue(42);
    prisma.stock.findMany.mockResolvedValue(RAYON);
    await catalogueDe('ph-1', 'paracetamol');
    expect(prisma.stock.findMany.mock.calls[0][0].where.medicament.AND).toHaveLength(1);
  });

  it('annonce le rayon entier meme quand la liste est filtree', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ ...OFFICINE_BASE, adresse: null });
    prisma.stock.count.mockResolvedValue(42);
    prisma.stock.findMany.mockResolvedValue(RAYON);
    const detail = await catalogueDe('ph-1', 'paracetamol');
    // « 1 resultat sur 42 en rayon » : sans ce total, on croirait l'officine vide.
    expect(detail.nombreProduits).toBe(42);
    expect(detail.produits).toHaveLength(1);
    expect(prisma.stock.count.mock.calls[0][0].where.medicament).toEqual({
      estActif: true,
      estReglemente: false,
    });
  });

  it('ne rend que ce qui est reellement en rayon', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ ...OFFICINE_BASE, adresse: null });
    prisma.stock.count.mockResolvedValue(0);
    prisma.stock.findMany.mockResolvedValue([]);
    await catalogueDe('ph-1');
    expect(prisma.stock.findMany.mock.calls[0][0].where.quantite).toEqual({ gt: 0 });
    expect(prisma.stock.findMany.mock.calls[0][0].where.idStructure).toBe('ph-1');
  });
});
