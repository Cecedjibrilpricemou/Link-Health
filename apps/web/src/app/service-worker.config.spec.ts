// Le service worker : l'application se charge sans reseau (§4.3 de la revue),
// mais **aucune reponse de l'API n'est mise en cache**.
//
// Les reponses de l'API sont des donnees medicales, et un meme telephone peut
// servir a plusieurs personnes (ASC, comptoir). Seule la coquille — HTML, JS,
// CSS, polices, images — est gardee pour fonctionner hors ligne ; les envois
// hors ligne restent l'affaire de la file d'attente (OfflineQueueService).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const web = process.cwd();
const lireJson = (f: string) => JSON.parse(readFileSync(join(web, f), 'utf8'));

describe('service worker', () => {
  it('existe, et met la coquille en cache dès l\'installation', () => {
    expect(existsSync(join(web, 'ngsw-config.json'))).toBe(true);
    const cfg = lireJson('ngsw-config.json');
    const app = cfg.assetGroups.find((g: { name: string }) => g.name === 'app');
    expect(app.installMode).toBe('prefetch');
    expect(app.resources.files).toEqual(expect.arrayContaining(['/index.html', '/*.js', '/*.css']));
  });

  it('ne met jamais en cache une réponse de l\'API', () => {
    const cfg = lireJson('ngsw-config.json');
    const urls: string[] = (cfg.dataGroups ?? []).flatMap((g: { urls: string[] }) => g.urls);
    expect(urls.filter((u) => /api/i.test(u))).toEqual([]);
    const fichiers: string[] = cfg.assetGroups.flatMap((g: { resources: { files?: string[]; urls?: string[] } }) =>
      [...(g.resources.files ?? []), ...(g.resources.urls ?? [])]);
    expect(fichiers.filter((u) => /api/i.test(u))).toEqual([]);
  });

  it('est généré par le build de production', () => {
    const angular = lireJson('angular.json');
    const projet = Object.values(angular.projects)[0] as { architect: { build: { configurations: Record<string, { serviceWorker?: string }> } } };
    expect(projet.architect.build.configurations['production'].serviceWorker).toBe('ngsw-config.json');
  });

  it('est enregistré hors développement seulement', () => {
    const config = readFileSync(join(web, 'src', 'app', 'app.config.ts'), 'utf8');
    expect(config).toMatch(/provideServiceWorker\(\s*'ngsw-worker\.js'/);
    expect(config).toMatch(/enabled:\s*!isDevMode\(\)/);
  });
});
