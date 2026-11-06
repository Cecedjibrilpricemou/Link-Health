// `.env.example` est la seule documentation qu'un poste neuf lit avant de
// demarrer l'API. Il doit dire vrai, et il doit tout dire.
//
// Constate le 2026-11-06 : il annoncait le code OTP de developpement « actif
// sauf false explicite », comme le schema de `env.ts`. Le code qui decide
// (`peutRenvoyerOtpEnClair`) exige au contraire `true` en toutes lettres. Un
// `.env` sans la ligne donnait donc un 503 a chaque connexion de
// professionnel, alors que la documentation promettait que tout marcherait.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envSchema } from '../src/config/env';
import { peutRenvoyerOtpEnClair } from '../src/utils/otp-developpement';

const RACINE_API = join(__dirname, '..');
const exemple = readFileSync(join(RACINE_API, '.env.example'), 'utf8').replace(/\r\n/g, '\n');
const sourceEnv = readFileSync(join(RACINE_API, 'src', 'config', 'env.ts'), 'utf8');

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/test',
  JWT_SECRET: 'secret-de-test-au-moins-32-caracteres',
  JWT_REFRESH_SECRET: 'autre-secret-de-test-au-moins-32-car',
  DB_ENCRYPTION_KEY: '0'.repeat(64),
};

/** La valeur d'une cle dans `.env.example` (ligne active, pas en commentaire). */
function valeurExemple(cle: string): string | undefined {
  return new RegExp(`^${cle}=(.*)$`, 'm').exec(exemple)?.[1]?.trim();
}

describe('.env.example', () => {
  it('documente chaque variable lue par le schema de configuration', () => {
    // Les cles du schema : un nom en majuscules en debut de propriete.
    const cles = [...sourceEnv.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
    expect(cles.length).toBeGreaterThan(10);
    const absentes = cles.filter((c) => !new RegExp(`^#?\\s*${c}=`, 'm').test(exemple));
    expect(absentes).toEqual([]);
  });

  it('active le code OTP de developpement, et le dit comme le code le lit', () => {
    expect(valeurExemple('EMAIL_OTP_DEV_FALLBACK')).toBe('true');
    expect(peutRenvoyerOtpEnClair({ NODE_ENV: 'development', EMAIL_OTP_DEV_FALLBACK: valeurExemple('EMAIL_OTP_DEV_FALLBACK') })).toBe(true);
    // L'ancienne phrase, fausse : absente du fichier, l'OTP est coupe.
    expect(exemple).not.toMatch(/Actif sauf « false »/);
  });

  it('autorise l’émulateur Android à côté du navigateur', () => {
    const origines = (valeurExemple('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim());
    expect(origines).toEqual(expect.arrayContaining(['http://localhost:4200', 'http://10.0.2.2:4200']));
  });
});

describe('env.ts : EMAIL_OTP_DEV_FALLBACK', () => {
  it('lit la variable comme le code qui décide : seul « true » l’active', () => {
    expect(envSchema.parse(BASE).EMAIL_OTP_DEV_FALLBACK).toBe(false);
    expect(envSchema.parse({ ...BASE, EMAIL_OTP_DEV_FALLBACK: 'true' }).EMAIL_OTP_DEV_FALLBACK).toBe(true);
    for (const v of ['false', '1', 'yes', 'TRUE', '']) {
      expect([v, envSchema.parse({ ...BASE, EMAIL_OTP_DEV_FALLBACK: v }).EMAIL_OTP_DEV_FALLBACK]).toEqual([v, false]);
    }
  });
});
