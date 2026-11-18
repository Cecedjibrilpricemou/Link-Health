// Changer de numero de telephone : le mot de passe prouve le titulaire, un
// code envoye au nouveau numero prouve qu'il le detient. L'ancien numero est
// averti, les autres sessions sont fermees.
jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn(), findFirst: jest.fn() },
    changementTelephone: { count: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn(), verifyPassword: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({ envoyerSms: jest.fn(), envoyerSmsSimule: jest.fn() }));
jest.mock('../src/utils/otp-developpement', () => ({ peutRenvoyerOtpEnClair: jest.fn() }));

import {
  confirmerChangementTelephone, demanderChangementTelephone, masquerTelephone, DEMANDES_PAR_HEURE,
} from '../src/services/telephone.service';
import { ConflictError, UnauthorizedError, ValidationError } from '../src/utils/app-error';

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findFirst: M };
    changementTelephone: { count: M; updateMany: M; create: M; update: M; findFirst: M };
    $transaction: M;
  };
};
const { hashPassword, verifyPassword } = jest.requireMock('../src/utils/password.utils') as { hashPassword: M; verifyPassword: M };
const { envoyerSms, envoyerSmsSimule } = jest.requireMock('../src/services/notification.service') as { envoyerSms: M; envoyerSmsSimule: M };
const { peutRenvoyerOtpEnClair } = jest.requireMock('../src/utils/otp-developpement') as { peutRenvoyerOtpEnClair: M };

const MAINTENANT = new Date('2026-11-12T10:00:00Z');
const MOI = { id: 'u1', telephone: '620100010', motDePasseHash: '$hash', estActif: true };
const DEMANDE = {
  id: 'd1', idUtilisateur: 'u1', nouveauTelephone: '620999999', codeHash: '$code',
  expireLe: new Date('2026-11-12T10:10:00Z'), tentatives: 0, maxTentatives: 5, utiliseLe: null,
};

let tx: { changementTelephone: { updateMany: M }; utilisateur: { update: M }; session: { deleteMany: M } };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.utilisateur.findUnique.mockResolvedValue(MOI);
  prisma.utilisateur.findFirst.mockResolvedValue(null);
  prisma.changementTelephone.count.mockResolvedValue(0);
  prisma.changementTelephone.create.mockResolvedValue({ id: 'd1' });
  hashPassword.mockResolvedValue('$code');
  verifyPassword.mockResolvedValue(true);
  envoyerSms.mockResolvedValue({});
  peutRenvoyerOtpEnClair.mockReturnValue(false);
  tx = {
    changementTelephone: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    utilisateur: { update: jest.fn().mockResolvedValue({}) },
    session: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
});

const demander = (dto: Partial<{ nouveauTelephone: string; motDePasse: string }> = {}) =>
  demanderChangementTelephone('u1', { nouveauTelephone: ' 620999999 ', motDePasse: 'secret', ...dto }, MAINTENANT);

describe('demander un changement de numero', () => {
  it('exige le mot de passe actuel, sans rien envoyer s il est faux', async () => {
    verifyPassword.mockResolvedValue(false);
    await expect(demander()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifyPassword).toHaveBeenCalledWith('secret', '$hash');
    expect(prisma.changementTelephone.create).not.toHaveBeenCalled();
    expect(envoyerSms).not.toHaveBeenCalled();
  });

  it('refuse le numero actuel, et un numero deja pris par un autre compte', async () => {
    await expect(demander({ nouveauTelephone: '620100010' })).rejects.toBeInstanceOf(ValidationError);
    prisma.utilisateur.findFirst.mockResolvedValue({ id: 'u-autre' });
    await expect(demander()).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.utilisateur.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { telephone: '620999999', NOT: { id: 'u1' } },
    }));
    expect(envoyerSms).not.toHaveBeenCalled();
  });

  it('limite les demandes pour qu on ne bombarde pas un numero de SMS', async () => {
    prisma.changementTelephone.count.mockResolvedValue(DEMANDES_PAR_HEURE);
    await expect(demander()).rejects.toMatchObject({ statusCode: 429 });
    expect(prisma.changementTelephone.count).toHaveBeenCalledWith({
      where: { idUtilisateur: 'u1', creeLe: { gte: new Date('2026-11-12T09:00:00Z') } },
    });
    expect(envoyerSms).not.toHaveBeenCalled();
  });

  it('envoie un code au nouveau numero, ne le garde que hache, et annule le precedent', async () => {
    const vue = await demander();

    expect(prisma.changementTelephone.updateMany).toHaveBeenCalledWith({
      where: { idUtilisateur: 'u1', utiliseLe: null }, data: { utiliseLe: MAINTENANT },
    });
    const code = hashPassword.mock.calls[0][0] as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(prisma.changementTelephone.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      idUtilisateur: 'u1', nouveauTelephone: '620999999', codeHash: '$code',
      expireLe: new Date('2026-11-12T10:10:00Z'),
    }) });
    expect(JSON.stringify(prisma.changementTelephone.create.mock.calls)).not.toContain(code);
    expect(envoyerSms).toHaveBeenCalledWith(expect.objectContaining({ telephone: '620999999' }));
    expect(envoyerSms.mock.calls[0][0].message).toContain(code);
    // Le code ne revient pas a l'ecran hors developpement.
    expect(vue).toEqual({ telephoneMasque: '•••••••99', expireDansMinutes: 10 });
  });

  it('ne rend le code a l ecran qu en developpement explicite', async () => {
    peutRenvoyerOtpEnClair.mockReturnValue(true);
    const vue = await demander();
    expect(vue.codeDeveloppement).toBe(hashPassword.mock.calls[0][0]);
  });

  it('annule un code qu on n a pas pu envoyer', async () => {
    envoyerSms.mockRejectedValue(new Error('operateur'));
    await expect(demander()).rejects.toMatchObject({ statusCode: 503 });
    expect(prisma.changementTelephone.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { utiliseLe: MAINTENANT } });
  });
});

describe('confirmer avec le code', () => {
  beforeEach(() => prisma.changementTelephone.findFirst.mockResolvedValue(DEMANDE));

  it('change le numero, ferme les autres sessions, et previent l ancien numero', async () => {
    const res = await confirmerChangementTelephone('u1', 'session-courante', { code: ' 123456 ' }, MAINTENANT);

    expect(verifyPassword).toHaveBeenCalledWith('123456', '$code');
    expect(tx.changementTelephone.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', utiliseLe: null }, data: { utiliseLe: MAINTENANT },
    });
    expect(tx.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { telephone: '620999999' } });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { idUtilisateur: 'u1', NOT: { id: 'session-courante' } } });
    expect(envoyerSmsSimule).toHaveBeenCalledWith('620100010', expect.stringContaining('•••••••99'));
    expect(res).toEqual({ telephone: '620999999' });
  });

  it('compte les essais faux et brule la demande au dernier', async () => {
    verifyPassword.mockResolvedValue(false);
    await expect(confirmerChangementTelephone('u1', 's', { code: '000000' }, MAINTENANT)).rejects.toThrow('4 tentative');
    expect(prisma.changementTelephone.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { tentatives: 1 } });

    prisma.changementTelephone.findFirst.mockResolvedValue({ ...DEMANDE, tentatives: 4 });
    await expect(confirmerChangementTelephone('u1', 's', { code: '000000' }, MAINTENANT)).rejects.toThrow('maximum');
    expect(prisma.changementTelephone.update).toHaveBeenLastCalledWith({
      where: { id: 'd1' }, data: { tentatives: 5, utiliseLe: MAINTENANT },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse un code expire, ou sans demande en cours', async () => {
    prisma.changementTelephone.findFirst.mockResolvedValue({ ...DEMANDE, expireLe: new Date('2026-11-12T09:59:59Z') });
    await expect(confirmerChangementTelephone('u1', 's', { code: '123456' }, MAINTENANT)).rejects.toThrow('expire');
    prisma.changementTelephone.findFirst.mockResolvedValue(null);
    await expect(confirmerChangementTelephone('u1', 's', { code: '123456' }, MAINTENANT)).rejects.toThrow('Aucune demande');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ne change rien deux fois si le meme code arrive deux fois', async () => {
    tx.changementTelephone.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmerChangementTelephone('u1', 's', { code: '123456' }, MAINTENANT)).rejects.toThrow('deja ete utilise');
    expect(tx.utilisateur.update).not.toHaveBeenCalled();
    expect(envoyerSmsSimule).not.toHaveBeenCalled();
  });

  it('dit que le numero est pris s il l a ete entre-temps', async () => {
    tx.utilisateur.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(confirmerChangementTelephone('u1', 's', { code: '123456' }, MAINTENANT)).rejects.toBeInstanceOf(ConflictError);
    expect(envoyerSmsSimule).not.toHaveBeenCalled();
  });
});

describe('masquerTelephone', () => {
  it('ne laisse voir que les deux derniers chiffres', () => {
    expect(masquerTelephone('620999999')).toBe('•••••••99');
    expect(masquerTelephone('1')).toBe('••');
  });
});
