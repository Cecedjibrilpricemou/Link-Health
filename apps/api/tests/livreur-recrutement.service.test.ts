import { creerLivreur, definirActiviteLivreur, listerLivreurs } from '../src/services/livreur-recrutement.service';
import { notifierLivreursCourse } from '../src/services/course.service';
import type { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError } from '../src/utils/app-error';
import { Role } from '../src/config/generated/client/client';
import { notifierSansBloquer } from '../src/services/notification.service';
import { hashPassword } from '../src/utils/password.utils';
import { genererMotDePasseTemp } from '../src/services/admin-structure.service';
import { filtreZone } from '../src/utils/zone';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    livreurProfile: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    course: { count: jest.fn(), findUnique: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});

jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn().mockResolvedValue('password-hash') }));
jest.mock('../src/services/admin-structure.service', () => ({
  genererMotDePasseTemp: jest.fn().mockReturnValue('BaoBao@Demo123'),
}));
jest.mock('../src/services/notification.service', () => ({
  notifierSansBloquer: jest.fn().mockResolvedValue(undefined),
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { create: M; findUnique: M; findMany: M };
    livreurProfile: { create: M; findUnique: M; findMany: M; update: M };
    course: { count: M; findUnique: M };
    $transaction: M;
  };
};

const admin: JwtPayload = { userId: 'admin-1', role: Role.ADMIN_REGIONAL, sessionId: 'session-1' };
const patient: JwtPayload = { userId: 'patient-1', role: Role.PATIENT, sessionId: 'session-2' };
const dto = {
  prenom: 'Mamadou',
  nom: 'Diallo',
  telephone: '620100099',
  quartier: 'Donka',
  prefecture: 'Conakry',
  commune: 'Dixinn',
};

beforeEach(() => {
  jest.resetAllMocks();
  (hashPassword as jest.Mock).mockResolvedValue('password-hash');
  (genererMotDePasseTemp as jest.Mock).mockReturnValue('BaoBao@Demo123');
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  prisma.utilisateur.findUnique.mockResolvedValue(null);
  prisma.utilisateur.create.mockResolvedValue({
    id: 'user-created',
    prenom: dto.prenom,
    nom: dto.nom,
    telephone: dto.telephone,
    creeLe: new Date('2026-10-24T00:00:00Z'),
  });
  prisma.livreurProfile.create.mockResolvedValue({});
  prisma.livreurProfile.findUnique.mockResolvedValue({
    id: 'profile-1',
    estActif: true,
  });
  prisma.livreurProfile.update.mockResolvedValue({});
  prisma.course.count.mockResolvedValue(0);
  prisma.course.findUnique.mockResolvedValue({
    numero: 'LV-2026-000001',
    quartier: dto.quartier,
    prefecture: dto.prefecture,
    commune: dto.commune,
  });
  prisma.livreurProfile.findMany.mockResolvedValue([]);
  (notifierSansBloquer as jest.Mock).mockResolvedValue(undefined);
});

describe('recrutement des livreurs', () => {
  it('cree le compte et son profil dans la meme transaction', async () => {
    const user = {
      id: 'user-1', prenom: dto.prenom, nom: dto.nom, telephone: dto.telephone,
      creeLe: new Date('2026-10-24T00:00:00Z'),
    };
    prisma.utilisateur.create.mockResolvedValue(user);
    prisma.livreurProfile.create.mockResolvedValue({});

    const result = await creerLivreur(admin, dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.utilisateur.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: Role.LIVREUR,
        idStructure: null,
        doitChangerMotDePasse: true,
        motDePasseHash: 'password-hash',
      }),
    }));
    expect(prisma.livreurProfile.create).toHaveBeenCalledWith({
      data: {
        idUtilisateur: 'user-1',
        quartier: dto.quartier,
        prefecture: dto.prefecture,
        commune: dto.commune,
      },
    });
    expect(result.livreur).toEqual(expect.objectContaining({
      id: 'user-1',
      quartier: dto.quartier,
      prefecture: dto.prefecture,
      commune: dto.commune,
      estActif: true,
    }));
    expect(result).not.toHaveProperty('livreur.qrCode');
    expect(result.motDePasseTemporaire).toBe('BaoBao@Demo123');
  });

  it('enregistre une commune vide comme absente', async () => {
    prisma.utilisateur.create.mockResolvedValue({
      id: 'user-1', prenom: dto.prenom, nom: dto.nom, telephone: dto.telephone,
      creeLe: new Date('2026-10-24T00:00:00Z'),
    });

    await creerLivreur(admin, { ...dto, commune: '   ' });

    expect(prisma.livreurProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commune: null }),
    });
  });

  it('annule la creation du compte si la creation du profil echoue', async () => {
    const utilisateursPersistes: { id: string }[] = [];
    prisma.utilisateur.create.mockImplementation(async () => {
      const user = { id: 'user-a-annuler' };
      utilisateursPersistes.push(user);
      return {
        ...user, prenom: dto.prenom, nom: dto.nom, telephone: dto.telephone,
        creeLe: new Date('2026-10-24T00:00:00Z'),
      };
    });
    prisma.livreurProfile.create.mockRejectedValue(new Error('echec profil'));
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tailleInitiale = utilisateursPersistes.length;
      try {
        return await fn(prisma);
      } catch (error) {
        utilisateursPersistes.splice(tailleInitiale);
        throw error;
      }
    });

    await expect(creerLivreur(admin, dto)).rejects.toThrow('echec profil');
    expect(utilisateursPersistes).toEqual([]);
  });

  it('refuse un role non autorise avant toute ecriture', async () => {
    await expect(creerLivreur(patient, dto)).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.utilisateur.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse proprement un numero de telephone deja utilise', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(creerLivreur(admin, dto)).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('n envoie pas de notification aux livreurs inactifs', async () => {
    await notifierLivreursCourse('course-1');

    expect(prisma.livreurProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        estActif: true,
        ...filtreZone(dto),
        utilisateur: { role: Role.LIVREUR, estActif: true },
      }),
    }));
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  it('refuse de desactiver un livreur tant qu une course lui est attribuee ou en cours', async () => {
    prisma.course.count.mockResolvedValue(1);
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 'user-1',
      prenom: dto.prenom,
      nom: dto.nom,
      telephone: dto.telephone,
      creeLe: new Date('2026-10-24T00:00:00Z'),
      livreurProfile: { quartier: dto.quartier, prefecture: dto.prefecture, estActif: false },
    });

    await expect(definirActiviteLivreur(admin, 'user-1', false))
      .rejects.toBeInstanceOf(ConflictError);
    expect(prisma.course.count).toHaveBeenCalledWith({
      where: {
        idLivreur: 'profile-1',
        statut: { in: ['ATTRIBUEE', 'EN_COURS'] },
      },
    });
    expect(prisma.livreurProfile.update).not.toHaveBeenCalled();
  });

  it('ne publie pas de QR code dans la liste administrative', async () => {
    prisma.utilisateur.findMany.mockResolvedValue([{
      id: 'user-1',
      prenom: dto.prenom,
      nom: dto.nom,
      telephone: dto.telephone,
      creeLe: new Date('2026-10-24T00:00:00Z'),
      livreurProfile: {
        quartier: dto.quartier,
        prefecture: dto.prefecture,
        estActif: true,
      },
    }]);

    const result = await listerLivreurs(admin);

    expect(JSON.stringify(result)).not.toContain('qrCode');
    expect(prisma.utilisateur.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        livreurProfile: { select: { quartier: true, prefecture: true, commune: true, estActif: true } },
      }),
    }));
  });
});
