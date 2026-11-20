// Creer une compagnie d'assurance en une fois.
//
// **Le defaut que ce fichier empeche de revenir** : creer une assurance
// demandait trois gestes dans deux ecrans - la structure, puis la compagnie,
// puis le rattachement. Qui s'arretait au premier laissait un responsable
// qui se connectait pour lire « Cette structure n'est rattachee a aucune
// compagnie d'assurance ». La porte unique fait naitre les trois ensemble, ou
// rien du tout.
//
// La base et le disque sont simules : ce qui est teste, c'est le service.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    assureur: { findUnique: jest.fn(), create: jest.fn() },
    utilisateur: { findUnique: jest.fn(), create: jest.fn() },
    structureSante: { create: jest.fn() },
    pieceAgrement: { createMany: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// L'ecriture reelle irait dans `stockage-prive/agrements/`. La validation des
// pieces, elle, reste le vrai code : c'est elle qu'on eprouve.
jest.mock('../src/services/piece-agrement.service', () => {
  const vrai = jest.requireActual('../src/services/piece-agrement.service');
  return { ...vrai, ecrireFichiers: jest.fn(), supprimerFichiers: jest.fn() };
});
jest.mock('../src/services/email.service', () => ({
  envoyerEmailAdminStructure: jest.fn(),
}));
jest.mock('../src/services/admin-structure.service', () => ({
  genererMotDePasseTemp: jest.fn(() => 'Kq7m-Xw3P-abcd-EFGH'),
}));
jest.mock('../src/utils/password.utils', () => ({
  hashPassword: jest.fn(async (v: string) => `hache:${v}`),
}));

import { prisma } from '../src/config/prisma';
import { logger } from '../src/config/logger';
import * as pieces from '../src/services/piece-agrement.service';
import { creerAssuranceAvecResponsable, type CreationAssuranceRecue } from '../src/services/assurance.service';
import { ConflictError, ValidationError } from '../src/utils/app-error';

type M = jest.Mock;
const bd = prisma as unknown as {
  assureur: { findUnique: M; create: M };
  utilisateur: { findUnique: M; create: M };
  structureSante: { create: M };
  pieceAgrement: { createMany: M };
  $transaction: M;
};
const disque = pieces as unknown as { ecrireFichiers: M; supprimerFichiers: M };

const AGREMENT = { fieldname: 'AGREMENT_ASSURANCE', originalname: 'agrement.pdf', buffer: Buffer.from('%PDF-1.4 bcrg') };
const FICHIER_ECRIT = { type: 'AGREMENT_ASSURANCE', fichier: 'abc.pdf', taille: 13, libelle: null };

const DTO: CreationAssuranceRecue = {
  nom: 'Sunu Assurances',
  prefecture: 'Conakry',
  commune: 'Kaloum',
  telephone: '620111222',
  rccm: 'GN.TCC.2026.B.00042',
  numeroAgrementCreation: 'D/2009/CAM/LOA/07',
  lieuAutorise: 'Kaloum',
  code: 'sunu',
  modeEchange: 'PORTAIL',
  responsable: { prenom: 'Awa', nom: 'Bah', telephone: '620333444', email: 'awa.bah@sunu.gn' },
};

beforeEach(() => {
  jest.clearAllMocks();
  bd.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  bd.assureur.findUnique.mockResolvedValue(null);
  bd.utilisateur.findUnique.mockResolvedValue(null);
  bd.structureSante.create.mockResolvedValue({ id: 'struct-1', nom: DTO.nom, type: 'ASSURANCE' });
  bd.pieceAgrement.createMany.mockResolvedValue({ count: 1 });
  bd.assureur.create.mockResolvedValue({
    id: 'assu-1', nom: DTO.nom, code: 'SUNU', telephone: DTO.telephone, email: null,
    estActif: true, modeEchange: 'PORTAIL', idStructure: 'struct-1', regles: [], _count: { contrats: 0 },
  });
  bd.utilisateur.create.mockResolvedValue({
    id: 'resp-1', prenom: 'Awa', nom: 'Bah', telephone: '620333444', email: 'awa.bah@sunu.gn', role: 'ASSUREUR',
  });
  disque.ecrireFichiers.mockResolvedValue([FICHIER_ECRIT]);
  disque.supprimerFichiers.mockResolvedValue(undefined);
});

describe('creer une assurance en une fois', () => {
  // (1) Les trois naissent ensemble, et sur la meme structure : c'est ce qui
  // manquait a celui qui s'arretait au premier geste.
  it('cree la structure, sa piece, la compagnie rattachee et le compte ASSUREUR, dans une transaction', async () => {
    const r = await creerAssuranceAvecResponsable(DTO, [AGREMENT]);

    expect(bd.$transaction).toHaveBeenCalledTimes(1);
    expect(bd.structureSante.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'ASSURANCE', nom: 'Sunu Assurances', numeroAgrementCreation: 'D/2009/CAM/LOA/07' }),
    });
    expect(bd.pieceAgrement.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ type: 'AGREMENT_ASSURANCE', idStructure: 'struct-1' })],
    });
    expect(bd.assureur.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ code: 'SUNU', modeEchange: 'PORTAIL', idStructure: 'struct-1' }),
    }));
    expect(bd.utilisateur.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: 'ASSUREUR', idStructure: 'struct-1', email: 'awa.bah@sunu.gn', doitChangerMotDePasse: true,
      }),
    }));
    expect(r.assureur.code).toBe('SUNU');
    expect(r.responsable.role).toBe('ASSUREUR');
    // Rendu une fois, a l'administration qui le transmet.
    expect(r.motDePasseTemporaire).toBe('Kq7m-Xw3P-abcd-EFGH');
  });

  it('ne journalise jamais le mot de passe', async () => {
    await creerAssuranceAvecResponsable(DTO, [AGREMENT]);

    const journal = JSON.stringify([
      ...(logger.info as M).mock.calls, ...(logger.error as M).mock.calls, ...(logger.warn as M).mock.calls,
    ]);
    expect(journal).not.toContain('Kq7m-Xw3P-abcd-EFGH');
  });

  // (2) Un dossier incomplet ne laisse rien derriere lui.
  it('refuse sans l agrement de la Banque Centrale, et n ecrit rien', async () => {
    await expect(creerAssuranceAvecResponsable(DTO, [])).rejects.toBeInstanceOf(ValidationError);

    expect(disque.ecrireFichiers).not.toHaveBeenCalled();
    expect(bd.$transaction).not.toHaveBeenCalled();
    expect(bd.structureSante.create).not.toHaveBeenCalled();
    expect(bd.assureur.create).not.toHaveBeenCalled();
    expect(bd.utilisateur.create).not.toHaveBeenCalled();
  });

  it('refuse sans la reference de l agrement, et n ecrit rien', async () => {
    const sansReference = { ...DTO, numeroAgrementCreation: undefined };

    await expect(creerAssuranceAvecResponsable(sansReference, [AGREMENT]))
      .rejects.toThrow(/Banque Centrale/);
    expect(disque.ecrireFichiers).not.toHaveBeenCalled();
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  // (3) Le message nomme le code, pas une contrainte de base.
  it('refuse un code deja pris en le nommant, avant toute ecriture', async () => {
    bd.assureur.findUnique.mockResolvedValue({ id: 'autre' });

    const erreur = await creerAssuranceAvecResponsable(DTO, [AGREMENT]).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ConflictError);
    expect((erreur as Error).message).toMatch(/code SUNU/);
    expect(disque.ecrireFichiers).not.toHaveBeenCalled();
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  // Deux agents creent la meme compagnie a la meme seconde : le controle
  // passe pour les deux, la base refuse le second.
  it('nomme le code quand la base le refuse pendant la transaction, et efface la piece', async () => {
    bd.assureur.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002', meta: { modelName: 'Assureur', target: ['code'] },
    }));

    const erreur = await creerAssuranceAvecResponsable(DTO, [AGREMENT]).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ConflictError);
    expect((erreur as Error).message).toMatch(/code SUNU/);
    expect(disque.supprimerFichiers).toHaveBeenCalledWith(['abc.pdf']);
  });

  // (4) Si le compte ne peut pas naitre, la structure et la compagnie ne
  // restent pas, et la piece non plus.
  it('ne laisse ni structure orpheline ni fichier quand la transaction echoue', async () => {
    const persistees: string[] = [];
    bd.structureSante.create.mockImplementation(async () => {
      persistees.push('structure');
      return { id: 'struct-1', nom: DTO.nom, type: 'ASSURANCE' };
    });
    bd.assureur.create.mockImplementation(async () => {
      persistees.push('compagnie');
      return { id: 'assu-1', code: 'SUNU', regles: [], _count: { contrats: 0 } };
    });
    bd.utilisateur.create.mockRejectedValue(new Error('echec du compte'));
    // Ce que fait une vraie transaction : tout ou rien.
    bd.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const avant = persistees.length;
      try {
        return await fn(prisma);
      } catch (e) {
        persistees.splice(avant);
        throw e;
      }
    });

    await expect(creerAssuranceAvecResponsable(DTO, [AGREMENT])).rejects.toThrow('echec du compte');

    expect(persistees).toEqual([]);
    expect(disque.supprimerFichiers).toHaveBeenCalledWith(['abc.pdf']);
  });

  // La modale ne doit pas affirmer un envoi qui a echoue : l'administrateur
  // fermerait sans noter le mot de passe, et le responsable resterait dehors.
  it('dit que le courriel est parti quand il est parti', async () => {
    const r = await creerAssuranceAvecResponsable(DTO, [AGREMENT]);
    expect(r.emailEnvoye).toBe(true);
  });

  it('dit que le courriel n est pas parti quand l envoi echoue', async () => {
    const courriels = jest.requireMock('../src/services/email.service') as { envoyerEmailAdminStructure: M };
    courriels.envoyerEmailAdminStructure.mockRejectedValueOnce(new Error('aucun expediteur configure'));

    const r = await creerAssuranceAvecResponsable(DTO, [AGREMENT]);

    expect(r.emailEnvoye).toBe(false);
    expect(r.motDePasseTemporaire).toBe('Kq7m-Xw3P-abcd-EFGH');
  });

  it('refuse un telephone de responsable deja porte par un compte, avant toute ecriture', async () => {
    bd.utilisateur.findUnique.mockImplementation(async ({ where }: { where: { telephone?: string } }) =>
      (where.telephone ? { id: 'deja' } : null));

    await expect(creerAssuranceAvecResponsable(DTO, [AGREMENT])).rejects.toBeInstanceOf(ConflictError);
    expect(disque.ecrireFichiers).not.toHaveBeenCalled();
  });
});
