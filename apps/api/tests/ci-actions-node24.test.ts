/**
 * GitHub retire l'environnement Node 20 des runners : une action JavaScript
 * encore construite pour Node 20 fait d'abord afficher un avertissement,
 * puis fait échouer le job. Ce test liste les versions minimales (Node 24)
 * des actions utilisées par nos workflows.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = join(__dirname, '..', '..', '..', '.github', 'workflows');

// Première version majeure qui tourne sous Node 24.
const MAJEURE_MINIMALE: Record<string, number> = {
  'actions/checkout': 5,
  'actions/setup-node': 5,
  'actions/setup-python': 6,
  'actions/upload-artifact': 6,
  'actions/download-artifact': 7,
  'actions/cache': 5,
};

describe('Workflows CI : actions compatibles Node 24', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => /\.ya?ml$/.test(f));

  it('trouve au moins un workflow', () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it.each(fichiers)('%s n’utilise aucune action restée sous Node 20', (fichier) => {
    const contenu = readFileSync(join(DOSSIER, fichier), 'utf8');
    const obsoletes: string[] = [];
    for (const m of contenu.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@v(\d+)/g)) {
      const minimale = MAJEURE_MINIMALE[m[1]];
      if (minimale !== undefined && Number(m[2]) < minimale) {
        obsoletes.push(`${m[1]}@v${m[2]} (v${minimale} minimum)`);
      }
    }
    expect(obsoletes).toEqual([]);
  });
});
