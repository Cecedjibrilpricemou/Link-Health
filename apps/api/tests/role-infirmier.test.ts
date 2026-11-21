// L'infirmier soigne sans prescrire.
//
// Ce que ce fichier tient :
//   - ses portes : son espace, les vaccins ; et les portes qu'il n'a pas -
//     ordonnance, analyse, cloture, liberation de resultats, historique ;
//   - son perimetre : la visite en cours dans sa structure, et elle seule ;
//   - un passage vide est refuse, un passage se rattache a la visite et a
//     son auteur ;
//   - le praticien lit les soins de la visite ; l'accueil, non.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn() },
    episodeSoins: { findFirst: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    soinInfirmier: { create: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

import { soinInfirmierSchema } from '../src/validators/api.schemas';
import { rolesCreablesPour } from '../src/services/admin-structure.service';
import {
  dossierDeVisite, enregistrerSoin, patientsDuJour, soinsDeLaVisite,
} from '../src/services/infirmier.service';
import { ConflictError, NotFoundError, ValidationError } from '../src/utils/app-error';
import type { JwtPayload } from '../src/types/auth.types';

type Couche = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }; handle: unknown };
/* eslint-disable @typescript-eslint/no-require-imports */
const routesInfirmier = require('../src/routes/infirmier.routes').default as { stack: Couche[] };
const routesHopital = require('../src/routes/hopital.routes').default as { stack: Couche[] };
const routesMedecin = require('../src/routes/medecin.routes').default as { stack: Couche[] };
const routesConsultation = require('../src/routes/consultation.routes').default as { stack: Couche[] };
const routesVaccination = require('../src/routes/vaccination.routes').default as { stack: Couche[] };
/* eslint-enable @typescript-eslint/no-require-imports */

/** Les roles qui atteignent une route : les gardes du routeur, puis les siennes. */
function rolesPour(routeur: { stack: Couche[] }, methode: string, chemin: string): string[] | null {
  const globales: string[][] = [];
  for (const c of routeur.stack) {
    if (!c.route) {
      const r = (c.handle as { roles?: readonly string[] })?.roles;
      if (r) globales.push([...r]);
      continue;
    }
    if (c.route.path !== chemin || !c.route.methods[methode]) continue;
    const propres = c.route.stack.map((x) => (x.handle as { roles?: readonly string[] })?.roles)
      .filter((r): r is readonly string[] => !!r).map((r) => [...r]);
    const toutes = [...globales, ...propres];
    return toutes.length ? toutes.reduce((a, b) => a.filter((x) => b.includes(x))) : [];
  }
  return null;
}

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M };
    episodeSoins: { findFirst: M; findMany: M; findUniqueOrThrow: M };
    soinInfirmier: { create: M; findMany: M };
  };
};

const INFIRMIER = { userId: 'inf-1', role: 'INFIRMIER' } as JwtPayload;
const MEDECIN = { userId: 'med-1', role: 'MEDECIN' } as JwtPayload;
const SOIN = {
  id: 's1', creeLe: new Date('2026-11-21T08:00:00Z'), note: 'Pansement refait',
  temperature: 38.5, tensionSystolique: 120, tensionDiastolique: 80, frequenceCardiaque: null,
  frequenceRespiratoire: null, spo2: null, poidsKg: null, glycemie: null,
  auteur: { prenom: 'Mariama', nom: 'Sow', role: 'INFIRMIER' },
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'st-1' });
  prisma.episodeSoins.findFirst.mockResolvedValue({ id: 'ep-1', statut: 'EN_COURS', idPatient: 'p-1' });
  prisma.soinInfirmier.create.mockResolvedValue(SOIN);
});

describe('ses portes', () => {
  it('son espace est a lui seul', () => {
    for (const [m, c] of [['get', '/patients'], ['get', '/visites/:id'], ['post', '/visites/:id/soins']] as const) {
      expect(rolesPour(routesInfirmier, m, c)).toEqual(['INFIRMIER']);
    }
  });

  it('il vaccine et lit le carnet vaccinal', () => {
    expect(rolesPour(routesVaccination, 'post', '/')).toContain('INFIRMIER');
    expect(rolesPour(routesVaccination, 'get', '/patient/:id')).toContain('INFIRMIER');
  });

  // Il soigne sans prescrire : ces portes sont celles du praticien.
  it('ni ordonnance, ni analyse, ni cloture, ni resultat, ni historique', () => {
    for (const [m, c] of [
      ['post', '/episodes/:id/consultation'], ['post', '/episodes/:id/demandes-analyse'], ['post', '/episodes/:id/cloturer'],
    ] as const) {
      expect(rolesPour(routesHopital, m, c)).not.toContain('INFIRMIER');
    }
    expect(rolesPour(routesConsultation, 'post', '/:id/ordonnances')).not.toContain('INFIRMIER');
    expect(rolesPour(routesMedecin, 'post', '/resultats/:id/liberer')).not.toContain('INFIRMIER');
    expect(rolesPour(routesMedecin, 'get', '/patients/:idPatient/historique')).not.toContain('INFIRMIER');
  });

  // Les soins sont un contenu medical : le praticien les lit, l'accueil non.
  it('les soins de la visite se lisent par le praticien, pas par l accueil', () => {
    expect(rolesPour(routesHopital, 'get', '/episodes/:id/soins')).toEqual(['MEDECIN', 'SAGE_FEMME']);
  });

  it('il se cree partout ou l on soigne, jamais au laboratoire', () => {
    for (const t of ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'] as const) {
      expect(rolesCreablesPour(t)).toContain('INFIRMIER');
    }
    expect(rolesCreablesPour('LABORATOIRE')).not.toContain('INFIRMIER');
  });
});

describe('son perimetre : la visite en cours dans sa structure', () => {
  it('les patients du jour sont ceux des visites ouvertes de sa structure', async () => {
    prisma.episodeSoins.findMany.mockResolvedValue([]);
    await patientsDuJour(INFIRMIER);
    expect(prisma.episodeSoins.findMany.mock.calls[0][0].where).toEqual({ idStructure: 'st-1', statut: { in: ['OUVERT', 'EN_COURS'] } });
  });

  it('une visite d une autre structure n existe pas pour lui', async () => {
    prisma.episodeSoins.findFirst.mockResolvedValue(null);
    await expect(dossierDeVisite(INFIRMIER, 'ep-ailleurs')).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.episodeSoins.findFirst.mock.calls[0][0].where).toEqual({ id: 'ep-ailleurs', idStructure: 'st-1' });
  });

  it('une visite close ne se soigne plus', async () => {
    prisma.episodeSoins.findFirst.mockResolvedValue({ id: 'ep-1', statut: 'CLOS', idPatient: 'p-1' });
    await expect(enregistrerSoin(INFIRMIER, 'ep-1', { temperature: 37 })).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.soinInfirmier.create).not.toHaveBeenCalled();
  });
});

describe('un passage', () => {
  it('vide, il est refuse', async () => {
    await expect(enregistrerSoin(INFIRMIER, 'ep-1', { note: '   ' })).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.soinInfirmier.create).not.toHaveBeenCalled();
  });

  it('se rattache a la visite et a son auteur, avec ses seules constantes', async () => {
    const vu = await enregistrerSoin(INFIRMIER, 'ep-1', { temperature: 38.5, tensionSystolique: 120, tensionDiastolique: 80, note: ' Pansement refait ' });
    expect(prisma.soinInfirmier.create.mock.calls[0][0].data).toEqual({
      temperature: 38.5, tensionSystolique: 120, tensionDiastolique: 80,
      note: 'Pansement refait', idEpisode: 'ep-1', idAuteur: 'inf-1',
    });
    expect(vu).toEqual(expect.objectContaining({ note: 'Pansement refait', auteur: 'Mariama Sow' }));
    expect(vu.constantes.temperature).toBe(38.5);
  });

  it('le schema garde les bornes des constantes, et rien d autre', () => {
    expect(soinInfirmierSchema.safeParse({ temperature: 60 }).success).toBe(false);
    expect(soinInfirmierSchema.safeParse({ spo2: 97, note: 'ok' }).success).toBe(true);
    expect(soinInfirmierSchema.safeParse({ ordonnance: 'x' }).success).toBe(false);
  });

  it('le praticien lit les soins des visites de sa structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: null, medecinProfile: { idStructure: 'st-1' } });
    prisma.episodeSoins.findFirst.mockResolvedValue({ id: 'ep-1' });
    prisma.soinInfirmier.findMany.mockResolvedValue([SOIN]);
    const soins = await soinsDeLaVisite(MEDECIN, 'ep-1');
    expect(prisma.episodeSoins.findFirst.mock.calls[0][0].where).toEqual({ id: 'ep-1', idStructure: 'st-1' });
    expect(soins).toHaveLength(1);
  });
});
