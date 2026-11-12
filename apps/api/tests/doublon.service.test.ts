// Détection de doublons de dossier patient (EF-01-05).
//
// **Pourquoi cela compte** : un patient en double, c'est un dossier médical
// coupé en deux — l'allergie notée d'un côté n'est pas vue de l'autre. Et
// c'est un plafond d'assurance consommé deux fois.
//
// **Ce que ce service ne fait pas : fusionner.** Il propose, un agent décide.
// Fusionner deux personnes distinctes mélange leurs dossiers médicaux, ce qui
// est bien plus dangereux que de laisser un doublon.

// R4 : le nom de la mere se cherche par empreinte, calculee sous une cle
// derivee de DB_ENCRYPTION_KEY. Une cle de test, jamais celle d'une base.
process.env.DB_ENCRYPTION_KEY = 'ab'.repeat(32);

jest.mock('../src/config/prisma', () => ({
  prisma: {
    patientProfile: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    utilisateur: { findUnique: jest.fn() },
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
// R14 : la numerotation vient des parametres du pays installe. `paysInstalle`
// laisse un test changer de pays ; une fonction simple, pas un jest.fn, pour
// que `resetAllMocks` ne l'efface pas.
const paysInstalle: { valeur?: unknown } = {};
jest.mock('../src/services/parametres.service', () => {
  const vrai = jest.requireActual('../src/services/parametres.service');
  return { ...vrai, getValeursParametres: async () => ({ pays: paysInstalle.valeur ?? vrai.PARAMETRES_PAR_DEFAUT.pays }) };
});

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    patientProfile: { findMany: M; findUnique: M; findFirst: M };
    utilisateur: { findUnique: M };
  };
};

import {
  chercher, comparer, distance, estDateParDefaut, memeMotEcritAutrement,
  normaliser, normaliserTelephone, pourPatient, SEUIL_A_VERIFIER, SEUIL_PROBABLE,
} from '../src/services/doublon.service';
import { empreinteRecherche } from '../src/utils/encryption.utils';

// L'appelant autorise : depuis le 2026-10-24, ces lectures passent par
// `assertCanAccessPatient`. Le refus hors perimetre est couvert par
// `identite-cloisonnement.test.ts`.
const AGENT = { userId: 'u-acc', role: 'AGENT_ACCUEIL', sessionId: 's' } as never;

function dansSonPerimetre(): void {
  prisma.utilisateur.findUnique.mockResolvedValue({
    role: 'AGENT_ACCUEIL', idStructure: 'hop-1',
    patientProfile: null, ascProfile: null, medecinProfile: null, pharmacienProfile: null,
  });
  prisma.patientProfile.findFirst.mockResolvedValue({ id: 'p1' });
}

const BASE = {
  prenom: 'Mamadou',
  nom: 'Diallo',
  telephone: '620100010',
  dateNaissance: new Date('1990-05-12'),
  lieuNaissance: 'Kankan',
  nomMere: 'Fatoumata Barry',
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.patientProfile.findMany.mockResolvedValue([]);
  // Le pays installe revient a la Guinee : un test qui en change ne doit pas
  // le laisser aux suivants.
  delete paysInstalle.valeur;
});

// ── Ce que les données réelles ont imposé ────────────────────────────

describe('estDateParDefaut', () => {
  // Dans la base du 2026-10-04, **9 patients sur 10** portaient le 1er
  // janvier 2000. C'est la valeur qu'on saisit quand on ignore la date.
  it.each(['2000-01-01', '1990-01-01', '2026-01-01'])('%s est une date par défaut', (d) => {
    expect(estDateParDefaut(new Date(d))).toBe(true);
  });

  it.each(['1992-03-17', '2000-01-02', '2000-02-01'])('%s est une vraie date', (d) => {
    expect(estDateParDefaut(new Date(d))).toBe(false);
  });
});

describe('normaliser', () => {
  // « Condé », « CONDE » et « Conde » désignent la même famille.
  it.each([
    ['Condé', 'conde'],
    ['CONDE', 'conde'],
    ['  Conde  ', 'conde'],
    ['Ba-Diallo', 'ba diallo'],
    ['Aïssatou', 'aissatou'],
  ])('%s -> %s', (entree, attendu) => {
    expect(normaliser(entree)).toBe(attendu);
  });
});

describe('normaliserTelephone', () => {
  // « +224627082602 » et « 627082602 » sont le même numéro.
  it.each([
    ['+224627082602', '627082602'],
    ['627082602', '627082602'],
    ['620 100 010', '620100010'],
    ['00224620100010', '620100010'],
    ['+224 627-08-26-02', '627082602'],
  ])('%s -> %s', (entree, attendu) => {
    expect(normaliserTelephone(entree)).toBe(attendu);
  });

  // R14 : la numerotation vient du pays installe. Garder les 9 derniers
  // chiffres etait une regle guineenne : au Nigeria (10 chiffres), elle
  // tronquait le numero et confondait deux numeros differents.
  describe('un pays a numeros de 10 chiffres (Nigeria)', () => {
    const NIGERIA = { indicatifTelephone: '+234', longueurNumero: 10 };

    it.each([
      ['+2348031234567', '8031234567'],
      ['8031234567', '8031234567'],
      ['08031234567', '8031234567'],
      ['002348031234567', '8031234567'],
      ['+234 803 123 4567', '8031234567'],
    ])('%s -> %s', (entree, attendu) => {
      expect(normaliserTelephone(entree, NIGERIA)).toBe(attendu);
    });

    it('garde les dix chiffres au lieu de couper aux neuf derniers', () => {
      expect(normaliserTelephone('+2348031234567', NIGERIA)).toHaveLength(10);
    });

    it('deux numeros qui ne different que par leur premier chiffre restent distincts', () => {
      const a = normaliserTelephone('+2348031234567', NIGERIA);
      const b = normaliserTelephone('+2349031234567', NIGERIA);
      expect(a).not.toBe(b);
    });
  });

  // Un numero national qui commence par les chiffres de l'indicatif n'est pas
  // ampute : l'indicatif ne tombe qu'en ecriture internationale, ou quand la
  // longueur totale ne laisse pas de doute.
  it('ne retire pas l indicatif d un numero national qui commence pareil', () => {
    const SENEGAL = { indicatifTelephone: '+221', longueurNumero: 9 };
    expect(normaliserTelephone('221456789', SENEGAL)).toBe('221456789');
    expect(normaliserTelephone('+221221456789', SENEGAL)).toBe('221456789');
  });

  it('un numero vide ou sans chiffre ne rend rien', () => {
    expect(normaliserTelephone('')).toBe('');
    expect(normaliserTelephone('  --  ')).toBe('');
  });
});

// R14 : la numerotation traverse les deux fonctions qui s'en servent. Sans
// cela, un pays a dix chiffres verrait deux numeros differents comme un seul.
describe('la numerotation du pays suit jusqu au bout', () => {
  const NIGERIA = { indicatifTelephone: '+234', longueurNumero: 10 };
  // Memes neuf derniers chiffres, premier chiffre different.
  const A = { ...BASE, telephone: '8031234567' };
  const B = { ...BASE, telephone: '9031234567' };

  it('comparer : deux numeros nigerians distincts ne concordent pas', () => {
    // Avec l'ancienne regle (neuf derniers chiffres), « 031234567 » les
    // confondait : ils ne different que par leur premier chiffre.
    expect(A.telephone.slice(-9)).toBe(B.telephone.slice(-9));
    expect(comparer(A, B, NIGERIA).traits).not.toContain('TELEPHONE_IDENTIQUE');
  });

  it('comparer : le numero international et le national sont le meme', () => {
    const international = { ...BASE, telephone: '+2348031234567' };
    expect(comparer(A, international, NIGERIA).traits).toContain('TELEPHONE_IDENTIQUE');
    // Et avec le zero national, comme on l'ecrit sur place.
    expect(comparer(A, { ...BASE, telephone: '08031234567' }, NIGERIA).traits).toContain('TELEPHONE_IDENTIQUE');
  });

  it('comparer : le meme numero nigerian, ecrit autrement, concorde', () => {
    expect(comparer(A, { ...BASE, telephone: '+234 803 123 4567' }, NIGERIA).traits)
      .toContain('TELEPHONE_IDENTIQUE');
  });

  it('chercher : le pre-filtre cherche le numero a la longueur du pays installe', async () => {
    paysInstalle.valeur = { ...NIGERIA, niveauBase: 'ward', niveauElargissement: 'lga', niveaux: [] };
    dansSonPerimetre();
    prisma.patientProfile.findMany.mockResolvedValue([]);

    // Ecrit en international : c'est la que les deux numerotations divergent.
    // Avec l'indicatif guineen, « +234 » resterait collee devant le numero et
    // le pre-filtre ne ramenerait plus personne.
    await chercher({ ...A, telephone: '+2348031234567' });

    const ou = prisma.patientProfile.findMany.mock.calls[0][0].where.OR;
    const parTel = ou.find((c: { utilisateur?: { telephone?: unknown } }) => c.utilisateur?.telephone);
    expect(parTel).toEqual({ utilisateur: { telephone: { contains: '8031234567' } } });
  });
});

// ── Le cœur : ce qui pèse, et ce qui ne pèse pas ─────────────────────

describe('comparer : le poids de chaque trait', () => {
  const AUTRE = {
    prenom: 'Ousmane', nom: 'Barry', telephone: '660000000',
    dateNaissance: new Date('1975-08-03'), lieuNaissance: 'Labé', nomMere: 'Mariama Sow',
  };

  it('ne trouve aucune ressemblance entre deux inconnus', () => {
    expect(comparer(BASE, AUTRE).score).toBe(0);
  });

  it('reconnaît un nom identique quel que soit l ordre', () => {
    const r = comparer(BASE, { ...AUTRE, prenom: 'Diallo', nom: 'Mamadou' });
    expect(r.traits).toContain('NOM_IDENTIQUE');
  });

  it('reconnaît un nom contenu dans un autre', () => {
    const r = comparer(BASE, { ...AUTRE, prenom: 'Mamadou Aissata', nom: 'Diallo' });
    expect(r.traits).toContain('NOM_PROCHE');
    expect(r.traits).not.toContain('NOM_IDENTIQUE');
  });

  // **Le trait le plus discriminant.** Deux personnes sans lien partagent
  // rarement le nom de leur mère.
  it('donne le plus de poids au nom de la mère', () => {
    const avecMere = comparer(BASE, { ...AUTRE, nomMere: 'Fatoumata Barry' }).score;
    const avecLieu = comparer(BASE, { ...AUTRE, lieuNaissance: 'Kankan' }).score;
    const avecNom = comparer(BASE, { ...AUTRE, prenom: 'Mamadou', nom: 'Diallo' }).score;
    expect(avecMere).toBeGreaterThan(avecLieu);
    expect(avecMere).toBeGreaterThan(avecNom);
  });

  // **Le point que les données réelles ont imposé.** Une date par défaut
  // partagée n'apprend presque rien : un détecteur qui lui donnerait son
  // poids habituel signalerait neuf patients comme doublons les uns des
  // autres, et l'agent apprendrait à ignorer l'alerte.
  it('ne compte presque pas une date par défaut partagée', () => {
    const parDefaut = comparer(
      { ...BASE, dateNaissance: new Date('2000-01-01') },
      { ...AUTRE, dateNaissance: new Date('2000-01-01') }
    );
    expect(parDefaut.traits).toContain('DATE_PAR_DEFAUT');
    expect(parDefaut.score).toBeLessThan(SEUIL_A_VERIFIER);
  });

  it('compte bien une vraie date partagée', () => {
    const vraie = comparer(BASE, { ...AUTRE, dateNaissance: new Date('1990-05-12') });
    expect(vraie.traits).toContain('DATE_IDENTIQUE');
    expect(vraie.score).toBeGreaterThan(
      comparer({ ...BASE, dateNaissance: new Date('2000-01-01') },
               { ...AUTRE, dateNaissance: new Date('2000-01-01') }).score
    );
  });

  // Un téléphone familial est partagé : une mère qui inscrit ses trois
  // enfants donne son numéro trois fois. Ce ne sont pas des doublons.
  it('ne conclut pas sur le seul téléphone', () => {
    const r = comparer(BASE, { ...AUTRE, telephone: '620100010' });
    expect(r.traits).toContain('TELEPHONE_IDENTIQUE');
    expect(r.score).toBeLessThan(SEUIL_PROBABLE);
  });

  // Le cas précédent ne prouvait rien du **poids** du téléphone : sans
  // concordance de nom, la borne plafonne le score de toute façon, donc
  // n'importe quel poids passait le test. Il faut donc un cas où le nom
  // concorde — la borne ne s'applique pas — et où seul le téléphone s'ajoute.
  // Un sabotage portant le téléphone à 70 points passait inaperçu sans cela.
  it('le téléphone seul ne suffit pas à conclure, même avec le nom', () => {
    const memeNomMemeTel = {
      prenom: 'Mamadou', nom: 'Diallo', telephone: '620100010',
      dateNaissance: new Date('1975-08-03'), lieuNaissance: null, nomMere: null,
    };
    const sansTraits = { ...BASE, lieuNaissance: null, nomMere: null };
    const r = comparer(sansTraits, memeNomMemeTel);
    expect(r.traits).toEqual(expect.arrayContaining(['NOM_IDENTIQUE', 'TELEPHONE_IDENTIQUE']));
    expect(r.traits).not.toContain('SANS_CONCORDANCE_DE_NOM');
    // Deux homonymes au téléphone familial : à vérifier, pas à conclure.
    expect(r.score).toBeLessThan(SEUIL_PROBABLE);
    expect(r.score).toBeGreaterThanOrEqual(SEUIL_A_VERIFIER);
  });
});

// ── Les cas que l'agent verra vraiment ───────────────────────────────

describe('comparer : les cas de terrain', () => {
  // Le cas qui a motivé tout ce travail : deux dossiers de la même personne,
  // ouverts à deux endroits différents.
  it('déclare probable un même nom avec même mère et même lieu', () => {
    const r = comparer(BASE, { ...BASE, telephone: '661111111' });
    expect(r.score).toBeGreaterThanOrEqual(SEUIL_PROBABLE);
  });

  // Deux frères : même mère, même lieu, même téléphone familial, mais des
  // prénoms différents. **Ce ne sont pas des doublons**, et le détecteur ne
  // doit pas l'affirmer — tout au plus le signaler.
  it('ne déclare pas probables deux frères', () => {
    const frere = { ...BASE, prenom: 'Ousmane' };
    const r = comparer(BASE, frere);
    expect(r.traits).toContain('MERE_IDENTIQUE');
    expect(r.score).toBeLessThan(SEUIL_PROBABLE);
    expect(r.score).toBeGreaterThanOrEqual(SEUIL_A_VERIFIER);
  });

  // Des jumeaux : tout concorde — mère, lieu, téléphone familial, et même la
  // date — sauf le prénom. Sans la borne, le score atteignait 115.
  it('ne déclare jamais probables des jumeaux', () => {
    const jumeau = { ...BASE, prenom: 'Ousmane' };
    const r = comparer(BASE, jumeau);
    expect(r.score).toBeLessThan(SEUIL_PROBABLE);
    expect(r.traits).toContain('SANS_CONCORDANCE_DE_NOM');
  });

  // La borne ne doit pas effacer le signal : l'agent doit quand même
  // regarder. On ne conclut pas, on ne tait pas non plus.
  it('signale quand même le cas, sans conclure', () => {
    const r = comparer(BASE, { ...BASE, prenom: 'Ousmane' });
    expect(r.score).toBeGreaterThanOrEqual(SEUIL_A_VERIFIER);
  });

  // Et la borne ne doit pas s'appliquer quand le nom concorde : sinon elle
  // empêcherait de détecter les vrais doublons, ce qui serait pire.
  it('n applique pas la borne quand le nom concorde', () => {
    const r = comparer(BASE, { ...BASE, telephone: '661111111' });
    expect(r.traits).not.toContain('SANS_CONCORDANCE_DE_NOM');
    expect(r.score).toBeGreaterThanOrEqual(SEUIL_PROBABLE);
  });

  // Deux homonymes réels, nés le même jour par défaut, sans traits
  // distinctifs : c'est exactement la situation de 9 patients sur 10 dans la
  // base. Le détecteur doit les signaler sans conclure.
  it('signale sans conclure deux homonymes sans traits distinctifs', () => {
    const sansTraits = {
      prenom: 'Mamadou', nom: 'Diallo', telephone: '661111111',
      dateNaissance: new Date('2000-01-01'), lieuNaissance: null, nomMere: null,
    };
    const r = comparer(sansTraits, { ...sansTraits, telephone: '662222222' });
    expect(r.score).toBeLessThan(SEUIL_PROBABLE);
  });

  it('ignore les accents et la casse dans tous les traits', () => {
    const avecAccents = { ...BASE, prenom: 'MAMADOU', nom: 'DIALLO', nomMere: 'FATOUMATA BARRY', lieuNaissance: 'KANKAN' };
    const r = comparer(BASE, avecAccents);
    expect(r.traits).toEqual(expect.arrayContaining(['NOM_IDENTIQUE', 'MERE_IDENTIQUE', 'LIEU_IDENTIQUE']));
  });

  // Un trait absent ne doit pas compter comme une concordance : deux
  // dossiers sans nom de mère ne « partagent » pas leur mère.
  it.each([
    ['nomMere', { nomMere: null }, 'MERE_IDENTIQUE'],
    ['lieuNaissance', { lieuNaissance: null }, 'LIEU_IDENTIQUE'],
  ] as const)('ne compte pas %s quand il est absent des deux côtés', (_nom, vide, trait) => {
    const sans = { ...BASE, ...vide };
    const r = comparer(sans, { ...sans, telephone: '661111111' });
    expect(r.traits).not.toContain(trait);
  });

  it('ne compte pas un trait présent d un seul côté', () => {
    const r = comparer(BASE, { ...BASE, nomMere: null, telephone: '661111111' });
    expect(r.traits).not.toContain('MERE_IDENTIQUE');
  });
});

// ── La recherche ─────────────────────────────────────────────────────

const CANDIDAT = {
  id: 'p2',
  dateNaissance: new Date('1990-05-12'),
  lieuNaissance: 'Kankan',
  nomMere: 'Fatoumata Barry',
  niveauIdentite: 'PROVISOIRE',
  prefecture: 'Kankan',
  utilisateur: { prenom: 'Mamadou', nom: 'Diallo', telephone: '661111111' },
};

describe('chercher', () => {
  // Sans ce filtre, chaque création de dossier balaierait la table entière.
  it('ne compare qu aux dossiers partageant un trait, pas à toute la table', async () => {
    await chercher(BASE);
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { OR: unknown[] } }];
    // deux mots de nom + le téléphone + le nom de la mère
    expect(args.where.OR).toHaveLength(4);
  });

  // ── Ce que seule la vraie API a montré ───────────────────────────
  //
  // **Le pré-filtre cherchait les mots du nom par sous-chaîne entière.**
  // « Dialo » ne se trouve pas dans « Diallo » : le candidat n'était jamais
  // ramené de la base, et la tolérance d'orthographe n'avait jamais
  // l'occasion de servir. Les tests passaient — les mocks rendaient le
  // candidat sans se soucier du `where`. Vu le 2026-10-04 en appelant la
  // route avec deux dossiers réels.
  it('cherche par début de mot, pour atteindre les variantes d orthographe', async () => {
    await chercher({ ...BASE, prenom: 'Mohamadou', nom: 'Diallo' });
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { OR: unknown[] } }];
    const texte = JSON.stringify(args.where.OR);
    // Le début suffit : « moha » retrouve « Mohamed », « dial » retrouve
    // « Dialo ». Les mots sont normalisés en minuscules, et la requête est
    // insensible à la casse.
    expect(texte).toContain('"moha"');
    expect(texte).toContain('"dial"');
    expect(texte).not.toContain('mohamadou');
  });

  it('prend les mots courts en entier', async () => {
    await chercher({ ...BASE, prenom: 'Sow', nom: 'Bah' });
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { OR: unknown[] } }];
    const texte = JSON.stringify(args.where.OR);
    expect(texte).toContain('"sow"');
    expect(texte).toContain('"bah"');
  });

  // Le cas que le début de mot ne rattrape pas : la première lettre diffère.
  // « Konde » et « Conde » ne partagent aucun début. Le nom de la mère est
  // alors le seul chemin vers le candidat — et c'est justement le trait le
  // plus discriminant.
  it('ramène aussi par le nom de la mère', async () => {
    await chercher({ ...BASE, nomMere: 'Fatoumata Condé' });
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { OR: { nomMereEmpreinte?: unknown }[] } }];
    const parLaMere = args.where.OR.filter((c) => c.nomMereEmpreinte);
    expect(parLaMere).toHaveLength(1);
    // R4 : chiffre en base, le nom se compare par empreinte - sans accent ni casse.
    expect(parLaMere[0]).toEqual({ nomMereEmpreinte: empreinteRecherche('fatoumata  CONDE') });
    // Et le nom en clair ne part jamais dans la requete.
    expect(JSON.stringify(args.where)).not.toMatch(/fatoumata/i);
  });

  // Le lieu de naissance reste dehors, et c'est voulu : « Conakry » ramènerait
  // presque toute la table, ce que la borne `take: 100` tronquerait en silence.
  it('ne ramène pas par lieu de naissance', async () => {
    await chercher(BASE);
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: unknown }];
    expect(JSON.stringify(args.where)).not.toContain('lieuNaissance');
  });

  it('n interroge pas par nom de mère quand on ne la connaît pas', async () => {
    await chercher({ ...BASE, nomMere: null });
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { OR: unknown[] } }];
    expect(args.where.OR).toHaveLength(3);
  });

  it('borne la lecture, pour ne pas balayer la table', async () => {
    await chercher(BASE);
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ take: number }];
    expect(args.take).toBe(100);
  });

  it('écarte les candidats sous le seuil de doute', async () => {
    prisma.patientProfile.findMany.mockResolvedValue([
      { ...CANDIDAT, nomMere: null, lieuNaissance: null, dateNaissance: new Date('1975-01-01'),
        utilisateur: { prenom: 'Ousmane', nom: 'Diallo', telephone: '669999999' } },
    ]);
    expect(await chercher(BASE)).toEqual([]);
  });

  it('rend le candidat avec son score et ses traits', async () => {
    prisma.patientProfile.findMany.mockResolvedValue([CANDIDAT]);
    const [vue] = await chercher(BASE);
    expect(vue).toMatchObject({ id: 'p2', nomComplet: 'Mamadou Diallo', probable: true });
    expect(vue?.traits).toEqual(expect.arrayContaining(['NOM_IDENTIQUE', 'MERE_IDENTIQUE', 'LIEU_IDENTIQUE']));
  });

  it('met le plus ressemblant en tête', async () => {
    prisma.patientProfile.findMany.mockResolvedValue([
      { ...CANDIDAT, id: 'faible', nomMere: null, lieuNaissance: null },
      { ...CANDIDAT, id: 'fort' },
    ]);
    const vues = await chercher(BASE);
    expect(vues[0]?.id).toBe('fort');
  });

  it('exclut le dossier lui-même', async () => {
    await chercher(BASE, { exclureId: 'p1' });
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { id: unknown } }];
    expect(args.where.id).toEqual({ not: 'p1' });
  });

  it('limite ce qu il rend : un agent ne lira pas cent lignes', async () => {
    prisma.patientProfile.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ ...CANDIDAT, id: `p${i}` }))
    );
    expect(await chercher(BASE)).toHaveLength(10);
  });
});

describe('pourPatient', () => {
  // **Un dossier introuvable n'a pas « aucun doublon » : il n'existe pas.**
  // Rendre une liste vide ferait lire à l'agent une affirmation fausse sur un
  // dossier qu'on n'a pas trouvé. La route en fait un 404. Vu le 2026-10-04
  // en appelant la vraie route avec un identifiant inventé : elle répondait
  // 200 et une liste vide.
  it('distingue un dossier inconnu d un dossier sans doublon', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    dansSonPerimetre();
    expect(await pourPatient(AGENT, 'inconnu')).toBeNull();
  });

  it('rend une liste vide pour un dossier bien réel et sans doublon', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({
      id: 'p1', dateNaissance: BASE.dateNaissance, lieuNaissance: BASE.lieuNaissance,
      nomMere: BASE.nomMere,
      utilisateur: { prenom: BASE.prenom, nom: BASE.nom, telephone: BASE.telephone },
    });
    prisma.patientProfile.findMany.mockResolvedValue([]);
    dansSonPerimetre();
    expect(await pourPatient(AGENT, 'p1')).toEqual([]);
  });

  it('s exclut lui-même de ses propres doublons', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({
      id: 'p1', dateNaissance: BASE.dateNaissance, lieuNaissance: BASE.lieuNaissance,
      nomMere: BASE.nomMere, utilisateur: { prenom: BASE.prenom, nom: BASE.nom, telephone: BASE.telephone },
    });
    dansSonPerimetre();
    await pourPatient(AGENT, 'p1');
    const [args] = prisma.patientProfile.findMany.mock.calls[0] as [{ where: { id: unknown } }];
    expect(args.where.id).toEqual({ not: 'p1' });
  });
});


// ── Les noms transcrits à l'oreille ──────────────────────────────────
//
// **C'est ainsi que naissent la plupart des doublons.** Un nom est écrit
// différemment d'un guichet à l'autre, et sans tolérance « Mamadou Diallo »
// et « Mamadou Dialo » — une lettre — étaient traités comme deux personnes
// sans rapport.

describe('distance', () => {
  it.each([
    ['conde', 'conde', 0],
    ['conde', 'konde', 1],
    ['diallo', 'dialo', 1],
    ['maomou', 'maoumou', 1],
    ['sow', 'barry', 5],
  ])('%s / %s -> %i', (a, b, attendu) => {
    expect(distance(a, b)).toBe(attendu);
  });
});

describe('memeMotEcritAutrement', () => {
  // Les variantes qu'on rencontre réellement.
  it.each([
    ['conde', 'konde'],
    ['diallo', 'dialo'],
    ['maomou', 'maoumou'],
    ['fatoumata', 'fatoumatta'],
    ['mamadou', 'mohamadou'],
  ])('%s et %s sont le même nom écrit autrement', (a, b) => {
    expect(memeMotEcritAutrement(a, b)).toBe(true);
  });

  // La tolérance reste étroite : au-delà, on rapprocherait des noms
  // réellement distincts, et une fusion à tort mélange deux dossiers.
  it.each([
    ['sow', 'barry'],
    ['aissatou', 'mariama'],
    ['sow', 'bah'],
    ['conde', 'camara'],
  ])('%s et %s restent deux noms différents', (a, b) => {
    expect(memeMotEcritAutrement(a, b)).toBe(false);
  });

  // Un mot court tolère moins : « Sow » et « Sol » ne doivent pas se
  // confondre, alors que « Fatoumata » et « Fatoumatta » oui.
  it('tolère moins sur un mot court', () => {
    expect(memeMotEcritAutrement('sow', 'sou')).toBe(true);
    expect(memeMotEcritAutrement('sow', 'bah')).toBe(false);
  });

  // ── La frontière, tenue par des noms réels ───────────────────────
  //
  // Ces paires sont **à exactement une lettre au-delà** de la tolérance.
  // Elles sont là parce qu'un élargissement de la tolérance ne faisait
  // broncher aucun test : les contre-exemples que j'avais écrits étaient
  // tous à trois ou quatre lettres d'écart, donc hors d'atteinte. Mesuré
  // le 2026-10-04 sur ces noms.
  it.each([
    ['mariama', 'mariatou', 3],   // deux prénoms distincts, pas une graphie
    ['aissatou', 'aminatou', 3],
    ['ousmane', 'oumar', 3],
  ])('%s et %s restent distincts (%i lettres, mot long)', (a, b, d) => {
    expect(distance(a, b)).toBe(d);
    expect(memeMotEcritAutrement(a, b)).toBe(false);
  });

  it.each([
    ['kante', 'konate', 2],       // Kanté et Konaté sont deux familles
    ['bah', 'baba', 2],
  ])('%s et %s restent distincts (%i lettres, mot court)', (a, b, d) => {
    expect(distance(a, b)).toBe(d);
    expect(memeMotEcritAutrement(a, b)).toBe(false);
  });

  // **Ce que cette tolérance coûte, assumé.** À une lettre près, des noms
  // de familles différentes se rapprochent : Haba et Kaba, Sylla et Sylva,
  // Sidibé et Sidimé. Le service les rapproche donc, et c'est voulu — c'est
  // le prix de reconnaître Condé/Konde. Ce qui rend ce prix acceptable est
  // ailleurs : une variante **ne conclut jamais** (voir plus bas), elle
  // remonte à un agent qui regarde la pièce.
  it.each([
    ['haba', 'kaba'],
    ['sylla', 'sylva'],
    ['sidibe', 'sidime'],
    ['sekou', 'sekouba'],
  ])('rapproche %s et %s — assumé, et jamais conclusif', (a, b) => {
    expect(memeMotEcritAutrement(a, b)).toBe(true);
  });
});

describe('les variantes d orthographe dans la comparaison', () => {
  const TRAITS = { lieuNaissance: 'Conakry', nomMere: 'Fatoumata Conde' };

  it.each([
    ['Maomou Conde', 'Maoumou Conde'],
    ['Maomou Conde', 'Maomou Konde'],
    ['Mamadou Diallo', 'Mamadou Dialo'],
  ])('reconnaît « %s » et « %s » comme le même nom écrit autrement', (a, b) => {
    const [pa, ...na] = a.split(' ');
    const [pb, ...nb] = b.split(' ');
    const r = comparer(
      { ...BASE, ...TRAITS, prenom: pa, nom: na.join(' ') },
      { ...BASE, ...TRAITS, prenom: pb, nom: nb.join(' '), telephone: '661111111' }
    );
    expect(r.traits).toContain('NOM_VARIANTE');
  });

  // **Le point le plus délicat de ce service.** « Aissatou » et « Aissata » :
  // variante d'écriture, ou deux sœurs ? La machine ne peut pas trancher, et
  // personne ne le peut sans regarder le dossier. Sans cette règle, deux
  // frères atteignaient 117 et étaient annoncés comme doublons probables.
  it('ne conclut jamais sur une variante d orthographe', () => {
    const r = comparer(
      { ...BASE, ...TRAITS, prenom: 'Mamadou', nom: 'Diallo' },
      { ...BASE, ...TRAITS, prenom: 'Amadou', nom: 'Diallo', telephone: '661111111' }
    );
    expect(r.traits).toContain('NOM_VARIANTE');
    expect(r.score).toBeLessThan(SEUIL_PROBABLE);
  });

  // Mais le cas n'est pas tu : il remonte, avec ses traits affichés.
  it('le signale quand même, en tête de liste', () => {
    const r = comparer(
      { ...BASE, ...TRAITS, prenom: 'Mamadou', nom: 'Diallo' },
      { ...BASE, ...TRAITS, prenom: 'Mamadou', nom: 'Dialo', telephone: '661111111' }
    );
    expect(r.score).toBeGreaterThanOrEqual(SEUIL_A_VERIFIER);
    expect(r.traits).toContain('ORTHOGRAPHE_A_CONFIRMER');
  });

  // Les deux raisons de ne pas conclure ne se disent pas de la même façon :
  // les confondre ferait lire à l'agent le contraire de ce qu'il a sous les
  // yeux.
  it('distingue « nom écrit autrement » de « pas de nom commun »', () => {
    const variante = comparer(
      { ...BASE, ...TRAITS, prenom: 'Mamadou', nom: 'Diallo' },
      { ...BASE, ...TRAITS, prenom: 'Mamadou', nom: 'Dialo', telephone: '661111111' }
    );
    const freres = comparer(
      { ...BASE, ...TRAITS, prenom: 'Mamadou', nom: 'Diallo' },
      { ...BASE, ...TRAITS, prenom: 'Ousmane', nom: 'Diallo', telephone: '661111111' }
    );
    expect(variante.traits).toContain('ORTHOGRAPHE_A_CONFIRMER');
    expect(variante.traits).not.toContain('SANS_CONCORDANCE_DE_NOM');
    expect(freres.traits).toContain('SANS_CONCORDANCE_DE_NOM');
    expect(freres.traits).not.toContain('ORTHOGRAPHE_A_CONFIRMER');
  });

  // Deux variations, ce ne sont plus deux écritures d'un nom mais deux noms.
  it('refuse deux variations dans le même nom', () => {
    const r = comparer(
      { ...BASE, prenom: 'Mamadou', nom: 'Diallo' },
      { ...BASE, prenom: 'Amadou', nom: 'Dialo', telephone: '661111111' }
    );
    expect(r.traits).not.toContain('NOM_VARIANTE');
  });

  it('refuse de rapprocher des noms de longueurs différentes', () => {
    const r = comparer(
      { ...BASE, prenom: 'Mamadou', nom: 'Diallo' },
      { ...BASE, prenom: 'Mamadou Aissata Binta', nom: 'Diallo', telephone: '661111111' }
    );
    expect(r.traits).not.toContain('NOM_VARIANTE');
  });
});


// ── L'ordre d'importance des traits ──────────────────────────────────
//
// Les poids ne sont pas calibres — ils disent un ordre. Ces cas verrouillent
// cet ordre, parce qu'il est la seule chose que les poids promettent. **Ils
// ont ete ecrits apres coup** : trois sabotages (une variante qui pese autant
// qu'un nom identique, un nom partiel qui pese autant, un lieu de naissance
// qui ne pese plus rien) ne faisaient broncher aucun test.

describe('l ordre d importance des traits', () => {
  // Rien d'autre ne concorde que le telephone : ni lieu, ni mere, ni date.
  const seulLeTelephone = (prenom: string, nom: string) => comparer(
    { prenom: 'Mamadou', nom: 'Diallo', telephone: '620100010',
      dateNaissance: new Date('1990-05-12'), lieuNaissance: null, nomMere: null },
    { prenom, nom, telephone: '620100010',
      dateNaissance: new Date('1992-03-17'), lieuNaissance: null, nomMere: null }
  );

  it('un nom identique pèse plus qu une variante, qui pèse plus qu un nom partiel', () => {
    const identique = seulLeTelephone('Mamadou', 'Diallo');
    const variante = seulLeTelephone('Mamadou', 'Dialo');
    const partiel = seulLeTelephone('Mamadou Aissata', 'Diallo');

    expect(identique.traits).toContain('NOM_IDENTIQUE');
    expect(variante.traits).toContain('NOM_VARIANTE');
    expect(partiel.traits).toContain('NOM_PROCHE');

    // L'ordre, qui est tout ce que les poids promettent.
    expect(identique.score).toBeGreaterThan(variante.score);
    expect(variante.score).toBeGreaterThan(partiel.score);

    // Et aucun des trois ne conclut sur le seul telephone : un numero
    // familial est partage, une mère inscrit ses trois enfants avec le sien.
    for (const r of [identique, variante, partiel]) {
      expect(r.score).toBeGreaterThanOrEqual(SEUIL_A_VERIFIER);
      expect(r.score).toBeLessThan(SEUIL_PROBABLE);
    }
  });

  // Le lieu de naissance est un trait d'etat civil ; le telephone est un
  // objet qui se prête. Le premier doit peser plus.
  it('le lieu de naissance pèse plus que le téléphone', () => {
    const memeLieu = comparer(
      { ...BASE, nomMere: null, telephone: '620100010' },
      { ...BASE, nomMere: null, telephone: '666112233' }
    );
    const memeTelephone = comparer(
      { ...BASE, nomMere: null, lieuNaissance: 'Kankan' },
      { ...BASE, nomMere: null, lieuNaissance: 'Conakry' }
    );
    expect(memeLieu.traits).toContain('LIEU_IDENTIQUE');
    expect(memeTelephone.traits).toContain('TELEPHONE_IDENTIQUE');
    expect(memeLieu.score).toBeGreaterThan(memeTelephone.score);
  });

  // Ce que le lieu fait basculer : meme nom et meme telephone ne suffisent
  // pas, le lieu de naissance en plus fait un doublon probable.
  it('c est le lieu qui fait basculer un même nom au même numéro', () => {
    const sansLieu = comparer(
      { ...BASE, nomMere: null, lieuNaissance: null, dateNaissance: new Date('1990-05-12') },
      { ...BASE, nomMere: null, lieuNaissance: null, dateNaissance: new Date('1992-03-17') }
    );
    const avecLieu = comparer(
      { ...BASE, nomMere: null, dateNaissance: new Date('1990-05-12') },
      { ...BASE, nomMere: null, dateNaissance: new Date('1992-03-17') }
    );
    expect(sansLieu.score).toBeLessThan(SEUIL_PROBABLE);
    expect(avecLieu.score).toBeGreaterThanOrEqual(SEUIL_PROBABLE);
  });
});
