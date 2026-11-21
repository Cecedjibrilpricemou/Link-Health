// Assurance et tiers payant (EF-09, addendum du 2026-09-28 point 5).
//
// Le calcul de la prise en charge est la partie qu'on ne peut pas se
// permettre d'avoir fausse : un reste a charge errone se decouvre au
// comptoir, devant le patient. Il est donc pur, et teste pour lui-meme.
//
// La regle la plus importante de ce fichier tient en une phrase de l'addendum :
// **« un assure a 100 % paie quand meme son lait infantile »**.
import {
  calculerPriseEnCharge,
  motifDInegibilite,
  regleEnVigueur,
  repartir,
  verifierEligibilite,
  listerAssureursAdmin,
  type LigneAChiffrer,
  type ReglePourCalcul,
} from '../src/services/assurance.service';
import { JwtPayload } from '../src/types/auth.types';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    structureSante: { findUnique: jest.fn(), create: jest.fn() },
    structureAssureur: { findFirst: jest.fn() },
    assureur: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    patientProfile: { findUnique: jest.fn() },
    contratAssurance: { findFirst: jest.fn() },
    controleEligibilite: { create: jest.fn(), findMany: jest.fn() },
    venteComptoir: { aggregate: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn().mockResolvedValue('hashed') }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findFirst: M; create: M };
    structureSante: { findUnique: M; create: M };
    structureAssureur: { findFirst: M };
    assureur: { findUnique: M; findMany: M; update: M };
    patientProfile: { findUnique: M };
    contratAssurance: { findFirst: M };
    controleEligibilite: { create: M; findMany: M };
    venteComptoir: { aggregate: M };
    $transaction: M;
  };
};

const pharmacien: JwtPayload = { userId: 'pharma-1', role: 'PHARMACIEN', sessionId: 's' } as JwtPayload;

const LE_2_OCTOBRE = new Date('2026-10-02T10:00:00Z');

/** Un contrat ordinaire : 80 %, sans franchise ni plafond. */
const CONTRAT = { id: 'ct-1', tauxBasePourcent: 80, plafondAnnuelGnf: 0, franchiseGnf: 0 };

const ligne = (idMedicament: string, libelle: string, categorie: LigneAChiffrer['categorie'], montantGnf: number): LigneAChiffrer =>
  ({ idMedicament, libelle, categorie, montantGnf });

const PARA = ligne('m-para', 'Doliprane 500mg', 'MEDICAMENT', 10_000);
const LAIT = ligne('m-lait', 'Lait infantile 1er age', 'LAIT_INFANTILE', 45_000);

const regle = (r: Partial<ReglePourCalcul> & { categorie: ReglePourCalcul['categorie'] }): ReglePourCalcul => ({
  exclu: false, tauxPourcent: null, plafondLigneGnf: 0, dateEffet: new Date('2026-01-01'), ...r,
});

// ── Eligibilite ──────────────────────────────────────────────────────

describe('motifDInegibilite', () => {
  const base = { statut: 'ACTIF' as const, dateEffet: new Date('2026-01-01'), dateFin: null, carenceJours: 0 };

  it('ne dit rien quand le contrat couvre', () => {
    expect(motifDInegibilite(base, LE_2_OCTOBRE, 'VERIFIEE')).toBeNull();
  });

  it('refuse un contrat resilie', () => {
    expect(motifDInegibilite({ ...base, statut: 'RESILIE' }, LE_2_OCTOBRE, 'VERIFIEE')).toBe('Contrat resilie');
  });

  it('refuse un contrat suspendu', () => {
    expect(motifDInegibilite({ ...base, statut: 'SUSPENDU' }, LE_2_OCTOBRE, 'VERIFIEE')).toBe('Contrat suspendu');
  });

  it('refuse un contrat pas encore en vigueur', () => {
    expect(motifDInegibilite({ ...base, dateEffet: new Date('2027-01-01') }, LE_2_OCTOBRE, 'VERIFIEE'))
      .toMatch(/pas encore en vigueur/);
  });

  it('refuse un contrat expire', () => {
    expect(motifDInegibilite({ ...base, dateFin: new Date('2026-06-30') }, LE_2_OCTOBRE, 'VERIFIEE')).toBe('Contrat expire');
  });

  // La carence est ce qui empeche de s'assurer la veille d'une depense connue.
  it('refuse pendant la carence, et dit jusqu a quand', () => {
    const motif = motifDInegibilite(
      { ...base, dateEffet: new Date('2026-09-25'), carenceJours: 30 },
      LE_2_OCTOBRE,
      'VERIFIEE'
    );
    expect(motif).toMatch(/carence/i);
    expect(motif).toContain('2026-10-25');
  });

  it('accepte une fois la carence passee', () => {
    expect(motifDInegibilite({ ...base, dateEffet: new Date('2026-08-01'), carenceJours: 30 }, LE_2_OCTOBRE, 'VERIFIEE'))
      .toBeNull();
  });

  // ── Le verrou d'identito-vigilance (EF-01-10) ─────────────────────
  //
  // Le tiers payant engage un tiers : si l'identite est la mauvaise, c'est
  // l'assureur qui paie pour quelqu'un d'autre, et le vrai titulaire qui voit
  // son plafond annuel consomme sans le savoir. Dans la region, « Mamadou
  // Diallo, ne en 1990 » peut designer plusieurs personnes dans la meme
  // prefecture : le risque n'est pas theorique.
  it('refuse le tiers payant sur une identite provisoire, contrat parfait', () => {
    const motif = motifDInegibilite(base, LE_2_OCTOBRE, 'PROVISOIRE');
    expect(motif).toMatch(/identite provisoire/i);
  });

  // Le message doit dire quoi faire, pas seulement refuser : c'est un agent
  // d'accueil qui le lira, avec le patient devant lui.
  it('dit comment lever le verrou', () => {
    expect(motifDInegibilite(base, LE_2_OCTOBRE, 'PROVISOIRE')).toMatch(/piece a l'accueil/i);
  });

  // **Ce verrou ne refuse pas les soins.** Il refuse de faire payer un tiers
  // sur une identite declaree. Le patient est servi et paie comptant — c'est
  // la difference entre proteger l'assureur et trier les malades.
  it('ne bloque que le tiers payant, et le dit', () => {
    const motif = motifDInegibilite(base, LE_2_OCTOBRE, 'PROVISOIRE') ?? '';
    expect(motif).toMatch(/tiers payant/i);
    expect(motif).not.toMatch(/soins|refus de soin/i);
  });

  // L'identite passe avant les regles de contrat : inutile d'expliquer une
  // carence a quelqu'un dont on ne sait meme pas si c'est la bonne personne.
  it('passe avant les motifs de contrat', () => {
    expect(motifDInegibilite({ ...base, statut: 'RESILIE' }, LE_2_OCTOBRE, 'PROVISOIRE'))
      .toMatch(/identite provisoire/i);
  });

  it('laisse passer une identite verifiee', () => {
    expect(motifDInegibilite(base, LE_2_OCTOBRE, 'VERIFIEE')).toBeNull();
  });
});

describe('verifierEligibilite', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'struct-P', structure: { type: 'PHARMACIE' } });
    prisma.structureSante.findUnique.mockResolvedValue({
      id: 'struct-P', type: 'PHARMACIE', idStructureParente: null,
    });

    prisma.structureAssureur.findFirst.mockResolvedValue({ id: 'convention-1' });
    prisma.patientProfile.findUnique.mockResolvedValue({
      id: 'p-1', utilisateur: { prenom: 'Maomou', nom: 'Conde' },
    });
    prisma.controleEligibilite.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...data, id: 'ce-1', creeLe: LE_2_OCTOBRE })
    );
  });

  it('refuse un compte sans structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: null, structure: null });
    await expect(verifierEligibilite(pharmacien, 'p-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404 sur un patient inconnu', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(verifierEligibilite(pharmacien, 'p-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse, avec motif, un patient sans contrat', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue(null);
    const r = await verifierEligibilite(pharmacien, 'p-1', LE_2_OCTOBRE);
    expect(r.eligible).toBe(false);
    expect(r.motif).toMatch(/Aucun contrat/);
  });

  it('refuse quand l assureur est inactif sur la plateforme', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue({
      id: 'ct-1', numeroPolice: 'P-1', tauxBasePourcent: 80, statut: 'ACTIF',
      dateEffet: new Date('2026-01-01'), dateFin: null, carenceJours: 0,
      assureur: { id: 'as-1', nom: 'Pricemou & Frere', code: 'PF', estActif: false },
    });
    const r = await verifierEligibilite(pharmacien, 'p-1', LE_2_OCTOBRE);
    expect(r.eligible).toBe(false);
    expect(r.motif).toMatch(/inactif/);
  });

  it('accepte et recopie la police et le taux', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue({
      id: 'ct-1', numeroPolice: 'PF-00042', tauxBasePourcent: 80, statut: 'ACTIF',
      dateEffet: new Date('2026-01-01'), dateFin: null, carenceJours: 0,
      assureur: { id: 'as-1', nom: 'Pricemou & Frere', code: 'PF', estActif: true },
    });
    const r = await verifierEligibilite(pharmacien, 'p-1', LE_2_OCTOBRE);
    expect(r.eligible).toBe(true);
    expect(r.numeroPolice).toBe('PF-00042');
    expect(r.tauxBasePourcent).toBe(80);
    expect(r.assureur?.code).toBe('PF');
  });

  it('refuse une police assureur sans convention dans la pharmacie', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue({
      id: 'ct-1', idAssureur: 'as-1', numeroPolice: 'PF-00042', tauxBasePourcent: 80, statut: 'ACTIF',
      dateEffet: new Date('2026-01-01'), dateFin: null, carenceJours: 0,
      assureur: { id: 'as-1', nom: 'Pricemou & Frere', code: 'PF', estActif: true },
    });
    prisma.structureAssureur.findFirst.mockResolvedValue(null);

    const r = await verifierEligibilite(pharmacien, 'p-1', LE_2_OCTOBRE);
    expect(r.eligible).toBe(false);
    expect(r.motif).toMatch(/pas conventionne/);
  });

  // La reponse doit etre opposable : elle est donc enregistree, refus compris.
  it('enregistre le controle, y compris quand il refuse', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue(null);
    await verifierEligibilite(pharmacien, 'p-1', LE_2_OCTOBRE);

    expect(prisma.controleEligibilite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eligible: false,
        idPatient: 'p-1',
        idStructure: 'struct-P',
        idControlePar: 'pharma-1',
      }),
    }));
    const [args] = prisma.controleEligibilite.create.mock.calls[0] as [{ data: { motif: string | null } }];
    expect(args.data.motif).toBeTruthy();
  });

  it('ne recopie pas de taux quand le controle refuse', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue({
      id: 'ct-1', numeroPolice: 'P-1', tauxBasePourcent: 80, statut: 'RESILIE',
      dateEffet: new Date('2026-01-01'), dateFin: null, carenceJours: 0,
      assureur: { id: 'as-1', nom: 'X', code: 'X', estActif: true },
    });
    const r = await verifierEligibilite(pharmacien, 'p-1', LE_2_OCTOBRE);
    expect(r.eligible).toBe(false);
    expect(r.tauxBasePourcent).toBeNull();
  });
});

// ── La regle en vigueur ──────────────────────────────────────────────

describe('regleEnVigueur', () => {
  it('retient la plus recente parmi celles deja en vigueur', () => {
    const r = regleEnVigueur([
      regle({ categorie: 'MEDICAMENT', tauxPourcent: 60, dateEffet: new Date('2026-01-01') }),
      regle({ categorie: 'MEDICAMENT', tauxPourcent: 90, dateEffet: new Date('2026-06-01') }),
    ], 'MEDICAMENT', LE_2_OCTOBRE);
    expect(r?.tauxPourcent).toBe(90);
  });

  // Changer un taux ne doit pas reecrire ce qui a deja ete chiffre.
  it('ignore une regle dont la date d effet est future', () => {
    const r = regleEnVigueur([
      regle({ categorie: 'MEDICAMENT', tauxPourcent: 60, dateEffet: new Date('2026-01-01') }),
      regle({ categorie: 'MEDICAMENT', tauxPourcent: 10, dateEffet: new Date('2027-01-01') }),
    ], 'MEDICAMENT', LE_2_OCTOBRE);
    expect(r?.tauxPourcent).toBe(60);
  });

  it('ne confond pas deux categories', () => {
    const r = regleEnVigueur([regle({ categorie: 'COSMETIQUE', exclu: true })], 'MEDICAMENT', LE_2_OCTOBRE);
    expect(r).toBeNull();
  });
});

// ── La repartition ───────────────────────────────────────────────────

describe('repartir', () => {
  it('ne touche a rien quand la cible couvre le total', () => {
    expect(repartir([100, 200], 300)).toEqual([100, 200]);
    expect(repartir([100, 200], 500)).toEqual([100, 200]);
  });

  it('met tout a zero quand la cible est nulle', () => {
    expect(repartir([100, 200], 0)).toEqual([0, 0]);
  });

  // Le detail doit s'additionner jusqu'au total, sinon l'ecran affiche une
  // somme qui ne tombe pas juste.
  it('rend une somme exactement egale a la cible, malgre les arrondis', () => {
    for (const cible of [1, 7, 33, 99, 100, 101, 299]) {
      const parts = repartir([100, 100, 100], cible);
      expect(parts.reduce((t, p) => t + p, 0)).toBe(cible);
    }
  });

  it('respecte le prorata, les restes allant aux plus grosses parts', () => {
    expect(repartir([1000, 500], 300)).toEqual([200, 100]);
    expect(repartir([2, 1], 1)).toEqual([1, 0]);
  });

  it('ne produit jamais de part negative', () => {
    expect(repartir([100, 200], -50).every((p) => p >= 0)).toBe(true);
  });
});

// ── Le calcul de la prise en charge ──────────────────────────────────

describe('calculerPriseEnCharge', () => {
  it('applique le taux de base et laisse le reste au patient', () => {
    const p = calculerPriseEnCharge([PARA], CONTRAT, [], 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(8_000);
    expect(p.montantPatientGnf).toBe(2_000);
    expect(p.lignes[0]).toMatchObject({ couvert: true, tauxAppliquePourcent: 80, montantAssureGnf: 8_000 });
  });

  it('exclut une categorie, en disant laquelle', () => {
    const regles = [regle({ categorie: 'LAIT_INFANTILE', exclu: true })];
    const p = calculerPriseEnCharge([LAIT], CONTRAT, regles, 0, 45_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(0);
    expect(p.montantPatientGnf).toBe(45_000);
    expect(p.lignes[0]?.couvert).toBe(false);
    expect(p.lignes[0]?.motifExclusion).toMatch(/LAIT_INFANTILE exclue/);
  });

  // La phrase du chef de projet, testee telle quelle.
  it('un assure a 100 % paie quand meme son lait infantile', () => {
    const contrat100 = { ...CONTRAT, tauxBasePourcent: 100 };
    const regles = [regle({ categorie: 'LAIT_INFANTILE', exclu: true })];
    const p = calculerPriseEnCharge([PARA, LAIT], contrat100, regles, 0, 55_000, LE_2_OCTOBRE);

    expect(p.montantAssureGnf).toBe(10_000);   // le paracetamol en entier
    expect(p.montantPatientGnf).toBe(45_000);  // le lait, integralement
    expect(p.lignes.find((l) => l.idMedicament === 'm-lait')?.couvert).toBe(false);
    expect(p.lignes.find((l) => l.idMedicament === 'm-para')?.tauxAppliquePourcent).toBe(100);
  });

  it('un taux propre a la categorie prime sur le taux de base', () => {
    const regles = [regle({ categorie: 'MEDICAMENT', tauxPourcent: 50 })];
    const p = calculerPriseEnCharge([PARA], CONTRAT, regles, 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(5_000);
    expect(p.lignes[0]?.tauxAppliquePourcent).toBe(50);
  });

  it('un taux de 0 % ne couvre pas, et le dit', () => {
    const regles = [regle({ categorie: 'MEDICAMENT', tauxPourcent: 0 })];
    const p = calculerPriseEnCharge([PARA], CONTRAT, regles, 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(0);
    expect(p.lignes[0]?.couvert).toBe(false);
    expect(p.lignes[0]?.motifExclusion).toMatch(/0 %/);
  });

  it('plafonne une ligne, et le note', () => {
    const regles = [regle({ categorie: 'MEDICAMENT', tauxPourcent: 80, plafondLigneGnf: 3_000 })];
    const p = calculerPriseEnCharge([PARA], CONTRAT, regles, 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(3_000);
    expect(p.notes.join(' ')).toMatch(/plafond de 3000 GNF par ligne/);
  });

  it('retient la franchise sur la part de l assureur', () => {
    const contrat = { ...CONTRAT, franchiseGnf: 1_500 };
    const p = calculerPriseEnCharge([PARA], contrat, [], 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(6_500);   // 8 000 − 1 500
    expect(p.montantPatientGnf).toBe(3_500);
    expect(p.notes.join(' ')).toMatch(/Franchise de 1500 GNF/);
  });

  it('ne rend jamais une part negative a cause d une franchise plus grosse que la couverture', () => {
    const contrat = { ...CONTRAT, franchiseGnf: 50_000 };
    const p = calculerPriseEnCharge([PARA], contrat, [], 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(0);
    expect(p.montantPatientGnf).toBe(10_000);
  });

  it('tient compte de ce qui a deja ete consomme sur le plafond annuel', () => {
    const contrat = { ...CONTRAT, plafondAnnuelGnf: 10_000 };
    const p = calculerPriseEnCharge([PARA], contrat, [], 7_000, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(3_000);   // il ne restait que 3 000
    expect(p.notes.join(' ')).toMatch(/il restait 3000 GNF/);
  });

  it('ne prend plus rien quand le plafond annuel est atteint', () => {
    const contrat = { ...CONTRAT, plafondAnnuelGnf: 10_000 };
    const p = calculerPriseEnCharge([PARA], contrat, [], 10_000, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(0);
    expect(p.montantPatientGnf).toBe(10_000);
    expect(p.notes.join(' ')).toMatch(/Plafond annuel atteint/);
  });

  // La remise du pharmacien profite au patient, pas a l'assureur.
  it('ne prend jamais plus que ce que la caisse encaisse', () => {
    const contrat100 = { ...CONTRAT, tauxBasePourcent: 100 };
    const p = calculerPriseEnCharge([PARA], contrat100, [], 0, 9_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(9_000);
    expect(p.montantPatientGnf).toBe(0);
    expect(p.notes.join(' ')).toMatch(/ramenee au montant encaisse/);
  });

  // Sans cela, l'ecran afficherait un detail qui ne tombe pas sur le total.
  it('le detail ligne par ligne s additionne exactement a la part de l assureur', () => {
    const contrat = { ...CONTRAT, franchiseGnf: 1_111, plafondAnnuelGnf: 20_000 };
    const lignes = [PARA, LAIT, ligne('m-savon', 'Savon', 'HYGIENE', 12_000)];
    const p = calculerPriseEnCharge(lignes, contrat, [], 5_000, 67_000, LE_2_OCTOBRE);

    const somme = p.lignes.reduce((t, l) => t + l.montantAssureGnf, 0);
    expect(somme).toBe(p.montantAssureGnf);
    expect(p.montantAssureGnf + p.montantPatientGnf).toBe(67_000);
  });

  it('ne couvre rien, et ne ment pas sur le taux, quand la part tombe a zero', () => {
    const contrat = { ...CONTRAT, plafondAnnuelGnf: 1 };
    const p = calculerPriseEnCharge([PARA], contrat, [], 1, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(0);
    expect(p.lignes[0]?.couvert).toBe(false);
    expect(p.lignes[0]?.tauxAppliquePourcent).toBe(0);
  });

  it('un panier vide ne fait rien prendre', () => {
    const p = calculerPriseEnCharge([], CONTRAT, [], 0, 0, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(0);
    expect(p.montantPatientGnf).toBe(0);
    expect(p.lignes).toEqual([]);
  });

  it('chiffre avec la regle en vigueur a la date de la vente, pas avec la derniere', () => {
    const regles = [
      regle({ categorie: 'MEDICAMENT', tauxPourcent: 90, dateEffet: new Date('2026-01-01') }),
      regle({ categorie: 'MEDICAMENT', tauxPourcent: 20, dateEffet: new Date('2026-12-01') }),
    ];
    const p = calculerPriseEnCharge([PARA], CONTRAT, regles, 0, 10_000, LE_2_OCTOBRE);
    expect(p.montantAssureGnf).toBe(9_000);
  });
});


// ── Le verrou tient aussi au chiffrage (EF-01-10) ───────────────────
//
// Le chiffrage a la caisse part desormais de la carte scannee : ses tests,
// dont la lecture du niveau d'identite en base, vivent dans
// assurance-cartes.service.test.ts.
