// Toute route est contrôlée, ou bien elle est inscrite ici avec sa raison.
//
// **Pourquoi ce fichier existe.** `GET /commandes/:id` est resté quatorze
// jours sans aucun contrôle : ni rôle, ni propriété. N'importe quel compte
// connecté lisait la commande d'un inconnu, avec son nom et ses médicaments.
// `routes-permissions.test.ts` existait déjà, mais il vérifie des routes
// **nommées une par une** : une route oubliée n'y apparaît pas, donc rien
// n'échoue. C'est le propre d'un test par énumération — il prouve ce qu'on a
// pensé à écrire, jamais ce qu'on a oublié.
//
// Ici, l'inverse : on parcourt les 226 routes réellement montées et on exige
// que chacune soit gardée. Une route nouvelle est refusée par défaut, et
// l'ouvrir demande d'écrire pourquoi. C'est la seule forme qui résiste à
// l'oubli.
//
// **Ce que ce test ne peut pas voir.** Il lit la pile de middlewares, donc il
// voit `authenticate` et `requireRole`. Il ne voit pas un contrôle fait dans
// le service — `assertPeutLireCommande`, `assertCanAccessConsultation`, le
// filtrage par auteur du bris de glace. D'où la seconde liste : chaque entrée
// y nomme le contrôle qui remplace la garde de rôle. Si personne ne sait
// l'écrire, c'est qu'il n'y en a pas.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

jest.mock('../src/config/prisma', () => ({ prisma: {} }));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

type Poignee = { name?: string; roles?: readonly string[] };
type Couche = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Poignee }[] };
  handle?: Poignee;
};

/**
 * Les fichiers de routes, tous.
 *
 * La liste est vérifiée contre le contenu du dossier plus bas : un fichier
 * ajouté et non inscrit ici passerait sinon au travers, et c'est exactement
 * le trou que ce test est censé fermer.
 */
const FICHIERS = [
  'admin-structure', 'analytics', 'asc', 'assurance', 'auth', 'bris-de-glace',
  'commande', 'compte', 'consentement', 'consultation', 'course', 'fhir', 'geographie', 'hopital',
  'identite', 'journal', 'laboratoire', 'medecin', 'medicament', 'notification',
  'ordonnance', 'paiement', 'parametres', 'patient', 'pharmacien', 'privacy',
  'recherche', 'referentiel', 'resultats', 'rgpd', 'stats', 'sync', 'triage', 'upload',
  'ussd', 'vaccination', 'webhook-chapchap',
] as const;

/**
 * Les routes atteignables **sans être connecté**, et pourquoi.
 *
 * La clé est `fichier MÉTHODE chemin` — le chemin tel qu'il est déclaré dans
 * son routeur, pas le chemin monté. C'est ce que donne le parcours de pile,
 * donc il n'y a pas de table de correspondance à maintenir à côté.
 */
const PUBLIQUES: Record<string, string> = {
  // ── S'authentifier, forcément avant d'être authentifié.
  'auth POST /login': "point d'entrée ; limité à 20 tentatives par quart d'heure",
  'auth POST /verify-otp': 'second facteur, même session de connexion',
  'auth POST /refresh': 'ne vaut que porteur du cookie de rafraîchissement',
  'auth POST /register': 'création de compte patient',
  'auth POST /forgot-password': 'par définition hors session',
  'auth POST /reset-password': 'vaut par le jeton reçu par courriel, pas par la session',

  // ── Inscription d'un patient par lui-même : la route crée le compte **et**
  // pose les cookies de session. Sans elle, personne ne peut entrer.
  'patient POST /': 'inscription du patient par lui-même ; pose les cookies en retour',

  // ── Ce qu'une page d'accueil doit pouvoir afficher avant toute connexion.
  // A1 : chercher un produit en pharmacie avant meme d'avoir un compte.
  'recherche GET /produits': "recherche publique de produits ; ne rend que des stocks declares par les pharmacies, jamais un produit reglemente, jamais une quantite",
  'parametres GET /publics': "nom et logo de la plateforme, affichés sur l'écran de connexion",
  'stats GET /public': 'compteurs agrégés, aucune donnée nominative',
  'admin-structure GET /structures/publiques':
    "annuaire des établissements, pour choisir où prendre rendez-vous ; déclarée **avant** le router.use(authenticate) du fichier",
  'geographie GET /configuration': "découpage administratif du pays installé (M1) ; aucune donnée personnelle",
  'geographie GET /lieux': "noms des lieux et de leurs voisins (M1), proposés dès l'inscription ; aucune donnée personnelle",

  // ── Deux entrées machine, authentifiées autrement qu'au cookie.
  'ussd POST /session':
    'passerelle USSD de l’opérateur ; signature HMAC horodatée vérifiée par authentifierPasserelleUssd, puis PIN du patient',
  'webhook-chapchap POST /chapchap':
    'rappel de la passerelle de paiement ; authentifié par signature HMAC-SHA256 vérifiée avant toute lecture du corps',
};

/**
 * Les routes ouvertes à **tout rôle connecté**, et ce qui tient lieu de garde.
 *
 * Une entrée ici n'est pas une dispense : elle affirme qu'un contrôle existe
 * ailleurs et dit lequel. Si la phrase ne peut pas être écrite, la route doit
 * recevoir un `requireRole`.
 */
const TOUS_ROLES_CONNECTES: Record<string, string> = {
  // ── Son propre compte. Le périmètre, c'est le porteur du jeton.
  'auth GET /me': 'lit le jeton de l’appelant, rien d’autre',
  'auth POST /logout': 'efface ses propres cookies',
  'auth PUT /change-password': 'son propre mot de passe',
  'auth PUT /profile': 'modifie le profil du porteur du jeton ; ne prend aucun identifiant en entree',
  'auth POST /telephone/demande': 'son propre numero ; exige son mot de passe actuel, aucun identifiant de cible en entree',
  'auth POST /telephone/confirmer': 'sa propre demande en cours, prouvee par le code recu au nouveau numero',
  'upload POST /avatar': 'enregistre la photo du porteur du jeton ; aucun identifiant de cible en entree',

  // ── Ses propres notifications, filtrées sur l'identifiant du jeton.
  'notification GET /me': 'filtré sur user.userId',
  'notification GET /me/non-lues': 'filtré sur user.userId',
  'notification PUT /:id/lire': 'refuse une notification qui n’est pas la sienne',
  'notification PUT /tout-lire': 'filtré sur user.userId',

  // ── Les textes de consentement : tout le monde doit pouvoir les relire.
  'consentement GET /': 'textes publics de consentement, aucune donnée de patient',
  'consentement GET /en-vigueur': 'texte de consentement actuellement applicable, identique pour tous les comptes',

  // ── Contrôle de propriété dans le service, pas dans la pile.
  'commande GET /:id':
    'assertPeutLireCommande — patient, pharmacie détentrice, prescripteur, administration ; c’est la route qui a été trouvée ouverte le 10/10',
  'ordonnance GET /:id': 'assertCanAccessConsultation sur la consultation portante',
  'ordonnance GET /:id/document': 'même assertion, avant de rendre le document imprimable',

  // ── Filtrage par auteur dans le gestionnaire lui-même.
  'bris-de-glace GET /':
    'un soignant ne voit que ses propres accès ; seule l’administration voit tout, et c’est elle qui relit',
};

/* eslint-disable @typescript-eslint/no-require-imports */

/** Toutes les routes montées, avec l'état réel de leurs gardes. */
function inventaire(): { clef: string; auth: boolean; roles: string[] }[] {
  const routes: { clef: string; auth: boolean; roles: string[] }[] = [];

  for (const fichier of FICHIERS) {
    const routeur = require(`../src/routes/${fichier}.routes`).default as { stack: Couche[] };
    let authGlobale = false;
    const rolesGlobaux: string[] = [];

    for (const couche of routeur.stack) {
      // Une garde posée par `router.use(...)` s'applique à tout ce qui suit —
      // et seulement à ce qui suit : l'ordre de déclaration compte, c'est ce
      // qui permet une route publique en tête d'un fichier par ailleurs gardé.
      if (!couche.route) {
        if (couche.handle?.name === 'authenticate') authGlobale = true;
        if (couche.handle?.roles) rolesGlobaux.push(...couche.handle.roles);
        continue;
      }

      let auth = authGlobale;
      const roles = [...rolesGlobaux];
      for (const c of couche.route.stack) {
        if (c.handle?.name === 'authenticate') auth = true;
        if (c.handle?.roles) roles.push(...c.handle.roles);
      }

      for (const methode of Object.keys(couche.route.methods)) {
        if (!couche.route.methods[methode]) continue;
        routes.push({
          clef: `${fichier} ${methode.toUpperCase()} ${couche.route.path}`,
          auth,
          roles: [...new Set(roles)],
        });
      }
    }
  }
  return routes;
}

describe('toute route de l API est gardée, ou inscrite avec sa raison', () => {
  const routes = inventaire();

  it('le parcours trouve bien toutes les routes', () => {
    // Un parcours qui ne trouverait rien passerait les deux assertions
    // suivantes sans rien prouver. C'est le mode d'échec le plus discret
    // d'un test de ce genre.
    expect(routes.length).toBeGreaterThan(200);
  });

  // **Le dossier est la référence, pas la liste.** Un fichier de routes
  // ajouté et oublié dans FICHIERS échapperait à tout ce qui suit.
  it('aucun fichier de routes n échappe au parcours', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const sur = fs
      .readdirSync(`${__dirname}/../src/routes`)
      .filter((f: string) => f.endsWith('.routes.ts'))
      .map((f: string) => f.replace('.routes.ts', ''))
      .sort();
    expect(sur).toEqual([...FICHIERS].sort());
  });

  it('exige authenticate partout, sauf sur les routes publiques déclarées', () => {
    const nues = routes.filter((r) => !r.auth && !PUBLIQUES[r.clef]).map((r) => r.clef);
    expect(nues).toEqual([]);
  });

  it('exige une garde de rôle, sauf là où un autre contrôle est nommé', () => {
    const sansRole = routes
      .filter((r) => r.auth && r.roles.length === 0 && !TOUS_ROLES_CONNECTES[r.clef])
      .map((r) => r.clef);
    expect(sansRole).toEqual([]);
  });

  it('reserve chaque route de course au role attendu', () => {
    const attendues: Record<string, string> = {
      'course GET /ouvertes': 'LIVREUR',
      'course POST /:id/offres': 'LIVREUR',
      'course GET /mes-courses': 'LIVREUR',
      'course GET /commande/:idCommande/offres': 'PATIENT',
      'course POST /commande/:idCommande/choisir': 'PATIENT',
      'course POST /:id/recu': 'PATIENT',
      'course POST /:id/renoncer': 'PATIENT',
      'course POST /:id/remettre': 'PHARMACIEN',
    };
    for (const [clef, role] of Object.entries(attendues)) {
      expect(routes.find((route) => route.clef === clef)?.roles).toEqual([role]);
    }
  });

  it('reserve le recrutement des livreurs aux administrations regionales et nationales', () => {
    const attendues: Record<string, string[]> = {
      'compte POST /livreurs': ['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'],
      'compte GET /livreurs': ['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'],
      'compte PATCH /livreurs/:id/activite': ['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'],
    };
    for (const [clef, roles] of Object.entries(attendues)) {
      expect(routes.find((route) => route.clef === clef)?.roles).toEqual(roles);
    }
  });

  // **Une entrée périmée rouvre la porte en silence.** Si une route est
  // renommée, son inscription reste et ne protège plus rien ; la route
  // nouvelle, elle, n'est inscrite nulle part — mais une liste jamais relue
  // laisserait croire que le sujet est traité.
  it('aucune inscription ne vise une route qui n existe plus', () => {
    const clefs = new Set(routes.map((r) => r.clef));
    const perimees = [...Object.keys(PUBLIQUES), ...Object.keys(TOUS_ROLES_CONNECTES)].filter(
      (c) => !clefs.has(c)
    );
    expect(perimees).toEqual([]);
  });

  // Une raison vide, ou réduite à « ok », ne documente rien.
  it('chaque inscription porte une raison écrite', () => {
    const muettes = Object.entries({ ...PUBLIQUES, ...TOUS_ROLES_CONNECTES })
      .filter(([, raison]) => raison.trim().length < 20)
      .map(([clef]) => clef);
    expect(muettes).toEqual([]);
  });

  // Les deux listes disent des choses contraires : une route ne peut pas
  // être à la fois publique et réservée aux connectés.
  it('les deux listes ne se recouvrent pas', () => {
    const deuxFois = Object.keys(PUBLIQUES).filter((c) => c in TOUS_ROLES_CONNECTES);
    expect(deuxFois).toEqual([]);
  });
});
