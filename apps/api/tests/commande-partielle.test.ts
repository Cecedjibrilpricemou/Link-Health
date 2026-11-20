// La prise partielle d'une commande.
//
// **Le defaut que ce fichier empeche de revenir** : une pharmacie qui n'avait
// que deux produits sur trois ne pouvait que refuser, et le patient finissait
// souvent sans rien. Elle peut le proposer ; le patient choisit, sous deux
// heures, d'accepter et de faire relancer le manquant, d'accepter seul, ou de
// refuser. Rien n'est servi ni paye sans son accord.
import {
  DELAI_REPONSE_PARTIELLE_MINUTES,
  chiffrerCommande,
  commandesDeLaPharmacie,
  conclureCommandesExpirees,
  expirerPropositionsPartielles,
  getCommande,
  proposerPrisePartielle,
  repondrePropositionPartielle,
} from '../src/services/commande.service';
import { transitionPermise } from '../src/services/commande.transitions';
import { ConflictError, ForbiddenError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn(), findMany: jest.fn() },
    structureSante: { findMany: jest.fn() },
    commande: {
      findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(),
      create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    reponsePharmacie: { upsert: jest.fn() },
    ligneCommande: { deleteMany: jest.fn(), createMany: jest.fn() },
    stock: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/services/numero.service', () => ({ prochainNumero: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({ notifierSansBloquer: jest.fn() }));
jest.mock('../src/services/geographie.service', () => ({ voisinsDe: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findMany: M };
    structureSante: { findMany: M };
    commande: { findUnique: M; findUniqueOrThrow: M; findMany: M; create: M; update: M; updateMany: M };
    reponsePharmacie: { upsert: M };
    ligneCommande: { deleteMany: M; createMany: M };
    stock: { findMany: M };
    $transaction: M;
  };
};
const { prochainNumero } = jest.requireMock('../src/services/numero.service') as { prochainNumero: M };
const { notifierSansBloquer } = jest.requireMock('../src/services/notification.service') as { notifierSansBloquer: M };
const { voisinsDe } = jest.requireMock('../src/services/geographie.service') as { voisinsDe: M };

const PHARMACIEN = { userId: 'u-ph', role: 'PHARMACIEN' } as never;
const PATIENT = { userId: 'u-pat', role: 'PATIENT' } as never;
const AUTRE_PATIENT = { userId: 'u-autre', role: 'PATIENT' } as never;

const NOUNIE = {
  id: 'ph-nounie', nom: 'Pharmacie Nounie', type: 'PHARMACIE', estActive: true, estPartenaire: true,
  prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
};

/** L'ordonnance : trois produits prescrits. */
const LIGNES = [
  { id: 'lo-1', quantite: 2, posologie: '1 cp matin et soir', idMedicament: 'm1', medicament: { libelle: 'Doliprane 500mg', dosage: '500mg', forme: 'comprime', prixUnitaireGnf: 1000 } },
  { id: 'lo-2', quantite: 1, posologie: null, idMedicament: 'm2', medicament: { libelle: 'Clamoxyl 500mg', dosage: '500mg', forme: 'gelule', prixUnitaireGnf: 2500 } },
  { id: 'lo-3', quantite: 1, posologie: null, idMedicament: 'm3', medicament: { libelle: 'Morphine 10mg', dosage: '10mg', forme: 'ampoule', prixUnitaireGnf: 8000 } },
];

/** Une commande telle que `COMMANDE_INCLUDE` la rend. */
function commande(etat: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1', numero: 'CM-2026-000001', statut: 'RECHERCHE_PHARMACIE',
    quartierRecherche: 'Kipé', prefectureRecherche: 'Conakry', communeRecherche: 'Ratoma',
    elargieLe: null, voisinesLe: null, communesVoisines: [],
    idPharmacie: null, modeRemise: null, creeLe: new Date('2026-11-20T08:00:00Z'),
    lignesOrdonnance: [], lignesProposees: [], idCommandeOrigine: null, commandeOrigine: null,
    propositionPartielleLe: null, choixPartiel: null, choixPartielLe: null,
    reponses: [], pharmacie: null, lignes: [], courses: [],
    montantTotalGnf: null, chiffreeLe: null, preteLe: null, remiseLe: null, clotureeLe: null, motifAnnulation: null,
    idOrdonnance: 'ord-1',
    ordonnance: {
      numero: 'OR-2026-000001', signePar: 'u-med', lignes: LIGNES,
      consultation: {
        idMedecinValideur: 'u-med',
        patient: { idUtilisateur: 'u-pat', utilisateur: { id: 'u-pat', prenom: 'Maomou', nom: 'Conde' } },
      },
    },
    ...etat,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  voisinsDe.mockResolvedValue([]);
  prochainNumero.mockResolvedValue('CM-2026-000002');
  notifierSansBloquer.mockResolvedValue(undefined);
  prisma.utilisateur.findUnique.mockResolvedValue({ id: 'u-ph', structure: NOUNIE });
  prisma.utilisateur.findMany.mockResolvedValue([]);
  prisma.structureSante.findMany.mockResolvedValue([]);
  prisma.reponsePharmacie.upsert.mockResolvedValue({});
  prisma.commande.updateMany.mockResolvedValue({ count: 1 });
  prisma.commande.findUnique.mockResolvedValue(commande());
  prisma.commande.findUniqueOrThrow.mockResolvedValue(commande());
  prisma.commande.create.mockResolvedValue({ id: 'cmd-2', numero: 'CM-2026-000002' });
  prisma.commande.findMany.mockResolvedValue([]);
});

describe('la pharmacie propose une partie', () => {
  it('reserve la commande pour elle, le temps que le patient choisisse', async () => {
    await proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1', 'lo-2']);

    expect(prisma.commande.updateMany).toHaveBeenCalledWith({
      // Atomique, comme une prise complete : deux officines, un seul gagnant.
      where: { id: 'cmd-1', idPharmacie: null, statut: 'RECHERCHE_PHARMACIE' },
      data: expect.objectContaining({
        idPharmacie: 'ph-nounie',
        statut: 'ATTENTE_ACCORD_PATIENT',
        lignesProposees: ['lo-1', 'lo-2'],
        propositionPartielleLe: expect.any(Date),
      }),
    });
  });

  // Si le patient refuse, elle n'est plus sollicitee : elle a dit ne pas tout avoir.
  it('compte comme un « non » pour la totalite', async () => {
    await proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1']);

    expect(prisma.reponsePharmacie.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { idCommande: 'cmd-1', idStructure: 'ph-nounie', aTousLesProduits: false },
    }));
  });

  it('previent le patient seul, du nombre de produits et de l heure limite, sans nommer un produit', async () => {
    await proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1', 'lo-2']);

    expect(notifierSansBloquer).toHaveBeenCalledTimes(1);
    const n = notifierSansBloquer.mock.calls[0]![0];
    expect(n.idUtilisateur).toBe('u-pat');
    expect(n.contenu).toMatch(/2 produit\(s\) sur 3/);
    expect(n.contenu).toMatch(/Choisissez avant \d{2}:\d{2}/);
    // Une notification s'affiche sur un ecran verrouille (P9).
    for (const l of LIGNES) expect(n.contenu).not.toContain(l.medicament.libelle);
  });

  it('refuse une proposition vide', async () => {
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', [])).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it('refuse un produit qui n est pas dans la commande', async () => {
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1', 'lo-inconnue'])).rejects.toThrow(/n'appartient pas/);
  });

  it('renvoie vers la prise complete quand elle a tout', async () => {
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1', 'lo-2', 'lo-3'])).rejects.toThrow(/prenez la commande entiere/);
  });

  it('ne propose que sur les lignes d un reliquat, pas sur toute l ordonnance', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({ lignesOrdonnance: ['lo-2', 'lo-3'] }));

    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1'])).rejects.toThrow(/n'appartient pas/);
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-2', 'lo-3'])).rejects.toThrow(/entiere/);
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-2'])).resolves.toBeDefined();
  });

  it('perd la course contre une autre officine plus rapide', async () => {
    prisma.commande.updateMany.mockResolvedValue({ count: 0 });
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1'])).rejects.toBeInstanceOf(ConflictError);
  });

  it('ne propose pas sur une commande deja prise par une autre', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({ idPharmacie: 'ph-autre', statut: 'PRISE_EN_CHARGE' }));
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1'])).rejects.toThrow(/autre pharmacie/);
  });

  it('ne propose pas hors de sa zone', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({ prefectureRecherche: 'Kankan', communeRecherche: 'Kankan', quartierRecherche: 'Centre' }));
    await expect(proposerPrisePartielle(PHARMACIEN, 'cmd-1', ['lo-1'])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('le patient choisit', () => {
  const enAttente = () => commande({
    statut: 'ATTENTE_ACCORD_PATIENT', idPharmacie: 'ph-nounie',
    lignesProposees: ['lo-1', 'lo-2'], propositionPartielleLe: new Date('2026-11-20T09:00:00Z'),
  });
  beforeEach(() => {
    prisma.commande.findUnique.mockResolvedValue(enAttente());
    prisma.commande.findUniqueOrThrow.mockResolvedValue(enAttente());
  });

  it('accepte seul : la commande ne sert plus que la partie disponible, rien n est relance', async () => {
    await repondrePropositionPartielle(PATIENT, 'cmd-1', 'ACCEPTER_SEUL');

    expect(prisma.commande.updateMany).toHaveBeenCalledWith({
      where: { id: 'cmd-1', statut: 'ATTENTE_ACCORD_PATIENT' },
      data: expect.objectContaining({
        statut: 'PRISE_EN_CHARGE', lignesOrdonnance: ['lo-1', 'lo-2'], choixPartiel: 'ACCEPTE_SEUL',
      }),
    });
    expect(prisma.commande.create).not.toHaveBeenCalled();
  });

  it('accepte et relance : le manquant devient un reliquat, sans la pharmacie qui ne l a pas', async () => {
    prisma.structureSante.findMany.mockResolvedValue([
      { id: 'ph-nounie', nom: 'Pharmacie Nounie' },
      { id: 'ph-kipe', nom: 'Pharmacie de Kipe' },
    ]);
    prisma.utilisateur.findMany.mockImplementation(async (args: { where: { idStructure?: { in?: string[] } } }) =>
      (args.where.idStructure?.in ?? []).map((id) => ({ id: `pharmacien-${id}` })));

    await repondrePropositionPartielle(PATIENT, 'cmd-1', 'ACCEPTER_ET_RELANCER');

    expect(prisma.commande.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ choixPartiel: 'ACCEPTE_ET_RELANCE', lignesOrdonnance: ['lo-1', 'lo-2'] }),
    }));
    expect(prisma.commande.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idOrdonnance: 'ord-1',
        idCommandeOrigine: 'cmd-1',
        lignesOrdonnance: ['lo-3'],
        statut: 'RECHERCHE_PHARMACIE',
        // Sa reponse est posee d'avance : l'appel n'attend pas d'elle une
        // reponse qu'elle ne donnera jamais.
        reponses: { create: { idStructure: 'ph-nounie', aTousLesProduits: false } },
      }),
    });
    // Seule l'autre officine de la zone est appelee.
    const appeles = notifierSansBloquer.mock.calls
      .map((c) => c[0])
      .filter((n) => n.type === 'COMMANDE_A_SERVIR')
      .map((n) => n.idUtilisateur);
    expect(appeles).toEqual(['pharmacien-ph-kipe']);
  });

  it('relance sans personne a appeler : le reliquat est sans pharmacie, et le patient le sait', async () => {
    prisma.structureSante.findMany.mockResolvedValue([{ id: 'ph-nounie', nom: 'Pharmacie Nounie' }]);

    await repondrePropositionPartielle(PATIENT, 'cmd-1', 'ACCEPTER_ET_RELANCER');

    expect(prisma.commande.create).toHaveBeenCalledWith({ data: expect.objectContaining({ statut: 'SANS_PHARMACIE' }) });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMANDE_SANS_PHARMACIE', idUtilisateur: 'u-pat' }));
  });

  it('refuse : la commande retourne au quartier, liberee de la pharmacie', async () => {
    await repondrePropositionPartielle(PATIENT, 'cmd-1', 'REFUSER');

    expect(prisma.commande.updateMany).toHaveBeenCalledWith({
      where: { id: 'cmd-1', statut: 'ATTENTE_ACCORD_PATIENT' },
      data: expect.objectContaining({
        statut: 'RECHERCHE_PHARMACIE', idPharmacie: null, lignesProposees: [], choixPartiel: 'REFUSE',
      }),
    });
    expect(prisma.commande.create).not.toHaveBeenCalled();
  });

  it('n est ouvert qu au patient de la commande', async () => {
    await expect(repondrePropositionPartielle(AUTRE_PATIENT, 'cmd-1', 'ACCEPTER_SEUL')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it('ne repond plus a une proposition close', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({ statut: 'PRISE_EN_CHARGE' }));
    await expect(repondrePropositionPartielle(PATIENT, 'cmd-1', 'ACCEPTER_SEUL')).rejects.toBeInstanceOf(ConflictError);
  });

  // Le delai expire a la meme seconde : l'expiration a gagne, le patient le sait.
  it('ne vole pas une proposition expiree a la meme seconde', async () => {
    prisma.commande.updateMany.mockResolvedValue({ count: 0 });
    await expect(repondrePropositionPartielle(PATIENT, 'cmd-1', 'ACCEPTER_SEUL')).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.commande.create).not.toHaveBeenCalled();
  });
});

describe('sans reponse sous deux heures', () => {
  const MAINTENANT = new Date('2026-11-20T12:00:00Z');

  it('dure deux heures', () => {
    expect(DELAI_REPONSE_PARTIELLE_MINUTES).toBe(120);
  });

  it('retourne au quartier les propositions echues, et le dit au patient', async () => {
    prisma.commande.findMany.mockResolvedValue([{ id: 'cmd-1' }]);
    prisma.commande.findUnique.mockResolvedValue(commande({ statut: 'ATTENTE_ACCORD_PATIENT', idPharmacie: 'ph-nounie' }));

    const r = await expirerPropositionsPartielles(DELAI_REPONSE_PARTIELLE_MINUTES, MAINTENANT);

    expect(r.expirees).toBe(1);
    expect(prisma.commande.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { statut: 'ATTENTE_ACCORD_PATIENT', propositionPartielleLe: { lte: new Date('2026-11-20T10:00:00Z') } },
    }));
    expect(prisma.commande.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: 'RECHERCHE_PHARMACIE', idPharmacie: null, choixPartiel: 'EXPIRE' }),
    }));
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({ idUtilisateur: 'u-pat', titre: expect.stringMatching(/autres pharmacies/) }));
  });

  it('ne compte pas une proposition acceptee a la meme seconde', async () => {
    prisma.commande.findMany.mockResolvedValue([{ id: 'cmd-1' }]);
    prisma.commande.updateMany.mockResolvedValue({ count: 0 });

    const r = await expirerPropositionsPartielles(DELAI_REPONSE_PARTIELLE_MINUTES, MAINTENANT);

    expect(r.expirees).toBe(0);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  // Revenue au quartier, la commande a droit a son delai complet : sinon elle
  // serait conclue « sans pharmacie » a l'instant ou les autres la revoient.
  it('laisse a une commande revenue au quartier son delai final complet', async () => {
    await conclureCommandesExpirees(60, MAINTENANT);

    const where = prisma.commande.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ choixPartielLe: null }, { choixPartielLe: { lte: new Date('2026-11-20T11:00:00Z') } }]);
  });
});

describe('le stock, verifie a l arrivee de l appel', () => {
  it('dit a la pharmacie ce qu elle a, pour les seuls appels en cours', async () => {
    prisma.commande.findMany.mockResolvedValue([
      commande({ id: 'cmd-appel' }),
      commande({ id: 'cmd-prise', statut: 'PRISE_EN_CHARGE', idPharmacie: 'ph-nounie' }),
    ]);
    prisma.stock.findMany.mockResolvedValue([
      { idMedicament: 'm1', quantite: 0, medicament: { libelle: 'Doliprane 500mg', dci: null, dosage: null }, lots: [{ quantite: 10, datePeremption: null }] },
    ]);

    const vues = await commandesDeLaPharmacie(PHARMACIEN);

    const appel = vues.find((v) => v.id === 'cmd-appel')!;
    expect(appel.disponibilite).toEqual(expect.objectContaining({ etat: 'PARTIELLE', disponibles: 1, total: 3 }));
    expect(appel.disponibilite!.lignes.map((l) => l.etat)).toEqual(['DISPONIBLE', 'ABSENT', 'ABSENT']);
    // Une commande deja prise n'a plus a etre confrontee au stock.
    expect(vues.find((v) => v.id === 'cmd-prise')!.disponibilite).toBeUndefined();
    expect(prisma.stock.findMany.mock.calls[0]![0].where.idStructure).toBe('ph-nounie');
  });
});

describe('ce qui est servi, et ce qui est montre', () => {
  it('ne chiffre que les lignes acceptees', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({ statut: 'PRISE_EN_CHARGE', idPharmacie: 'ph-nounie' }));
    prisma.commande.findUniqueOrThrow.mockResolvedValue({ lignesOrdonnance: ['lo-1', 'lo-2'], ordonnance: { lignes: LIGNES } });
    prisma.stock.findMany.mockResolvedValue([{ idMedicament: 'm1', margeGnf: 100 }, { idMedicament: 'm2', margeGnf: 0 }]);
    prisma.$transaction.mockResolvedValue([]);

    await chiffrerCommande(PHARMACIEN, 'cmd-1');

    const lignes = prisma.ligneCommande.createMany.mock.calls[0]![0].data as { idLigneOrdonnance: string }[];
    expect(lignes.map((l) => l.idLigneOrdonnance)).toEqual(['lo-1', 'lo-2']);
    // La Morphine manquante n'est ni chiffree, ni exigee au catalogue.
    expect(prisma.stock.findMany.mock.calls[0]![0].where.idMedicament.in).toEqual(['m1', 'm2']);
  });

  it('montre au patient ce qui est disponible, ce qui manque, et l heure limite', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({
      statut: 'ATTENTE_ACCORD_PATIENT', lignesProposees: ['lo-1', 'lo-2'],
      propositionPartielleLe: new Date('2026-11-20T09:00:00Z'),
    }));

    const vue = await getCommande('cmd-1');

    expect(vue.propositionPartielle).toEqual(expect.objectContaining({
      disponibles: [
        { idLigneOrdonnance: 'lo-1', libelle: 'Doliprane 500mg', quantite: 2 },
        { idLigneOrdonnance: 'lo-2', libelle: 'Clamoxyl 500mg', quantite: 1 },
      ],
      manquants: [{ idLigneOrdonnance: 'lo-3', libelle: 'Morphine 10mg', quantite: 1 }],
      expireLe: '2026-11-20T11:00:00.000Z',
      choix: null,
    }));
  });

  it('ne montre d une commande partielle ou d un reliquat que ses propres lignes', async () => {
    prisma.commande.findUnique.mockResolvedValue(commande({
      lignesOrdonnance: ['lo-3'], idCommandeOrigine: 'cmd-1', commandeOrigine: { numero: 'CM-2026-000001' },
    }));

    const vue = await getCommande('cmd-2');

    expect(vue.lignes.map((l) => l.id)).toEqual(['lo-3']);
    expect(vue.numeroCommandeOrigine).toBe('CM-2026-000001');
  });

  it('autorise les passages de la proposition, et eux seuls', () => {
    expect(transitionPermise('RECHERCHE_PHARMACIE', 'ATTENTE_ACCORD_PATIENT')).toBe(true);
    expect(transitionPermise('ATTENTE_ACCORD_PATIENT', 'PRISE_EN_CHARGE')).toBe(true);
    expect(transitionPermise('ATTENTE_ACCORD_PATIENT', 'RECHERCHE_PHARMACIE')).toBe(true);
    expect(transitionPermise('ATTENTE_ACCORD_PATIENT', 'ANNULEE')).toBe(true);
    // Rien n'est chiffre ni paye sans l'accord du patient.
    expect(transitionPermise('ATTENTE_ACCORD_PATIENT', 'A_PAYER')).toBe(false);
    expect(transitionPermise('PRISE_EN_CHARGE', 'ATTENTE_ACCORD_PATIENT')).toBe(false);
  });
});
