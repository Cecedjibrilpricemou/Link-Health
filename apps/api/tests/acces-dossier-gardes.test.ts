// Les lectures qui montrent l'historique passent par l'accord du patient.
//
// Le service porte la regle (acces-dossier.service.test.ts) ; ici on verifie
// qu'elle est posee la ou l'historique sort deja : l'evolution des resultats
// et l'export FHIR. Retirer une de ces lignes rouvrirait l'historique au
// medecin sans que rien ne casse ailleurs.
//
// Et les routes nouvelles : le patient seul repond pour son dossier, le
// medecin seul lit et relance.
import type { Role } from '../src/config/generated/client/client';
import { ForbiddenError } from '../src/utils/app-error';

process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

jest.mock('../src/config/prisma', () => ({ prisma: {} }));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/services/acces-dossier.service', () => ({
  assertHistoriqueSiMedecin: jest.fn(),
}));
jest.mock('../src/services/laboratoire.service', () => ({
  examensSuivisPourProfessionnel: jest.fn().mockResolvedValue([]),
  evolutionPourProfessionnel: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessPatient: jest.fn(),
  assertCanAccessConsultation: jest.fn(),
}));
jest.mock('../src/services/privacy.service', () => ({ assertPatientConsent: jest.fn() }));
jest.mock('../src/services/fhir.service', () => ({
  getPatientFhir: jest.fn().mockResolvedValue({}),
  getPatientBundleFhir: jest.fn().mockResolvedValue({}),
}));

type M = jest.Mock;
const { assertHistoriqueSiMedecin } = jest.requireMock('../src/services/acces-dossier.service') as { assertHistoriqueSiMedecin: M };
const labo = jest.requireMock('../src/services/laboratoire.service') as { examensSuivisPourProfessionnel: M; evolutionPourProfessionnel: M };
const fhir = jest.requireMock('../src/services/fhir.service') as { getPatientFhir: M; getPatientBundleFhir: M };

type Couche = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle?: unknown;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const resultats = require('../src/routes/resultats.routes').default as { stack: Couche[] };
const patients = require('../src/routes/patient.routes').default as { stack: Couche[] };
const medecin = require('../src/routes/medecin.routes').default as { stack: Couche[] };
const controleur = require('../src/controllers/fhir.controller') as {
  getPatientFhirController: (req: unknown, res: unknown) => Promise<void>;
  getPatientBundleFhirController: (req: unknown, res: unknown) => Promise<void>;
};

/** Le dernier maillon de la route : le gestionnaire lui-meme. */
function gestionnaire(routeur: { stack: Couche[] }, methode: string, chemin: string) {
  const c = routeur.stack.find((x) => x.route?.path === chemin && x.route.methods[methode]);
  if (!c) throw new Error(`route absente : ${methode} ${chemin}`);
  const pile = c.route!.stack;
  return pile[pile.length - 1]!.handle as (req: unknown, res: unknown) => Promise<void>;
}

/** Les roles de la route, gardes du routeur comprises (intersection). */
function rolesPour(routeur: { stack: Couche[] }, methode: string, chemin: string): Role[] | null {
  const globales: Role[][] = [];
  for (const couche of routeur.stack) {
    if (!couche.route) {
      const r = (couche.handle as { roles?: readonly Role[] })?.roles;
      if (r) globales.push([...r]);
      continue;
    }
    if (couche.route.path !== chemin || !couche.route.methods[methode]) continue;
    const propres = couche.route.stack
      .map((c) => (c.handle as { roles?: readonly Role[] })?.roles)
      .filter((r): r is readonly Role[] => !!r)
      .map((r) => [...r]);
    const toutes = [...globales, ...propres];
    return toutes.length ? toutes.reduce((a, b) => a.filter((x) => b.includes(x))) : [];
  }
  return null;
}

const MEDECIN = { userId: 'med-1', role: 'MEDECIN', sessionId: 's' };
const res = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

beforeEach(() => {
  jest.clearAllMocks();
  assertHistoriqueSiMedecin.mockResolvedValue(undefined);
});

describe('les resultats suivis d un patient suivent l accord', () => {
  it.each([
    ['/patients/:idPatient/examens-suivis', {}, () => labo.examensSuivisPourProfessionnel],
    ['/patients/:idPatient/evolution', { codeLoinc: '718-7' }, () => labo.evolutionPourProfessionnel],
  ])('%s : garde avant lecture', async (chemin, query, service) => {
    const h = gestionnaire(resultats, 'get', chemin);

    await h({ user: MEDECIN, params: { idPatient: 'pat-1' }, query }, res());
    expect(assertHistoriqueSiMedecin).toHaveBeenCalledWith(MEDECIN, 'pat-1');

    service().mockClear();
    assertHistoriqueSiMedecin.mockRejectedValue(new ForbiddenError('accord'));
    await expect(h({ user: MEDECIN, params: { idPatient: 'pat-1' }, query }, res())).rejects.toBeInstanceOf(ForbiddenError);
    expect(service()).not.toHaveBeenCalled();
  });
});

describe('l export FHIR emporte l historique : il suit l accord', () => {
  it.each([
    ['getPatientFhirController', () => fhir.getPatientFhir],
    ['getPatientBundleFhirController', () => fhir.getPatientBundleFhir],
  ] as const)('%s', async (nom, service) => {
    assertHistoriqueSiMedecin.mockRejectedValue(new ForbiddenError('accord'));
    await expect(controleur[nom]({ user: MEDECIN, params: { id: 'pat-1' } }, res())).rejects.toBeInstanceOf(ForbiddenError);
    expect(assertHistoriqueSiMedecin).toHaveBeenCalledWith(MEDECIN, 'pat-1');
    expect(service()).not.toHaveBeenCalled();
  });
});

describe('les routes de l accord', () => {
  it('le patient seul repond pour son dossier', () => {
    expect(rolesPour(patients, 'get', '/me/acces-dossier')).toEqual(['PATIENT']);
    for (const geste of ['accorder', 'refuser', 'retirer']) {
      expect(rolesPour(patients, 'post', `/me/acces-dossier/:id/${geste}`)).toEqual(['PATIENT']);
    }
  });

  // Ni l'administrateur de structure ni l'administrateur regional : l'accord
  // est donne a un medecin, pas a une fonction.
  it('le medecin seul lit l historique et relance', () => {
    expect(rolesPour(medecin, 'get', '/patients/:idPatient/acces')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'post', '/patients/:idPatient/acces/relancer')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'get', '/patients/:idPatient/historique')).toEqual(['MEDECIN']);
  });
});
