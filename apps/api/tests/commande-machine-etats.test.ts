// La machine à états de la commande (P6 / EF-07).
//
// **Un seul endroit décide des passages autorisés**, donc un seul endroit à
// verrouiller. Ce fichier parcourt les 121 paires d'états possibles et exige
// que seules les 21 prévues passent : énumérer les passages permis prouve ce
// qu'on a pensé à écrire, parcourir le produit cartésien prouve aussi ce
// qu'on a oublié d'interdire.
//
// Les invariants structurels — total contre somme des lignes, mode de remise
// cohérent avec l'état, horodatages, annulation motivée — vivent en base, et
// ont été prouvés sur une base jetable en regardant chaque garde refuser. Ce
// fichier couvre ce qui est décidé en TypeScript.
import {
  annulerCommande,
  assertTransition,
  avancerApresPaiement,
  chiffrerCommande,
  confirmerRemise,
  marquerPrete,
  transitionPermise,
} from '../src/services/commande.service';
import { ConflictError, ForbiddenError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    commande: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    utilisateur: { findUnique: jest.fn(), findMany: jest.fn() },
    stock: { findMany: jest.fn() },
    ligneCommande: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/services/numero.service', () => ({ prochainNumero: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({ notifierSansBloquer: jest.fn() }));
jest.mock('../src/services/course.service', () => ({
  ouvrirCourse: jest.fn(),
  notifierLivreursCourse: jest.fn(),
}));
const { ouvrirCourse, notifierLivreursCourse } = jest.requireMock('../src/services/course.service') as {
  ouvrirCourse: M;
  notifierLivreursCourse: M;
};

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    commande: { findUnique: M; findUniqueOrThrow: M; update: M; updateMany: M };
    utilisateur: { findUnique: M; findMany: M };
    stock: { findMany: M };
    ligneCommande: { deleteMany: M; createMany: M };
    $transaction: M;
  };
};

const TOUS = [
  'RECHERCHE_PHARMACIE', 'PRISE_EN_CHARGE', 'A_PAYER', 'PAYEE', 'EN_PREPARATION',
  'PRETE_POUR_RETRAIT', 'PRETE_POUR_LIVRAISON', 'RETIREE', 'CLOTUREE',
  'SANS_PHARMACIE', 'ANNULEE',
] as const;

/** Les seuls passages prévus. Tout le reste doit être refusé. */
const PERMIS: ReadonlyArray<readonly [string, string]> = [
  ['RECHERCHE_PHARMACIE', 'PRISE_EN_CHARGE'],
  ['RECHERCHE_PHARMACIE', 'SANS_PHARMACIE'],
  ['RECHERCHE_PHARMACIE', 'ANNULEE'],
  ['PRISE_EN_CHARGE', 'A_PAYER'],
  ['PRISE_EN_CHARGE', 'RECHERCHE_PHARMACIE'],
  ['PRISE_EN_CHARGE', 'ANNULEE'],
  ['A_PAYER', 'PAYEE'],
  ['A_PAYER', 'ANNULEE'],
  ['PAYEE', 'EN_PREPARATION'],
  ['PAYEE', 'ANNULEE'],
  ['EN_PREPARATION', 'PRETE_POUR_RETRAIT'],
  ['EN_PREPARATION', 'PRETE_POUR_LIVRAISON'],
  ['EN_PREPARATION', 'ANNULEE'],
  ['PRETE_POUR_RETRAIT', 'CLOTUREE'],
  ['PRETE_POUR_RETRAIT', 'ANNULEE'],
  ['PRETE_POUR_LIVRAISON', 'PRETE_POUR_RETRAIT'],
  ['PRETE_POUR_LIVRAISON', 'RETIREE'],
  ['PRETE_POUR_LIVRAISON', 'ANNULEE'],
  ['RETIREE', 'CLOTUREE'],
  ['SANS_PHARMACIE', 'RECHERCHE_PHARMACIE'],
  ['SANS_PHARMACIE', 'ANNULEE'],
];

const qui = (userId: string, role: string) => ({ userId, role, sessionId: 's' }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((
    operations: ((tx: unknown) => Promise<unknown>) | unknown[],
  ) => Array.isArray(operations) ? Promise.all(operations) : operations(prisma));
  prisma.commande.update.mockResolvedValue({});
  prisma.commande.updateMany.mockResolvedValue({ count: 1 });
  prisma.utilisateur.findMany.mockResolvedValue([]);
  ouvrirCourse.mockResolvedValue({ id: 'course-1', statut: 'APPEL_OFFRES' });
});

describe('la table des transitions', () => {
  it('autorise les 21 passages prevus, et eux seuls', () => {
    const attendus = new Set(PERMIS.map(([de, vers]) => `${de}->${vers}`));
    const inattendus: string[] = [];
    const manquants: string[] = [];

    for (const de of TOUS) {
      for (const vers of TOUS) {
        const clef = `${de}->${vers}`;
        const permise = transitionPermise(de as never, vers as never);
        if (permise && !attendus.has(clef)) inattendus.push(clef);
        if (!permise && attendus.has(clef)) manquants.push(clef);
      }
    }
    expect({ inattendus, manquants }).toEqual({ inattendus: [], manquants: [] });
  });

  // **Les deux etats terminaux n'ont aucune sortie**, pas meme vers
  // eux-memes : un code qui « reclôturerait » une commande deja close
  // ecraserait sa date de cloture.
  it.each(['CLOTUREE', 'ANNULEE'])('%s ne mene nulle part', (terminal) => {
    const sorties = TOUS.filter((vers) => transitionPermise(terminal as never, vers as never));
    expect(sorties).toEqual([]);
  });

  // **Une commande remise ne s'annule pas** : les produits sont partis
  // (EF-07-11, pas de retour). C'est la seule branche ou l'annulation
  // disparait avant la fin.
  it('une commande remise ne peut plus etre annulee', () => {
    expect(transitionPermise('RETIREE' as never, 'ANNULEE' as never)).toBe(false);
  });

  it('refuse un passage impossible avec un message lisible', () => {
    expect(() => assertTransition('CLOTUREE' as never, 'EN_PREPARATION' as never))
      .toThrow(ConflictError);
    expect(() => assertTransition('CLOTUREE' as never, 'EN_PREPARATION' as never))
      .toThrow(/cloturee/i);
    expect(() => assertTransition('RECHERCHE_PHARMACIE' as never, 'CLOTUREE' as never))
      .toThrow(/ne peut pas passer/i);
  });
});

// ── Le chiffrage du panier ───────────────────────────────────────────

const LIGNES_ORDONNANCE = [
  { id: 'lo1', quantite: 2, idMedicament: 'm1', medicament: { libelle: 'Doliprane', prixUnitaireGnf: 1000 } },
  { id: 'lo2', quantite: 1, idMedicament: 'm2', medicament: { libelle: 'Clamoxyl', prixUnitaireGnf: 2500 } },
];

/**
 * Une commande tenue par l'officine de l'appelant.
 *
 * **Une seule forme pour toutes les lectures.** `prisma.commande.findUnique`
 * sert aussi bien a lire l'etat qu'a trouver les destinataires des
 * notifications : deux formes differentes faisaient planter la seconde
 * lecture, et le test echouait sur sa propre doublure plutot que sur le code.
 */
const COMMANDE_PARTAGEE = {
  id: 'c1',
  numero: 'CM-1',
  quartierRecherche: 'Donka',
  creeLe: new Date('2026-10-14T08:00:00Z'),
  montantTotalGnf: null,
  chiffreeLe: null,
  preteLe: null,
  remiseLe: null,
  clotureeLe: null,
  motifAnnulation: null,
  // Les champs de la prise partielle (2026-11-20), a leurs valeurs par defaut.
  lignesOrdonnance: [], lignesProposees: [], idCommandeOrigine: null, commandeOrigine: null,
  propositionPartielleLe: null, choixPartiel: null, choixPartielLe: null,
  lignes: [],
  pharmacie: { id: 'ph1', nom: 'Pharmacie Essai', quartier: 'Donka' },
  reponses: [],
  ordonnance: {
    numero: 'ORD-1',
    signePar: 'u-med',
    lignes: LIGNES_ORDONNANCE.map((l) => ({
      ...l,
      posologie: '1 cp',
      medicament: { ...l.medicament, dosage: '500mg', forme: 'comprime' },
    })),
    consultation: {
      idMedecinValideur: 'u-med',
      patient: { id: 'p1', idUtilisateur: 'u-pat', utilisateur: { id: 'u-pat', prenom: 'Maomou', nom: 'Conde' } },
    },
  },
};

function officineTient(statut = 'PRISE_EN_CHARGE', modeRemise: string | null = null) {
  prisma.utilisateur.findUnique.mockResolvedValue({
    idStructure: 'ph1',
    structure: { id: 'ph1', nom: 'Pharmacie Essai', type: 'PHARMACIE', estPartenaire: true, quartier: 'Donka' },
  });
  prisma.commande.findUnique.mockResolvedValue({
    ...COMMANDE_PARTAGEE, statut, idPharmacie: 'ph1', modeRemise,
  });
  prisma.commande.findUniqueOrThrow.mockResolvedValue({
    ...COMMANDE_PARTAGEE, statut, idPharmacie: 'ph1', modeRemise,
  });
}

describe('chiffrer le panier', () => {
  it('applique la regle du comptoir : prix de reference plus la marge de l officine', async () => {
    officineTient();
    prisma.stock.findMany.mockResolvedValue([
      { idMedicament: 'm1', margeGnf: 200 },
      { idMedicament: 'm2', margeGnf: 500 },
    ]);
    await chiffrerCommande(qui('u-ph', 'PHARMACIEN'), 'c1');

    const lignes = prisma.ligneCommande.createMany.mock.calls[0]?.[0]?.data as Array<{
      libelle: string; prixUnitaireGnf: number; montantGnf: number; quantite: number;
    }>;
    expect(lignes).toEqual([
      expect.objectContaining({ libelle: 'Doliprane', prixUnitaireGnf: 1200, quantite: 2, montantGnf: 2400 }),
      expect.objectContaining({ libelle: 'Clamoxyl', prixUnitaireGnf: 3000, quantite: 1, montantGnf: 3000 }),
    ]);
  });

  it('pose un total egal a la somme de ses lignes', async () => {
    officineTient();
    prisma.stock.findMany.mockResolvedValue([
      { idMedicament: 'm1', margeGnf: 200 },
      { idMedicament: 'm2', margeGnf: 500 },
    ]);
    await chiffrerCommande(qui('u-ph', 'PHARMACIEN'), 'c1');

    const maj = prisma.commande.update.mock.calls[0]?.[0] as { data: { montantTotalGnf: number; statut: string } };
    expect(maj.data.montantTotalGnf).toBe(2400 + 3000);
    expect(maj.data.statut).toBe('A_PAYER');
  });

  // **Chiffrer un produit qu'on n'a pas, c'est promettre ce qu'on ne pourra
  // pas remettre.** L'officine avait declare tout detenir ; si ce n'est plus
  // vrai, le refus la nomme plutot que de laisser le patient payer.
  it('refuse en nommant les produits absents du catalogue de l officine', async () => {
    officineTient();
    prisma.stock.findMany.mockResolvedValue([{ idMedicament: 'm1', margeGnf: 200 }]);
    await expect(chiffrerCommande(qui('u-ph', 'PHARMACIEN'), 'c1'))
      .rejects.toThrow(/Clamoxyl/);
    expect(prisma.ligneCommande.createMany).not.toHaveBeenCalled();
  });

  it('refuse de chiffrer une commande qui n est pas la sienne', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      idStructure: 'ph1',
      structure: { id: 'ph1', nom: 'Essai', type: 'PHARMACIE', estPartenaire: true, quartier: 'Donka' },
    });
    prisma.commande.findUnique.mockResolvedValue({
      ...COMMANDE_PARTAGEE, statut: 'PRISE_EN_CHARGE', idPharmacie: 'une-autre',
    });
    await expect(chiffrerCommande(qui('u-ph', 'PHARMACIEN'), 'c1')).rejects.toThrow(ForbiddenError);
  });

  it('refuse de chiffrer deux fois', async () => {
    officineTient('A_PAYER');
    await expect(chiffrerCommande(qui('u-ph', 'PHARMACIEN'), 'c1')).rejects.toThrow(ConflictError);
  });
});

// ── Ce que le mode de remise decide ──────────────────────────────────

describe('le sachet est pret', () => {
  it('refuse tant que le patient n a pas choisi retrait ou livraison', async () => {
    officineTient('EN_PREPARATION', null);
    await expect(marquerPrete(qui('u-ph', 'PHARMACIEN'), 'c1')).rejects.toThrow(ValidationError);
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['RETRAIT_PHARMACIE', 'PRETE_POUR_RETRAIT'],
    ['LIVRAISON', 'PRETE_POUR_LIVRAISON'],
  ])('mode %s mene a %s', async (mode, attendu) => {
    officineTient('EN_PREPARATION', mode);
    await marquerPrete(qui('u-ph', 'PHARMACIEN'), 'c1');
    const maj = prisma.commande.updateMany.mock.calls[0]?.[0] as { data: { statut: string; preteLe: Date } };
    expect(maj.data.statut).toBe(attendu);
    expect(maj.data.preteLe).toBeInstanceOf(Date);
    if (mode === 'LIVRAISON') {
      expect(ouvrirCourse).toHaveBeenCalledWith('c1', prisma);
      expect(notifierLivreursCourse).toHaveBeenCalledWith('course-1');
    } else {
      expect(ouvrirCourse).not.toHaveBeenCalled();
      expect(notifierLivreursCourse).not.toHaveBeenCalled();
    }
  });
});

describe('la remise', () => {
  // Pour un retrait, le patient est au comptoir : la remise est la fin. Faire
  // passer un retrait par deux etats pour un seul geste n'aurait decrit
  // personne.
  it('un retrait est remis et clos dans le meme geste', async () => {
    officineTient('PRETE_POUR_RETRAIT', 'RETRAIT_PHARMACIE');
    await confirmerRemise(qui('u-ph', 'PHARMACIEN'), 'c1');
    const maj = prisma.commande.update.mock.calls[0]?.[0] as {
      data: { statut: string; remiseLe: Date; clotureeLe: Date };
    };
    expect(maj.data.statut).toBe('CLOTUREE');
    expect(maj.data.remiseLe).toBeInstanceOf(Date);
    expect(maj.data.clotureeLe).toBeInstanceOf(Date);
  });

  it('refuse la remise au comptoir pour une commande en livraison et indique le scan QR', async () => {
    officineTient('PRETE_POUR_LIVRAISON', 'LIVRAISON');
    await expect(confirmerRemise(qui('u-ph', 'PHARMACIEN'), 'c1'))
      .rejects.toThrow('Cette commande part en livraison : scannez le QR du motard.');
    expect(prisma.commande.update).not.toHaveBeenCalled();
  });
});

// ── Le paiement fait avancer, une fois ───────────────────────────────

describe('avancer apres paiement', () => {
  it('fait passer une commande a payer en payee', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      ...COMMANDE_PARTAGEE, statut: 'A_PAYER', idPharmacie: 'ph1',
    });
    await avancerApresPaiement('c1');
    const maj = prisma.commande.update.mock.calls[0]?.[0] as { data: { statut: string } };
    expect(maj.data.statut).toBe('PAYEE');
  });

  // Un rappel de passerelle est rejoue, et peut arriver deux fois. Le second
  // ne doit rien defaire.
  it.each(['PAYEE', 'EN_PREPARATION', 'CLOTUREE', 'ANNULEE'])(
    'ne touche a rien quand la commande est deja %s',
    async (statut) => {
      prisma.commande.findUnique.mockResolvedValue({
        ...COMMANDE_PARTAGEE, statut, idPharmacie: 'ph1',
      });
      await avancerApresPaiement('c1');
      expect(prisma.commande.update).not.toHaveBeenCalled();
    },
  );

  it('ne leve pas sur une commande disparue', async () => {
    prisma.commande.findUnique.mockResolvedValue(null);
    await expect(avancerApresPaiement('inconnue')).resolves.toBeUndefined();
  });
});

// ── L'annulation ─────────────────────────────────────────────────────

describe('annuler', () => {
  beforeEach(() => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'ph1', role: 'PATIENT' });
    prisma.commande.findUnique.mockResolvedValue({
      ...COMMANDE_PARTAGEE, statut: 'A_PAYER', idPharmacie: 'ph1',
    });
    prisma.commande.findUniqueOrThrow.mockResolvedValue({
      ...COMMANDE_PARTAGEE, statut: 'A_PAYER', idPharmacie: 'ph1',
    });
  });

  it.each(['', '  ', 'non'])('refuse un motif trop court (%j)', async (motif) => {
    await expect(annulerCommande(qui('u-pat', 'PATIENT'), 'c1', motif))
      .rejects.toThrow(ValidationError);
  });

  it('refuse d annuler une commande deja remise', async () => {
    prisma.commande.findUniqueOrThrow.mockResolvedValue({
      ...COMMANDE_PARTAGEE, statut: 'RETIREE', idPharmacie: 'ph1',
    });
    await expect(annulerCommande(qui('u-pat', 'PATIENT'), 'c1', 'je ne veux plus'))
      .rejects.toThrow(ConflictError);
  });

  // Une commande payee garde une sortie : l'officine peut decouvrir une
  // rupture apres coup, et sans sortie la commande resterait bloquee pour
  // toujours. Le remboursement se fait au comptoir, pas ici.
  it('laisse annuler une commande deja payee, avec son motif', async () => {
    prisma.commande.findUniqueOrThrow.mockResolvedValue({
      ...COMMANDE_PARTAGEE, statut: 'PAYEE', idPharmacie: 'ph1',
    });
    await annulerCommande(qui('u-pat', 'PATIENT'), 'c1', 'rupture chez le grossiste');
    const maj = prisma.commande.update.mock.calls[0]?.[0] as {
      data: { statut: string; motifAnnulation: string };
    };
    expect(maj.data.statut).toBe('ANNULEE');
    expect(maj.data.motifAnnulation).toBe('rupture chez le grossiste');
  });
});
