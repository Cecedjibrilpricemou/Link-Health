// Lot assurance : contrats collectifs, adhesions, cartes a QR opaque et taux
// propres a chaque police.
//
// Ce qui ne doit jamais etre faux ici :
//   - une couverture expiree, resiliee ou non conventionnee ne paie rien ;
//   - le taux negocie par une entreprise prime sur celui de la compagnie ;
//   - le plafond annuel d'un contrat collectif se compte par beneficiaire ;
//   - une compagnie n'agit jamais sur les contrats d'une autre.
import {
  ajouterAdhesion,
  ajouterReglePolice,
  chiffrerParCarte,
  creerContratCollectif,
  finDeCouverture,
  mesCartesAssurance,
  motifAdhesion,
  motifCouverture,
  motifDInegibilite,
  motifIdentiteTiersPayant,
  rechercherPatientParTelephone,
  reglesApplicables,
  renouvelerContratCollectif,
  resumeGaranties,
  statutEffectif,
  terminerAdhesion,
  verifierCarteAssurance,
  type LigneAChiffrer,
  type ReglePourCalcul,
} from '../src/services/assurance.service';
import { JwtPayload } from '../src/types/auth.types';
import { ConflictError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma = {
    utilisateur: { findUnique: jest.fn() },
    assureur: { findUnique: jest.fn() },
    structureSante: { findUnique: jest.fn() },
    structureAssureur: { findFirst: jest.fn() },
    patientProfile: { findUnique: jest.fn(), findMany: jest.fn() },
    contratAssurance: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    adhesionAssurance: {
      findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(),
    },
    contratCollectifAssurance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    entrepriseAssuree: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    regleCouverturePolice: { create: jest.fn() },
    personneAssuree: { findUnique: jest.fn(), findMany: jest.fn() },
    controleEligibilite: { create: jest.fn() },
    venteComptoir: { aggregate: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
// R14 : la numerotation vient des parametres du pays installe.
jest.mock('../src/services/parametres.service', () => {
  const vrai = jest.requireActual('../src/services/parametres.service');
  return { ...vrai, getValeursParametres: async () => ({ pays: vrai.PARAMETRES_PAR_DEFAUT.pays }) };
});

type M = jest.Mock;
type Mocks = Record<string, Record<string, M>> & { $transaction: M };
const { prisma } = jest.requireMock('../src/config/prisma') as { prisma: Mocks };

const pharmacien = { userId: 'pharma-1', role: 'PHARMACIEN', sessionId: 's' } as JwtPayload;
const agentAssureur = { userId: 'agent-1', role: 'ASSUREUR', sessionId: 's' } as JwtPayload;

const LE_2_OCTOBRE = new Date('2026-10-02T10:00:00Z');
const JETON_INDIVIDUEL = 'I'.repeat(43);
const JETON_COLLECTIF = 'C'.repeat(43);

const r = (categorie: ReglePourCalcul['categorie'], p: Partial<ReglePourCalcul> = {}): ReglePourCalcul => ({
  categorie, exclu: false, tauxPourcent: null, plafondLigneGnf: 0, dateEffet: new Date('2026-01-01'), ...p,
});

const REGLES_COMPAGNIE = [r('MEDICAMENT', { tauxPourcent: 70 }), r('LAIT_INFANTILE', { exclu: true })];
const ASSUREUR = { id: 'as-1', nom: 'Pricemou & Frere', code: 'PF', estActif: true, regles: REGLES_COMPAGNIE };
const PATIENT = { id: 'p-1', niveauIdentite: 'VERIFIEE', utilisateur: { prenom: 'Maomou', nom: 'Conde' } };

const CONTRAT_INDIVIDUEL = {
  id: 'ct-1', jetonCarte: JETON_INDIVIDUEL, numeroPolice: 'PF-001',
  tauxBasePourcent: 80, plafondAnnuelGnf: 0, franchiseGnf: 0,
  dateEffet: new Date('2026-01-01'), dateFin: new Date('2026-12-31'),
  carenceJours: 0, periodeGraceJours: 0, statut: 'ACTIF', idAssureur: 'as-1', idPatient: 'p-1',
  assureur: ASSUREUR, patient: PATIENT, reglesPersonnalisees: [] as ReglePourCalcul[],
};

const CONTRAT_COLLECTIF = {
  id: 'cc-1', numeroContrat: 'COL-2026-01', nomRegime: 'Cadres',
  tauxBasePourcent: 100, plafondAnnuelGnf: 0, franchiseGnf: 0,
  dateEffet: new Date('2026-01-01'), dateFin: new Date('2026-12-31'),
  carenceJours: 0, periodeGraceJours: 0, statut: 'ACTIF', idAssureur: 'as-1',
  assureur: ASSUREUR,
  entreprise: { raisonSociale: 'Mines de Boke' },
  // Le taux negocie par l'entreprise : 90 % sur les medicaments, la ou la
  // compagnie applique 70 %.
  regles: [r('MEDICAMENT', { tauxPourcent: 90 })],
};

const ADHESION = {
  id: 'ad-1', jetonCarte: JETON_COLLECTIF, numeroAdherent: 'EMP-42',
  dateEffet: new Date('2026-02-01'), dateFin: null as Date | null, statut: 'ACTIF',
  motifFin: null as string | null,
  contratCollectif: CONTRAT_COLLECTIF, patient: PATIENT,
};

const DOLIPRANE: LigneAChiffrer = { idMedicament: 'm-para', libelle: 'Doliprane', categorie: 'MEDICAMENT', montantGnf: 10_000 };
const LAIT: LigneAChiffrer = { idMedicament: 'm-lait', libelle: 'Lait 1er age', categorie: 'LAIT_INFANTILE', montantGnf: 40_000 };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  prisma.contratAssurance.findUnique.mockResolvedValue(null);
  prisma.adhesionAssurance.findUnique.mockResolvedValue(null);
  prisma.structureSante.findUnique.mockResolvedValue({ id: 'struct-P', type: 'PHARMACIE', idStructureParente: null });
  prisma.structureAssureur.findFirst.mockResolvedValue({ id: 'convention-1' });
  prisma.venteComptoir.aggregate.mockResolvedValue({ _sum: { montantAssureGnf: 0 } });
  prisma.controleEligibilite.create.mockResolvedValue({ id: 'ce-1' });
  // Pas de fiche de la compagnie par defaut : l'identite vient du dossier.
  prisma.personneAssuree.findUnique.mockResolvedValue(null);
  prisma.personneAssuree.findMany.mockResolvedValue([]);
});

/** Le compte connecte est un pharmacien d'officine. */
function commePharmacien() {
  prisma.utilisateur.findUnique.mockResolvedValue({
    idStructure: 'struct-P',
    structure: { type: 'PHARMACIE', idStructureParente: null },
    pharmacienProfile: { roleOfficine: 'TITULAIRE' },
  });
}

/** Le compte connecte est un agent de la compagnie as-1. */
function commeAgentAssureur() {
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'struct-A' });
  prisma.assureur.findUnique.mockResolvedValue({ id: 'as-1' });
}

// ── Les dates de couverture ──────────────────────────────────────────

describe('finDeCouverture', () => {
  it('couvre le jour de fin en entier', () => {
    expect(finDeCouverture(new Date('2026-12-31')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('ajoute la grace prevue au contrat, et seulement elle', () => {
    expect(finDeCouverture(new Date('2026-12-31'), 15).toISOString()).toBe('2027-01-16T00:00:00.000Z');
  });
});

describe('motifDInegibilite : echeance', () => {
  const base = { statut: 'ACTIF' as const, dateEffet: new Date('2026-01-01'), dateFin: new Date('2026-10-02'), carenceJours: 0 };

  it('couvre encore le soir du dernier jour', () => {
    expect(motifDInegibilite(base, new Date('2026-10-02T18:00:00Z'), 'VERIFIEE')).toBeNull();
  });

  it('expire automatiquement le lendemain de la date de fin, sans aucun traitement', () => {
    expect(motifDInegibilite(base, new Date('2026-10-03T00:00:00Z'), 'VERIFIEE')).toBe('Contrat expire');
  });

  it('applique une periode de grace seulement si le contrat la prevoit', () => {
    const avecGrace = { ...base, periodeGraceJours: 7 };
    expect(motifDInegibilite(avecGrace, new Date('2026-10-05T10:00:00Z'), 'VERIFIEE')).toBeNull();
    expect(motifDInegibilite(avecGrace, new Date('2026-10-10T00:00:00Z'), 'VERIFIEE')).toBe('Contrat expire');
  });
});

describe('statutEffectif', () => {
  it('affiche EXPIRE un contrat actif dont l echeance est passee', () => {
    expect(statutEffectif('ACTIF', new Date('2026-06-30'), 0, LE_2_OCTOBRE)).toBe('EXPIRE');
  });

  it('ne change ni un contrat sans fin ni un contrat resilie', () => {
    expect(statutEffectif('ACTIF', null, 0, LE_2_OCTOBRE)).toBe('ACTIF');
    expect(statutEffectif('RESILIE', new Date('2026-06-30'), 0, LE_2_OCTOBRE)).toBe('RESILIE');
  });
});

describe('motifAdhesion', () => {
  const base = { statut: 'ACTIF' as const, dateEffet: new Date('2026-02-01'), dateFin: null };

  it('laisse passer une adhesion en cours', () => {
    expect(motifAdhesion(base, LE_2_OCTOBRE)).toBeNull();
  });

  it('refuse une adhesion terminee, sans en donner la raison a la pharmacie', () => {
    expect(motifAdhesion({ ...base, statut: 'RESILIE' }, LE_2_OCTOBRE)).toBe('Adhesion du beneficiaire terminee');
  });

  it('refuse apres la fin programmee, et dit depuis quand', () => {
    expect(motifAdhesion({ ...base, dateFin: new Date('2026-09-15') }, LE_2_OCTOBRE)).toContain('2026-09-15');
  });

  it('refuse une adhesion pas encore en vigueur', () => {
    expect(motifAdhesion({ ...base, dateEffet: new Date('2026-11-01') }, LE_2_OCTOBRE)).toMatch(/pas encore/);
  });
});

// ── L'identite qui engage l'assureur (decision du 2026-10-21) ────────

describe('motifIdentiteTiersPayant', () => {
  const fiche = { photo: 'p-1.webp', numeroPiece: 'GN-1', dateExpirationPiece: new Date('2030-01-01') };

  it('accepte une identite verifiee a l accueil, meme sans fiche', () => {
    expect(motifIdentiteTiersPayant('VERIFIEE', null, LE_2_OCTOBRE)).toBeNull();
  });

  it('accepte une identite provisoire quand la fiche de la compagnie porte piece et photo', () => {
    expect(motifIdentiteTiersPayant('PROVISOIRE', fiche, LE_2_OCTOBRE)).toBeNull();
  });

  it('refuse une fiche sans photo : la pharmacie n aurait rien a comparer', () => {
    expect(motifIdentiteTiersPayant('PROVISOIRE', { ...fiche, photo: null }, LE_2_OCTOBRE)).toMatch(/Photo manquante/);
  });

  it('refuse une piece expiree, mais la couvre jusqu au soir de sa date d expiration', () => {
    const expireLe = { ...fiche, dateExpirationPiece: new Date('2026-10-02') };
    expect(motifIdentiteTiersPayant('PROVISOIRE', expireLe, new Date('2026-10-02T18:00:00Z'))).toBeNull();
    expect(motifIdentiteTiersPayant('PROVISOIRE', expireLe, new Date('2026-10-03T00:00:00Z'))).toMatch(/expiree/);
  });

  it('refuse une identite provisoire sans fiche', () => {
    expect(motifIdentiteTiersPayant('PROVISOIRE', null, LE_2_OCTOBRE)).toMatch(/Identite provisoire/);
  });
});

// ── Les taux propres a une police ─────────────────────────────────────

describe('reglesApplicables', () => {
  it('le taux negocie par la police prime, meme sur une regle compagnie plus recente', () => {
    const compagnie = [r('MEDICAMENT', { tauxPourcent: 60, dateEffet: new Date('2026-06-01') })];
    const police = [r('MEDICAMENT', { tauxPourcent: 90, dateEffet: new Date('2026-01-01') })];
    const regles = reglesApplicables(compagnie, police, LE_2_OCTOBRE);
    expect(regles.filter((x) => x.categorie === 'MEDICAMENT')).toEqual(police);
  });

  it('garde les regles compagnie des categories que la police ne regle pas', () => {
    const regles = reglesApplicables(REGLES_COMPAGNIE, [r('MEDICAMENT', { tauxPourcent: 90 })], LE_2_OCTOBRE);
    expect(regles.some((x) => x.categorie === 'LAIT_INFANTILE' && x.exclu)).toBe(true);
  });

  it('une regle de police future ne prend pas encore la main', () => {
    const police = [r('MEDICAMENT', { tauxPourcent: 90, dateEffet: new Date('2027-01-01') })];
    const regles = reglesApplicables(REGLES_COMPAGNIE, police, LE_2_OCTOBRE);
    expect(regles.some((x) => x.categorie === 'MEDICAMENT' && x.tauxPourcent === 70)).toBe(true);
  });
});

describe('resumeGaranties', () => {
  it('resume une ligne par categorie reglee, exclusions comprises', () => {
    const regles = reglesApplicables(REGLES_COMPAGNIE, CONTRAT_COLLECTIF.regles, LE_2_OCTOBRE);
    expect(resumeGaranties(100, regles, LE_2_OCTOBRE)).toEqual([
      { categorie: 'LAIT_INFANTILE', exclu: true, tauxPourcent: 0 },
      { categorie: 'MEDICAMENT', exclu: false, tauxPourcent: 90 },
    ]);
  });

  it('une regle sans taux affiche le taux de base du contrat', () => {
    expect(resumeGaranties(80, [r('MEDICAMENT', { plafondLigneGnf: 5_000 })], LE_2_OCTOBRE))
      .toEqual([{ categorie: 'MEDICAMENT', exclu: false, tauxPourcent: 80 }]);
  });
});

describe('motifCouverture', () => {
  const collective = {
    typeCouverture: 'COLLECTIVE' as const,
    assureur: ASSUREUR,
    contrat: CONTRAT_COLLECTIF as never,
    adhesion: { statut: 'ACTIF' as const, dateEffet: new Date('2026-02-01'), dateFin: null },
    patient: { id: 'p-1', niveauIdentite: 'VERIFIEE' as const, prenom: 'M', nom: 'C' },
  };

  it('dit que c est le contrat de l entreprise qui a expire', () => {
    expect(motifCouverture(collective, new Date('2027-01-05T10:00:00Z'))).toBe("Contrat collectif de l'entreprise expire");
  });

  it('refuse un employe sorti, meme quand le contrat de l entreprise court encore', () => {
    expect(motifCouverture({ ...collective, adhesion: { ...collective.adhesion, statut: 'RESILIE' } }, LE_2_OCTOBRE))
      .toBe('Adhesion du beneficiaire terminee');
  });

  it('garde le verrou d identito-vigilance', () => {
    expect(motifCouverture({ ...collective, patient: { ...collective.patient, niveauIdentite: 'PROVISOIRE' } }, LE_2_OCTOBRE))
      .toMatch(/Identite provisoire/);
  });

  it('refuse quand la compagnie est inactive', () => {
    expect(motifCouverture({ ...collective, assureur: { ...ASSUREUR, estActif: false } }, LE_2_OCTOBRE)).toMatch(/inactif/);
  });
});

// ── Le controle au comptoir ──────────────────────────────────────────

describe('verifierCarteAssurance', () => {
  beforeEach(commePharmacien);

  it('refuse une carte inconnue, sans rien enregistrer', async () => {
    await expect(verifierCarteAssurance(pharmacien, 'X'.repeat(43), LE_2_OCTOBRE)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.controleEligibilite.create).not.toHaveBeenCalled();
  });

  it('ne cherche que la carte presentee, jamais une liste d assures', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue(ADHESION);
    await verifierCarteAssurance(pharmacien, JETON_COLLECTIF, LE_2_OCTOBRE);
    expect(prisma.adhesionAssurance.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { jetonCarte: JETON_COLLECTIF } }));
    expect(prisma.adhesionAssurance.findMany).not.toHaveBeenCalled();
    expect(prisma.contratAssurance.findMany).not.toHaveBeenCalled();
  });

  it('accepte un employe couvert par le contrat de son entreprise, et montre ses taux', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue(ADHESION);
    const v = await verifierCarteAssurance(pharmacien, JETON_COLLECTIF, LE_2_OCTOBRE);

    expect(v.eligible).toBe(true);
    expect(v.typeCouverture).toBe('COLLECTIVE');
    expect(v.souscripteur).toBe('Mines de Boke');
    expect(v.numeroAdherent).toBe('EMP-42');
    expect(v.garanties).toContainEqual({ categorie: 'MEDICAMENT', exclu: false, tauxPourcent: 90 });
    expect(v.idControle).toBe('ce-1');
  });

  it('accepte une identite provisoire portee par la fiche de la compagnie, et demande de comparer la photo', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue({ ...ADHESION, idPatient: 'p-1', patient: { ...PATIENT, niveauIdentite: 'PROVISOIRE' } });
    prisma.personneAssuree.findUnique.mockResolvedValue({ photo: 'p-1.webp', numeroPiece: 'GN-1', dateExpirationPiece: null });

    const v = await verifierCarteAssurance(pharmacien, JETON_COLLECTIF, LE_2_OCTOBRE);
    expect(v.eligible).toBe(true);
    expect(v.photoAComparer).toBe(true);
    expect(v.photoDisponible).toBe(true);
    // La fiche cherchee est celle de la compagnie de la carte, pour ce patient.
    expect(prisma.personneAssuree.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { idAssureur_idPatient: { idAssureur: 'as-1', idPatient: 'p-1' } },
    }));
  });

  it('ne demande pas de comparer une photo qui n existe pas', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue(ADHESION);
    const v = await verifierCarteAssurance(pharmacien, JETON_COLLECTIF, LE_2_OCTOBRE);
    expect(v.photoAComparer).toBe(false);
  });

  it('enregistre le controle sur l adhesion, pas sur un contrat individuel', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue(ADHESION);
    await verifierCarteAssurance(pharmacien, JETON_COLLECTIF, LE_2_OCTOBRE);
    expect(prisma.controleEligibilite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eligible: true, idAdhesionAssurance: 'ad-1', idContrat: null,
        idPatient: 'p-1', idStructure: 'struct-P', idControlePar: 'pharma-1',
      }),
    }));
  });

  it('refuse, et l enregistre, quand la pharmacie n est pas conventionnee', async () => {
    prisma.contratAssurance.findUnique.mockResolvedValue(CONTRAT_INDIVIDUEL);
    prisma.structureAssureur.findFirst.mockResolvedValue(null);

    const v = await verifierCarteAssurance(pharmacien, JETON_INDIVIDUEL, LE_2_OCTOBRE);
    expect(v.eligible).toBe(false);
    expect(v.motif).toMatch(/pas conventionne/);
    expect(prisma.controleEligibilite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eligible: false, tauxBasePourcent: null, idContrat: 'ct-1' }),
    }));
  });

  it('une carte encore imprimee ne suffit pas : l adhesion terminee est refusee', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue({
      ...ADHESION, statut: 'RESILIE', dateFin: new Date('2026-09-01'), motifFin: 'Licenciement pour faute',
    });
    const v = await verifierCarteAssurance(pharmacien, JETON_COLLECTIF, LE_2_OCTOBRE);
    expect(v.eligible).toBe(false);
    expect(v.statut).toBe('RESILIE');
    // Le motif de depart reste chez l'assureur.
    expect(JSON.stringify(v)).not.toContain('Licenciement');
  });
});

// ── Le chiffrage a la caisse ─────────────────────────────────────────

describe('chiffrerParCarte', () => {
  it('applique le taux negocie par l entreprise et les exclusions de la compagnie', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue(ADHESION);
    const res = await chiffrerParCarte(JETON_COLLECTIF, [DOLIPRANE, LAIT], 50_000, 'struct-P', LE_2_OCTOBRE);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prise.montantAssureGnf).toBe(9_000);
    expect(res.prise.montantPatientGnf).toBe(41_000);
    expect(res.prise.lignes.find((l) => l.idMedicament === 'm-lait')?.couvert).toBe(false);
    expect(res.prise).toMatchObject({
      typeCouverture: 'COLLECTIVE', idContrat: 'cc-1', idContratAssurance: null, idAdhesionAssurance: 'ad-1', idPatient: 'p-1',
    });
  });

  it('compte le plafond annuel d un contrat collectif par beneficiaire', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue({
      ...ADHESION, contratCollectif: { ...CONTRAT_COLLECTIF, plafondAnnuelGnf: 50_000 },
    });
    prisma.venteComptoir.aggregate.mockResolvedValue({ _sum: { montantAssureGnf: 45_000 } });

    const res = await chiffrerParCarte(JETON_COLLECTIF, [DOLIPRANE], 10_000, 'struct-P', LE_2_OCTOBRE);
    expect(res.ok && res.prise.montantAssureGnf).toBe(5_000);
    const [args] = prisma.venteComptoir.aggregate.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toMatchObject({ idAdhesionAssurance: 'ad-1', statut: 'PAYEE' });
    expect(args.where).not.toHaveProperty('idContratAssurance');
  });

  it('chiffre une police individuelle avec les regles de la compagnie', async () => {
    prisma.contratAssurance.findUnique.mockResolvedValue(CONTRAT_INDIVIDUEL);
    const res = await chiffrerParCarte(JETON_INDIVIDUEL, [DOLIPRANE], 10_000, 'struct-P', LE_2_OCTOBRE);

    expect(res.ok && res.prise.montantAssureGnf).toBe(7_000);
    const [args] = prisma.venteComptoir.aggregate.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toMatchObject({ idContratAssurance: 'ct-1' });
  });

  it('refuse une carte inconnue', async () => {
    expect(await chiffrerParCarte('X'.repeat(43), [DOLIPRANE], 10_000, 'struct-P', LE_2_OCTOBRE))
      .toEqual({ ok: false, motif: expect.stringMatching(/inconnue/) });
  });

  it('refuse quand le contrat de l entreprise a expire', async () => {
    prisma.adhesionAssurance.findUnique.mockResolvedValue(ADHESION);
    const res = await chiffrerParCarte(JETON_COLLECTIF, [DOLIPRANE], 10_000, 'struct-P', new Date('2027-01-02T10:00:00Z'));
    expect(res).toEqual({ ok: false, motif: "Contrat collectif de l'entreprise expire" });
    expect(prisma.venteComptoir.aggregate).not.toHaveBeenCalled();
  });

  it('refuse une identite provisoire', async () => {
    prisma.contratAssurance.findUnique.mockResolvedValue({
      ...CONTRAT_INDIVIDUEL, patient: { ...PATIENT, niveauIdentite: 'PROVISOIRE' },
    });
    const res = await chiffrerParCarte(JETON_INDIVIDUEL, [DOLIPRANE], 10_000, 'struct-P', LE_2_OCTOBRE);
    expect(res.ok).toBe(false);
  });

  // Un sabotage remplacant le niveau lu par « VERIFIEE » en dur doit faire
  // echouer un test : la caisse ne passe pas par le controle de la carte.
  it('lit le niveau d identite en base, pour la police comme pour l adhesion', async () => {
    prisma.contratAssurance.findUnique.mockResolvedValue(CONTRAT_INDIVIDUEL);
    await chiffrerParCarte(JETON_INDIVIDUEL, [DOLIPRANE], 10_000, 'struct-P', LE_2_OCTOBRE);
    const [contrat] = prisma.contratAssurance.findUnique.mock.calls[0] as [{ include: { patient: { select: { niveauIdentite: boolean } } } }];
    const [adhesion] = prisma.adhesionAssurance.findUnique.mock.calls[0] as [{ include: { patient: { select: { niveauIdentite: boolean } } } }];
    expect(contrat.include.patient.select.niveauIdentite).toBe(true);
    expect(adhesion.include.patient.select.niveauIdentite).toBe(true);
  });

  it('herite des conventions de l hopital parent', async () => {
    prisma.contratAssurance.findUnique.mockResolvedValue(CONTRAT_INDIVIDUEL);
    prisma.structureSante.findUnique.mockResolvedValue({ id: 'pharmacie-1', type: 'PHARMACIE', idStructureParente: 'hopital-1' });
    await chiffrerParCarte(JETON_INDIVIDUEL, [DOLIPRANE], 10_000, 'pharmacie-1', LE_2_OCTOBRE);
    expect(prisma.structureAssureur.findFirst).toHaveBeenCalledWith({
      where: { idAssureur: 'as-1', idStructure: { in: ['pharmacie-1', 'hopital-1'] } },
      select: { id: true },
    });
  });

  it('refuse sans convention, et le dit', async () => {
    prisma.contratAssurance.findUnique.mockResolvedValue(CONTRAT_INDIVIDUEL);
    prisma.structureAssureur.findFirst.mockResolvedValue(null);
    const res = await chiffrerParCarte(JETON_INDIVIDUEL, [DOLIPRANE], 10_000, 'struct-P', LE_2_OCTOBRE);
    expect(res).toEqual({ ok: false, motif: expect.stringMatching(/pas conventionne/) });
  });
});

// ── Les cartes du patient ────────────────────────────────────────────

describe('mesCartesAssurance', () => {
  it('rend une carte par police et par adhesion, les utilisables d abord', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p-1' });
    prisma.contratAssurance.findMany.mockResolvedValue([{ ...CONTRAT_INDIVIDUEL, dateFin: new Date('2026-06-30') }]);
    prisma.adhesionAssurance.findMany.mockResolvedValue([ADHESION]);

    const cartes = await mesCartesAssurance('u-patient', LE_2_OCTOBRE);
    expect(cartes.map((c) => [c.typeCouverture, c.statut])).toEqual([['COLLECTIVE', 'ACTIF'], ['INDIVIDUELLE', 'EXPIRE']]);
    expect(cartes[0]).toMatchObject({ beneficiaire: { prenom: 'Maomou', nom: 'Conde' }, jetonCarte: JETON_COLLECTIF });
  });
});

// ── L'assureur gere ses contrats ─────────────────────────────────────

describe('creerContratCollectif', () => {
  beforeEach(commeAgentAssureur);
  const dto = {
    entreprise: { raisonSociale: 'Mines de Boke (renomme)', identifiantLegal: 'RCCM-42' },
    numeroContrat: 'COL-2026-01', nomRegime: 'Cadres', tauxBasePourcent: 90,
    dateEffet: '2026-01-01', dateFin: '2026-12-31',
  };

  it('ne modifie pas une entreprise deja connue d une autre compagnie', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue(null);
    prisma.entrepriseAssuree.findUnique.mockResolvedValue({ id: 'ent-1', estActive: true });
    prisma.contratCollectifAssurance.create.mockResolvedValue({
      ...CONTRAT_COLLECTIF, entreprise: { id: 'ent-1', raisonSociale: 'Mines de Boke', identifiantLegal: 'RCCM-42' },
      regles: [], _count: { adhesions: 0 },
    });

    await creerContratCollectif(agentAssureur, dto, LE_2_OCTOBRE);
    expect(prisma.entrepriseAssuree.create).not.toHaveBeenCalled();
    expect(prisma.entrepriseAssuree.update).not.toHaveBeenCalled();
    expect(prisma.entrepriseAssuree.upsert).not.toHaveBeenCalled();
    expect(prisma.contratCollectifAssurance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idEntreprise: 'ent-1', idAssureur: 'as-1' }),
    }));
  });

  it('refuse un numero de contrat deja pris dans la compagnie', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue({ id: 'cc-1' });
    await expect(creerContratCollectif(agentAssureur, dto, LE_2_OCTOBRE)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('ajouterAdhesion', () => {
  beforeEach(() => {
    commeAgentAssureur();
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue(CONTRAT_COLLECTIF);
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p-1' });
    prisma.adhesionAssurance.findFirst.mockResolvedValue(null);
    prisma.adhesionAssurance.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...ADHESION, ...data, id: 'ad-2', finEnregistreeLe: null }));
  });

  it('ne trouve pas le contrat d une autre compagnie', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue(null);
    await expect(ajouterAdhesion(agentAssureur, 'cc-autre', { idPatient: 'p-1', numeroAdherent: 'E1' }, LE_2_OCTOBRE))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.contratCollectifAssurance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cc-autre', idAssureur: 'as-1' },
    }));
  });

  it('donne au beneficiaire sa propre carte, qui suit la fin du contrat', async () => {
    await ajouterAdhesion(agentAssureur, 'cc-1', { idPatient: 'p-1', numeroAdherent: 'E1' }, LE_2_OCTOBRE);
    const [{ data }] = prisma.adhesionAssurance.create.mock.calls[0] as [{ data: { jetonCarte: string; dateFin: unknown } }];
    expect(data.jetonCarte).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.dateFin).toBeNull();
  });

  it('refuse d ajouter un beneficiaire a un contrat expire', async () => {
    await expect(ajouterAdhesion(agentAssureur, 'cc-1', { idPatient: 'p-1', numeroAdherent: 'E1' }, new Date('2027-02-01')))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse une personne deja adherente', async () => {
    prisma.adhesionAssurance.findFirst.mockResolvedValue({ idPatient: 'p-1' });
    await expect(ajouterAdhesion(agentAssureur, 'cc-1', { idPatient: 'p-1', numeroAdherent: 'E1' }, LE_2_OCTOBRE))
      .rejects.toThrow(/deja adherente/);
  });
});

describe('terminerAdhesion', () => {
  beforeEach(() => {
    commeAgentAssureur();
    prisma.adhesionAssurance.findFirst.mockResolvedValue({
      id: 'ad-1', statut: 'ACTIF', dateEffet: new Date('2026-02-01'), dateFin: null, finEnregistreeLe: null,
    });
    prisma.adhesionAssurance.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...ADHESION, ...data }));
  });

  it('resilie aussitot une fin immediate, avec motif et auteur', async () => {
    await terminerAdhesion(agentAssureur, 'ad-1', { motif: 'Depart de l entreprise' }, LE_2_OCTOBRE);
    expect(prisma.adhesionAssurance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        statut: 'RESILIE', dateFin: LE_2_OCTOBRE, motifFin: 'Depart de l entreprise',
        finEnregistreeLe: LE_2_OCTOBRE, idFinEnregistreePar: 'agent-1',
      }),
    }));
  });

  it('laisse couvert jusqu a une fin future', async () => {
    await terminerAdhesion(agentAssureur, 'ad-1', { motif: 'Fin de periode d essai', dateEffet: '2026-10-31' }, LE_2_OCTOBRE);
    expect(prisma.adhesionAssurance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: 'ACTIF', dateFin: new Date('2026-10-31') }),
    }));
  });

  it('ne cherche que dans les contrats de la compagnie', async () => {
    await terminerAdhesion(agentAssureur, 'ad-1', { motif: 'Depart de l entreprise' }, LE_2_OCTOBRE);
    expect(prisma.adhesionAssurance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ad-1', contratCollectif: { idAssureur: 'as-1' } },
    }));
  });

  it('refuse de repousser une fin deja prevue', async () => {
    prisma.adhesionAssurance.findFirst.mockResolvedValue({
      id: 'ad-1', statut: 'ACTIF', dateEffet: new Date('2026-02-01'), dateFin: new Date('2026-10-15'), finEnregistreeLe: null,
    });
    await expect(terminerAdhesion(agentAssureur, 'ad-1', { motif: 'Depart', dateEffet: '2026-11-30' }, LE_2_OCTOBRE))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse une seconde fin', async () => {
    prisma.adhesionAssurance.findFirst.mockResolvedValue({
      id: 'ad-1', statut: 'RESILIE', dateEffet: new Date('2026-02-01'), dateFin: LE_2_OCTOBRE, finEnregistreeLe: LE_2_OCTOBRE,
    });
    await expect(terminerAdhesion(agentAssureur, 'ad-1', { motif: 'Depart' }, LE_2_OCTOBRE)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('renouvelerContratCollectif', () => {
  beforeEach(() => {
    commeAgentAssureur();
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue(CONTRAT_COLLECTIF);
  });

  it('refuse une echeance qui ne prolonge pas le contrat', async () => {
    await expect(renouvelerContratCollectif(agentAssureur, 'cc-1', { dateFin: '2026-12-01' }, LE_2_OCTOBRE))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('enregistre la nouvelle periode de validite', async () => {
    prisma.contratCollectifAssurance.update.mockResolvedValue({
      ...CONTRAT_COLLECTIF, dateFin: new Date('2027-12-31'),
      entreprise: { id: 'ent-1', raisonSociale: 'Mines de Boke', identifiantLegal: null }, regles: [], _count: { adhesions: 3 },
    });
    const v = await renouvelerContratCollectif(agentAssureur, 'cc-1', { dateFin: '2027-12-31' }, LE_2_OCTOBRE);
    expect(prisma.contratCollectifAssurance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { dateFin: new Date('2027-12-31'), statut: 'ACTIF' },
    }));
    expect(v.nombreAdhesionsActives).toBe(3);
  });

  it('refuse de renouveler un contrat resilie', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue({ ...CONTRAT_COLLECTIF, statut: 'RESILIE' });
    await expect(renouvelerContratCollectif(agentAssureur, 'cc-1', { dateFin: '2027-12-31' }, LE_2_OCTOBRE))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ajouterReglePolice', () => {
  beforeEach(commeAgentAssureur);

  it('ne touche pas a la police d une autre compagnie', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue(null);
    await expect(ajouterReglePolice(agentAssureur, {
      typeCouverture: 'COLLECTIVE', idContrat: 'cc-autre', categorie: 'MEDICAMENT', tauxPourcent: 90,
    })).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.regleCouverturePolice.create).not.toHaveBeenCalled();
  });

  it('rattache la regle au seul contrat collectif vise', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue({ id: 'cc-1' });
    prisma.regleCouverturePolice.create.mockResolvedValue({ id: 'rp-1', ...r('MEDICAMENT', { tauxPourcent: 90 }) });
    await ajouterReglePolice(agentAssureur, { typeCouverture: 'COLLECTIVE', idContrat: 'cc-1', categorie: 'MEDICAMENT', tauxPourcent: 90 });
    expect(prisma.regleCouverturePolice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ idContratCollectif: 'cc-1', idContratAssurance: null, tauxPourcent: 90, exclu: false }),
    });
  });

  it('refuse une exclusion qui porte aussi un taux', async () => {
    prisma.contratAssurance.findFirst.mockResolvedValue({ id: 'ct-1' });
    await expect(ajouterReglePolice(agentAssureur, {
      typeCouverture: 'INDIVIDUELLE', idContrat: 'ct-1', categorie: 'MEDICAMENT', exclu: true, tauxPourcent: 50,
    })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('rechercherPatientParTelephone', () => {
  beforeEach(commeAgentAssureur);

  it('refuse un numero incomplet : pas de recherche approximative', async () => {
    await expect(rechercherPatientParTelephone(agentAssureur, '620')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.patientProfile.findMany).not.toHaveBeenCalled();
  });

  it('cherche sur le numero exact, et masque le telephone', async () => {
    prisma.patientProfile.findMany.mockResolvedValue([{
      id: 'p-1', dateNaissance: new Date('1990-05-01'),
      utilisateur: { prenom: 'Maomou', nom: 'Conde', telephone: '620000001' },
    }]);
    const res = await rechercherPatientParTelephone(agentAssureur, '+224 620 00 00 01');
    expect(prisma.patientProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { utilisateur: { telephone: { endsWith: '620000001' } } },
    }));
    expect(res).toEqual([{ id: 'p-1', prenom: 'Maomou', nom: 'Conde', telephoneMasque: '••••••001', anneeNaissance: 1990 }]);
  });
});
