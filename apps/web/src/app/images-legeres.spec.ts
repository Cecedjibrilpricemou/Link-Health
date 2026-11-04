// Images legeres (§4.3 de la revue, faible debit).
//
// login-hero.png pesait 686 Ko et les photos de « Comment ca marche » de
// 142 a 333 Ko, a 1600 px de large pour un affichage d'environ 600 px. Elles
// sont servies en WebP, a la taille utile (srcset), et celles du bas de page
// ne se chargent qu'a l'approche.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src');
const lire = (f: string) => readFileSync(join(src, 'app', f), 'utf8');
const LIMITE = 120 * 1024;

/** Les chemins assets/images/... cites dans un texte (src, srcset, donnees). */
function images(texte: string): string[] {
  return [...texte.matchAll(/assets\/images\/[\w-]+(?:\.\w+)?/g)].map((m) => m[0]);
}

describe('images de l\'accueil et de la connexion', () => {
  const landing = lire('features/landing/landing.component.html');
  const etapes = lire('features/landing/components/how-it-works/how-it-works.component.html');
  const donnees = lire('features/landing/components/how-it-works/how-it-works.component.ts');
  const auth = lire('shared/components/auth-shell/auth-shell.component.html');

  it('ne sert plus de PNG ni de JPEG', () => {
    const cites = [landing, etapes, donnees, auth].flatMap(images);
    expect(cites.filter((c) => /\.(png|jpe?g)$/i.test(c))).toEqual([]);
  });

  it('chaque WebP cité existe et reste léger', () => {
    const webp = [...new Set([landing, etapes, auth].join('\n').match(/assets\/images\/[\w-]+\.webp/g) ?? [])];
    const bases = [...donnees.matchAll(/image: 'assets\/images\/([\w-]+)'/g)].map((m) => m[1]!);
    const tous = [...webp, ...bases.flatMap((b) => [`assets/images/${b}-480.webp`, `assets/images/${b}-800.webp`])];
    expect(tous.length).toBeGreaterThan(6);
    for (const f of tous) {
      const chemin = join(src, f);
      expect(existsSync(chemin), f).toBe(true);
      expect(statSync(chemin).size, f).toBeLessThan(LIMITE);
    }
  });

  it('l\'image d\'en-tête est prioritaire et proposée en deux tailles', () => {
    const img = landing.match(/<img[^>]*login-hero[^>]*>/)?.[0] ?? '';
    expect(img).toMatch(/srcset=/);
    expect(img).toMatch(/fetchpriority="high"/);
    expect(img).not.toMatch(/loading="lazy"/);
  });

  it('les photos du bas de page se chargent à l\'approche, à la bonne taille', () => {
    const img = etapes.match(/<img[\s\S]*?\/?>/)?.[0] ?? '';
    expect(img).toMatch(/loading="lazy"/);
    expect(img).toMatch(/srcset/);
    expect(img).toMatch(/sizes=/);
  });
});
