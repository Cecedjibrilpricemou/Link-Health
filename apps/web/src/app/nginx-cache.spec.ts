// Le cache HTTP de nginx (§4.3 de la revue, faible debit).
//
// Les fichiers dont le nom porte une empreinte (main-C5WO3AC6.js...) ne
// changent jamais : ils se gardent un an. Ceux qui disent quelle version
// charger — index.html, ngsw.json, ngsw-worker.js — se revalident a chaque
// visite : mis en cache, ils empecheraient toute mise a jour d'arriver.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const conf = readFileSync(join(process.cwd(), 'nginx.conf'), 'utf8');

/**
 * Le corps du bloc `location ...` dont l'en-tete contient `motif`. Les bornes
 * sont l'accolade suivie d'un retour a la ligne et celle seule sur sa ligne :
 * une regex de l'en-tete peut contenir `{8}`.
 */
function bloc(motif: string): string {
  const i = conf.indexOf(motif);
  if (i < 0) return '';
  const reste = conf.slice(i);
  const debut = reste.search(/\{\s*\r?\n/);
  const fin = reste.slice(debut).search(/\r?\n\s*\}/);
  return reste.slice(debut, debut + fin);
}

/** La regex PCRE du bloc des fichiers a empreinte, rejouee en JavaScript. */
function regexEmpreinte(): RegExp {
  const m = conf.match(/location ~\* "([^"]+)"/);
  if (!m) throw new Error('bloc des fichiers a empreinte introuvable');
  return new RegExp(m[1]!.replace(/\(\?i\)/, ''), 'i');
}

describe('nginx : cache HTTP', () => {
  it('garde un an, immuables, les fichiers à empreinte', () => {
    const re = regexEmpreinte();
    for (const f of ['/main-C5WO3AC6.js', '/chunk-26ESX2N3.js', '/styles-AB12CD34.css', '/polyfills-ZX9Y8W7V.js']) {
      expect(re.test(f)).toBe(true);
    }
    expect(bloc('location ~* "')).toMatch(/immutable/);
  });

  it('ne prend jamais pour un fichier à empreinte ce qui dit quelle version charger', () => {
    const re = regexEmpreinte();
    for (const f of ['/index.html', '/ngsw.json', '/ngsw-worker.js', '/safety-worker.js', '/favicon.ico']) {
      expect(re.test(f)).toBe(false);
    }
  });

  it('revalide le service worker et son manifeste à chaque visite', () => {
    expect(bloc('location = /ngsw-worker.js')).toMatch(/no-cache/);
    expect(bloc('location = /ngsw.json')).toMatch(/no-cache/);
  });

  it('revalide index.html, y compris quand il sert de repli aux routes', () => {
    expect(bloc('location / ')).toMatch(/no-cache/);
    expect(bloc('location / ')).toMatch(/try_files \$uri \$uri\/ \/index\.html/);
  });

  it('garde un an les polices et images à empreinte de /media/', () => {
    expect(bloc('location /media/')).toMatch(/immutable/);
  });

  it('continue de relayer l\'API sans la mettre en cache', () => {
    const api = bloc('location /api/');
    expect(api).toMatch(/proxy_pass http:\/\/api:3000\/api\//);
    expect(api).not.toMatch(/expires|immutable|proxy_cache/);
  });
});
