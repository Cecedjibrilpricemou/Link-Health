// La sage-femme a les ecrans et les actes du medecin.
//
// Ce que ce fichier tient :
//   - `estPraticien` reconnait le medecin et la sage-femme, et personne d'autre ;
//   - **aucune garde de route ne s'ouvre au medecin sans s'ouvrir a la
//     sage-femme** : une route ajoutee demain avec `requireRole('MEDECIN')`
//     seul fait tomber ce test, au lieu de fermer en silence une porte a la
//     sage-femme ;
//   - aucun service ne compare plus le role a `'MEDECIN'` en dur : c'est
//     ainsi qu'elle tombait dans la branche « agent communautaire » d'un `if`
//     et se voyait refuser sa propre consultation.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { estPraticien, nomDuPraticien, qualiteDuPraticien, ROLES_PRATICIENS } from '../src/utils/praticien.util';

const SRC = join(__dirname, '..', 'src');

function sources(dossier: string): { chemin: string; texte: string }[] {
  return readdirSync(join(SRC, dossier))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ chemin: `${dossier}/${f}`, texte: readFileSync(join(SRC, dossier, f), 'utf8') }));
}

/** Les appels `requireRole(...)` d'un fichier, parentheses equilibrees. */
function gardes(texte: string): string[] {
  const trouves: string[] = [];
  let i = texte.indexOf('requireRole(');
  while (i >= 0) {
    let k = i + 'requireRole('.length;
    let profondeur = 1;
    while (profondeur > 0 && k < texte.length) {
      if (texte[k] === '(') profondeur += 1;
      if (texte[k] === ')') profondeur -= 1;
      k += 1;
    }
    trouves.push(texte.slice(i, k));
    i = texte.indexOf('requireRole(', k);
  }
  return trouves;
}

describe('qui exerce comme un medecin', () => {
  it('le medecin et la sage-femme, personne d autre', () => {
    expect([...ROLES_PRATICIENS]).toEqual(['MEDECIN', 'SAGE_FEMME']);
    expect(estPraticien('MEDECIN')).toBe(true);
    expect(estPraticien('SAGE_FEMME')).toBe(true);
    for (const r of ['ASC', 'ASC_SUPERVISOR', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO', 'PHARMACIEN', 'ADMIN_STRUCTURE', 'PATIENT', null, undefined, '']) {
      expect(estPraticien(r)).toBe(false);
    }
  });
});

// Une sage-femme n'est pas docteur : l'appeler ainsi sur un compte rendu ou
// dans le parcours du patient lui preterait un titre qu'elle n'a pas.
describe('comment on la nomme', () => {
  it('« Dr » pour le medecin seul ; sans role connu, l usage d avant', () => {
    expect(nomDuPraticien({ prenom: 'Awa', nom: 'Keita', role: 'SAGE_FEMME' })).toBe('Awa Keita');
    expect(nomDuPraticien({ prenom: 'Alpha', nom: 'Bah', role: 'MEDECIN' })).toBe('Dr Alpha Bah');
    expect(nomDuPraticien({ prenom: 'Alpha', nom: 'Bah' })).toBe('Dr Alpha Bah');
    expect(qualiteDuPraticien('SAGE_FEMME')).toBe('Sage-femme');
    expect(qualiteDuPraticien('MEDECIN')).toBe('Médecin');
  });

  it('plus aucun « Dr » ecrit en dur dans les services', () => {
    const enDur = sources('services')
      .flatMap(({ chemin, texte }) => texte.split('\n').map((l, n) => ({ chemin, n: n + 1, l })))
      .filter(({ l }) => /[`'"]Dr [$'"`]|'<br>Dr '/.test(l))
      .map(({ chemin, n, l }) => `${chemin}:${n} ${l.trim()}`);
    expect(enDur).toEqual([]);
  });
});

describe('les portes du medecin sont celles de la sage-femme', () => {
  it('chaque garde qui laisse passer le medecin laisse passer la sage-femme', () => {
    const oublis: string[] = [];
    let vues = 0;
    for (const { chemin, texte } of sources('routes')) {
      for (const g of gardes(texte)) {
        if (!g.includes("'MEDECIN'")) continue;
        vues += 1;
        if (!g.includes("'SAGE_FEMME'")) oublis.push(`${chemin} : ${g.replace(/\s+/g, ' ')}`);
      }
    }
    expect(oublis).toEqual([]);
    // Le balayage a bien trouve les gardes : un test qui ne voit rien ne protege rien.
    expect(vues).toBeGreaterThan(30);
  });

  it('aucun service ne compare plus le role au seul medecin', () => {
    const enDur = /role\s*[!=]==\s*(?:'MEDECIN'|Role\.MEDECIN)|role:\s*(?:'MEDECIN'|Role\.MEDECIN)\b/;
    const trouves = [...sources('services'), ...sources('middlewares')]
      .flatMap(({ chemin, texte }) => texte.split('\n').map((l, n) => ({ chemin, n: n + 1, l })))
      .filter(({ l }) => enDur.test(l))
      // La specialite n'appartient qu'au medecin : la sage-femme n'en a pas.
      .filter(({ l }) => !/specialite/.test(l))
      .map(({ chemin, n, l }) => `${chemin}:${n} ${l.trim()}`);
    expect(trouves).toEqual([]);
  });
});
