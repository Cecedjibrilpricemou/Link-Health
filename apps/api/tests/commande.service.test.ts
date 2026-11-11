// Commande pharmacie (P6 / EF-07) — appel au quartier et attribution.
// Processus : docs/PARCOURS-COMMANDE-LIVRAISON.md
//
// Le point critique est l'attribution. « La première pharmacie qui déclare
// détenir tous les produits prend la commande » n'a de sens que si deux
// pharmacies simultanées donnent un gagnant et un perdant. Toute la mécanique
// repose sur un `updateMany` conditionnel : les tests ci-dessous vérifient
// qu'on ne peut pas passer à côté.
import {
  choisirModeRemise,
  commandesDeLaPharmacie,
  elargirCommande,
  elargirCommandesEnAttente,
  lancerRecherchePharmacie,
  pharmaciesDeLaZone,
  repondreDisponibilite,
  retirerPriseEnCharge,
} from '../src/services/commande.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';
import { CHAMPS_RECHERCHE, filtreZone } from '../src/utils/zone';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn(), findMany: jest.fn() },
    structureSante: { findMany: jest.fn() },
    ordonnance: { findUnique: jest.fn() },
    commande: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    reponsePharmacie: { upsert: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/services/numero.service', () => ({ prochainNumero: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({ notifierSansBloquer: jest.fn() }));
// M1-C : les voisines viennent du referentiel ; aucune par defaut, chaque test precise.
jest.mock('../src/services/geographie.service', () => ({ voisinsDe: jest.fn() }));
const { voisinsDe } = jest.requireMock('../src/services/geographie.service') as { voisinsDe: jest.Mock };

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: jest.Mock; findMany: jest.Mock };
    structureSante: { findMany: jest.Mock };
    ordonnance: { findUnique: jest.Mock };
    commande: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    reponsePharmacie: { upsert: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
};
const { prochainNumero } = jest.requireMock('../src/services/numero.service') as { prochainNumero: jest.Mock };
const { notifierSansBloquer } = jest.requireMock('../src/services/notification.service') as { notifierSansBloquer: jest.Mock };

const PHARMACIEN = { userId: 'u-ph', role: 'PHARMACIEN' } as never;
const PATIENT = { userId: 'u-pat', role: 'PATIENT' } as never;

const NOUNIE = {
  id: 'ph-nounie', nom: 'Pharmacie Nounie',
  type: 'PHARMACIE', estActive: true, estPartenaire: true,
  prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
};

function pharmacienDe(structure: Record<string, unknown> = NOUNIE) {
  prisma.utilisateur.findUnique.mockResolvedValue({ id: 'u-ph', structure });
}

function ordonnanceSignee(etat: Record<string, unknown> = {}) {
  prisma.ordonnance.findUnique.mockResolvedValue({
    id: 'ord-1', numero: 'OR-2026-000001',
    signeLe: new Date('2026-09-20'),
    commande: null,
    lignes: [{ id: 'l1' }],
    consultation: {
      idMedecinValideur: 'u-med',
      patient: { prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé', utilisateur: { id: 'u-pat' } },
    },
    ...etat,
  });
}

/** La commande telle que `getCommande` la relira en fin d'appel. */
/**
 * Une commande telle que Prisma la rend avec `COMMANDE_INCLUDE`.
 *
 * **Enrichie le 2026-10-09** : les sorties passent desormais par
 * `versCommandeView`, qui lit la date, les lignes et l'identite du patient.
 * Une fixture partielle faisait echouer sept tests sur un `toISOString` —
 * pour la bonne raison, mais au mauvais endroit : c'est le decor qui manquait,
 * pas le code qui etait faux.
 */
function commandeRelue(etat: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1', numero: 'CM-2026-000001', statut: 'RECHERCHE_PHARMACIE',
    quartierRecherche: 'Kipé', prefectureRecherche: 'Conakry', communeRecherche: 'Ratoma',
    idPharmacie: null, modeRemise: null,
    creeLe: new Date('2026-10-09T08:00:00Z'),
    reponses: [],
    pharmacie: null,
    // Le panier chiffre : vide tant que l'officine n'a pas fixe ses prix.
    // `versCommandeView` montre alors la prescription, sans montant.
    lignes: [],
    montantTotalGnf: null,
    chiffreeLe: null, preteLe: null, remiseLe: null, clotureeLe: null,
    motifAnnulation: null,
    ordonnance: {
      numero: 'OR-2026-000001', signePar: 'u-med',
      lignes: [{
        id: 'lo-1', quantite: 2, posologie: '1 comprime matin et soir',
        medicament: { libelle: 'Doliprane 500mg', dosage: '500mg', forme: 'comprime' },
      }],
      consultation: {
        idMedecinValideur: 'u-med',
        patient: {
          idUtilisateur: 'u-pat',
          utilisateur: { id: 'u-pat', prenom: 'Maomou', nom: 'Conde' },
        },
      },
    },
    ...etat,
  };
}

beforeEach(() => {
  voisinsDe.mockResolvedValue([]);
  prochainNumero.mockResolvedValue('CM-2026-000001');
  notifierSansBloquer.mockResolvedValue(undefined);
  prisma.commande.create.mockResolvedValue({ id: 'cmd-1', numero: 'CM-2026-000001' });
  prisma.commande.findUnique.mockResolvedValue(commandeRelue());
  // Les destinataires d'un appel : vide par defaut, chaque test precise.
  prisma.utilisateur.findMany.mockResolvedValue([]);
});
afterEach(() => jest.resetAllMocks());

// ── Périmètre de l'appel ─────────────────────────────────────────────
describe('pharmaciesDeLaZone', () => {
  // La commune, dans sa prefecture : la pharmacie du quartier voisin est
  // sollicitee, celle d'une autre ville ne l'est jamais (utils/zone.ts).
  it('ne retient que les partenaires actives de la commune du patient', async () => {
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);
    const lieu = { prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé' };

    await pharmaciesDeLaZone(lieu);

    expect(prisma.structureSante.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        type: 'PHARMACIE',
        estActive: true,
        estPartenaire: true,
        ...filtreZone(lieu),
      },
    }));
  });

  // Une commande creee avant la prefecture de recherche : comparee par le
  // seul quartier, comme a sa creation, plutot que de ne plus rien trouver.
  it('ancienne commande sans préfecture : cherche par le quartier, comme avant', async () => {
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);

    await pharmaciesDeLaZone({ quartier: 'Kipé' });

    expect(prisma.structureSante.findMany.mock.calls[0][0].where.quartier)
      .toEqual({ equals: 'Kipé', mode: 'insensitive' });
  });

  // Sans lieu, elargir serait deviner : on solliciterait des pharmacies
  // qui n'ont aucune raison d'etre concernees.
  it('ne cherche nulle part quand le patient n a ni commune ni quartier', async () => {
    expect(await pharmaciesDeLaZone({ prefecture: 'Conakry' })).toEqual([]);
    expect(await pharmaciesDeLaZone({})).toEqual([]);
    expect(prisma.structureSante.findMany).not.toHaveBeenCalled();
  });

  it('refuse la file pour un pharmacien rattache directement a un hopital', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 'u-ph',
      idStructure: 'chu-1',
      structure: {
        id: 'chu-1', nom: 'CHU', type: 'CHU', estPartenaire: true, quartier: 'Kipé',
      },
    });
    prisma.commande.findMany.mockResolvedValue([]);

    await expect(commandesDeLaPharmacie(PHARMACIEN)).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.commande.findMany).not.toHaveBeenCalled();
  });
});

// ── Lancement ────────────────────────────────────────────────────────
describe('lancerRecherchePharmacie', () => {
  it('ouvre l appel sur la commune du patient, et la fige sur la commande', async () => {
    ordonnanceSignee();
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE, { id: 'ph-2', nom: 'Pharmacie 2' }]);

    await lancerRecherchePharmacie('ord-1');

    expect(prisma.commande.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        statut: 'RECHERCHE_PHARMACIE',
        quartierRecherche: 'Kipé', prefectureRecherche: 'Conakry', communeRecherche: 'Ratoma',
      }),
    }));
  });

  // Une ordonnance non signee n'est pas opposable : elle n'a rien a faire en
  // circulation, et aucune pharmacie ne pourrait la servir.
  it('refuse une ordonnance non signee', async () => {
    ordonnanceSignee({ signeLe: null });

    await expect(lancerRecherchePharmacie('ord-1')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.commande.create).not.toHaveBeenCalled();
  });

  it('refuse une seconde commande sur la meme ordonnance', async () => {
    ordonnanceSignee({ commande: { id: 'cmd-existante' } });

    await expect(lancerRecherchePharmacie('ord-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('404 sur une ordonnance inconnue', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(null);
    await expect(lancerRecherchePharmacie('ord-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  // Aucune partenaire dans le quartier : il n'y a personne a interroger. Le
  // resultat est le meme que si nul n'avait repondu.
  it('conclut sans pharmacie quand le quartier n en compte aucune', async () => {
    ordonnanceSignee();
    prisma.structureSante.findMany.mockResolvedValue([]);

    await lancerRecherchePharmacie('ord-1');

    expect(prisma.commande.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: 'SANS_PHARMACIE' }),
    }));
    const types = notifierSansBloquer.mock.calls.map((c) => c[0].type);
    expect(types).toContain('COMMANDE_SANS_PHARMACIE');
  });
});

// ── Attribution — le cœur du dispositif ──────────────────────────────
describe('repondreDisponibilite', () => {
  beforeEach(() => {
    pharmacienDe();
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);
    prisma.reponsePharmacie.upsert.mockResolvedValue({});
  });

  it('attribue la commande a celle qui declare tout avoir', async () => {
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    await repondreDisponibilite(PHARMACIEN, 'cmd-1', true);

    expect(prisma.commande.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      // Le verrou : on ne prend que si personne ne l'a prise.
      where: { id: 'cmd-1', idPharmacie: null, statut: 'RECHERCHE_PHARMACIE' },
    }));
    const types = notifierSansBloquer.mock.calls.map((c) => c[0].type);
    expect(types).toContain('COMMANDE_PRISE_EN_CHARGE');
  });

  // Le cas qui justifie tout le dispositif : deux pharmacies a la meme
  // seconde. `updateMany` ne touche rien pour la seconde — count vaut 0.
  it('refuse la seconde pharmacie quand une autre a ete plus rapide', async () => {
    prisma.commande.updateMany.mockResolvedValue({ count: 0 });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ConflictError);
    const types = notifierSansBloquer.mock.calls.map((c) => c[0].type);
    expect(types).not.toContain('COMMANDE_PRISE_EN_CHARGE');
  });

  it('refuse d emblee si la commande est deja prise par une autre', async () => {
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ idPharmacie: 'ph-autre' }));

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it('enregistre un refus sans rien attribuer', async () => {
    await repondreDisponibilite(PHARMACIEN, 'cmd-1', false);

    expect(prisma.reponsePharmacie.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { idCommande: 'cmd-1', idStructure: 'ph-nounie', aTousLesProduits: false },
    }));
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  // Quand toutes les sollicitees ont refuse et que la prefecture n'a
  // personne de plus (M5), il n'y a plus rien a attendre.
  it('conclut sans pharmacie quand toutes ont refuse', async () => {
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.commande.findUnique.mockResolvedValue(
      commandeRelue({ reponses: [{ idStructure: 'ph-1', aTousLesProduits: false,
        repondueLe: new Date('2026-10-09T09:00:00Z'), structure: { nom: 'Pharmacie Nounie' } }] })
    );

    await repondreDisponibilite(PHARMACIEN, 'cmd-1', false);

    expect(prisma.commande.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { statut: 'SANS_PHARMACIE' },
    }));
  });

  it('attend encore si une sollicitee n a pas repondu', async () => {
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE, { id: 'ph-2', nom: 'Pharmacie 2' }]);
    prisma.commande.findUnique.mockResolvedValue(
      commandeRelue({ reponses: [{ idStructure: 'ph-1', aTousLesProduits: false,
        repondueLe: new Date('2026-10-09T09:00:00Z'), structure: { nom: 'Pharmacie Nounie' } }] })
    );

    await repondreDisponibilite(PHARMACIEN, 'cmd-1', false);

    expect(prisma.commande.update).not.toHaveBeenCalled();
  });

  // ── Habilitation ──────────────────────────────────────────────────

  it('refuse une pharmacie d une autre commune', async () => {
    pharmacienDe({ ...NOUNIE, commune: 'Matoto' });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuse une pharmacie d une autre prefecture, meme avec une commune du meme nom', async () => {
    pharmacienDe({ ...NOUNIE, prefecture: 'Kankan' });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Le defaut d'avant : le quartier exact. La pharmacie d'a cote, dans la
  // meme commune, n'etait jamais sollicitee.
  it('accepte une pharmacie de la meme commune, dans un autre quartier', async () => {
    pharmacienDe({ ...NOUNIE, quartier: 'Taouyah' });
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).resolves.toBeDefined();
  });

  // Seules les conventionnees sont sollicitees : repondre suppose l'etre.
  it('refuse une pharmacie non partenaire', async () => {
    pharmacienDe({ ...NOUNIE, estPartenaire: false });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuse un compte qui n est pas rattache a une pharmacie', async () => {
    pharmacienDe({ ...NOUNIE, type: 'CENTRE' });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── Rétractation ─────────────────────────────────────────────────────
describe('retirerPriseEnCharge', () => {
  beforeEach(() => {
    pharmacienDe();
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);
    prisma.$transaction.mockResolvedValue([]);
  });

  it('rouvre le verrou pour les autres pharmacies', async () => {
    prisma.commande.findUnique.mockResolvedValue(
      commandeRelue({ idPharmacie: 'ph-nounie', statut: 'PRISE_EN_CHARGE' })
    );

    await retirerPriseEnCharge(PHARMACIEN, 'cmd-1', 'Rupture de stock constatee');

    expect(prisma.commande.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { idPharmacie: null, priseEnChargeLe: null, statut: 'RECHERCHE_PHARMACIE' },
    }));
  });

  it('refuse a une pharmacie qui n a pas la commande', async () => {
    prisma.commande.findUnique.mockResolvedValue(
      commandeRelue({ idPharmacie: 'ph-autre', statut: 'PRISE_EN_CHARGE' })
    );

    await expect(retirerPriseEnCharge(PHARMACIEN, 'cmd-1', 'motif valable')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ── Mode de remise ───────────────────────────────────────────────────
describe('choisirModeRemise', () => {
  it('laisse le patient choisir le retrait', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      ...commandeRelue({ statut: 'PRISE_EN_CHARGE' }),
      ordonnance: {
        numero: 'OR-2026-000001', lignes: [],
        consultation: {
          patient: {
            idUtilisateur: 'u-pat',
            utilisateur: { id: 'u-pat', prenom: 'Maomou', nom: 'Conde' },
          },
        },
      },
    });

    await choisirModeRemise(PATIENT, 'cmd-1', 'RETRAIT_PHARMACIE' as never);

    expect(prisma.commande.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { modeRemise: 'RETRAIT_PHARMACIE' },
    }));
  });

  // Le mode de remise est une decision personnelle : personne d'autre ne la
  // prend a la place du patient.
  it('refuse a quelqu un d autre que le patient', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      ...commandeRelue({ statut: 'PRISE_EN_CHARGE' }),
      ordonnance: { consultation: { patient: { idUtilisateur: 'un-autre' } } },
    });

    await expect(choisirModeRemise(PATIENT, 'cmd-1', 'LIVRAISON' as never)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuse tant qu aucune pharmacie n a pris la commande', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      ...commandeRelue({ statut: 'RECHERCHE_PHARMACIE' }),
      ordonnance: {
        numero: 'OR-2026-000001', lignes: [],
        consultation: {
          patient: {
            idUtilisateur: 'u-pat',
            utilisateur: { id: 'u-pat', prenom: 'Maomou', nom: 'Conde' },
          },
        },
      },
    });

    await expect(choisirModeRemise(PATIENT, 'cmd-1', 'LIVRAISON' as never)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ── File du comptoir ─────────────────────────────────────────────────
describe('commandesDeLaPharmacie', () => {
  it('montre les appels de sa commune non refuses, et ce qu elle a pris', async () => {
    pharmacienDe();
    prisma.commande.findMany.mockResolvedValue([]);

    await commandesDeLaPharmacie(PHARMACIEN);

    const { where } = prisma.commande.findMany.mock.calls[0][0];
    expect(where.OR[0]).toEqual(expect.objectContaining({
      statut: 'RECHERCHE_PHARMACIE',
      // La zone de la pharmacie, comparee a celle figee sur la commande ; les
      // commandes anterieures, sans prefecture, restent visibles.
      ...filtreZone(NOUNIE, CHAMPS_RECHERCHE, { prefectureFacultative: true }),
      // Une pharmacie qui a deja dit non ne doit pas revoir l'appel.
      reponses: { none: { idStructure: 'ph-nounie', aTousLesProduits: false } },
    }));
    expect(where.OR).toContainEqual({ idPharmacie: 'ph-nounie' });
  });

  // M5 : un appel elargi se voit dans toute la prefecture, pas au-dela.
  it('montre aussi les appels elargis de sa prefecture, sauf ceux qu elle a refuses', async () => {
    pharmacienDe();
    prisma.commande.findMany.mockResolvedValue([]);

    await commandesDeLaPharmacie(PHARMACIEN);

    const { where } = prisma.commande.findMany.mock.calls[0][0];
    expect(where.OR).toContainEqual({
      statut: 'RECHERCHE_PHARMACIE',
      elargieLe: { not: null },
      prefectureRecherche: { equals: 'Conakry', mode: 'insensitive' },
      reponses: { none: { idStructure: 'ph-nounie', aTousLesProduits: false } },
    });
  });
});

// ── M1-C : commune, puis communes voisines, puis prefecture ──────────
describe('elargissement aux communes voisines', () => {
  const DIXINN = { ...NOUNIE, id: 'ph-dixinn', nom: 'Pharmacie Dixinn', commune: 'Dixinn', quartier: 'Donka' };
  const MATOTO = { ...NOUNIE, id: 'ph-matoto', nom: 'Pharmacie Matoto', commune: 'Matoto', quartier: 'Gbessia' };
  // Trois recherches : les voisines (filtre `in`), la commune (Ratoma), la prefecture.
  const parEtape = ({ where }: { where: unknown }) => {
    const j = JSON.stringify(where);
    if (j.includes('"in":')) return Promise.resolve([DIXINN]);
    if (j.includes('Ratoma')) return Promise.resolve([NOUNIE]);
    return Promise.resolve([NOUNIE, DIXINN, MATOTO]);
  };
  const appelees = () => prisma.utilisateur.findMany.mock.calls.map((c) => c[0].where.idStructure.in);

  it('au lancement, sans partenaire dans la commune, appelle d abord les voisines', async () => {
    ordonnanceSignee();
    voisinsDe.mockResolvedValue(['Dixinn']);
    prisma.structureSante.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([DIXINN]);

    await lancerRecherchePharmacie('ord-1');

    expect(voisinsDe).toHaveBeenCalledWith('Conakry', 'Ratoma');
    expect(prisma.commande.create.mock.calls[0][0].data).toMatchObject({
      statut: 'RECHERCHE_PHARMACIE', voisinesLe: expect.any(Date), communesVoisines: ['dixinn'], elargieLe: null,
    });
    // La recherche des voisines compare sans casse.
    expect(prisma.structureSante.findMany.mock.calls[1][0].where.commune).toEqual({ in: ['Dixinn'], mode: 'insensitive' });
  });

  it('au lancement, voisines vides : directement toute la prefecture, comme avant', async () => {
    ordonnanceSignee();
    voisinsDe.mockResolvedValue(['Dixinn']);
    prisma.structureSante.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([MATOTO]);

    await lancerRecherchePharmacie('ord-1');

    expect(prisma.commande.create.mock.calls[0][0].data).toMatchObject({
      voisinesLe: null, communesVoisines: [], elargieLe: expect.any(Date),
    });
  });

  it('premiere etape : n appelle que les voisines, et fige leur liste', async () => {
    voisinsDe.mockResolvedValue(['Dixinn']);
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.structureSante.findMany.mockImplementation(parEtape);
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'u-dixinn' }]);

    expect(await elargirCommande('cmd-1')).toBe(1);

    expect(prisma.commande.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.commande.updateMany).toHaveBeenCalledWith({
      where: { id: 'cmd-1', statut: 'RECHERCHE_PHARMACIE', voisinesLe: null, elargieLe: null },
      data: { voisinesLe: expect.any(Date), communesVoisines: ['dixinn'] },
    });
    expect(appelees()).toEqual([['ph-dixinn']]);
  });

  it('des voisines sans personne de plus : l etape est sautee, la prefecture est ouverte', async () => {
    voisinsDe.mockResolvedValue(['Kaloum']);
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.structureSante.findMany.mockImplementation(({ where }) => {
      const j = JSON.stringify(where);
      if (j.includes('"in":')) return Promise.resolve([]);
      return parEtape({ where });
    });

    await elargirCommande('cmd-1');

    expect(prisma.commande.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.commande.updateMany.mock.calls[0][0].data).toEqual({ elargieLe: expect.any(Date) });
  });

  it('seconde etape : la prefecture, sans rappeler ni la commune ni les voisines', async () => {
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ voisinesLe: new Date(), communesVoisines: ['dixinn'] }));
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.structureSante.findMany.mockImplementation(parEtape);

    await elargirCommande('cmd-1');

    // Le referentiel n'est plus consulte : la premiere etape est passee.
    expect(voisinsDe).not.toHaveBeenCalled();
    expect(prisma.commande.updateMany.mock.calls[0][0].data).toEqual({ elargieLe: expect.any(Date) });
    expect(appelees()).toEqual([['ph-matoto']]);
  });

  it('quand la commune et les voisines ont toutes refuse, passe aussitot a la prefecture', async () => {
    pharmacienDe();
    prisma.reponsePharmacie.upsert.mockResolvedValue({});
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.structureSante.findMany.mockImplementation(parEtape);
    const refus = (idStructure: string) => ({ idStructure, aTousLesProduits: false, repondueLe: new Date(), structure: { nom: idStructure } });
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({
      voisinesLe: new Date(), communesVoisines: ['dixinn'], reponses: [refus('ph-nounie'), refus('ph-dixinn')],
    }));

    await repondreDisponibilite(PHARMACIEN, 'cmd-1', false);

    expect(prisma.commande.updateMany.mock.calls[0][0].data).toEqual({ elargieLe: expect.any(Date) });
    expect(prisma.commande.update).not.toHaveBeenCalled();
  });

  it('une pharmacie voisine peut repondre une fois l appel ouvert aux voisines, pas avant', async () => {
    pharmacienDe(DIXINN);
    prisma.structureSante.findMany.mockImplementation(parEtape);
    prisma.reponsePharmacie.upsert.mockResolvedValue({});
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);

    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ voisinesLe: new Date(), communesVoisines: ['dixinn'] }));
    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).resolves.toBeDefined();
  });

  it('une commune non voisine reste refusee a cette etape', async () => {
    pharmacienDe(MATOTO);
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ voisinesLe: new Date(), communesVoisines: ['dixinn'] }));

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('une voisine du meme nom dans une autre prefecture reste refusee', async () => {
    pharmacienDe({ ...DIXINN, prefecture: 'Kindia' });
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ voisinesLe: new Date(), communesVoisines: ['dixinn'] }));

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('la file du comptoir montre les appels ouverts a sa commune comme voisine', async () => {
    pharmacienDe(DIXINN);
    prisma.commande.findMany.mockResolvedValue([]);

    await commandesDeLaPharmacie(PHARMACIEN);

    const { where } = prisma.commande.findMany.mock.calls[0][0];
    expect(where.OR).toContainEqual({
      statut: 'RECHERCHE_PHARMACIE',
      voisinesLe: { not: null },
      communesVoisines: { has: 'dixinn' },
      prefectureRecherche: { equals: 'Conakry', mode: 'insensitive' },
      reponses: { none: { idStructure: 'ph-dixinn', aTousLesProduits: false } },
    });
  });
});

// ── M5 : l'appel s'etend a la prefecture ─────────────────────────────
describe('elargissement a la prefecture', () => {
  const MATOTO = { id: 'ph-matoto', nom: 'Pharmacie Matoto', prefecture: 'Conakry', commune: 'Matoto' };
  // La commune (le filtre nomme Ratoma) : Nounie seule. La prefecture : Nounie et Matoto.
  const communeOuPrefecture = ({ where }: { where: unknown }) =>
    Promise.resolve(JSON.stringify(where).includes('Ratoma') ? [NOUNIE] : [NOUNIE, MATOTO]);

  it('au lancement, sans partenaire dans la commune, appelle toute la prefecture', async () => {
    ordonnanceSignee();
    // 1er appel : la commune (vide) ; 2e : la prefecture.
    prisma.structureSante.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([MATOTO]);
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'u-matoto' }]);

    await lancerRecherchePharmacie('ord-1');

    expect(prisma.commande.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: 'RECHERCHE_PHARMACIE', elargieLe: expect.any(Date) }),
    }));
    expect(prisma.structureSante.findMany.mock.calls[1][0].where.prefecture)
      .toEqual({ equals: 'Conakry', mode: 'insensitive' });
    const appel = notifierSansBloquer.mock.calls.find((c) => c[0].type === 'COMMANDE_A_SERVIR');
    expect(appel?.[0]).toMatchObject({ idUtilisateur: 'u-matoto' });
    expect(appel?.[0].contenu).toContain('aucune pharmacie de sa commune');
  });

  it('au lancement, une commune servie n est pas elargie', async () => {
    ordonnanceSignee();
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);

    await lancerRecherchePharmacie('ord-1');

    expect(prisma.commande.create.mock.calls[0][0].data.elargieLe).toBeNull();
    expect(prisma.structureSante.findMany).toHaveBeenCalledTimes(1);
  });

  it('quand toute la commune refuse, appelle les autres pharmacies de la prefecture', async () => {
    pharmacienDe();
    prisma.reponsePharmacie.upsert.mockResolvedValue({});
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({
      reponses: [{ idStructure: 'ph-nounie', aTousLesProduits: false,
        repondueLe: new Date('2026-10-09T09:00:00Z'), structure: { nom: 'Pharmacie Nounie' } }],
    }));
    prisma.structureSante.findMany.mockImplementation(communeOuPrefecture);
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'u-matoto' }]);

    await repondreDisponibilite(PHARMACIEN, 'cmd-1', false);

    expect(prisma.commande.updateMany).toHaveBeenCalledWith({
      where: { id: 'cmd-1', statut: 'RECHERCHE_PHARMACIE', elargieLe: null },
      data: { elargieLe: expect.any(Date) },
    });
    // Seule Matoto est appelee : Nounie l'etait deja, et a refuse.
    expect(prisma.utilisateur.findMany.mock.calls[0][0].where.idStructure.in).toEqual(['ph-matoto']);
    expect(prisma.commande.update).not.toHaveBeenCalled();
  });

  it('un second passage simultane ne previent personne une seconde fois', async () => {
    prisma.commande.updateMany.mockResolvedValue({ count: 0 });
    prisma.structureSante.findMany.mockImplementation(communeOuPrefecture);

    expect(await elargirCommande('cmd-1')).toBe(0);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
    // Personne n'est meme recherche a prevenir : le verrou a ete perdu avant.
    expect(prisma.utilisateur.findMany).not.toHaveBeenCalled();
  });

  it('n elargit pas une commande deja elargie ou deja prise', async () => {
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ elargieLe: new Date() }));
    expect(await elargirCommande('cmd-1')).toBe(0);
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ statut: 'ATTRIBUEE' }));
    expect(await elargirCommande('cmd-1')).toBe(0);
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it('une pharmacie de la prefecture peut repondre a un appel elargi, pas a un appel de commune', async () => {
    pharmacienDe({ ...NOUNIE, id: 'ph-matoto', commune: 'Matoto' });
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);
    prisma.reponsePharmacie.upsert.mockResolvedValue({});
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);

    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ elargieLe: new Date() }));
    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).resolves.toBeDefined();
  });

  it('meme elargi, refuse une pharmacie d une autre prefecture', async () => {
    pharmacienDe({ ...NOUNIE, prefecture: 'Kankan' });
    prisma.commande.findUnique.mockResolvedValue(commandeRelue({ elargieLe: new Date() }));

    await expect(repondreDisponibilite(PHARMACIEN, 'cmd-1', true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('le job ne prend que les appels plus vieux que le delai, et compte ceux portes plus loin', async () => {
    const maintenant = new Date('2026-11-11T12:00:00Z');
    prisma.commande.findMany.mockResolvedValue([{ id: 'cmd-1' }]);
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.structureSante.findMany.mockImplementation(communeOuPrefecture);

    const res = await elargirCommandesEnAttente(10, maintenant);

    expect(prisma.commande.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        statut: 'RECHERCHE_PHARMACIE',
        elargieLe: null,
        prefectureRecherche: { not: null },
        // Depuis la creation dans la commune, depuis l'ouverture aux voisines ensuite (M1-C).
        OR: [
          { voisinesLe: null, creeLe: { lte: new Date('2026-11-11T11:50:00Z') } },
          { voisinesLe: { lte: new Date('2026-11-11T11:50:00Z') } },
        ],
      },
    }));
    expect(res).toEqual({ elargies: 1 });
  });

  it('le job ne compte pas un appel que la prefecture ne peut pas porter plus loin', async () => {
    prisma.commande.findMany.mockResolvedValue([{ id: 'cmd-1' }]);
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);

    expect(await elargirCommandesEnAttente(10)).toEqual({ elargies: 0 });
  });
});

// ── Le motard au comptoir ────────────────────────────────────────────
describe('le motard attribue, vu par la pharmacie', () => {
  const MOTARD = { prenom: 'Ibrahima', nom: 'Keita', telephone: '620100016', photoUrl: '/uploads/avatars/motard.jpg' };

  function commandeEnLivraison(statutCourse: string, idPharmacie = 'ph-nounie', utilisateur: unknown = MOTARD) {
    return commandeRelue({
      statut: 'PRETE_POUR_LIVRAISON', modeRemise: 'LIVRAISON', idPharmacie,
      courses: [{ id: 'course-1', statut: statutCourse, livreur: utilisateur ? { utilisateur } : null }],
    });
  }

  async function vuParLaPharmacie(commande: unknown) {
    pharmacienDe();
    prisma.commande.findMany.mockResolvedValue([commande]);
    const [vue] = await commandesDeLaPharmacie(PHARMACIEN);
    return vue;
  }

  it('montre photo, nom et telephone du motard choisi a la pharmacie qui remet le colis', async () => {
    const vue = await vuParLaPharmacie(commandeEnLivraison('ATTRIBUEE'));
    expect(vue.livreur).toEqual(MOTARD);
  });

  it('le montre encore pendant la course', async () => {
    const vue = await vuParLaPharmacie(commandeEnLivraison('EN_COURS'));
    expect(vue.livreur?.prenom).toBe('Ibrahima');
  });

  it('rend une photo absente comme null, sans casser la vue', async () => {
    const vue = await vuParLaPharmacie(commandeEnLivraison('ATTRIBUEE', 'ph-nounie', { ...MOTARD, photoUrl: null }));
    expect(vue.livreur?.photoUrl).toBeNull();
  });

  it('ne montre personne tant que le patient n a pas choisi de motard', async () => {
    const vue = await vuParLaPharmacie(commandeEnLivraison('APPEL_OFFRES', 'ph-nounie', null));
    expect(vue).not.toHaveProperty('livreur');
  });

  it('ne montre plus un motard dont l attribution a ete retiree', async () => {
    // La course est revenue en appel d'offres : celui qui etait choisi ne
    // viendra pas, meme si son profil est encore rattache.
    const vue = await vuParLaPharmacie(commandeEnLivraison('APPEL_OFFRES'));
    expect(vue).not.toHaveProperty('livreur');
  });

  it('ne montre pas le motard a une autre pharmacie', async () => {
    const vue = await vuParLaPharmacie(commandeEnLivraison('ATTRIBUEE', 'ph-autre'));
    expect(vue).not.toHaveProperty('livreur');
  });

  it('demande les champs du motard a la base, et seulement ceux-la', async () => {
    pharmacienDe();
    prisma.commande.findMany.mockResolvedValue([]);
    await commandesDeLaPharmacie(PHARMACIEN);
    const { include } = prisma.commande.findMany.mock.calls[0][0];
    expect(include.courses.select.livreur).toEqual({
      select: { utilisateur: { select: { prenom: true, nom: true, telephone: true, photoUrl: true } } },
    });
  });
});

// ── Qui est prevenu d'un appel ───────────────────────────────────────
//
// **Ce bloc protege un defaut en service.** `idUtilisateur` recevait
// l'identifiant de la **structure** : la cle etrangere refusait,
// `notifierSansBloquer` avalait l'erreur, et aucune officine n'a jamais ete
// prevenue. Rien ne le signalait, parce que l'ecran du comptoir finit par
// montrer l'appel — encore faut-il que quelqu'un pense a le regarder.
describe('notification de l appel', () => {
  it('previent les pharmaciens, pas les pharmacies', async () => {
    ordonnanceSignee();
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'u-pharma-1' }, { id: 'u-pharma-2' }]);

    await lancerRecherchePharmacie('ord-1');

    // Les destinataires cherches sont bien des comptes de pharmaciens de ces
    // structures, et non les structures elles-memes.
    const ou = prisma.utilisateur.findMany.mock.calls[0]![0].where;
    expect(ou).toMatchObject({ role: 'PHARMACIEN', estActif: true });
    expect(ou.idStructure.in).toEqual([NOUNIE.id]);

    const destinataires = notifierSansBloquer.mock.calls
      .filter((c) => c[0].type === 'COMMANDE_A_SERVIR')
      .map((c) => c[0].idUtilisateur);
    expect(destinataires).toEqual(['u-pharma-1', 'u-pharma-2']);
    // Le piege exact : l'identifiant de la structure ne doit jamais s'y
    // trouver.
    expect(destinataires).not.toContain(NOUNIE.id);
  });

  it('ne previent personne quand aucune officine n a de pharmacien actif', async () => {
    ordonnanceSignee();
    prisma.structureSante.findMany.mockResolvedValue([NOUNIE]);
    prisma.utilisateur.findMany.mockResolvedValue([]);

    await lancerRecherchePharmacie('ord-1');

    const appels = notifierSansBloquer.mock.calls.filter((c) => c[0].type === 'COMMANDE_A_SERVIR');
    expect(appels).toHaveLength(0);
  });
});
