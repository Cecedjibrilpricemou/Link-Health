// Les erreurs des routes admin-structure et parametres.
//
// **Le constat (revue du 30/10).** Ces routes attrapaient elles-memes leurs
// erreurs, au lieu de les laisser au gestionnaire global :
//
// - cinq blocs repondaient **toujours 500**, et huit **toujours 400**, quel
//   que soit le probleme : un 403 ou un 404 du service changeait de sens ;
// - tous renvoyaient `e.message` tel quel, **meme en production** : une
//   erreur Prisma partait au navigateur avec le nom des tables et des colonnes.
//
// Le gestionnaire global (`error.middleware.ts`) fait deja les deux choses
// bien : il respecte le code d'une `AppError` et masque les autres messages
// en production. Ce fichier verifie que les routes le laissent faire.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

import express from 'express';
import type { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '../src/config/generated/client/client';

jest.mock('../src/config/prisma', () => ({ prisma: {} }));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/config/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../src/services/admin-structure.service', () => ({ getStructuresPubliques: jest.fn() }));
jest.mock('../src/services/parametres.service', () => ({ getIdentitePlateforme: jest.fn() }));

import adminStructureRoutes from '../src/routes/admin-structure.routes';
import parametresRoutes from '../src/routes/parametres.routes';
import { globalErrorHandler } from '../src/middlewares/error.middleware';
import { NotFoundError, ForbiddenError } from '../src/utils/app-error';
import * as adminService from '../src/services/admin-structure.service';
import * as parametresService from '../src/services/parametres.service';

const structuresPubliques = adminService.getStructuresPubliques as jest.Mock;
const identite = parametresService.getIdentitePlateforme as jest.Mock;

let base = '';
let serveur: ReturnType<express.Express['listen']>;

beforeAll((fait) => {
  const app = express();
  app.use(express.json());
  app.use('/admin-structure', adminStructureRoutes);
  app.use('/parametres', parametresRoutes);
  app.use(globalErrorHandler);
  serveur = app.listen(0, () => {
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    fait();
  });
});
afterAll((fait) => { serveur.close(() => fait()); });

const envOrigine = process.env['NODE_ENV'];
afterEach(() => { process.env['NODE_ENV'] = envOrigine; jest.resetAllMocks(); });

async function appeler(chemin: string) {
  const r = await fetch(base + chemin);
  return { statut: r.status, corps: await r.text() };
}

describe('le code de l erreur metier est respecte', () => {
  it('un 404 du service reste un 404 (et non un 500)', async () => {
    structuresPubliques.mockRejectedValue(new NotFoundError('Aucune structure'));
    const r = await appeler('/admin-structure/structures/publiques');
    expect(r.statut).toBe(404);
    expect(r.corps).toContain('Aucune structure');
  });

  it('un 403 du service reste un 403', async () => {
    identite.mockRejectedValue(new ForbiddenError('Refuse'));
    const r = await appeler('/parametres/publics');
    expect(r.statut).toBe(403);
  });
});

describe('en production, une erreur interne ne sort pas', () => {
  beforeEach(() => { process.env['NODE_ENV'] = 'production'; });

  it('admin-structure : message interne masque', async () => {
    structuresPubliques.mockRejectedValue(new Error('relation "structures_sante" colonne idSecrete'));
    const r = await appeler('/admin-structure/structures/publiques');
    expect(r.statut).toBe(500);
    expect(r.corps).not.toContain('structures_sante');
  });

  it('parametres : message interne masque', async () => {
    identite.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const r = await appeler('/parametres/publics');
    expect(r.statut).toBe(500);
    expect(r.corps).not.toContain('ECONNREFUSED');
  });
});

describe('violation d unicite Prisma', () => {
  it('devient un 409 au message neutre, sans le detail de la contrainte', async () => {
    process.env['NODE_ENV'] = 'production';
    structuresPubliques.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`telephone`)', { code: 'P2002', clientVersion: 'test' },
    ));
    const r = await appeler('/admin-structure/structures/publiques');
    expect(r.statut).toBe(409);
    expect(r.corps).not.toContain('Unique constraint');
  });
});

describe('les fichiers de routes', () => {
  it.each(['admin-structure.routes.ts', 'parametres.routes.ts'])(
    "%s ne traduit plus lui-meme les erreurs",
    (fichier) => {
      const source = readFileSync(join(__dirname, '..', 'src', 'routes', fichier), 'utf8');
      expect(source).not.toMatch(/catch \(e: unknown\)/);
      expect(source).not.toMatch(/status\((400|500)\)\.json\(\{ success: false, error: e instanceof Error/);
    },
  );
});
