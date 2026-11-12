// A1 : la recherche publique de produits.
//
// Ce qui est verrouille ici : ce qui ne doit **jamais** sortir (produits
// reglementes, quantites exactes), ce que le visiteur doit retrouver meme
// mal ecrit, et l'elargissement qui evite de repondre « rien » quand le
// produit est a deux rues.
import { chercherProduits, motsDeLaRecherche } from '../src/services/recherche.service';
import { ValidationError } from '../src/utils/app-error';
import { empreinteCatalogue, etatDuStock, prixDeVenteGnf } from '../src/utils/catalogue';

const voisines: { valeur: string[] } = { valeur: [] };
jest.mock('../src/services/geographie.service', () => ({
  voisinsDe: jest.fn(async () => voisines.valeur),
}));

jest.mock('../src/config/prisma', () => ({
  prisma: { medicament: { findMany: jest.fn() } },
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { medicament: { findMany: M } };
};

const MAINTENANT = new Date('2026-11-12T10:00:00.000Z');

function stock(sur: Partial<{
  quantite: number; seuilAlerte: number; margeGnf: number; modifieLe: Date; idStructure: string;
}> = {}) {
  return {
    quantite: 40,
    seuilAlerte: 10,
    margeGnf: 1_500,
    modifieLe: MAINTENANT,
    idStructure: 'ph-1',
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

const CRITERE = { q: 'paracetamol', prefecture: 'Conakry', commune: 'Ratoma' };

beforeEach(() => {
  jest.clearAllMocks();
  voisines.valeur = [];
});

// ── Ce qu'on cherche ────────────────────────────────────────────────

describe('motsDeLaRecherche', () => {
  it('retire les accents et la casse : on tape rarement « Paracétamol »', () => {
    expect(motsDeLaRecherche('Paracétamol')).toEqual(['paracetamol']);
    expect(motsDeLaRecherche('  SIROP   Toux ')).toEqual(['sirop', 'toux']);
  });

  it('ecarte les mots d une lettre plutot que de refuser la recherche', () => {
    // « vitamine b 12 » doit chercher vitamine et 12, pas rien du tout.
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

  it('refuse une recherche sans zone : afficher des prix a l autre bout du pays n aide personne', async () => {
    await expect(chercherProduits({ ...CRITERE, prefecture: '  ' })).rejects.toThrow(ValidationError);
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

  it('ne rend jamais la quantite en stock, seulement un etat', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit({ stocks: [stock({ quantite: 7 })] })]);
    const r = await chercherProduits(CRITERE);
    const rendu = JSON.stringify(r.produits[0]);
    expect(rendu).not.toContain('quantite');
    expect(rendu).not.toContain('seuilAlerte');
    expect(r.produits[0]?.etatStock).toBe('FAIBLE');
  });

  it('ne sollicite que les pharmacies actives', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await chercherProduits(CRITERE);
    const où = prisma.medicament.findMany.mock.calls[0][0].where.stocks.some;
    expect(où.quantite).toEqual({ gt: 0 });
    expect(où.structure.is.type).toBe('PHARMACIE');
    expect(où.structure.is.estActive).toBe(true);
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
  });

  it('donne la fourchette quand deux officines ne vendent pas au meme prix', async () => {
    prisma.medicament.findMany.mockResolvedValue([
      produit({
        stocks: [
          stock({ idStructure: 'ph-1', margeGnf: 1_500 }),
          stock({ idStructure: 'ph-2', margeGnf: 3_000 }),
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
      produit({ stocks: [stock({ idStructure: 'ph-1' }), stock({ idStructure: 'ph-1' })] }),
    ]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.nombrePharmacies).toBe(1);
  });

  it('retient le meilleur etat de la zone et la declaration la plus recente', async () => {
    const vieux = new Date('2026-11-01T08:00:00.000Z');
    prisma.medicament.findMany.mockResolvedValue([
      produit({
        stocks: [
          stock({ idStructure: 'ph-1', quantite: 2, modifieLe: vieux }),
          stock({ idStructure: 'ph-2', quantite: 80, modifieLe: MAINTENANT }),
        ],
      }),
    ]);
    const r = await chercherProduits(CRITERE);
    // Une officine presque a sec ne doit pas decourager d'aller chez l'autre.
    expect(r.produits[0]?.etatStock).toBe('DISPONIBLE');
    expect(r.produits[0]?.declareLe).toEqual(MAINTENANT);
  });

  it('signale un medicament, pour que l ecran invite a demander conseil', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit({ categorie: 'LAIT_INFANTILE', dci: null })]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits[0]?.estMedicament).toBe(false);
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
    voisines.valeur = ['Dixinn', 'Matam'];
    prisma.medicament.findMany.mockResolvedValueOnce([]).mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.zoneUtilisee).toBe('VOISINES');
    expect(r.communesVoisines).toEqual(['Dixinn', 'Matam']);
  });

  it('finit par la zone entiere plutot que de repondre « rien »', async () => {
    voisines.valeur = ['Dixinn'];
    prisma.medicament.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([produit()]);
    const r = await chercherProduits(CRITERE);
    expect(r.zoneUtilisee).toBe('PREFECTURE');
    expect(prisma.medicament.findMany).toHaveBeenCalledTimes(3);
  });

  it('sans commune, interroge directement la zone entiere', async () => {
    prisma.medicament.findMany.mockResolvedValue([produit()]);
    const r = await chercherProduits({ q: 'paracetamol', prefecture: 'Conakry' });
    expect(r.zoneUtilisee).toBe('PREFECTURE');
    expect(prisma.medicament.findMany).toHaveBeenCalledTimes(1);
  });

  it('rend une liste vide sans rien inventer quand le produit est introuvable', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    const r = await chercherProduits(CRITERE);
    expect(r.produits).toEqual([]);
    expect(r.commune).toBe('Ratoma');
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
