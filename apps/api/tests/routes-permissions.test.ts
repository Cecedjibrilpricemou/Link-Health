// Qui peut atteindre quoi.
//
// Les gardes de route n'etaient couvertes par aucun test : retirer un
// `requireRole` d'une route ne cassait rien, et l'API s'ouvrait en silence.
// `requireRole` porte desormais ses roles (`GardeDeRole.roles`), ce qui permet
// de parcourir la pile d'un routeur et d'affirmer le cablage reel.
//
// Ce fichier verrouille en particulier l'addendum du 2026-09-28, point 9 :
// l'agent d'accueil ne fait plus rien de medical — ni prescription, ni
// ordonnance, ni produit.
import type { Role } from '../src/config/generated/client/client';

// Ce fichier est le seul a importer de vrais routeurs : ils tirent
// `auth.middleware`, qui lit ces secrets au chargement du module. Les autres
// suites n'en ont pas besoin, d'ou l'absence de fichier de setup global.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

// Ce fichier est le seul a importer de vrais routeurs : ils tirent
// `auth.middleware`, qui lit ces secrets au chargement du module. Les autres
// suites n'en ont pas besoin, d'ou l'absence de fichier de setup global.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

jest.mock('../src/config/prisma', () => ({ prisma: {} }));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

type Couche = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle?: unknown;
};

/** Les gardes de profil d'officine restent distinctes des roles globaux. */
function rolesOfficinePour(routeur: { stack: Couche[] }, methode: string, chemin: string): string[] | null {
  const route = routeur.stack.find((c) => c.route?.path === chemin && c.route.methods[methode]);
  if (!route) return null;
  return route.route!.stack.flatMap((c) => [
    ...(((c.handle as { rolesOfficine?: readonly string[] })?.rolesOfficine) ?? []),
  ]);
}

/** Les roles qui peuvent atteindre `methode chemin`, gardes du routeur comprises. */
function rolesPour(routeur: { stack: Couche[] }, methode: string, chemin: string): Role[] | null {
  const globales: Role[][] = [];
  for (const couche of routeur.stack) {
    // Une garde posee par `router.use(...)` s'applique a tout ce qui suit.
    if (!couche.route) {
      const r = (couche.handle as { roles?: readonly Role[] })?.roles;
      if (r) globales.push([...r]);
      continue;
    }
    if (couche.route.path !== chemin || !couche.route.methods[methode]) continue;

    const propres: Role[][] = [];
    for (const c of couche.route.stack) {
      const r = (c.handle as { roles?: readonly Role[] })?.roles;
      if (r) propres.push([...r]);
    }
    // L'intersection de toutes les gardes traversees : chacune doit passer.
    const toutes = [...globales, ...propres];
    if (!toutes.length) return [];
    return toutes.reduce((a, b) => a.filter((x) => b.includes(x)));
  }
  return null;
}

// Les routeurs s'importent apres les mocks.
/* eslint-disable @typescript-eslint/no-require-imports */
const hopital = require('../src/routes/hopital.routes').default as { stack: Couche[] };
const commande = require('../src/routes/commande.routes').default as { stack: Couche[] };
const resultats = require('../src/routes/resultats.routes').default as { stack: Couche[] };
const medecin = require('../src/routes/medecin.routes').default as { stack: Couche[] };
const pharmacien = require('../src/routes/pharmacien.routes').default as { stack: Couche[] };
const assurance = require('../src/routes/assurance.routes').default as { stack: Couche[] };
const referentiels = require('../src/routes/referentiel.routes').default as { stack: Couche[] };
const journal = require('../src/routes/journal.routes').default as { stack: Couche[] };
const comptes = require('../src/routes/compte.routes').default as { stack: Couche[] };
const rgpd = require('../src/routes/rgpd.routes').default as { stack: Couche[] };
const privacy = require('../src/routes/privacy.routes').default as { stack: Couche[] };
const identites = require('../src/routes/identite.routes').default as { stack: Couche[] };
const adminStructure = require('../src/routes/admin-structure.routes').default as { stack: Couche[] };
const consultations = require('../src/routes/consultation.routes').default as { stack: Couche[] };
const courses = require('../src/routes/course.routes').default as { stack: Couche[] };

describe('disponibilite et zone du motard (M4)', () => {
  it('les trois routes ne sont ouvertes qu au livreur', () => {
    expect(rolesPour(courses, 'get', '/livreur/profil')).toEqual(['LIVREUR']);
    expect(rolesPour(courses, 'put', '/livreur/service')).toEqual(['LIVREUR']);
    expect(rolesPour(courses, 'put', '/livreur/communes')).toEqual(['LIVREUR']);
  });
});
const paiements = require('../src/routes/paiement.routes').default as { stack: Couche[] };

describe('compte rendu de consultation (EF-05-03)', () => {
  it('ouvert au patient et aux soignants, ferme a l administration et au comptoir', () => {
    expect(rolesPour(consultations, 'get', '/:id/compte-rendu')).toEqual(['PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN']);
  });

  describe('recu de paiement', () => {
    it('est reserve au patient', () => {
      expect(rolesPour(paiements, 'get', '/factures/:id/recu')).toEqual(['PATIENT']);
    });
  });
});

describe('creation des pharmacies hospitalieres', () => {
  it('est ouverte a l administrateur de structure et au super-admin', () => {
    expect(rolesPour(adminStructure, 'post', '/pharmacies')).toEqual(['SUPER_ADMIN', 'ADMIN_STRUCTURE']);
  });

  it('la liste des pharmacies hospitalieres est reservee a l administrateur de structure', () => {
    expect(rolesPour(adminStructure, 'get', '/pharmacies')).toEqual(['ADMIN_STRUCTURE']);
  });
});

describe('l accueil ne fait plus rien de medical (addendum, point 9)', () => {
  // Chacune de ces routes lui etait ouverte avant le 2026-09-28.
  const INTERDITES: [string, string, string][] = [
    ['hopital', 'post', '/episodes/:id/demandes-analyse'],
    ['hopital', 'get', '/demandes-analyse/:id'],
    ['hopital', 'post', '/demandes-analyse/:id/annuler'],
    ['hopital', 'get', '/demandes-analyse/:id/document'],
    ['hopital', 'post', '/episodes/:id/cloturer'],
    ['commande', 'post', '/'],
  ];
  const ROUTEURS: Record<string, { stack: Couche[] }> = { hopital, commande, resultats };

  it.each(INTERDITES)('%s %s %s refuse AGENT_ACCUEIL', (nom, methode, chemin) => {
    const roles = rolesPour(ROUTEURS[nom]!, methode, chemin);
    expect(roles).not.toBeNull();
    expect(roles).not.toContain('AGENT_ACCUEIL');
  });

  it('la lecture des resultats lui est fermee', () => {
    // Garde posee au niveau du routeur : elle couvre toutes ses routes.
    const globales = resultats.stack
      .filter((c) => !c.route)
      .flatMap((c) => [...((c.handle as { roles?: readonly Role[] })?.roles ?? [])]);
    expect(globales.length).toBeGreaterThan(0);
    expect(globales).not.toContain('AGENT_ACCUEIL');
    expect(globales).toContain('MEDECIN');
  });
});

describe('ce que l accueil garde', () => {
  // Il cherche le patient, ouvre l'episode de la visite et redirige. Lui
  // retirer cela le laisserait sans moyen de pointer une arrivee.
  const GARDEES: [string, string][] = [
    ['get', '/patients/recherche'],
    ['post', '/episodes'],
    ['get', '/episodes'],
    ['post', '/episodes/:id/orientation'],
  ];

  it.each(GARDEES)('%s %s reste ouverte a AGENT_ACCUEIL', (methode, chemin) => {
    expect(rolesPour(hopital, methode, chemin)).toContain('AGENT_ACCUEIL');
  });
});

describe('ce qui revient au medecin', () => {
  it('prescrire une analyse lui est ouvert', () => {
    expect(rolesPour(hopital, 'post', '/episodes/:id/demandes-analyse')).toContain('MEDECIN');
  });

  it('cloturer l episode lui est ouvert', () => {
    expect(rolesPour(hopital, 'post', '/episodes/:id/cloturer')).toContain('MEDECIN');
  });

  // Liberer des resultats est un acte medical : ni l'administrateur de la
  // structure, qui atteint pourtant le reste du routeur, ni personne d'autre.
  it('liberer des resultats est reserve au seul MEDECIN', () => {
    expect(rolesPour(medecin, 'post', '/resultats/:id/liberer')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'get', '/resultats')).toEqual(['MEDECIN']);
  });

  // Addendum, point 3 : le creneau appartient au medecin. L'administrateur de
  // structure atteint le reste du routeur mais n'a pas d'agenda a tenir.
  it('fixer un rendez-vous et tenir son agenda sont reserves au MEDECIN', () => {
    expect(rolesPour(medecin, 'post', '/orientations/:idEpisode/rendez-vous')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'get', '/rendez-vous')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'patch', '/rendez-vous/:id/statut')).toEqual(['MEDECIN']);
  });
});

describe('prise de rendez-vous a distance (addendum, point 6)', () => {
  // Chaque metier a son geste, et un seul.
  it('seul le medecin accepte ou refuse une demande', () => {
    expect(rolesPour(medecin, 'get', '/demandes')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'post', '/demandes/:id/accepter')).toEqual(['MEDECIN']);
    expect(rolesPour(medecin, 'post', '/demandes/:id/refuser')).toEqual(['MEDECIN']);
  });

  // L'accueil oriente ce que personne ne vise : c'est son metier.
  it('l accueil oriente, et n a pas de route pour accepter', () => {
    expect(rolesPour(hopital, 'get', '/demandes')).toContain('AGENT_ACCUEIL');
    expect(rolesPour(hopital, 'post', '/demandes/:id/orienter')).toContain('AGENT_ACCUEIL');
    expect(rolesPour(hopital, 'post', '/demandes/:id/accepter')).toBeNull();
  });
});

describe('le pointage de presence reste a l accueil (addendum, point 2)', () => {
  // C'est le seul geste de l'accueil sur un rendez-vous : il ne le cree pas et
  // n'en change pas l'heure. Le lui retirer le priverait de son metier.
  it.each([
    ['get', '/presences'],
    ['post', '/rendez-vous/:id/presence'],
  ])('%s %s reste ouverte a AGENT_ACCUEIL', (methode, chemin) => {
    expect(rolesPour(hopital, methode, chemin)).toContain('AGENT_ACCUEIL');
  });

  // Mais il ne doit pas pouvoir creer de rendez-vous par cette porte.
  it('l accueil n a aucune route de creation de rendez-vous', () => {
    const cheminsRdv = hopital.stack
      .filter((c) => c.route?.path.includes('rendez-vous'))
      .map((c) => `${Object.keys(c.route!.methods)[0]} ${c.route!.path}`);
    expect(cheminsRdv).toEqual(['post /rendez-vous/:id/presence']);
  });
});


// ── La caisse appartient a l'officine (addendum, points 1.1 et 1.2) ──
describe('le comptoir d officine est reserve au pharmacien', () => {
  it.each([
    ['post', '/ventes'],
    ['get', '/ventes'],
    ['get', '/ventes/:id'],
    ['post', '/ventes/:id/annuler'],
    ['get', '/tableau-de-bord'],
  ])('%s %s n est ouverte qu a PHARMACIEN', (methode, chemin) => {
    expect(rolesPour(pharmacien, methode, chemin)).toEqual(['PHARMACIEN']);
  });

  describe('les permissions internes de l officine', () => {
    it.each([
      ['get', '/agents'],
      ['post', '/agents'],
      ['get', '/connexions'],
      ['post', '/catalogue-local'],
      ['patch', '/catalogue-local/:id'],
      ['delete', '/catalogue-local/:id'],
      ['post', '/approvisionnements'],
      ['post', '/stocks/reapprovisionner'],
      ['get', '/stocks/mouvements'],
      ['post', '/stocks/lots/:idLot/ajuster'],
      ['put', '/agents/:id/role-permanent'],
    ])('%s %s est reserve au titulaire', (methode, chemin) => {
      expect(rolesOfficinePour(pharmacien, methode, chemin)).toEqual(['TITULAIRE']);
    });

    it('autorise l annulation apres verification du titulaire au niveau du service', () => {
      expect(rolesOfficinePour(pharmacien, 'post', '/ventes/:id/annuler')).toEqual([]);
    });

    it.each([
      ['post', '/ordonnances/verifier'],
      ['post', '/ordonnances/:id/delivrer'],
    ])('%s %s reste reserve au personnel clinique', (methode, chemin) => {
      expect(rolesOfficinePour(pharmacien, methode, chemin)).toEqual([
        'TITULAIRE', 'ADJOINT', 'PREPARATEUR',
      ]);
    });

    it('les commandes pharmaceutiques ne sont pas accessibles au caissier', () => {
      expect(rolesOfficinePour(commande, 'get', '/pharmacie')).toEqual([
        'TITULAIRE', 'ADJOINT', 'PREPARATEUR',
      ]);
      expect(rolesOfficinePour(commande, 'post', '/:id/chiffrer')).toEqual([
        'TITULAIRE', 'ADJOINT', 'PREPARATEUR',
      ]);
    });
  });

  // Le chiffre d'affaires d'une officine n'est pas une donnee de soin : ni le
  // medecin, ni l'accueil, ni l'ASC n'ont a le lire.
  it.each(['MEDECIN', 'AGENT_ACCUEIL', 'ASC', 'TECHNICIEN_LABO', 'PATIENT'] as const)(
    'ferme le tableau de bord a %s',
    (role) => {
      expect(rolesPour(pharmacien, 'get', '/tableau-de-bord')).not.toContain(role);
    }
  );

  it('les routes caisse existent bien et restent limitees au personnel officinal', () => {
    for (const [methode, chemin] of [
      ['get', '/caisse/session'],
      ['post', '/caisse/sessions'],
      ['post', '/caisse/sessions/:id/cloturer'],
      ['get', '/caisse/rapport'],
    ] as const) {
      expect(rolesOfficinePour(pharmacien, methode, chemin)).toEqual([
        'TITULAIRE', 'ADJOINT', 'PREPARATEUR', 'CAISSIER',
      ]);
      expect(rolesPour(pharmacien, methode, chemin)).toEqual(['PHARMACIEN']);
    }
  });

  // Une route qu'on croit protegee mais qui n'existe pas donnerait un test
  // vert sans rien garder.
  it('les cinq routes de vente existent bien', () => {
    for (const [methode, chemin] of [
      ['post', '/ventes'], ['get', '/ventes'], ['get', '/ventes/:id'],
      ['post', '/ventes/:id/annuler'], ['get', '/tableau-de-bord'],
    ] as const) {
      expect(rolesPour(pharmacien, methode, chemin)).not.toBeNull();
    }
  });
});


// ── Assurance : deux publics, deux niveaux (EF-09) ───────────────────
describe('l assurance separe le comptoir de l administration', () => {
  // Le comptoir controle et chiffre ; il ne cree ni assureur ni contrat.
  it.each([
    ['post', '/eligibilite'],
    ['get', '/patients/:id/eligibilite'],
  ])('%s %s est ouverte au comptoir', (methode, chemin) => {
    const roles = rolesPour(assurance, methode, chemin);
    expect(roles).toContain('PHARMACIEN');
    expect(roles).toContain('AGENT_ACCUEIL');
  });

  it.each([
    ['post', '/assureurs'],
    ['post', '/assureurs/:id/regles'],
    ['post', '/contrats'],
  ])('%s %s est reservee a l administration nationale', (methode, chemin) => {
    expect(rolesPour(assurance, methode, chemin)).toEqual(['ADMIN_NATIONAL', 'SUPER_ADMIN']);
  });

  it.each([
    ['get', '/assureurs/catalogue'],
    ['post', '/assureurs/:id/convention'],
    ['delete', '/assureurs/:id/convention'],
  ])('%s %s est ouverte aux responsables d une structure officinale ou hospitaliere', (methode, chemin) => {
    expect(rolesPour(assurance, methode, chemin)).toEqual(['ADMIN_STRUCTURE', 'PHARMACIEN']);
  });

  it('expose aux structures et pharmacies uniquement leurs assureurs conventionnes', () => {
    const roles = rolesPour(assurance, 'get', '/assureurs');
    expect(roles).toContain('ADMIN_STRUCTURE');
    expect(roles).toContain('PHARMACIEN');
  });

  // Un pharmacien qui pourrait creer un contrat pourrait s'assurer lui-meme.
  it.each(['PHARMACIEN', 'AGENT_ACCUEIL', 'MEDECIN', 'PATIENT', 'ADMIN_STRUCTURE'] as const)(
    'ferme la creation de contrat a %s',
    (role) => {
      expect(rolesPour(assurance, 'post', '/contrats')).not.toContain(role);
    }
  );

  // Et un patient ne doit pas pouvoir lire l'eligibilite de quelqu'un d'autre.
  it('ferme le controle d eligibilite au patient', () => {
    expect(rolesPour(assurance, 'post', '/eligibilite')).not.toContain('PATIENT');
  });

  it('les routes assurance existent bien', () => {
    for (const [methode, chemin] of [
      ['post', '/eligibilite'], ['get', '/patients/:id/eligibilite'],
      ['post', '/simulation'], ['get', '/patients/:id/contrats'],
      ['get', '/assureurs'], ['post', '/assureurs'],
      ['post', '/assureurs/:id/regles'], ['post', '/contrats'],
      ['get', '/assureurs/catalogue'], ['post', '/assureurs/:id/convention'],
      ['delete', '/assureurs/:id/convention'],
      ['post', '/cartes/verifier'], ['get', '/mes-cartes'],
      ['get', '/moi/patients'], ['post', '/moi/contrats'],
      ['get', '/moi/contrats-collectifs'], ['post', '/moi/contrats-collectifs'],
      ['post', '/moi/contrats-collectifs/:id/renouveler'],
      ['get', '/moi/contrats-collectifs/:id/adhesions'], ['post', '/moi/contrats-collectifs/:id/adhesions'],
      ['post', '/moi/adhesions/:id/fin'], ['post', '/moi/polices/regles'],
      ['post', '/cartes/photo'], ['post', '/mes-cartes/photo'],
      ['post', '/moi/contrats-collectifs/:id/travailleurs'], ['post', '/moi/contrats-collectifs/:id/import'],
      ['post', '/moi/personnes'], ['get', '/moi/personnes/:id'], ['patch', '/moi/personnes/:id'],
      ['post', '/moi/personnes/:id/photo'], ['get', '/moi/personnes/:id/photo'],
    ] as const) {
      expect(rolesPour(assurance, methode, chemin)).not.toBeNull();
    }
  });
});

// ── Lot assurance : cartes, contrats collectifs, adhesions ───────────
describe('le lot assurance garde chaque public a sa place', () => {
  // La pharmacie verifie la carte presentee ; elle ne gere aucun contrat.
  it('ouvre la verification de carte et la simulation au comptoir seulement', () => {
    for (const chemin of ['/cartes/verifier', '/simulation']) {
      expect(rolesPour(assurance, 'post', chemin)).toEqual(['PHARMACIEN', 'AGENT_ACCUEIL']);
    }
  });

  // Ses cartes, le patient seul les lit : elles portent le jeton de son QR.
  it('reserve les cartes au patient connecte', () => {
    expect(rolesPour(assurance, 'get', '/mes-cartes')).toEqual(['PATIENT']);
    expect(rolesPour(assurance, 'post', '/mes-cartes/photo')).toEqual(['PATIENT']);
  });

  // La photo d'un assure ne sort, au comptoir, que pour la carte presentee.
  it('ouvre la photo de la carte au comptoir seulement', () => {
    expect(rolesPour(assurance, 'post', '/cartes/photo')).toEqual(['PHARMACIEN', 'AGENT_ACCUEIL']);
  });

  // Contrats, adhesions et taux vivent dans l'espace de la compagnie.
  it.each([
    ['get', '/moi/patients'],
    ['post', '/moi/contrats'],
    ['get', '/moi/contrats-collectifs'],
    ['post', '/moi/contrats-collectifs'],
    ['post', '/moi/contrats-collectifs/:id/renouveler'],
    ['get', '/moi/contrats-collectifs/:id/adhesions'],
    ['post', '/moi/contrats-collectifs/:id/adhesions'],
    ['post', '/moi/adhesions/:id/fin'],
    ['post', '/moi/polices/regles'],
    ['post', '/moi/contrats-collectifs/:id/travailleurs'],
    ['post', '/moi/contrats-collectifs/:id/import'],
    ['post', '/moi/personnes'],
    ['get', '/moi/personnes/:id'],
    ['patch', '/moi/personnes/:id'],
    ['post', '/moi/personnes/:id/photo'],
    ['get', '/moi/personnes/:id/photo'],
  ])('%s %s est reservee a l assureur', (methode, chemin) => {
    expect(rolesPour(assurance, methode, chemin)).toEqual(['ASSUREUR']);
  });
});


// ── Les referentiels valent pour toute la plateforme (EF-12-03) ──────
describe('l import des referentiels est reserve a l administration nationale', () => {
  it.each([
    ['post', '/:type/import'],
    ['get', '/:type/colonnes'],
  ])('%s %s n est ouverte qu a ADMIN_NATIONAL et SUPER_ADMIN', (methode, chemin) => {
    expect(rolesPour(referentiels, methode, chemin)).toEqual(['ADMIN_NATIONAL', 'SUPER_ADMIN']);
  });

  // Une regle d'interaction erronee se traduit en alerte fausse — ou absente
  // — chez chaque prescripteur. Ce n'est pas un droit de structure.
  it.each(['MEDECIN', 'PHARMACIEN', 'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'TECHNICIEN_LABO'] as const)(
    'ferme l import a %s',
    (role) => {
      expect(rolesPour(referentiels, 'post', '/:type/import')).not.toContain(role);
    }
  );

  it('les deux routes existent bien', () => {
    expect(rolesPour(referentiels, 'post', '/:type/import')).not.toBeNull();
    expect(rolesPour(referentiels, 'get', '/:type/colonnes')).not.toBeNull();
  });
});


// -- Le journal d audit : l ecran le plus sensible du produit (EF-12-05) --
describe('la recherche dans le journal est reservee a l administration nationale', () => {
  it.each([
    ['get', '/'],
    ['get', '/export'],
    ['get', '/anomalies'],
  ])('%s %s n est ouverte qu a ADMIN_NATIONAL et SUPER_ADMIN', (methode, chemin) => {
    expect(rolesPour(journal, methode, chemin)).toEqual(['ADMIN_NATIONAL', 'SUPER_ADMIN']);
  });

  // Un administrateur de structure n a pas a voir les acces des autres
  // structures, et un soignant pas davantage. C est le seul endroit ou l on
  // voit, d un coup, qui a touche au dossier de qui.
  it.each([
    'MEDECIN', 'PHARMACIEN', 'TECHNICIEN_LABO', 'AGENT_ACCUEIL',
    'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'PATIENT', 'ASC',
  ] as const)('ferme la recherche a %s', (role) => {
    expect(rolesPour(journal, 'get', '/')).not.toContain(role);
    expect(rolesPour(journal, 'get', '/export')).not.toContain(role);
  });

  it('les trois routes existent bien', () => {
    expect(rolesPour(journal, 'get', '/')).not.toBeNull();
    expect(rolesPour(journal, 'get', '/export')).not.toBeNull();
    expect(rolesPour(journal, 'get', '/anomalies')).not.toBeNull();
  });
});


// -- Suspension de compte (EF-12-01) --------------------------------
describe('la suspension de compte est reservee a l administration nationale', () => {
  it.each([
    ['get', '/'],
    ['post', '/:id/suspendre'],
    ['post', '/:id/reactiver'],
  ])('%s %s n est ouverte qu a ADMIN_NATIONAL et SUPER_ADMIN', (methode, chemin) => {
    expect(rolesPour(comptes, methode, chemin)).toEqual(['ADMIN_NATIONAL', 'SUPER_ADMIN']);
  });

  // Un admin de structure dispose deja de `desactiverAgent`, borne a ses
  // propres agents. Fermer n importe quel compte de la plateforme est une
  // responsabilite d un autre ordre.
  it.each([
    'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'MEDECIN', 'PHARMACIEN', 'PATIENT', 'ASC',
  ] as const)('ferme la suspension a %s', (role) => {
    expect(rolesPour(comptes, 'post', '/:id/suspendre')).not.toContain(role);
    expect(rolesPour(comptes, 'post', '/:id/reactiver')).not.toContain(role);
  });

  it('les trois routes existent bien', () => {
    expect(rolesPour(comptes, 'get', '/')).not.toBeNull();
    expect(rolesPour(comptes, 'post', '/:id/suspendre')).not.toBeNull();
    expect(rolesPour(comptes, 'post', '/:id/reactiver')).not.toBeNull();
  });
});


// -- Demandes d exercice de droits (EF-12-09) ------------------------
describe('les demandes RGPD : deposer est un droit, traiter une responsabilite', () => {
  // Deposer une demande est un droit du patient.
  it.each([
    ['get', '/me/demandes-rgpd'],
    ['post', '/me/demandes-rgpd'],
  ])('%s %s est ouverte au patient', (methode, chemin) => {
    expect(rolesPour(privacy, methode, chemin)).toEqual(['PATIENT']);
  });

  // Traiter engage le responsable de traitement, pas un etablissement.
  it.each([
    ['get', '/'],
    ['post', '/:id/prendre-en-charge'],
    ['post', '/:id/repondre'],
  ])('%s %s n est ouverte qu a ADMIN_NATIONAL et SUPER_ADMIN', (methode, chemin) => {
    expect(rolesPour(rgpd, methode, chemin)).toEqual(['ADMIN_NATIONAL', 'SUPER_ADMIN']);
  });

  it.each(['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'MEDECIN', 'PATIENT'] as const)(
    'ferme le traitement a %s',
    (role) => {
      expect(rolesPour(rgpd, 'post', '/:id/repondre')).not.toContain(role);
    }
  );

  it('les cinq routes existent bien', () => {
    expect(rolesPour(privacy, 'get', '/me/demandes-rgpd')).not.toBeNull();
    expect(rolesPour(privacy, 'post', '/me/demandes-rgpd')).not.toBeNull();
    expect(rolesPour(rgpd, 'get', '/')).not.toBeNull();
    expect(rolesPour(rgpd, 'post', '/:id/prendre-en-charge')).not.toBeNull();
    expect(rolesPour(rgpd, 'post', '/:id/repondre')).not.toBeNull();
  });
});


// -- Verification d identite au comptoir (EF-01-04/10) ---------------
describe('la verification d identite est le geste de celui qui recoit', () => {
  it.each([
    ['get', '/'],
    ['post', '/:id/verifier'],
    ['post', '/:id/traits'],
  ])('%s %s est ouverte a l accueil et a l admin de structure', (methode, chemin) => {
    expect(rolesPour(identites, methode, chemin)).toEqual(['AGENT_ACCUEIL', 'ADMIN_STRUCTURE']);
  });

  // Ce n est ni un acte medical ni un acte d administration nationale :
  // c est celui qui recoit le patient et regarde sa piece.
  it.each(['MEDECIN', 'PHARMACIEN', 'TECHNICIEN_LABO', 'PATIENT', 'ASC', 'ADMIN_NATIONAL'] as const)(
    'ferme la verification a %s',
    (role) => {
      expect(rolesPour(identites, 'post', '/:id/verifier')).not.toContain(role);
    }
  );

  it('les trois routes existent bien', () => {
    expect(rolesPour(identites, 'get', '/')).not.toBeNull();
    expect(rolesPour(identites, 'post', '/:id/verifier')).not.toBeNull();
    expect(rolesPour(identites, 'post', '/:id/traits')).not.toBeNull();
  });
});
