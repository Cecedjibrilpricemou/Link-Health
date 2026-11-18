// La configuration de production : ce que le conteneur expose, et ce que
// l'API renvoie en clair.
//
// **Le constat.** `docker/docker-compose.yml` lancait l'API en
// `NODE_ENV=development`, avec le mot de passe Postgres ecrit en dur, et
// publiait Postgres et Redis (sans mot de passe) sur toutes les interfaces.
// Hors production, et sans variable pour l'interdire, l'API renvoyait le code
// OTP dans la reponse de connexion : la double authentification ne servait
// plus a rien. Il n'existait pas d'autre fichier compose.
import { readFileSync } from 'fs';
import { join } from 'path';
import { peutRenvoyerOtpEnClair } from '../src/utils/otp-developpement';

describe('peutRenvoyerOtpEnClair — opt-in explicite', () => {
  it('refuse par defaut, sans variable', () => {
    expect(peutRenvoyerOtpEnClair({ NODE_ENV: 'development' })).toBe(false);
  });

  it('refuse pour toute valeur autre que "true"', () => {
    for (const valeur of ['', '1', 'yes', 'TRUE', 'false', 'oui']) {
      expect(peutRenvoyerOtpEnClair({ NODE_ENV: 'development', EMAIL_OTP_DEV_FALLBACK: valeur })).toBe(false);
    }
  });

  it('accepte en developpement quand la variable vaut exactement "true"', () => {
    expect(peutRenvoyerOtpEnClair({ NODE_ENV: 'development', EMAIL_OTP_DEV_FALLBACK: 'true' })).toBe(true);
  });

  it('refuse toujours en production, meme avec la variable', () => {
    expect(peutRenvoyerOtpEnClair({ NODE_ENV: 'production', EMAIL_OTP_DEV_FALLBACK: 'true' })).toBe(false);
  });
});

describe('auth.service', () => {
  it("passe par peutRenvoyerOtpEnClair, et n'a plus de test « !== 'false' »", () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'services', 'auth.service.ts'), 'utf8');
    expect(source).toMatch(/peutRenvoyerOtpEnClair\(\)/);
    expect(source).not.toMatch(/EMAIL_OTP_DEV_FALLBACK\s*!==\s*'false'/);
  });
});

describe('docker/docker-compose.prod.yml', () => {
  const chemin = join(__dirname, '..', '..', '..', 'docker', 'docker-compose.prod.yml');
  // Sous Windows, git peut extraire le fichier en CRLF : sans cette
  // normalisation, `service()` ne trouvait plus aucun bloc.
  const compose = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');

  /** Le bloc d'un service : de son nom au service suivant (meme indentation). */
  function service(nom: string): string {
    const m = compose.match(new RegExp(`\\n  ${nom}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|\\nvolumes:|$)`));
    if (!m) throw new Error(`service ${nom} introuvable`);
    return m[1]!;
  }

  it("lance l'API en production", () => {
    expect(service('api')).toMatch(/NODE_ENV:\s*production/);
    expect(compose).not.toMatch(/NODE_ENV:\s*development/);
  });

  it("n'active jamais l'OTP en clair", () => {
    expect(compose).not.toMatch(/EMAIL_OTP_DEV_FALLBACK/);
  });

  it("n'ecrit aucun mot de passe en dur : tout secret est une variable obligatoire", () => {
    expect(compose).not.toMatch(/baobao_password/);
    for (const secret of ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'DB_ENCRYPTION_KEY']) {
      expect(compose).toMatch(new RegExp(`\\$\\{${secret}:\\?`));
    }
  });

  it("ne publie Postgres que sur l'interface locale du serveur", () => {
    const ports = service('postgres').match(/ports:\s*\n((?:\s+- .*\n?)+)/)?.[1] ?? '';
    for (const ligne of ports.split('\n').filter((l) => l.trim().startsWith('-'))) {
      expect(ligne).toMatch(/127\.0\.0\.1:/);
    }
  });

  it('ne publie pas Redis, et lui impose un mot de passe', () => {
    const redis = service('redis');
    expect(redis).not.toMatch(/ports:/);
    expect(redis).toMatch(/--requirepass/);
  });

  it("donne a l'API l'adresse Redis avec son mot de passe", () => {
    expect(service('api')).toMatch(/REDIS_URL:\s*redis:\/\/:\$\{REDIS_PASSWORD/);
  });

  /**
   * **Le defaut que ce test ferme.** Le service `api` n'avait aucun volume :
   * les fichiers televerses vivaient dans le conteneur, et **chaque
   * redeploiement les effacait**. Les avatars et les logos se reparent en les
   * reposant. Les pieces d'agrement, non : elles sont la preuve sur laquelle
   * une structure a ete admise, et le candidat n'a aucun moyen de les
   * redeposer une fois son dossier valide.
   *
   * Invisible en developpement, ou le disque est celui de la machine.
   */
  it("conserve les fichiers televerses d'un deploiement a l'autre", () => {
    const api = service('api');
    expect(api).toMatch(/api_stockage_prive:\/repo\/apps\/api\/stockage-prive/);
    expect(api).toMatch(/api_uploads:\/repo\/apps\/api\/uploads/);

    // Un volume nomme non declare fait echouer `docker compose up`.
    const declares = compose.match(/\nvolumes:\n([\s\S]*)$/)?.[1] ?? '';
    expect(declares).toMatch(/^\s+api_stockage_prive:/m);
    expect(declares).toMatch(/^\s+api_uploads:/m);
  });
});

/**
 * Les deux dossiers doivent exister dans l'image **avant** le changement de
 * proprietaire.
 *
 * Docker, montant un volume vide sur un dossier qui existe dans l'image, en
 * reprend le proprietaire. Sur un dossier absent, il le cree pour `root` — et
 * l'API, qui tourne en `node`, ne peut plus y ecrire. Le premier
 * televersement echouerait sur un refus de permission, en production
 * seulement.
 */
describe('apps/api/Dockerfile', () => {
  const dockerfile = readFileSync(join(__dirname, '..', 'Dockerfile'), 'utf8').replace(/\r\n/g, '\n');

  it('cree les deux dossiers de fichiers avant de changer leur proprietaire', () => {
    const mkdir = dockerfile.indexOf('mkdir -p /repo/apps/api/uploads');
    const chown = dockerfile.indexOf('chown -R node:node /repo');

    expect(mkdir).toBeGreaterThan(-1);
    expect(dockerfile).toMatch(/mkdir -p .*stockage-prive\/agrements/);
    expect(chown).toBeGreaterThan(mkdir);
  });

  it("n'execute pas l'API en root", () => {
    expect(dockerfile).toMatch(/\nUSER node\n/);
  });
});
