// La file d'attente en direct : un pointage ou un appel part aux deux bouts.
//
// **Le defaut que ce fichier empeche de revenir.** Le medecin recevait une
// notification quand l'accueil pointait son patient, mais sa liste ne bougeait
// pas sans recharger ; et l'accueil ne voyait pas que le medecin avait appele
// le patient. Chaque changement d'un rendez-vous part desormais au medecin et
// aux agents d'accueil de la structure - et seulement a eux.
jest.mock('../src/config/prisma', () => ({
  prisma: {
    rendezVous: { findUnique: jest.fn() },
    utilisateur: { findMany: jest.fn() },
  },
}));
jest.mock('../src/realtime/socket.server', () => ({ emitToUser: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { diffuserRendezVous, EVENEMENT_RENDEZ_VOUS } from '../src/realtime/rendez-vous.events';

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { rendezVous: { findUnique: M }; utilisateur: { findMany: M } };
};
const { emitToUser } = jest.requireMock('../src/realtime/socket.server') as { emitToUser: M };
const { logger } = jest.requireMock('../src/config/logger') as { logger: { warn: M } };

const arrivee = new Date('2026-11-20T08:05:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.rendezVous.findUnique.mockResolvedValue({
    id: 'rdv-1', statut: 'PRESENT', arriveeLe: arrivee, idMedecin: 'med-1',
    episode: { idStructure: 'struct-A' },
  });
  prisma.utilisateur.findMany.mockResolvedValue([{ id: 'accueil-1' }, { id: 'accueil-2' }]);
});

describe('diffuser un rendez-vous', () => {
  it('previent le medecin et chaque agent d accueil de la structure', async () => {
    await diffuserRendezVous('rdv-1');

    const evenement = { idRendezVous: 'rdv-1', statut: 'PRESENT', arriveeLe: arrivee.toISOString() };
    expect(emitToUser).toHaveBeenCalledTimes(3);
    expect(emitToUser).toHaveBeenCalledWith('med-1', EVENEMENT_RENDEZ_VOUS, evenement);
    expect(emitToUser).toHaveBeenCalledWith('accueil-1', EVENEMENT_RENDEZ_VOUS, evenement);
    expect(emitToUser).toHaveBeenCalledWith('accueil-2', EVENEMENT_RENDEZ_VOUS, evenement);
  });

  // Rien de medical sur la socket : l'ecran relit par les routes habituelles,
  // qui verifient les droits.
  it('ne fait passer que des identifiants et un etat', async () => {
    await diffuserRendezVous('rdv-1');

    const charge = emitToUser.mock.calls[0]![2] as Record<string, unknown>;
    expect(Object.keys(charge).sort()).toEqual(['arriveeLe', 'idRendezVous', 'statut']);
  });

  it('ne cherche que l accueil de la structure du rendez-vous, et ses comptes actifs', async () => {
    await diffuserRendezVous('rdv-1');

    expect(prisma.utilisateur.findMany).toHaveBeenCalledWith({
      where: { idStructure: 'struct-A', role: 'AGENT_ACCUEIL', estActif: true },
      select: { id: true },
    });
  });

  it('previent une seule fois un medecin qui serait aussi compte d accueil', async () => {
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'med-1' }]);

    await diffuserRendezVous('rdv-1');

    expect(emitToUser).toHaveBeenCalledTimes(1);
  });

  it('previent l accueil meme sans medecin designe', async () => {
    prisma.rendezVous.findUnique.mockResolvedValue({
      id: 'rdv-1', statut: 'PRESENT', arriveeLe: null, idMedecin: null, episode: { idStructure: 'struct-A' },
    });

    await diffuserRendezVous('rdv-1');

    expect(emitToUser.mock.calls.map((c) => c[0])).toEqual(['accueil-1', 'accueil-2']);
  });

  // Le pointage est deja enregistre : une socket en panne ne doit pas le
  // faire passer pour rate.
  it('ne fait jamais echouer le geste qui l appelle', async () => {
    prisma.utilisateur.findMany.mockRejectedValue(new Error('base indisponible'));

    await expect(diffuserRendezVous('rdv-1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('ne dit rien d un rendez-vous introuvable', async () => {
    prisma.rendezVous.findUnique.mockResolvedValue(null);

    await diffuserRendezVous('rdv-x');

    expect(emitToUser).not.toHaveBeenCalled();
  });
});
