// R15 : corriger l'identite d'un patient (sexe, date de naissance, prenom,
// nom). Personne ne le pouvait : une erreur de saisie a l'admission restait
// pour toujours. L'issue est etroite : accueil ou administration, sur un
// patient de son perimetre, avec un motif, et chaque trait corrige garde son
// ancienne valeur et son auteur.
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    patientProfile: { findUnique: jest.fn(), update: jest.fn() },
    correctionIdentite: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessPatient: jest.fn(),
  buildPatientWhereForUser: jest.fn(),
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    patientProfile: { findUnique: M; update: M };
    correctionIdentite: { findMany: M };
    $transaction: M;
  };
};
const { assertCanAccessPatient } = jest.requireMock('../src/services/access-control.service') as { assertCanAccessPatient: M };

import { corrigerIdentite, historiqueCorrections, noterTraits } from '../src/services/identite.service';

const AGENT = { userId: 'agent-1', role: 'AGENT_ACCUEIL' as const, sessionId: 's1' };
const MAINTENANT = new Date('2026-11-12T10:00:00.000Z');
const MOTIF = "Erreur de saisie a l'admission, acte de naissance presente";

const PATIENT = {
  id: 'p1', sexe: 'M', dateNaissance: new Date('2002-03-15T00:00:00.000Z'), idFusionneDans: null,
  idUtilisateur: 'u-pat', utilisateur: { prenom: 'Mariama', nom: 'Bah' },
};
const LIGNE = {
  id: 'p1', dateNaissance: new Date('2020-03-15T00:00:00.000Z'), sexe: 'F', prefecture: 'Conakry',
  lieuNaissance: null, nomMere: null, niveauIdentite: 'VERIFIEE', typePiece: null, numeroPiece: null,
  identiteVerifieeLe: null, utilisateur: { prenom: 'Mariama', nom: 'Bah', telephone: '620100010' }, verifiePar: null,
};

let tx: { utilisateur: { update: M }; correctionIdentite: { createMany: M }; patientProfile: { update: M } };

beforeEach(() => {
  jest.resetAllMocks();
  assertCanAccessPatient.mockResolvedValue(undefined);
  prisma.patientProfile.findUnique.mockResolvedValue(PATIENT);
  tx = {
    utilisateur: { update: jest.fn().mockResolvedValue({}) },
    correctionIdentite: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    patientProfile: { update: jest.fn().mockResolvedValue(LIGNE) },
  };
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
});

describe('corrigerIdentite : ce qui est exige', () => {
  it('exige un motif qui dit quelque chose', async () => {
    await expect(corrigerIdentite(AGENT, 'p1', { sexe: 'F', motif: 'erreur' }, MAINTENANT))
      .rejects.toThrow('Le motif est exige');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('controle le perimetre avant de lire le dossier', async () => {
    assertCanAccessPatient.mockRejectedValue(new ForbiddenError('hors perimetre'));
    await expect(corrigerIdentite(AGENT, 'p1', { sexe: 'F', motif: MOTIF }, MAINTENANT)).rejects.toBeInstanceOf(ForbiddenError);
    expect(assertCanAccessPatient).toHaveBeenCalledWith(AGENT, 'p1');
    expect(prisma.patientProfile.findUnique).not.toHaveBeenCalled();
  });

  it('refuse un patient inconnu', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(corrigerIdentite(AGENT, 'p1', { sexe: 'F', motif: MOTIF }, MAINTENANT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renvoie au dossier principal quand celui-ci a ete fusionne', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ ...PATIENT, idFusionneDans: 'p-principal' });
    await expect(corrigerIdentite(AGENT, 'p1', { sexe: 'F', motif: MOTIF }, MAINTENANT))
      .rejects.toThrow('corrigez le dossier principal');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse une correction qui ne change rien', async () => {
    await expect(corrigerIdentite(AGENT, 'p1', {
      sexe: 'M', prenom: 'Mariama', dateNaissance: '2002-03-15', motif: MOTIF,
    }, MAINTENANT)).rejects.toThrow('Aucun changement');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['2027-01-01', 'hors des limites'],
    ['1899-12-31', 'hors des limites'],
    ['2020-02-30', 'invalide'],
  ])('refuse la date %s', async (date, message) => {
    await expect(corrigerIdentite(AGENT, 'p1', { dateNaissance: date, motif: MOTIF }, MAINTENANT))
      .rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('corrigerIdentite : ce qui est ecrit', () => {
  it('corrige sexe et date, et garde une ligne par trait avec l ancienne valeur et l agent', async () => {
    await corrigerIdentite(AGENT, 'p1', { sexe: 'F', dateNaissance: '2020-03-15', motif: `  ${MOTIF}  ` }, MAINTENANT);

    expect(tx.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: { sexe: 'F', dateNaissance: new Date('2020-03-15T00:00:00.000Z') },
    }));
    expect(tx.correctionIdentite.createMany).toHaveBeenCalledWith({
      data: [
        { champ: 'sexe', ancienneValeur: 'M', nouvelleValeur: 'F', motif: MOTIF, idPatient: 'p1', idAuteur: 'agent-1', creeLe: MAINTENANT },
        {
          champ: 'dateNaissance', ancienneValeur: '2002-03-15', nouvelleValeur: '2020-03-15',
          motif: MOTIF, idPatient: 'p1', idAuteur: 'agent-1', creeLe: MAINTENANT,
        },
      ],
    });
    // Ni prenom ni nom touches : le compte n'est pas reecrit.
    expect(tx.utilisateur.update).not.toHaveBeenCalled();
  });

  it('corrige le nom sur le compte du patient, pas sur celui de l agent', async () => {
    await corrigerIdentite(AGENT, 'p1', { nom: 'Barry', prenom: 'Mariama', motif: MOTIF }, MAINTENANT);

    expect(tx.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'u-pat' }, data: { nom: 'Barry' } });
    expect(tx.correctionIdentite.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ champ: 'nom', ancienneValeur: 'Bah', nouvelleValeur: 'Barry' }),
    ]);
  });

  it('ne change pas le niveau d identite : corriger n est pas verifier', async () => {
    await corrigerIdentite(AGENT, 'p1', { sexe: 'F', motif: MOTIF }, MAINTENANT);
    const data = tx.patientProfile.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('niveauIdentite');
    expect(data).not.toHaveProperty('idVerifiePar');
  });

  it('rend l identite corrigee, prenom et nom separes', async () => {
    const vue = await corrigerIdentite(AGENT, 'p1', { sexe: 'F', motif: MOTIF }, MAINTENANT);
    expect(vue).toMatchObject({ prenom: 'Mariama', nom: 'Bah', nomComplet: 'Mariama Bah', sexe: 'F' });
  });
});

describe('historiqueCorrections', () => {
  it('controle le perimetre et nomme l auteur, ou dit qu il est parti', async () => {
    prisma.correctionIdentite.findMany.mockResolvedValue([
      { id: 'c2', champ: 'sexe', ancienneValeur: 'M', nouvelleValeur: 'F', motif: MOTIF, creeLe: MAINTENANT,
        auteur: { prenom: 'Fatoumata', nom: 'Keita' } },
      { id: 'c1', champ: 'nom', ancienneValeur: 'Bah', nouvelleValeur: 'Barry', motif: MOTIF, creeLe: MAINTENANT, auteur: null },
    ]);

    const h = await historiqueCorrections(AGENT, 'p1');

    expect(assertCanAccessPatient).toHaveBeenCalledWith(AGENT, 'p1');
    expect(prisma.correctionIdentite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { idPatient: 'p1' }, orderBy: { creeLe: 'desc' },
    }));
    expect(h.map((c) => c.auteur)).toEqual(['Fatoumata Keita', null]);
  });

  it('ne lit rien hors perimetre', async () => {
    assertCanAccessPatient.mockRejectedValue(new ForbiddenError('non'));
    await expect(historiqueCorrections(AGENT, 'p1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.correctionIdentite.findMany).not.toHaveBeenCalled();
  });
});

// Un trait lu sur une piece fondait la verification : il ne se reecrit pas
// sur simple declaration.
describe('noterTraits apres verification', () => {
  beforeEach(() => prisma.patientProfile.update.mockResolvedValue(LIGNE));

  it('refuse d ecraser un trait verifie', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ niveauIdentite: 'VERIFIEE', lieuNaissance: 'Kankan', nomMere: null });
    await expect(noterTraits(AGENT, 'p1', { lieuNaissance: 'Labe' })).rejects.toThrow('verifies sur piece');
    expect(prisma.patientProfile.update).not.toHaveBeenCalled();
  });

  it('laisse completer un trait absent', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ niveauIdentite: 'VERIFIEE', lieuNaissance: 'Kankan', nomMere: null });
    await noterTraits(AGENT, 'p1', { nomMere: 'Fatoumata Conde', lieuNaissance: 'Kankan' });
    expect(prisma.patientProfile.update).toHaveBeenCalled();
  });

  it('laisse reecrire une identite provisoire', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ niveauIdentite: 'PROVISOIRE', lieuNaissance: 'Kankan', nomMere: null });
    await noterTraits(AGENT, 'p1', { lieuNaissance: 'Labe' });
    expect(prisma.patientProfile.update).toHaveBeenCalled();
  });

  it('refuse un patient inconnu', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(noterTraits(AGENT, 'p1', { lieuNaissance: 'Labe' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse toujours une saisie vide', async () => {
    await expect(noterTraits(AGENT, 'p1', {})).rejects.toBeInstanceOf(ValidationError);
  });
});
