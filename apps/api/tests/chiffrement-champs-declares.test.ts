// La liste des champs chiffres doit designer des champs qui existent, la ou
// ils existent. Une faute de modele ne fait aucun bruit : l'extension ne
// chiffre simplement rien, et la donnee reste en clair.
//
// C'est arrive : `posologie` et `instructions` etaient declares sous
// `Ordonnance`, alors qu'ils vivent sur `LigneOrdonnance`. Ils sont restes en
// clair des le premier jour, et seul un rattrapage interrompu l'a revele.
// Ce test confronte la liste au schema Prisma lui-meme.
import { readFileSync } from 'fs';
import { join } from 'path';
import { EMPREINTES, ENCRYPTED_FIELDS } from '../src/config/prisma-encryption.extension';

/** Les champs de chaque modele, avec leur type tel qu'ecrit dans le schema. */
function champsDuSchema(): Map<string, Map<string, string>> {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const modeles = new Map<string, Map<string, string>>();
  for (const bloc of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const champs = new Map<string, string>();
    for (const ligne of bloc[2]!.split(/\r?\n/)) {
      const m = /^\s*(\w+)\s+([\w[\]?]+)/.exec(ligne);
      if (m && !ligne.trim().startsWith('//') && !ligne.trim().startsWith('@@')) champs.set(m[1]!, m[2]!);
    }
    modeles.set(bloc[1]!, champs);
  }
  return modeles;
}

const SCHEMA = champsDuSchema();

describe('les champs declares chiffres', () => {
  it('le schema est bien lu', () => {
    expect(SCHEMA.get('LigneOrdonnance')?.get('posologie')).toBe('String');
  });

  const scalaires = Object.entries(ENCRYPTED_FIELDS).flatMap(([m, f]) => f.scalar.map((c) => [m, c] as const));
  const tableaux = Object.entries(ENCRYPTED_FIELDS).flatMap(([m, f]) => f.array.map((c) => [m, c] as const));

  it.each(scalaires)('%s.%s existe et est un texte', (modele, champ) => {
    expect(SCHEMA.has(modele)).toBe(true);
    expect(SCHEMA.get(modele)!.get(champ)).toMatch(/^String\??$/);
  });

  it.each(tableaux)('%s.%s existe et est une liste de textes', (modele, champ) => {
    expect(SCHEMA.get(modele)?.get(champ)).toBe('String[]');
  });

  it('chaque empreinte porte sur un champ chiffre, dans une colonne texte qui existe', () => {
    for (const [modele, empreintes] of Object.entries(EMPREINTES)) {
      for (const [champ, colonne] of Object.entries(empreintes)) {
        expect(ENCRYPTED_FIELDS[modele]?.scalar).toContain(champ);
        expect(SCHEMA.get(modele)?.get(colonne)).toMatch(/^String\??$/);
      }
    }
  });
});
