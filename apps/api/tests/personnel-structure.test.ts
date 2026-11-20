// Le personnel d'une structure : les metiers, le profil d'un medecin, et les
// gestes de l'administrateur sur un compte (reactiver, reinitialiser).
import {
  creerAgent,
  getAgentsStructure,
  modifierProfilAgent,
  reactiverAgent,
  reinitialiserMotDePasseAgent,
  rolesCreablesPour,
} from '../src/services/admin-structure.service';
import { normaliserSpecialite } from '../src/utils/specialite.util';
import { createAgentStructureSchema, modifierProfilAgentSchema } from '../src/validators/api.schemas';
import { ConflictError, ForbiddenError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    medecinProfile: { create: jest.fn(), update: jest.fn() },
    ascProfile: { create: jest.fn() },
    session: { deleteMany: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]));
  return { prisma };
});
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn().mockResolvedValue('$hash') }));
jest.mock('../src/services/email.service', () => ({
  envoyerEmailAgent: jest.fn(), envoyerEmailAdminStructure: jest.fn(), envoyerReinitialisationAgent: jest.fn(),
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findMany: M; create: M; update: M };
    medecinProfile: { create: M; update: M };
    ascProfile: { create: M };
    session: { deleteMany: M };
    $transaction: M;
  };
};
const email = jest.requireMock('../src/services/email.service') as { envoyerEmailAgent: M; envoyerReinitialisationAgent: M };

const ADMIN = { idStructure: 'st-1', structure: { nom: 'CHU Donka', type: 'CHU' } };
const base = { telephone: '620000111', email: 'dr.bah@chu.test', prenom: 'Alpha', nom: 'Bah' };

/** L'admin, puis (pour les gestes sur un compte) l'agent vise. */
function lire(admin: unknown, agent?: unknown) {
  prisma.utilisateur.findUnique.mockImplementation((q: { where: { id?: string; telephone?: string; email?: string } }) => {
    if (q.where.id === 'admin') return Promise.resolve(admin);
    if (q.where.id) return Promise.resolve(agent ?? null);
    return Promise.resolve(null); // telephone, email : libres
  });
}

const agent = (o: Record<string, unknown> = {}) => ({
  id: 'ag-1', idStructure: 'st-1', role: 'MEDECIN', prenom: 'Alpha', nom: 'Bah',
  email: 'dr.bah@chu.test', numeroOrdre: 'GN-123', estActif: true, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.utilisateur.create.mockResolvedValue({ id: 'nouveau', telephone: base.telephone, prenom: 'Alpha', nom: 'Bah', role: 'MEDECIN' });
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]));
});

describe('rolesCreablesPour — les metiers selon la structure', () => {
  it('hopitaux, CHU, cliniques : medecins, accueil, laboratoire ; pas d agents communautaires', () => {
    for (const t of ['HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'] as const) {
      expect(rolesCreablesPour(t)).toEqual(['MEDECIN', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO']);
    }
  });
  it('centre et poste : les agents communautaires aussi ; le poste sans laboratoire', () => {
    expect(rolesCreablesPour('CENTRE')).toContain('ASC');
    expect(rolesCreablesPour('CENTRE')).toContain('TECHNICIEN_LABO');
    expect(rolesCreablesPour('POSTE')).not.toContain('TECHNICIEN_LABO');
  });
  it('un laboratoire : ses techniciens ; pharmacie et assurance : personne', () => {
    expect(rolesCreablesPour('LABORATOIRE')).toEqual(['TECHNICIEN_LABO']);
    expect(rolesCreablesPour('PHARMACIE')).toEqual([]);
    expect(rolesCreablesPour('ASSURANCE')).toEqual([]);
  });
});

describe('la creation d un compte', () => {
  it('un medecin sans specialite precisee est generaliste', async () => {
    lire(ADMIN);
    await creerAgent('admin', { ...base, role: 'MEDECIN' as never });
    expect(prisma.medecinProfile.create.mock.calls[0][0].data).toMatchObject({ specialite: 'MEDECINE_GENERALE' });
  });

  it('un chirurgien-dentiste : un medecin de specialite dentaire, avec son numero d ordre', async () => {
    lire(ADMIN);
    await creerAgent('admin', { ...base, role: 'MEDECIN' as never, specialite: 'DENTAIRE', numeroOrdre: '  gn-dent  0042 ' });
    expect(prisma.medecinProfile.create.mock.calls[0][0].data).toMatchObject({ specialite: 'DENTAIRE' });
    expect(prisma.utilisateur.create.mock.calls[0][0].data).toMatchObject({ numeroOrdre: 'GN-DENT 0042' });
  });

  it('le numero d ordre ne vaut que pour un medecin', async () => {
    lire(ADMIN);
    await creerAgent('admin', { ...base, role: 'AGENT_ACCUEIL' as never, numeroOrdre: 'X-1' });
    expect(prisma.utilisateur.create.mock.calls[0][0].data.numeroOrdre).toBeNull();
    expect(prisma.medecinProfile.create).not.toHaveBeenCalled();
  });

  it('refuse un metier absent de la structure : un agent communautaire au CHU, un medecin au laboratoire', async () => {
    lire(ADMIN);
    await expect(creerAgent('admin', { ...base, role: 'ASC' as never })).rejects.toBeInstanceOf(ForbiddenError);
    lire({ idStructure: 'lab', structure: { nom: 'Labo', type: 'LABORATOIRE' } });
    await expect(creerAgent('admin', { ...base, role: 'MEDECIN' as never })).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.utilisateur.create).not.toHaveBeenCalled();
  });

  it('le schema ne laisse plus passer un pharmacien, ni une specialite inventee', () => {
    expect(createAgentStructureSchema.safeParse({ ...base, role: 'PHARMACIEN' }).success).toBe(false);
    expect(createAgentStructureSchema.safeParse({ ...base, role: 'MEDECIN', specialite: 'SORCELLERIE' }).success).toBe(false);
    expect(createAgentStructureSchema.safeParse({ ...base, role: 'MEDECIN', specialite: 'PEDIATRIE', numeroOrdre: 'GN/2024-17' }).success).toBe(true);
    expect(createAgentStructureSchema.safeParse({ ...base, role: 'MEDECIN', numeroOrdre: '<script>' }).success).toBe(false);
  });
});

describe('la liste du personnel', () => {
  it('garde les comptes desactives, apres les autres, avec metier et verification', async () => {
    lire(ADMIN);
    prisma.utilisateur.findMany.mockResolvedValue([
      { id: 'a', estActif: true, numeroOrdre: 'GN-1', ordreVerifieLe: new Date(), medecinProfile: { bureau: 'B12', specialite: 'PEDIATRIE' } },
      { id: 'b', estActif: false, numeroOrdre: null, ordreVerifieLe: null, medecinProfile: null },
    ]);
    const liste = await getAgentsStructure('admin');
    const q = prisma.utilisateur.findMany.mock.calls[0][0];
    expect(q.where.estActif).toBeUndefined();
    expect(q.orderBy).toEqual([{ estActif: 'desc' }, { creeLe: 'desc' }]);
    expect(liste[0]).toMatchObject({ id: 'a', specialite: 'PEDIATRIE', bureau: 'B12', ordreVerifie: true, numeroOrdre: 'GN-1' });
    expect(liste[1]).toMatchObject({ id: 'b', estActif: false, specialite: null, ordreVerifie: false });
  });
});

describe('reactiver un compte', () => {
  it('le reactive', async () => {
    lire(ADMIN, agent({ estActif: false }));
    await reactiverAgent('admin', 'ag-1');
    expect(prisma.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'ag-1' }, data: { estActif: true } });
  });
  it('refuse un compte deja actif, ou d une autre structure', async () => {
    lire(ADMIN, agent());
    await expect(reactiverAgent('admin', 'ag-1')).rejects.toBeInstanceOf(ConflictError);
    lire(ADMIN, agent({ idStructure: 'ailleurs', estActif: false }));
    await expect(reactiverAgent('admin', 'ag-1')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('le profil d un medecin', () => {
  it('changer le numero d ordre retire sa verification', async () => {
    lire(ADMIN, agent());
    await modifierProfilAgent('admin', 'ag-1', { numeroOrdre: 'gn-999' });
    expect(prisma.utilisateur.update).toHaveBeenCalledWith({
      where: { id: 'ag-1' }, data: { numeroOrdre: 'GN-999', ordreVerifieLe: null, idOrdreVerifiePar: null },
    });
  });

  it('le meme numero ne touche pas la verification ; la specialite change', async () => {
    lire(ADMIN, agent());
    await modifierProfilAgent('admin', 'ag-1', { numeroOrdre: ' gn-123 ', specialite: 'CARDIOLOGIE' });
    expect(prisma.utilisateur.update).not.toHaveBeenCalled();
    expect(prisma.medecinProfile.update).toHaveBeenCalledWith({ where: { idUtilisateur: 'ag-1' }, data: { specialite: 'CARDIOLOGIE' } });
  });

  it('un numero vide efface', async () => {
    lire(ADMIN, agent());
    await modifierProfilAgent('admin', 'ag-1', { numeroOrdre: null });
    expect(prisma.utilisateur.update.mock.calls[0][0].data.numeroOrdre).toBeNull();
  });

  it('refuse pour qui n est pas medecin ; le schema refuse un envoi vide', async () => {
    lire(ADMIN, agent({ role: 'AGENT_ACCUEIL' }));
    await expect(modifierProfilAgent('admin', 'ag-1', { specialite: 'ORL' })).rejects.toBeInstanceOf(ValidationError);
    expect(modifierProfilAgentSchema.safeParse({}).success).toBe(false);
  });
});

describe('reinitialiser un mot de passe', () => {
  it('un mot de passe temporaire, ses sessions fermees, un courriel', async () => {
    lire(ADMIN, agent());
    const r = await reinitialiserMotDePasseAgent('admin', 'ag-1');

    expect(r.motDePasseTemporaire).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}-[\w]{4}$/);
    expect(prisma.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'ag-1' }, data: { motDePasseHash: '$hash', doitChangerMotDePasse: true } });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { idUtilisateur: 'ag-1' } });
    expect(email.envoyerReinitialisationAgent).toHaveBeenCalledWith(expect.objectContaining({
      destinataire: 'dr.bah@chu.test', nomStructure: 'CHU Donka', motDePasseTemporaire: r.motDePasseTemporaire,
    }));
    expect(r.emailEnvoye).toBe('dr.bah@chu.test');
  });

  it('le courriel en echec : le mot de passe est quand meme rendu', async () => {
    lire(ADMIN, agent());
    email.envoyerReinitialisationAgent.mockRejectedValueOnce(new Error('smtp'));
    const r = await reinitialiserMotDePasseAgent('admin', 'ag-1');
    expect(r.emailEnvoye).toBeNull();
    expect(r.motDePasseTemporaire).toBeTruthy();
  });

  it('ni un agent d ailleurs, ni un autre administrateur', async () => {
    lire(ADMIN, agent({ idStructure: 'ailleurs' }));
    await expect(reinitialiserMotDePasseAgent('admin', 'ag-1')).rejects.toBeInstanceOf(ForbiddenError);
    lire(ADMIN, agent({ role: 'ADMIN_STRUCTURE' }));
    await expect(reinitialiserMotDePasseAgent('admin', 'ag-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe('les specialites saisies avant la liste', () => {
  it('sont reconnues sous leur code, accents et casse ignores', () => {
    expect(normaliserSpecialite('Medecine generale')).toBe('MEDECINE_GENERALE');
    expect(normaliserSpecialite('  Généraliste ')).toBe('MEDECINE_GENERALE');
    expect(normaliserSpecialite('pédiatre')).toBe('PEDIATRIE');
    expect(normaliserSpecialite('Chirurgien-dentiste')).toBe('DENTAIRE');
    expect(normaliserSpecialite('Gynéco')).toBe('GYNECO_OBSTETRIQUE');
    expect(normaliserSpecialite('ORL')).toBe('ORL');
    expect(normaliserSpecialite('CARDIOLOGIE')).toBe('CARDIOLOGIE');
  });

  it('un texte inconnu reste tel quel ; vide, rien', () => {
    expect(normaliserSpecialite('Medecine tropicale')).toBe('Medecine tropicale');
    expect(normaliserSpecialite('  ')).toBeNull();
    expect(normaliserSpecialite(null)).toBeNull();
  });

  it('la liste du personnel les rend sous leur code', async () => {
    lire(ADMIN);
    prisma.utilisateur.findMany.mockResolvedValue([
      { id: 'a', estActif: true, numeroOrdre: null, ordreVerifieLe: null, medecinProfile: { bureau: null, specialite: 'Medecine generale' } },
    ]);
    expect((await getAgentsStructure('admin'))[0]!.specialite).toBe('MEDECINE_GENERALE');
  });
});

