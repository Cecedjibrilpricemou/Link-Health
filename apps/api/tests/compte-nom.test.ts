// Le nom d'un professionnel. Une fois son numero d'ordre verifie, il figure
// sur ce qu'il signe : il ne le change plus seul, l'administration le corrige
// avec un motif, et le journal garde l'avant et l'apres.
jest.mock('../src/config/prisma', () => ({
  prisma: { utilisateur: { findUnique: jest.fn() }, $transaction: jest.fn() },
}));
jest.mock('../src/realtime/socket.server', () => ({ deconnecterUtilisateur: jest.fn() }));

import { assertNomModifiableParLeProfessionnel, corrigerNom } from '../src/services/compte.service';
import { ForbiddenError, NotFoundError } from '../src/utils/app-error';

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { utilisateur: { findUnique: M }; $transaction: M };
};

const ADMIN = { userId: 'admin-1', role: 'ADMIN_NATIONAL' as const };
const MOTIF = "Faute de frappe a la creation, carte de l'ordre presentee";
const MAINTENANT = new Date('2026-11-12T11:00:00Z');
const MEDECIN = {
  id: 'med-1', prenom: 'Mamadou', nom: 'Dialo', email: 'm@example.org', telephone: '620', role: 'MEDECIN',
  numeroOrdre: 'GN-123', ordreVerifieLe: new Date('2026-10-01T00:00:00Z'),
  estActif: true, suspenduLe: null, motifSuspension: null, derniereConnexion: null, suspenduPar: null, structure: null,
};

let tx: { utilisateur: { update: M }; journalAudit: { create: M } };

beforeEach(() => {
  jest.resetAllMocks();
  tx = {
    utilisateur: { update: jest.fn().mockImplementation(async ({ data }) => ({ ...MEDECIN, ...data })) },
    journalAudit: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
});

describe('le professionnel et son propre nom', () => {
  it('le fige une fois son ordre verifie', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(MEDECIN);
    await expect(assertNomModifiableParLeProfessionnel('med-1', { nom: 'Diallo' }))
      .rejects.toThrow("adressez-vous a l'administration");
  });

  it('laisse passer le meme nom renvoye avec le formulaire', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(MEDECIN);
    await expect(assertNomModifiableParLeProfessionnel('med-1', { prenom: 'Mamadou', nom: 'Dialo' })).resolves.toBeUndefined();
  });

  it('le laisse libre tant que l ordre n est pas verifie', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...MEDECIN, ordreVerifieLe: null });
    await expect(assertNomModifiableParLeProfessionnel('med-1', { nom: 'Diallo' })).resolves.toBeUndefined();
  });

  it('ne concerne pas les roles sans ordre', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...MEDECIN, role: 'AGENT_ACCUEIL' });
    await expect(assertNomModifiableParLeProfessionnel('u', { nom: 'Diallo' })).resolves.toBeUndefined();
  });
});

describe('l administration corrige le nom', () => {
  beforeEach(() => prisma.utilisateur.findUnique.mockResolvedValue(MEDECIN));

  it('corrige, et le journal garde l avant, l apres, le motif et l auteur', async () => {
    const vue = await corrigerNom(ADMIN, 'med-1', { nom: ' Diallo ', motif: MOTIF }, MAINTENANT);

    expect(tx.utilisateur.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'med-1' }, data: { prenom: 'Mamadou', nom: 'Diallo' },
    }));
    expect(tx.journalAudit.create).toHaveBeenCalledWith({ data: {
      action: 'CORRECTION_NOM', ressource: 'utilisateurs', idRessource: 'med-1', idUtilisateur: 'admin-1', creeLe: MAINTENANT,
      metadonnees: { avant: { prenom: 'Mamadou', nom: 'Dialo' }, apres: { prenom: 'Mamadou', nom: 'Diallo' }, motif: MOTIF },
    } });
    expect(vue).toMatchObject({
      nom: 'Diallo', soumisOrdre: true, numeroOrdre: 'GN-123', ordreVerifieLe: '2026-10-01T00:00:00.000Z',
    });
  });

  it('exige un motif, et un vrai changement', async () => {
    await expect(corrigerNom(ADMIN, 'med-1', { nom: 'Diallo', motif: 'faute' }, MAINTENANT)).rejects.toThrow('motif est exige');
    await expect(corrigerNom(ADMIN, 'med-1', { nom: 'Dialo', motif: MOTIF }, MAINTENANT)).rejects.toThrow('Aucun changement');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('renvoie les patients vers l ecran Identites', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...MEDECIN, role: 'PATIENT' });
    await expect(corrigerNom(ADMIN, 'p', { nom: 'Diallo', motif: MOTIF }, MAINTENANT)).rejects.toThrow('Identites');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ne laisse qu un super administrateur corriger un super administrateur', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...MEDECIN, role: 'SUPER_ADMIN' });
    await expect(corrigerNom(ADMIN, 'sa', { nom: 'Diallo', motif: MOTIF }, MAINTENANT)).rejects.toBeInstanceOf(ForbiddenError);
    await corrigerNom({ userId: 'sa-2', role: 'SUPER_ADMIN' }, 'sa', { nom: 'Diallo', motif: MOTIF }, MAINTENANT);
    expect(tx.utilisateur.update).toHaveBeenCalledTimes(1);
  });

  it('refuse un compte inconnu', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(null);
    await expect(corrigerNom(ADMIN, 'x', { nom: 'Diallo', motif: MOTIF }, MAINTENANT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('dit dans la liste qui attend la verification de son ordre', async () => {
    const enAttente = { ...MEDECIN, ordreVerifieLe: null, numeroOrdre: null };
    prisma.utilisateur.findUnique.mockResolvedValue(enAttente);
    tx.utilisateur.update.mockImplementation(async ({ data }) => ({ ...enAttente, ...data }));
    const vue = await corrigerNom(ADMIN, 'med-1', { nom: 'Diallo', motif: MOTIF }, MAINTENANT);
    expect(vue).toMatchObject({ soumisOrdre: true, numeroOrdre: null, ordreVerifieLe: null });
  });
});
