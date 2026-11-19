import { creerLivreur, definirActiviteLivreur, listerLivreurs } from '../src/services/livreur-recrutement.service';
import { notifierLivreursCourse } from '../src/services/course.service';
import type { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError } from '../src/utils/app-error';
import { Role } from '../src/config/generated/client/client';
import { notifierSansBloquer } from '../src/services/notification.service';
import { hashPassword } from '../src/utils/password.utils';
import { genererMotDePasseTemp } from '../src/services/admin-structure.service';
import { filtreZone } from '../src/utils/zone';
import { creerAvecDossier } from '../src/services/candidature-livreur.service';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    livreurProfile: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    course: { count: jest.fn(), findUnique: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});

// La creation passe desormais par le dossier du livreur, eprouve dans sa
// propre suite (candidature-livreur.service.test.ts). Ici, seule compte la
// porte : qu'elle verifie le role, transmette les pieces et rende la vue.
jest.mock('../src/services/candidature-livreur.service', () => ({
  ...jest.requireActual('../src/services/candidature-livreur.service'),
  creerAvecDossier: jest.fn(),
}));
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
  // **La regle a change** : la creation exige desormais les six pieces du
  // dossier, comme le depot public. Les anciens tests de cette porte
  // (transaction, commune vide, telephone pris) eprouvent maintenant le vrai
  // code dans candidature-livreur.service.test.ts.
  const dossierDto = { ...dto, dateNaissance: '1995-04-12', sexe: 'M' as const };
  const fichiers = [{ fieldname: 'CNI_RECTO', buffer: Buffer.from('%PDF-1.4') }];

  it('cree le livreur par son dossier et rend sa vue, sans QR', async () => {
    (creerAvecDossier as jest.Mock).mockResolvedValue({
      idUtilisateur: 'user-1', numero: 'DL-2026-0001', motDePasseTemporaire: null,
    });
    prisma.utilisateur.findUnique.mockResolvedValue({
      id: 'user-1', prenom: dto.prenom, nom: dto.nom, telephone: dto.telephone,
      creeLe: new Date('2026-10-24T00:00:00Z'),
      livreurProfile: { quartier: dto.quartier, prefecture: dto.prefecture, commune: dto.commune, estActif: true },
    });

    const result = await creerLivreur(admin, dossierDto, fichiers);

    expect(creerAvecDossier).toHaveBeenCalledWith(admin, dossierDto, fichiers);
    expect(result.livreur).toEqual(expect.objectContaining({
      id: 'user-1', quartier: dto.quartier, commune: dto.commune, estActif: true,
    }));
    expect(result).not.toHaveProperty('livreur.qrCode');
    expect(result.numeroDossier).toBe('DL-2026-0001');
    // Parti par courriel : l'agent ne le voit pas.
    expect(result.motDePasseTemporaire).toBeNull();
  });

  it('refuse un role non autorise avant toute ecriture', async () => {
    await expect(creerLivreur(patient, dossierDto, fichiers)).rejects.toBeInstanceOf(ForbiddenError);
    expect(creerAvecDossier).not.toHaveBeenCalled();
    expect(prisma.utilisateur.create).not.toHaveBeenCalled();
  });

  it('n envoie pas de notification aux livreurs inactifs', async () => {
    await notifierLivreursCourse('course-1');

    expect(prisma.livreurProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        estActif: true,
        enService: true,
        OR: [
          filtreZone(dto),
          { AND: [
            { prefecture: { equals: dto.prefecture, mode: 'insensitive' } },
            { communesDesservies: { has: dto.commune } },
          ] },
        ],
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
