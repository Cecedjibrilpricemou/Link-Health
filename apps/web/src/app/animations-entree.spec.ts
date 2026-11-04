// Les animations d'entree ne cachent plus le contenu (§4.3 de la revue).
//
// L'en-tete de l'accueil et le formulaire de connexion partaient de
// `opacity: 0` avec un flou : apres le demarrage de l'application, il fallait
// encore attendre pres d'une seconde (delais compris) pour lire la page — et
// le flou coute cher a calculer sur un telephone d'entree de gamme. Ils
// glissent desormais legerement, lisibles des la premiere image.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src');
const lire = (f: string) => readFileSync(join(src, f), 'utf8');

/** Le premier etat (`from` ou `0%`) d'une @keyframes. */
function depart(css: string, nom: string): string {
  const i = css.indexOf(`@keyframes ${nom}`);
  if (i < 0) throw new Error(`@keyframes ${nom} introuvable`);
  const bloc = css.slice(i, css.indexOf('\n}', i));
  return bloc.match(/(?:from|0%)\s*\{([^}]*)\}/)?.[1] ?? '';
}

describe("animations d'entrée", () => {
  const landing = lire('app/features/landing/landing.component.scss');
  const auth = lire('styles/_auth.scss');

  for (const [nom, css] of [['bb-land-rise', landing], ['bb-auth-in', auth]] as const) {
    it(`${nom} ne part ni invisible ni flou`, () => {
      const d = depart(css, nom);
      expect(d).not.toMatch(/opacity:\s*0(?![.\d])/);
      expect(d).not.toMatch(/blur/);
    });
  }

  it("l'entrée de l'accueil reste désactivée pour qui réduit les animations", () => {
    const mixin = landing.slice(landing.indexOf('@mixin entree'), landing.indexOf('}\n}', landing.indexOf('@mixin entree')));
    expect(mixin).toMatch(/prefers-reduced-motion:\s*no-preference/);
  });
});
