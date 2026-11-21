// Les services d'un etablissement : declares par l'administrateur, proposes a
// l'accueil, avec leurs medecins.
import {
  creerService,
  exigerServiceOuvert,
  listerServices,
  modifierService,
  nomServiceNet,
  servicesOuverts,
} from '../src/services/services-hospitaliers.service';
import { creerAgent, modifierProfilAgent } from '../src/services/admin-structure.service';
import { creerServiceSchema, modifierServiceSchema, modifierProfilAgentSchema } from '../src/validators/api.schemas';
import { Prisma } from '../src/config/generated/client/client';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    serviceHospitalier: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    medecinProfile: { create: jest.fn(), update: jest.fn() },
    ascProfile: { create: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn().mockResolvedValue('$hash') }));
jest.mock('../src/services/email.service', () => ({
  envoyerEmailAgent: jest.fn(), envoyerEmailAdminStructure: jest.fn(), envoyerReinitialisationAgent: jest.fn(),
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; create: M; update: M };
    serviceHospitalier: { findMany: M; findFirst: M; create: M; update: M };
    medecinProfile: { create: M; update: M };
    $transaction: M;
  };
};

const ADMIN_CHU = { role: 'ADMIN_STRUCTURE', idStructure: 'st-1', structure: { nom: 'CHU Donka', type: 'CHU' } };
const ligne = (o: Record<string, unknown> = {}) => ({ id: 'sv-1', nom: 'Pédiatrie', actif: true, _count: { medecins: 2 }, ...o });
const doublon = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

function lire(admin: unknown, agent?: unknown) {
  prisma.utilisateur.findUnique.mockImplementation((q: { where: { id?: string } }) => {
    if (q.where.id === 'admin') return Promise.resolve(admin);
    if (q.where.id) return Promise.resolve(agent ?? null);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
});

describe('nomServiceNet', () => {
  it('resserre les espaces et met une majuscule initiale', () => {
    expect(nomServiceNet('  médecine   interne ')).toBe('Médecine interne');
    expect(nomServiceNet('ORL')).toBe('ORL');
  });
  it('refuse un nom vide ou trop long', () => {
    expect(() => nomServiceNet(' a ')).toThrow(ValidationError);
    expect(() => nomServiceNet('x'.repeat(81))).toThrow(ValidationError);
  });
});

describe('l administrateur declare ses services', () => {
  it('liste ceux de sa structure, ouverts d abord, avec leurs medecins', async () => {
    lire(ADMIN_CHU);
    prisma.serviceHospitalier.findMany.mockResolvedValue([ligne(), ligne({ id: 'sv-2', nom: 'Ancien', actif: false, _count: { medecins: 0 } })]);
    const s = await listerServices('admin');
    expect(prisma.serviceHospitalier.findMany.mock.calls[0][0].where).toEqual({ idStructure: 'st-1' });
    expect(prisma.serviceHospitalier.findMany.mock.calls[0][0].orderBy).toEqual([{ actif: 'desc' }, { nom: 'asc' }]);
    expect(s[0]).toEqual({ id: 'sv-1', nom: 'Pédiatrie', actif: true, nbMedecins: 2 });
  });

  it('cree un service au nom propre ; un doublon est dit', async () => {
    lire(ADMIN_CHU);
    prisma.serviceHospitalier.findFirst.mockResolvedValue(null);
    prisma.serviceHospitalier.create.mockResolvedValue(ligne({ nom: 'Urgences', _count: { medecins: 0 } }));
    await creerService('admin', '  urgences ');
    expect(prisma.serviceHospitalier.create.mock.calls[0][0].data).toEqual({ idStructure: 'st-1', nom: 'Urgences' });

    prisma.serviceHospitalier.create.mockRejectedValue(doublon());
    const e = await creerService('admin', 'Urgences').catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.message).toContain('Urgences');
  });

  it('a la casse pres, un meme nom est un doublon', async () => {
    lire(ADMIN_CHU);
    prisma.serviceHospitalier.findFirst.mockResolvedValue({ id: 'sv-1' });
    await expect(creerService('admin', 'PÉDIATRIE')).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.serviceHospitalier.findFirst.mock.calls[0][0].where).toEqual({
      idStructure: 'st-1', nom: { equals: 'PÉDIATRIE', mode: 'insensitive' },
    });
    expect(prisma.serviceHospitalier.create).not.toHaveBeenCalled();
  });

  it('renommer vers le nom d un autre service est refuse ; garder le sien, non', async () => {
    lire(ADMIN_CHU);
    prisma.serviceHospitalier.findFirst
      .mockResolvedValueOnce({ id: 'sv-1' })      // le service existe dans la structure
      .mockResolvedValueOnce({ id: 'sv-2' });     // un autre porte deja ce nom
    await expect(modifierService('admin', 'sv-1', { nom: 'urgences' })).rejects.toBeInstanceOf(ConflictError);

    prisma.serviceHospitalier.findFirst.mockReset();
    prisma.serviceHospitalier.findFirst.mockResolvedValueOnce({ id: 'sv-1' }).mockResolvedValueOnce(null);
    prisma.serviceHospitalier.update.mockResolvedValue(ligne());
    await modifierService('admin', 'sv-1', { nom: 'pédiatrie' });
    expect(prisma.serviceHospitalier.findFirst.mock.calls[1][0].where.NOT).toEqual({ id: 'sv-1' });
  });

  it('renomme et ferme un service de sa structure seulement', async () => {
    lire(ADMIN_CHU);
    prisma.serviceHospitalier.findFirst.mockResolvedValueOnce({ id: 'sv-1' }).mockResolvedValueOnce(null);
    prisma.serviceHospitalier.update.mockResolvedValue(ligne({ actif: false }));
    await modifierService('admin', 'sv-1', { actif: false, nom: 'pédiatrie générale' });
    expect(prisma.serviceHospitalier.findFirst.mock.calls[0][0].where).toEqual({ id: 'sv-1', idStructure: 'st-1' });
    expect(prisma.serviceHospitalier.update.mock.calls[0][0].data).toEqual({ actif: false, nom: 'Pédiatrie générale' });

    prisma.serviceHospitalier.findFirst.mockResolvedValue(null);
    await expect(modifierService('admin', 'ailleurs', { actif: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pas de services pour un laboratoire, une pharmacie, ni pour qui n est pas administrateur', async () => {
    lire({ ...ADMIN_CHU, structure: { nom: 'Labo', type: 'LABORATOIRE' } });
    await expect(listerServices('admin')).rejects.toBeInstanceOf(ForbiddenError);
    lire({ ...ADMIN_CHU, role: 'MEDECIN' });
    await expect(creerService('admin', 'Urgences')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.serviceHospitalier.create).not.toHaveBeenCalled();
  });

  it('le schema refuse un envoi vide ou un champ inconnu', () => {
    expect(creerServiceSchema.safeParse({ nom: 'x' }).success).toBe(false);
    expect(modifierServiceSchema.safeParse({}).success).toBe(false);
    expect(modifierServiceSchema.safeParse({ actif: false, idStructure: 'x' }).success).toBe(false);
  });
});

describe('l accueil voit les services ouverts', () => {
  it('ouverts seulement, par ordre alphabetique', async () => {
    prisma.serviceHospitalier.findMany.mockResolvedValue([ligne()]);
    await servicesOuverts('st-1');
    expect(prisma.serviceHospitalier.findMany.mock.calls[0][0].where).toEqual({ idStructure: 'st-1', actif: true });
  });
});

describe('le service d un medecin', () => {
  const MEDECIN = { id: 'ag-1', idStructure: 'st-1', role: 'MEDECIN', prenom: 'A', nom: 'B', email: null, numeroOrdre: null, estActif: true };

  it('un service ouvert de la structure, ou un refus', async () => {
    prisma.serviceHospitalier.findFirst.mockResolvedValue({ id: 'sv-1' });
    await expect(exigerServiceOuvert('st-1', 'sv-1')).resolves.toBeUndefined();
    expect(prisma.serviceHospitalier.findFirst.mock.calls[0][0].where).toEqual({ id: 'sv-1', idStructure: 'st-1', actif: true });
    prisma.serviceHospitalier.findFirst.mockResolvedValue(null);
    await expect(exigerServiceOuvert('st-1', 'ferme')).rejects.toBeInstanceOf(ValidationError);
  });

  it('se choisit a la creation du compte', async () => {
    lire(ADMIN_CHU);
    prisma.serviceHospitalier.findFirst.mockResolvedValue({ id: 'sv-1' });
    prisma.utilisateur.create.mockResolvedValue({ id: 'n', telephone: '1', prenom: 'A', nom: 'B', role: 'MEDECIN' });
    await creerAgent('admin', { telephone: '620', email: 'a@x.test', prenom: 'A', nom: 'B', role: 'MEDECIN' as never, idService: 'sv-1' });
    expect(prisma.medecinProfile.create.mock.calls[0][0].data).toMatchObject({ idService: 'sv-1' });
  });

  it('se change, ou se detache, depuis la fiche', async () => {
    lire(ADMIN_CHU, MEDECIN);
    prisma.serviceHospitalier.findFirst.mockResolvedValue({ id: 'sv-2' });
    await modifierProfilAgent('admin', 'ag-1', { idService: 'sv-2' });
    expect(prisma.medecinProfile.update).toHaveBeenCalledWith({ where: { idUtilisateur: 'ag-1' }, data: { idService: 'sv-2' } });

    prisma.medecinProfile.update.mockClear();
    await modifierProfilAgent('admin', 'ag-1', { idService: null });
    expect(prisma.medecinProfile.update).toHaveBeenCalledWith({ where: { idUtilisateur: 'ag-1' }, data: { idService: null } });
  });

  it('refuse un service ferme ou d ailleurs, sans rien ecrire', async () => {
    lire(ADMIN_CHU, MEDECIN);
    prisma.serviceHospitalier.findFirst.mockResolvedValue(null);
    await expect(modifierProfilAgent('admin', 'ag-1', { idService: 'ferme' })).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.medecinProfile.update).not.toHaveBeenCalled();
  });

  it('le schema accepte un service seul', () => {
    expect(modifierProfilAgentSchema.safeParse({ idService: 'sv-1' }).success).toBe(true);
    expect(modifierProfilAgentSchema.safeParse({ idService: null }).success).toBe(true);
  });
});
