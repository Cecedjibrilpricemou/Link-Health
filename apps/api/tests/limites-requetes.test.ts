// Limites de requetes : reglables par l'environnement, inchangees par defaut.
//
// L'E2E enchaine en une seule session plus de 300 requetes en 15 minutes :
// l'API repondait 429 au milieu d'un parcours, et le test echouait au hasard
// (la caisse ne recevait plus son montant a jour). L'environnement de test
// releve la limite ; la production garde 300 et 20 tant que personne ne
// decide autrement.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

import { envSchema } from '../src/config/env';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/test',
  JWT_SECRET: 'secret-de-test-au-moins-32-caracteres',
  JWT_REFRESH_SECRET: 'autre-secret-de-test-au-moins-32-car',
  DB_ENCRYPTION_KEY: '0'.repeat(64),
};

describe('limites de requêtes', () => {
  it('garde 300 requêtes et 20 connexions par quart d’heure par défaut', () => {
    const e = envSchema.parse(BASE);
    expect(e.RATE_LIMIT_API_MAX).toBe(300);
    expect(e.RATE_LIMIT_AUTH_MAX).toBe(20);
  });

  it('se règle par l’environnement (E2E)', () => {
    const e = envSchema.parse({ ...BASE, RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_AUTH_MAX: '1000' });
    expect(e.RATE_LIMIT_API_MAX).toBe(10000);
    expect(e.RATE_LIMIT_AUTH_MAX).toBe(1000);
  });

  it('refuse une valeur absurde plutôt que de désactiver la protection', () => {
    for (const v of ['0', '-5', 'beaucoup', '2.5']) {
      expect(envSchema.safeParse({ ...BASE, RATE_LIMIT_API_MAX: v }).success).toBe(false);
    }
  });
});
