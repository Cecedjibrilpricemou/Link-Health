// Le stock verifie a l'arrivee d'une commande.
//
// **Le defaut que ce fichier empeche de revenir** : le pharmacien repondait
// « j'ai tout » de memoire, apres avoir fouille ses rayons. Ces tests tiennent
// ce que la verification lui promet : un lot perime ne compte pas, une
// quantite insuffisante se voit, et un equivalent n'est que signale.
jest.mock('../src/config/prisma', () => ({ prisma: { stock: { findMany: jest.fn() } } }));

import {
  disponibilitesDansMonStock,
  evaluerDisponibilite,
  quantiteUtilisable,
  type LigneAServir,
  type StockProduit,
} from '../src/services/disponibilite-stock.service';

const { prisma } = jest.requireMock('../src/config/prisma') as { prisma: { stock: { findMany: jest.Mock } } };

const MAINTENANT = new Date('2026-11-20T10:00:00Z');
const PERIME = new Date('2026-10-01T00:00:00Z');
const VALIDE = new Date('2027-06-01T00:00:00Z');

const DOLIPRANE = { libelle: 'Doliprane 500 mg', dci: 'Paracetamol', dosage: '500 mg' };
const EFFERALGAN = { libelle: 'Efferalgan 500mg', dci: 'paracétamol', dosage: '500mg' };
const AMOXI = { libelle: 'Clamoxyl 500 mg', dci: 'Amoxicilline', dosage: '500 mg' };

function ligne(id: string, idMedicament: string, quantite: number, medicament: LigneAServir['medicament'] = DOLIPRANE): LigneAServir {
  return { id, idMedicament, quantite, medicament };
}

function stock(
  idMedicament: string,
  lots: { quantite: number; datePeremption: Date | null }[],
  medicament: StockProduit['medicament'] = DOLIPRANE,
  quantite = 0,
): StockProduit {
  return { idMedicament, quantite, medicament, lots };
}

describe('la quantite delivrable', () => {
  it('ne compte que les lots non perimes', () => {
    const s = stock('m1', [{ quantite: 5, datePeremption: PERIME }, { quantite: 3, datePeremption: VALIDE }]);
    expect(quantiteUtilisable(s, MAINTENANT)).toBe(3);
  });

  // La date est facultative a la saisie : l'ignorer ferait disparaitre des
  // boites bien reelles.
  it('compte un lot sans date de peremption', () => {
    expect(quantiteUtilisable(stock('m1', [{ quantite: 4, datePeremption: null }]), MAINTENANT)).toBe(4);
  });

  it('garde le total d un stock saisi avant le suivi par lot', () => {
    expect(quantiteUtilisable(stock('m1', [], DOLIPRANE, 12), MAINTENANT)).toBe(12);
  });

  it('ne rend jamais une quantite negative', () => {
    expect(quantiteUtilisable(stock('m1', [{ quantite: -2, datePeremption: VALIDE }]), MAINTENANT)).toBe(0);
  });
});

describe('confronter une commande au stock', () => {
  it('dit COMPLETE quand chaque ligne est couverte', () => {
    const r = evaluerDisponibilite(
      [ligne('l1', 'm1', 2), ligne('l2', 'm2', 1, AMOXI)],
      [stock('m1', [{ quantite: 2, datePeremption: VALIDE }]), stock('m2', [{ quantite: 9, datePeremption: VALIDE }], AMOXI)],
      MAINTENANT,
    );
    expect(r).toEqual(expect.objectContaining({ etat: 'COMPLETE', disponibles: 2, total: 2 }));
    expect(r.lignes.map((l) => l.etat)).toEqual(['DISPONIBLE', 'DISPONIBLE']);
  });

  it('dit PARTIELLE et nomme ce qui manque, ou ce qui ne suffit pas', () => {
    const r = evaluerDisponibilite(
      [ligne('l1', 'm1', 2), ligne('l2', 'm2', 3, AMOXI), ligne('l3', 'm3', 1, { libelle: 'Morphine', dci: 'Morphine', dosage: '10 mg' })],
      [stock('m1', [{ quantite: 5, datePeremption: VALIDE }]), stock('m2', [{ quantite: 1, datePeremption: VALIDE }], AMOXI)],
      MAINTENANT,
    );
    expect(r).toEqual(expect.objectContaining({ etat: 'PARTIELLE', disponibles: 1, total: 3 }));
    expect(r.lignes).toEqual([
      expect.objectContaining({ idLigneOrdonnance: 'l1', etat: 'DISPONIBLE', quantiteEnStock: 5 }),
      expect.objectContaining({ idLigneOrdonnance: 'l2', etat: 'INSUFFISANT', quantiteEnStock: 1, quantiteDemandee: 3 }),
      expect.objectContaining({ idLigneOrdonnance: 'l3', etat: 'ABSENT', quantiteEnStock: 0, libelle: 'Morphine' }),
    ]);
  });

  // Une boite perimee ne se delivre pas : elle ne doit pas faire croire qu'on
  // a le produit.
  it('dit AUCUNE quand le seul stock est perime', () => {
    const r = evaluerDisponibilite([ligne('l1', 'm1', 1)], [stock('m1', [{ quantite: 50, datePeremption: PERIME }])], MAINTENANT);
    expect(r.etat).toBe('AUCUNE');
    expect(r.lignes[0]!.etat).toBe('ABSENT');
  });
});

describe('les equivalents, seulement signales', () => {
  it('signale un equivalent : meme molecule, meme dosage, autre marque', () => {
    const r = evaluerDisponibilite(
      [ligne('l1', 'm1', 2)],
      [stock('m9', [{ quantite: 6, datePeremption: VALIDE }], EFFERALGAN)],
      MAINTENANT,
    );
    // « Paracetamol » et « paracétamol » ne se ressemblent pas assez pour
    // l'ordinateur : l'accent les separe. On ne devine pas.
    expect(r.lignes[0]!.equivalents).toEqual([]);

    const sansAccent = evaluerDisponibilite(
      [ligne('l1', 'm1', 2)],
      [stock('m9', [{ quantite: 6, datePeremption: VALIDE }], { ...EFFERALGAN, dci: 'PARACETAMOL' })],
      MAINTENANT,
    );
    expect(sansAccent.lignes[0]!.equivalents).toEqual([
      { idMedicament: 'm9', libelle: 'Efferalgan 500mg', quantiteEnStock: 6 },
    ]);
    // Signale, pas compte : la ligne reste absente, c'est au pharmacien de
    // decider d'une substitution avec le patient.
    expect(sansAccent.lignes[0]!.etat).toBe('ABSENT');
    expect(sansAccent.etat).toBe('AUCUNE');
  });

  it('ne signale pas une autre molecule ni un autre dosage', () => {
    const r = evaluerDisponibilite(
      [ligne('l1', 'm1', 1)],
      [
        stock('m2', [{ quantite: 9, datePeremption: VALIDE }], AMOXI),
        stock('m3', [{ quantite: 9, datePeremption: VALIDE }], { libelle: 'Doliprane 1000', dci: 'Paracetamol', dosage: '1000 mg' }),
      ],
      MAINTENANT,
    );
    expect(r.lignes[0]!.equivalents).toEqual([]);
  });

  it('ne signale ni un equivalent perime, ni un equivalent quand le produit suffit', () => {
    const autre = { ...DOLIPRANE, libelle: 'Dafalgan 500 mg' };
    const perime = evaluerDisponibilite(
      [ligne('l1', 'm1', 1)],
      [stock('m9', [{ quantite: 9, datePeremption: PERIME }], autre)],
      MAINTENANT,
    );
    expect(perime.lignes[0]!.equivalents).toEqual([]);

    const suffit = evaluerDisponibilite(
      [ligne('l1', 'm1', 1)],
      [stock('m1', [{ quantite: 3, datePeremption: VALIDE }]), stock('m9', [{ quantite: 9, datePeremption: VALIDE }], autre)],
      MAINTENANT,
    );
    expect(suffit.lignes[0]!.equivalents).toEqual([]);
  });

  it('n a pas d equivalent pour un produit sans molecule renseignee', () => {
    const sansDci = { libelle: 'Tisane', dci: null, dosage: null };
    const r = evaluerDisponibilite(
      [ligne('l1', 'm1', 1, sansDci)],
      [stock('m9', [{ quantite: 9, datePeremption: VALIDE }], { ...sansDci, libelle: 'Autre tisane' })],
      MAINTENANT,
    );
    expect(r.lignes[0]!.equivalents).toEqual([]);
  });
});

describe('lire le stock de l officine', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lit les produits prescrits et leurs equivalents possibles, chez elle seule, en une requete', async () => {
    prisma.stock.findMany.mockResolvedValue([stock('m1', [{ quantite: 4, datePeremption: VALIDE }])]);

    const r = await disponibilitesDansMonStock('ph-1', [
      { id: 'c1', lignes: [ligne('l1', 'm1', 2)] },
      { id: 'c2', lignes: [ligne('l2', 'm2', 1, AMOXI)] },
    ], MAINTENANT);

    expect(prisma.stock.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.stock.findMany.mock.calls[0]![0].where;
    expect(where.idStructure).toBe('ph-1');
    expect(where.OR[0]).toEqual({ idMedicament: { in: ['m1', 'm2'] } });
    expect(r.get('c1')!.etat).toBe('COMPLETE');
    expect(r.get('c2')!.etat).toBe('AUCUNE');
  });

  it('ne lit rien quand il n y a aucun appel', async () => {
    const r = await disponibilitesDansMonStock('ph-1', [], MAINTENANT);
    expect(r.size).toBe(0);
    expect(prisma.stock.findMany).not.toHaveBeenCalled();
  });
});
