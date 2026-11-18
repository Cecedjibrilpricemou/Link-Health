import { readFileSync } from 'fs';
import path from 'path';
import type { Response } from 'express';
import {
  CSP_FICHIERS_PUBLICS,
  entetesFichiersPublics,
  OPTIONS_FICHIERS_PUBLICS,
} from '../src/middlewares/fichiers-publics.middleware';

describe('fichiers publics', () => {
  it('pose les en-tetes de securite et appelle next', () => {
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    entetesFichiersPublics({} as never, res as unknown as Response, next);

    expect(res.setHeader).toHaveBeenCalledTimes(3);
    expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Cross-Origin-Resource-Policy', 'cross-origin');
    expect(res.setHeader).toHaveBeenNthCalledWith(2, 'X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenNthCalledWith(3, 'Content-Security-Policy', CSP_FICHIERS_PUBLICS);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('limite la politique de contenu sans script', () => {
    expect(CSP_FICHIERS_PUBLICS).toContain("default-src 'none'");
    expect(CSP_FICHIERS_PUBLICS).toContain('sandbox');
    expect(CSP_FICHIERS_PUBLICS).not.toContain('script-src');
    expect(CSP_FICHIERS_PUBLICS).not.toContain('unsafe-eval');
  });

  it('desactive les fichiers caches, les listes et les redirections', () => {
    expect(OPTIONS_FICHIERS_PUBLICS).toStrictEqual({ dotfiles: 'deny', index: false, redirect: false });
  });

  it('configure une seule fois les fichiers publics dans index.ts', () => {
    const index = readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
    const montageUploads = index.match(/app\.use\(\s*['"]\/uploads['"][\s\S]*?\);/);
    const montagesUploads = index.match(/app\.use\(\s*['"]\/uploads['"]/g) ?? [];

    expect(montageUploads).not.toBeNull();
    expect(montageUploads?.[0]).toContain('entetesFichiersPublics,');
    expect(montageUploads?.[0]).toContain('OPTIONS_FICHIERS_PUBLICS)');
    expect(montagesUploads).toHaveLength(1);
  });
});
