// Le nginx de production et la taille des dossiers televerses.
//
// **Le defaut que ce fichier empeche de revenir.** Sans `client_max_body_size`,
// nginx garde son defaut de 1 Mo pour tout le corps d'une requete. La creation
// d'une compagnie d'assurance envoie quatre scans dans une seule requete :
// au-dela de 1 Mo ensemble, nginx repondait 413 par une page HTML, apres le
// televersement. L'API ne voyait rien passer, et l'ecran, faute de message
// lisible, affichait « Une erreur est survenue ». En local, rien ne se voyait :
// le serveur de developpement appelle l'API sans nginx.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const conf = readFileSync(join(process.cwd(), 'nginx.conf'), 'utf8');

/** Le corps du premier bloc dont l'en-tete contient `motif`. */
function bloc(motif: string): string {
  const i = conf.indexOf(motif);
  if (i < 0) return '';
  const reste = conf.slice(i);
  const debut = reste.search(/\{\s*\r?\n/);
  const fin = reste.slice(debut).search(/\r?\n {4}\}/);
  return reste.slice(debut, debut + fin);
}

/** Une taille nginx (`55m`, `1024k`, `2g`) en octets. */
function octets(valeur: string): number {
  const m = valeur.match(/^(\d+)([kmg]?)$/i);
  if (!m) throw new Error(`taille illisible : ${valeur}`);
  const unite = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2]!.toLowerCase() as '' | 'k' | 'm' | 'g'];
  return Number(m[1]) * unite;
}

/**
 * Le dossier le plus lourd que l'API accepte : dix pieces de 5 Mo
 * (`NOMBRE_MAX_PIECES` et `TAILLE_MAX_PIECE` dans `upload.middleware.ts`).
 * Recopie ici parce que l'ecran ne lit pas le code de l'API ; si l'API
 * change ses bornes, ce test doit changer avec elles.
 */
const DOSSIER_LE_PLUS_LOURD = 10 * 5 * 1024 ** 2;

describe('nginx : televersement des dossiers', () => {
  const api = bloc('location /api/');

  it('laisse passer vers l API un dossier complet de pieces', () => {
    const m = api.match(/client_max_body_size\s+(\w+);/);
    expect(m, 'client_max_body_size absent : nginx limite a 1 Mo').not.toBeNull();
    expect(octets(m![1]!)).toBeGreaterThanOrEqual(DOSSIER_LE_PLUS_LOURD);
  });

  it('ne releve pas la limite pour tout le site, seulement pour l API', () => {
    const horsApi = conf.replace(api, '');
    expect(horsApi).not.toMatch(/client_max_body_size/);
  });

  // Une page HTML devient « Une erreur est survenue » a l'ecran ; un JSON
  // dans la forme de l'API y est lu et affiche.
  it('refuse un envoi trop gros par un message que l ecran sait lire', () => {
    expect(api).toMatch(/error_page\s+413\s+@trop_volumineux;/);
    const refus = bloc('location @trop_volumineux');
    expect(refus).toMatch(/default_type\s+"application\/json/);
    const corps = refus.match(/return 413 '(.*)';/);
    expect(corps).not.toBeNull();
    const json = JSON.parse(corps![1]!.replace(/\\'/g, "'")) as { success: boolean; error: string };
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/trop volumineux/);
  });
});
