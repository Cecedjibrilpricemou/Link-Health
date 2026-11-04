// La page d'arrivee de chaque role, en un seul endroit.
//
// Deux tables la decidaient (connexion et garde de role) et elles avaient
// diverge : le livreur manquait au garde, et le pharmacien arrivait sur les
// ordonnances — page que le caissier d'officine n'a meme pas dans son menu.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCUEIL_PAR_ROLE, accueilDuRole } from './accueil-par-role';

const app = join(process.cwd(), 'src', 'app');

describe("page d'arrivée par rôle", () => {
  it('le pharmacien arrive sur son tableau de bord', () => {
    expect(accueilDuRole('PHARMACIEN')).toBe('/pharmacien/tableau-de-bord');
  });

  it('le livreur a une page d\'arrivée', () => {
    expect(accueilDuRole('LIVREUR')).toBe('/livreur/courses');
  });

  it('un rôle inconnu ou absent n\'a pas de page', () => {
    expect(accueilDuRole('INCONNU')).toBeUndefined();
    expect(accueilDuRole(null)).toBeUndefined();
  });

  it('chaque page d\'arrivée commence par l\'espace du rôle', () => {
    for (const url of Object.values(ACCUEIL_PAR_ROLE)) expect(url).toMatch(/^\/[a-z-]+\/[a-z-]+$/);
  });

  it('la connexion et le garde de rôle lisent la même table', () => {
    for (const f of ['features/auth/login/login.component.ts', 'core/guards/role.guard.ts']) {
      const source = readFileSync(join(app, f), 'utf8');
      expect(source).toContain('accueilDuRole');
      expect(source).not.toMatch(/PHARMACIEN:\s*'\/pharmacien/);
    }
  });
});
