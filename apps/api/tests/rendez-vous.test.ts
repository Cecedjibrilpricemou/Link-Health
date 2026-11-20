// Le circuit du rendez-vous, depuis l'addendum du 2026-09-28 :
//   l'accueil oriente sans heure -> le medecin fixe le creneau ->
//   l'assistante pointe l'arrivee -> le medecin prend le patient.
//
// Chacun de ces gestes appartient a un seul metier, et ces tests le disent.
import { fixerRendezVous, getAgenda, changerStatutRendezVous } from '../src/services/medecin.service';
import { presencesDuJour, pointerPresence } from '../src/services/hopital.service';
import { JwtPayload } from '../src/types/auth.types';
import { ConflictError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { findUnique: jest.fn(), findFirst: jest.fn() },
    episodeSoins: { findFirst: jest.fn() },
    rendezVous: {
      findFirst: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(),
      create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/services/notification.service', () => ({
  notifierSansBloquer: jest.fn().mockResolvedValue(undefined),
  envoyerSmsSimule: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/parametres.service', () => ({
  getIdentitePlateforme: jest.fn().mockResolvedValue({ nomCourt: 'KENEYA' }),
  getValeursParametres: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/utils/cache', () => ({ withCache: jest.fn(), cacheDel: jest.fn() }));
jest.mock('../src/realtime/socket.server', () => ({ emitToUser: jest.fn() }));
jest.mock('../src/realtime/rendez-vous.events', () => ({ diffuserRendezVous: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessConsultation: jest.fn(),
  buildPatientWhereForUser: jest.fn().mockResolvedValue({}),
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findFirst: M };
    episodeSoins: { findFirst: M };
    rendezVous: { findFirst: M; findMany: M; findUniqueOrThrow: M; create: M; update: M; updateMany: M };
    $transaction: M;
  };
};
const { notifierSansBloquer, envoyerSmsSimule } = jest.requireMock('../src/services/notification.service') as {
  notifierSansBloquer: M; envoyerSmsSimule: M;
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as { getIdentitePlateforme: M };
const { diffuserRendezVous } = jest.requireMock('../src/realtime/rendez-vous.events') as { diffuserRendezVous: M };

const medecin: JwtPayload = { userId: 'med-1', role: 'MEDECIN', sessionId: 's' } as JwtPayload;
const agent: JwtPayload = { userId: 'agent-1', role: 'AGENT_ACCUEIL', sessionId: 's' } as JwtPayload;

const episodeRow = {
  id: 'ep-1', numero: 'EP-2026-000001', motif: 'Maux de tete', statut: 'EN_COURS',
  idPatient: 'pat-1', structure: { nom: 'Hopital Donka' },
};

const rdvRow = {
  id: 'rdv-1', prevuLe: new Date('2026-10-01T09:00:00Z'), statut: 'PLANIFIE',
  motif: 'Maux de tete', arriveeLe: null,
  patient: {
    id: 'pat-1', dateNaissance: new Date('1992-03-17'), sexe: 'F',
    utilisateur: { prenom: 'Maomou', nom: 'Conde', telephone: '620100010' },
  },
  medecin: { id: 'med-1', prenom: 'David', nom: 'Camara' },
  episode: { id: 'ep-1', numero: 'EP-2026-000001' },
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'struct-A', medecinProfile: null });
  // `resetAllMocks` efface aussi les implementations posees a la declaration.
  notifierSansBloquer.mockResolvedValue(undefined);
  envoyerSmsSimule.mockResolvedValue(undefined);
  getIdentitePlateforme.mockResolvedValue({ nomCourt: 'KENEYA' });
});

describe('fixerRendezVous — le medecin pose le creneau', () => {
  it('refuse une date illisible', async () => {
    await expect(fixerRendezVous('med-1', 'ep-1', { prevuLe: 'pas-une-date' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  // Le creneau appartient au medecin responsable : un autre ne peut pas
  // convoquer un patient qu'il ne suit pas.
  it('refuse un episode dont ce medecin n est pas responsable', async () => {
    prisma.episodeSoins.findFirst.mockResolvedValue(null);
    await expect(fixerRendezVous('med-9', 'ep-1', { prevuLe: '2026-10-01T09:00:00Z' }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.episodeSoins.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'ep-1', idResponsable: 'med-9' });
  });

  it('refuse un episode termine', async () => {
    prisma.episodeSoins.findFirst.mockResolvedValue({ ...episodeRow, statut: 'CLOS' });
    await expect(fixerRendezVous('med-1', 'ep-1', { prevuLe: '2026-10-01T09:00:00Z' }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('cree le rendez-vous et previent le patient de l heure', async () => {
    prisma.episodeSoins.findFirst.mockResolvedValue(episodeRow);
    prisma.rendezVous.updateMany.mockResolvedValue({ count: 0 });
    prisma.rendezVous.create.mockResolvedValue(rdvRow);
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'pat-u', telephone: '620100010' });

    const vue = await fixerRendezVous('med-1', 'ep-1', { prevuLe: '2026-10-01T09:00:00Z' });

    expect(prisma.rendezVous.create.mock.calls[0][0].data).toMatchObject({
      idPatient: 'pat-1', idMedecin: 'med-1', idEpisode: 'ep-1', statut: 'PLANIFIE',
    });
    // C'est seulement ici que le patient apprend une heure : elle est confirmee.
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({ idUtilisateur: 'pat-u' }));
    expect(envoyerSmsSimule).toHaveBeenCalledTimes(1);
    // Le SMS ne porte aucun detail medical.
    expect(envoyerSmsSimule.mock.calls[0][1]).not.toMatch(/Maux de tete/i);
    expect(vue.patient.prenom).toBe('Maomou');
  });

  // Deplacer un creneau le remplace, il ne s'y ajoute pas.
  it('annule le rendez-vous planifie precedent de l episode', async () => {
    prisma.episodeSoins.findFirst.mockResolvedValue(episodeRow);
    prisma.rendezVous.updateMany.mockResolvedValue({ count: 1 });
    prisma.rendezVous.create.mockResolvedValue(rdvRow);
    prisma.utilisateur.findFirst.mockResolvedValue(null);

    await fixerRendezVous('med-1', 'ep-1', { prevuLe: '2026-10-02T10:00:00Z' });

    expect(prisma.rendezVous.updateMany).toHaveBeenCalledWith({
      where: { idEpisode: 'ep-1', statut: 'PLANIFIE' },
      data: { statut: 'ANNULE' },
    });
  });
});

describe('getAgenda — les rendez-vous du medecin, dans l ordre', () => {
  it('ne rend que les siens, du plus proche au plus lointain', async () => {
    prisma.rendezVous.findMany.mockResolvedValue([]);

    await getAgenda('med-1');

    const { where, orderBy } = prisma.rendezVous.findMany.mock.calls[0][0];
    expect(where.idMedecin).toBe('med-1');
    expect(orderBy).toEqual({ prevuLe: 'asc' });
  });

  // Un rendez-vous annule ne dit plus rien de la journee.
  it('ecarte les rendez-vous annules', async () => {
    prisma.rendezVous.findMany.mockResolvedValue([]);
    await getAgenda('med-1');
    expect(prisma.rendezVous.findMany.mock.calls[0][0].where.statut).toEqual({ not: 'ANNULE' });
  });

  it('rend le patient et l heure d arrivee', async () => {
    prisma.rendezVous.findMany.mockResolvedValue([{ ...rdvRow, arriveeLe: new Date('2026-10-01T08:45:00Z') }]);

    const [r] = await getAgenda('med-1');

    expect(r!.patient).toEqual(expect.objectContaining({ prenom: 'Maomou', nom: 'Conde' }));
    expect(typeof r!.arriveeLe).toBe('string');
    expect(r!.numeroEpisode).toBe('EP-2026-000001');
  });
});

describe('changerStatutRendezVous', () => {
  it('refuse un rendez-vous qui n est pas le sien', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue(null);
    await expect(changerStatutRendezVous('med-9', 'rdv-1', 'TERMINE')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse d agir sur un rendez-vous annule', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({ id: 'rdv-1', statut: 'ANNULE' });
    await expect(changerStatutRendezVous('med-1', 'rdv-1', 'TERMINE')).rejects.toBeInstanceOf(ConflictError);
  });

  it('marque la consultation terminee', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({ id: 'rdv-1', statut: 'PRESENT' });
    prisma.rendezVous.update.mockResolvedValue({ ...rdvRow, statut: 'TERMINE' });

    const vue = await changerStatutRendezVous('med-1', 'rdv-1', 'TERMINE');

    expect(prisma.rendezVous.update.mock.calls[0][0].data).toEqual({ statut: 'TERMINE' });
    expect(vue.statut).toBe('TERMINE');
  });

  // L'accueil voit en direct que le medecin a appele le patient.
  it('diffuse l appel du patient a l accueil, en direct', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({ id: 'rdv-1', statut: 'PRESENT' });
    prisma.rendezVous.update.mockResolvedValue({ ...rdvRow, statut: 'EN_CONSULTATION' });

    await changerStatutRendezVous('med-1', 'rdv-1', 'EN_CONSULTATION');

    expect(diffuserRendezVous).toHaveBeenCalledWith('rdv-1');
  });
});

describe('presencesDuJour et pointerPresence — l assistante', () => {
  it('ne rend que les rendez-vous du jour, dans sa structure', async () => {
    prisma.rendezVous.findMany.mockResolvedValue([]);

    await presencesDuJour(agent);

    const { where, orderBy } = prisma.rendezVous.findMany.mock.calls[0][0];
    expect(where.episode).toEqual({ idStructure: 'struct-A' });
    expect(where.statut).toEqual({ not: 'ANNULE' });
    expect(where.prevuLe.gte).toBeInstanceOf(Date);
    expect(where.prevuLe.lte).toBeInstanceOf(Date);
    expect(orderBy).toEqual({ prevuLe: 'asc' });
  });

  it('refuse un rendez-vous d une autre structure', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue(null);
    await expect(pointerPresence(agent, 'rdv-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pointe l arrivee, la date, et qui a pointe', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({
      id: 'rdv-1', statut: 'PLANIFIE', idMedecin: 'med-1', idEpisode: 'ep-1',
      patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.rendezVous.updateMany.mockResolvedValue({ count: 1 });
    prisma.rendezVous.findUniqueOrThrow.mockResolvedValue({ ...rdvRow, statut: 'PRESENT', arriveeLe: new Date() });

    const vue = await pointerPresence(agent, 'rdv-1');

    const { where, data } = prisma.rendezVous.updateMany.mock.calls[0][0];
    // La condition interdit le double pointage.
    expect(where).toEqual({ id: 'rdv-1', statut: 'PLANIFIE' });
    expect(data.statut).toBe('PRESENT');
    expect(data.arriveeLe).toBeInstanceOf(Date);
    expect(data.idPointePar).toBe('agent-1');
    expect(vue.statut).toBe('PRESENT');
  });

  // Sans cette notification, l'assistante devrait aller prevenir le medecin
  // de vive voix — et le pointage ne servirait a rien.
  it('previent le medecin que son patient attend', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({
      id: 'rdv-1', statut: 'PLANIFIE', idMedecin: 'med-1', idEpisode: 'ep-1',
      patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.rendezVous.updateMany.mockResolvedValue({ count: 1 });
    prisma.rendezVous.findUniqueOrThrow.mockResolvedValue({ ...rdvRow, statut: 'PRESENT' });

    await pointerPresence(agent, 'rdv-1');

    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'med-1', lienAction: '/medecin/agenda',
    }));
  });

  it('refuse un second pointage', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({
      id: 'rdv-1', statut: 'PRESENT', idMedecin: 'med-1', idEpisode: 'ep-1',
      patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.rendezVous.updateMany.mockResolvedValue({ count: 0 });

    await expect(pointerPresence(agent, 'rdv-1')).rejects.toBeInstanceOf(ConflictError);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
    expect(diffuserRendezVous).not.toHaveBeenCalled();
  });

  // La file du medecin bouge des que l'accueil pointe, sans rechargement.
  it('met a jour en direct la file du medecin', async () => {
    prisma.rendezVous.findFirst.mockResolvedValue({
      id: 'rdv-1', statut: 'PLANIFIE', idMedecin: 'med-1', idEpisode: 'ep-1',
      patient: { utilisateur: { prenom: 'Maomou', nom: 'Conde' } },
    });
    prisma.rendezVous.updateMany.mockResolvedValue({ count: 1 });
    prisma.rendezVous.findUniqueOrThrow.mockResolvedValue({ ...rdvRow, statut: 'PRESENT' });

    await pointerPresence(agent, 'rdv-1');

    expect(diffuserRendezVous).toHaveBeenCalledWith('rdv-1');
  });
});
