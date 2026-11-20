// Prise de rendez-vous a distance (addendum du 2026-09-28, point 6).
//
// Trois metiers, trois gestes, et aucun ne doit deborder sur l'autre :
// le patient demande, l'accueil oriente ce que personne ne vise, le medecin
// accepte en fixant l'heure ou refuse avec un motif.
import {
  creerDemande,
  mesDemandes,
  annulerDemande,
  demandesAOrienter,
  orienterDemande,
  mesDemandesRecues,
  accepterDemande,
  refuserDemande,
} from '../src/services/demande-rendez-vous.service';
import { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    patientProfile: { findUnique: jest.fn() },
    structureSante: { findFirst: jest.fn() },
    demandeRendezVous: {
      findFirst: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(),
      create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    episodeSoins: { create: jest.fn() },
    rendezVous: { create: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/services/acces-dossier.service', () => ({ demanderAccesDossier: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({
  notifierSansBloquer: jest.fn(), envoyerSmsSimule: jest.fn(),
}));
jest.mock('../src/services/parametres.service', () => ({
  getIdentitePlateforme: jest.fn(),
}));
jest.mock('../src/services/numero.service', () => ({ prochainNumero: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findFirst: M; findMany: M };
    patientProfile: { findUnique: M };
    structureSante: { findFirst: M };
    demandeRendezVous: { findFirst: M; findMany: M; findUniqueOrThrow: M; create: M; update: M; updateMany: M };
    episodeSoins: { create: M };
    rendezVous: { create: M };
    $transaction: M;
  };
};
const { notifierSansBloquer, envoyerSmsSimule } = jest.requireMock('../src/services/notification.service') as {
  notifierSansBloquer: M; envoyerSmsSimule: M;
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as { getIdentitePlateforme: M };
const { prochainNumero } = jest.requireMock('../src/services/numero.service') as { prochainNumero: M };
const { demanderAccesDossier } = jest.requireMock('../src/services/acces-dossier.service') as { demanderAccesDossier: M };

const agent: JwtPayload = { userId: 'agent-1', role: 'AGENT_ACCUEIL', sessionId: 's' } as JwtPayload;

const demandeRow = {
  id: 'dr-1', motif: 'Maux de tete persistants', statut: 'EN_ATTENTE',
  creeLe: new Date('2026-09-30T08:00:00Z'), traiteeLe: null, motifRefus: null,
  patient: {
    id: 'pat-1', dateNaissance: new Date('1992-03-17'), sexe: 'F',
    utilisateur: { prenom: 'Maomou', nom: 'Conde', telephone: '620100010' },
  },
  structure: { id: 'struct-A', nom: 'Hopital Donka', prefecture: 'Conakry' },
  medecin: null,
  episode: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  prisma.patientProfile.findUnique.mockResolvedValue({ id: 'pat-1', idStructurePreferee: 'struct-A' });
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'struct-A', medecinProfile: null });
  prisma.utilisateur.findMany.mockResolvedValue([]);
  notifierSansBloquer.mockResolvedValue(undefined);
  envoyerSmsSimule.mockResolvedValue(undefined);
  getIdentitePlateforme.mockResolvedValue({ nomCourt: 'KENEYA' });
  prochainNumero.mockResolvedValue('EP-2026-000042');
});

describe('creerDemande — le patient demande depuis chez lui', () => {
  it('refuse un compte sans dossier patient', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(creerDemande('u-x', { motif: 'Fatigue' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Sans etablissement prefere ni choix explicite, on ne sait pas ou envoyer.
  it('exige un etablissement quand le dossier n en a pas', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'pat-1', idStructurePreferee: null });
    await expect(creerDemande('u-1', { motif: 'Fatigue' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('retombe sur l etablissement prefere du dossier', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ id: 'struct-A', nom: 'Hopital Donka' });
    prisma.demandeRendezVous.findFirst.mockResolvedValue(null);
    prisma.demandeRendezVous.create.mockResolvedValue(demandeRow);

    await creerDemande('u-1', { motif: 'Maux de tete persistants' });

    expect(prisma.demandeRendezVous.create.mock.calls[0][0].data).toMatchObject({
      idPatient: 'pat-1', idStructure: 'struct-A', idMedecin: null,
    });
  });

  // Un patient inquiet en deposerait plusieurs et occuperait la file pour rien.
  it('refuse une seconde demande tant que la premiere attend', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ id: 'struct-A', nom: 'Hopital Donka' });
    prisma.demandeRendezVous.findFirst.mockResolvedValue({ id: 'dr-0' });

    await expect(creerDemande('u-1', { motif: 'Fatigue persistante' })).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.demandeRendezVous.create).not.toHaveBeenCalled();
  });

  it('refuse un medecin qui n exerce pas dans l etablissement', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ id: 'struct-A', nom: 'Hopital Donka' });
    prisma.utilisateur.findFirst.mockResolvedValue(null);

    await expect(creerDemande('u-1', { motif: 'Fatigue persistante', idMedecin: 'med-ailleurs' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  // Sans destinataire prevenu, la demande dort.
  it('previent le medecin vise', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ id: 'struct-A', nom: 'Hopital Donka' });
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'med-1' });
    prisma.demandeRendezVous.findFirst.mockResolvedValue(null);
    prisma.demandeRendezVous.create.mockResolvedValue({ ...demandeRow, medecin: { id: 'med-1', prenom: 'David', nom: 'Camara' } });

    await creerDemande('u-1', { motif: 'Maux de tete persistants', idMedecin: 'med-1' });

    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'med-1', lienAction: '/medecin/demandes',
    }));
  });

  it('previent l accueil quand aucun medecin n est vise', async () => {
    prisma.structureSante.findFirst.mockResolvedValue({ id: 'struct-A', nom: 'Hopital Donka' });
    prisma.demandeRendezVous.findFirst.mockResolvedValue(null);
    prisma.demandeRendezVous.create.mockResolvedValue(demandeRow);
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'agent-1' }]);

    await creerDemande('u-1', { motif: 'Maux de tete persistants' });

    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'agent-1', lienAction: '/hopital/demandes',
    }));
  });
});

describe('annulerDemande — le patient se ravise', () => {
  it('refuse d annuler la demande d un autre', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue(null);
    await expect(annulerDemande('u-1', 'dr-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse d annuler une demande deja traitee', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({ id: 'dr-1', statut: 'ACCEPTEE' });
    await expect(annulerDemande('u-1', 'dr-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('annule une demande encore en attente', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({ id: 'dr-1', statut: 'EN_ATTENTE' });
    prisma.demandeRendezVous.update.mockResolvedValue({ ...demandeRow, statut: 'ANNULEE' });

    const vue = await annulerDemande('u-1', 'dr-1');

    expect(prisma.demandeRendezVous.update.mock.calls[0][0].data).toMatchObject({ statut: 'ANNULEE' });
    expect(vue.statut).toBe('ANNULEE');
  });
});

describe('mesDemandes', () => {
  it('rend les siennes, la plus recente en tete', async () => {
    prisma.demandeRendezVous.findMany.mockResolvedValue([]);
    await mesDemandes('u-1');
    const { where, orderBy } = prisma.demandeRendezVous.findMany.mock.calls[0][0];
    expect(where).toEqual({ idPatient: 'pat-1' });
    expect(orderBy).toEqual({ creeLe: 'desc' });
  });
});

describe('l accueil oriente ce que personne ne vise', () => {
  it('ne voit que les demandes sans medecin de sa structure', async () => {
    prisma.demandeRendezVous.findMany.mockResolvedValue([]);

    await demandesAOrienter(agent);

    const { where, orderBy } = prisma.demandeRendezVous.findMany.mock.calls[0][0];
    expect(where).toEqual({ idStructure: 'struct-A', statut: 'EN_ATTENTE', idMedecin: null });
    // La plus ancienne d'abord : c'est le patient qui attend depuis le plus longtemps.
    expect(orderBy).toEqual({ creeLe: 'asc' });
  });

  it('refuse d orienter vers un medecin d un autre etablissement', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({
      id: 'dr-1', statut: 'EN_ATTENTE', patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.utilisateur.findFirst.mockResolvedValue(null);

    await expect(orienterDemande(agent, 'dr-1', 'med-ailleurs')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.demandeRendezVous.update).not.toHaveBeenCalled();
  });

  it('designe le medecin et le previent', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({
      id: 'dr-1', statut: 'EN_ATTENTE', patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'med-1' });
    prisma.demandeRendezVous.update.mockResolvedValue({ ...demandeRow, medecin: { id: 'med-1', prenom: 'David', nom: 'Camara' } });

    await orienterDemande(agent, 'dr-1', 'med-1');

    expect(prisma.demandeRendezVous.update.mock.calls[0][0].data).toEqual({ idMedecin: 'med-1' });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({ idUtilisateur: 'med-1' }));
  });

  // L'accueil oriente ; il ne fixe pas l'heure. Le statut ne bouge pas.
  it('n accepte pas la demande en l orientant', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({
      id: 'dr-1', statut: 'EN_ATTENTE', patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'med-1' });
    prisma.demandeRendezVous.update.mockResolvedValue(demandeRow);

    await orienterDemande(agent, 'dr-1', 'med-1');

    expect(prisma.demandeRendezVous.update.mock.calls[0][0].data.statut).toBeUndefined();
    expect(prisma.episodeSoins.create).not.toHaveBeenCalled();
    expect(prisma.rendezVous.create).not.toHaveBeenCalled();
  });
});

describe('accepterDemande — accepter, c est fixer l heure', () => {
  const recue = {
    id: 'dr-1', motif: 'Maux de tete persistants', statut: 'EN_ATTENTE',
    patient: { id: 'pat-1', utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    structure: { id: 'struct-A', nom: 'Hopital Donka' },
  };

  it('refuse une date illisible', async () => {
    await expect(accepterDemande('med-1', 'dr-1', { prevuLe: 'pas-une-date' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse une demande qui ne lui est pas adressee', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue(null);
    await expect(accepterDemande('med-9', 'dr-1', { prevuLe: '2026-10-05T09:00:00Z' }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.demandeRendezVous.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'dr-1', idMedecin: 'med-9' });
  });

  it('refuse une demande deja traitee', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({ ...recue, statut: 'REFUSEE' });
    await expect(accepterDemande('med-1', 'dr-1', { prevuLe: '2026-10-05T09:00:00Z' }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  // L'episode et le rendez-vous naissent ensemble : un episode sans
  // rendez-vous laisserait un dossier que personne n'attend.
  it('ouvre l episode et le rendez-vous, et rend le medecin responsable', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue(recue);
    prisma.demandeRendezVous.updateMany.mockResolvedValue({ count: 1 });
    prisma.episodeSoins.create.mockResolvedValue({ id: 'ep-9' });
    prisma.rendezVous.create.mockResolvedValue({ id: 'rdv-9' });
    prisma.demandeRendezVous.update.mockResolvedValue({});
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'pat-u', telephone: '620100010' });
    prisma.demandeRendezVous.findUniqueOrThrow.mockResolvedValue({ ...demandeRow, statut: 'ACCEPTEE' });

    await accepterDemande('med-1', 'dr-1', { prevuLe: '2026-10-05T09:00:00Z' });

    // L'historique suit l'accord du patient : la demande part avec le rendez-vous.
    expect(demanderAccesDossier).toHaveBeenCalledWith({
      idPatient: 'pat-1', idMedecin: 'med-1', idEpisode: 'ep-9', idRendezVous: 'rdv-9',
      prevuLe: new Date('2026-10-05T09:00:00Z'),
    });

    expect(prisma.episodeSoins.create.mock.calls[0][0].data).toMatchObject({
      numero: 'EP-2026-000042', idStructure: 'struct-A', idPatient: 'pat-1',
      idOuvertPar: 'med-1', idResponsable: 'med-1', statut: 'EN_COURS',
    });
    expect(prisma.rendezVous.create.mock.calls[0][0].data).toMatchObject({
      idPatient: 'pat-1', idMedecin: 'med-1', idEpisode: 'ep-9', statut: 'PLANIFIE',
    });
    // Le patient apprend son heure, sans detail medical dans le SMS.
    expect(envoyerSmsSimule).toHaveBeenCalledTimes(1);
    expect(envoyerSmsSimule.mock.calls[0][1]).not.toMatch(/Maux de tete/i);
  });

  // Deux acceptations simultanees : un gagnant, un perdant, jamais deux
  // episodes pour une seule demande.
  it('refuse quand la demande vient d etre traitee', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue(recue);
    prisma.demandeRendezVous.updateMany.mockResolvedValue({ count: 0 });

    await expect(accepterDemande('med-1', 'dr-1', { prevuLe: '2026-10-05T09:00:00Z' }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(prisma.episodeSoins.create).not.toHaveBeenCalled();
    expect(demanderAccesDossier).not.toHaveBeenCalled();
  });
});

describe('refuserDemande — un refus sans explication est un mur', () => {
  it('exige un motif', async () => {
    await expect(refuserDemande('med-1', 'dr-1', '  ')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.demandeRendezVous.findFirst).not.toHaveBeenCalled();
  });

  it('enregistre le motif et previent le patient', async () => {
    prisma.demandeRendezVous.findFirst.mockResolvedValue({
      id: 'dr-1', statut: 'EN_ATTENTE', idPatient: 'pat-1', structure: { nom: 'Hopital Donka' },
    });
    prisma.demandeRendezVous.update.mockResolvedValue({ ...demandeRow, statut: 'REFUSEE', motifRefus: 'Consultez d abord votre ASC' });
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'pat-u' });

    const vue = await refuserDemande('med-1', 'dr-1', 'Consultez d abord votre ASC');

    expect(prisma.demandeRendezVous.update.mock.calls[0][0].data).toMatchObject({
      statut: 'REFUSEE', motifRefus: 'Consultez d abord votre ASC',
    });
    expect(vue.motifRefus).toBe('Consultez d abord votre ASC');

    // Le motif reste dans l'espace du patient : il peut porter un detail que
    // rien ne doit sortir de la plateforme.
    const notif = notifierSansBloquer.mock.calls[0][0];
    expect(notif.idUtilisateur).toBe('pat-u');
    expect(notif.contenu).not.toMatch(/ASC/);
  });
});

describe('mesDemandesRecues', () => {
  it('ne rend que celles qui le visent et attendent', async () => {
    prisma.demandeRendezVous.findMany.mockResolvedValue([]);
    await mesDemandesRecues('med-1');
    expect(prisma.demandeRendezVous.findMany.mock.calls[0][0].where)
      .toEqual({ idMedecin: 'med-1', statut: 'EN_ATTENTE' });
  });
});
