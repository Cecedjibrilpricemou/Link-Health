// Referentiel geographique generique (M1). Ce qui compte :
// - le decoupage vient du pays installe, pas du code (Guinee, Nigeria, Mozambique...) ;
// - un lieu se range sous le niveau immediatement au-dessus, sans doublon ;
// - le voisinage est tenu dans les deux sens, au sein d'un meme niveau ;
// - un jeu de depart ne se charge que si le pays et son decoupage correspondent ;
// - les saisies hors referentiel remontent a l'administrateur.
import type { ParametresPaysView } from '@baobaoheath/shared-types';
import {
  chargerJeuDeDepart,
  configuration,
  creerLieu,
  horsReferentiel,
  listerLieux,
  MAX_VOISINS,
  modifierLieu,
  voisinsDe,
  zoneElargissementConnue,
} from '../src/services/geographie.service';
import { ConflictError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    lieuGeo: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    patientProfile: { groupBy: jest.fn() },
    structureSante: { groupBy: jest.fn() },
    livreurProfile: { groupBy: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../src/services/parametres.service', () => ({ getValeursParametres: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    lieuGeo: { findMany: M; findUnique: M; create: M; update: M };
    patientProfile: { groupBy: M }; structureSante: { groupBy: M }; livreurProfile: { groupBy: M };
    $transaction: M;
  };
};
const { getValeursParametres } = jest.requireMock('../src/services/parametres.service') as { getValeursParametres: M };

const GUINEE: ParametresPaysView = {
  code: 'GN', nom: 'Guinée', indicatifTelephone: '+224', longueurNumero: 9,
  niveaux: [
    { code: 'region', libelles: { fr: 'Région' } },
    { code: 'prefecture', libelles: { fr: 'Préfecture' } },
    { code: 'commune', libelles: { fr: 'Commune' } },
  ],
  niveauBase: 'commune', niveauElargissement: 'prefecture',
};
const NIGERIA: ParametresPaysView = {
  code: 'NG', nom: 'Nigeria', indicatifTelephone: '+234', longueurNumero: 10,
  niveaux: [
    { code: 'state', libelles: { fr: 'État', en: 'State' } },
    { code: 'lga', libelles: { fr: 'Zone de gouvernement local', en: 'LGA' } },
    { code: 'ward', libelles: { fr: 'Quartier', en: 'Ward' } },
  ],
  niveauBase: 'ward', niveauElargissement: 'lga',
};

const lieu = (id: string, niveau: string, nom: string, idParent: string | null, voisins: string[] = []) =>
  ({ id, niveau, nom, idParent, voisins, aValider: true });

const REG = lieu('r-cky', 'region', 'Conakry', null);
const PREF = lieu('p-cky', 'prefecture', 'Conakry', 'r-cky');
const RATOMA = lieu('c-ratoma', 'commune', 'Ratoma', 'p-cky', ['c-dixinn']);
const DIXINN = lieu('c-dixinn', 'commune', 'Dixinn', 'p-cky', ['c-ratoma']);
const MATAM = lieu('c-matam', 'commune', 'Matam', 'p-cky');
const ARBRE = [REG, PREF, RATOMA, DIXINN, MATAM];

function installer(pays: ParametresPaysView, lieux = ARBRE) {
  getValeursParametres.mockResolvedValue({ pays });
  prisma.lieuGeo.findMany.mockResolvedValue(lieux);
}

beforeEach(() => {
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.lieuGeo.update.mockImplementation(({ where, data }) =>
    Promise.resolve({ ...ARBRE.find((l) => l.id === where.id), ...data }));
  installer(GUINEE);
});
afterEach(() => jest.resetAllMocks());

/** Les voisins ecrits sur un lieu donne. */
const ecrituresChez = (id: string) => prisma.lieuGeo.update.mock.calls
  .filter(([a]) => a.where.id === id).map(([a]) => a.data.voisins);

describe('voisinsDe (M1-C)', () => {
  // Une autre prefecture, avec une commune du meme nom et une voisine hors zone.
  const P_COYAH = lieu('p-coyah', 'prefecture', 'Coyah', 'r-kindia');
  const RATOMA_COYAH = lieu('c-ratoma-coyah', 'commune', 'Ratoma', 'p-coyah', ['c-manea']);
  const MANEA = lieu('c-manea', 'commune', 'Manéah', 'p-coyah', ['c-ratoma-coyah', 'c-ratoma']);
  const RATOMA_LIE = { ...RATOMA, voisins: ['c-dixinn', 'c-manea'] };

  it('rend les voisins du referentiel, sans tenir compte de la casse', async () => {
    expect(await voisinsDe(' conakry ', 'RATOMA')).toEqual(['Dixinn']);
  });

  it('ne sort pas de la zone d elargissement, meme si un voisin la deborde', async () => {
    installer(GUINEE, [REG, PREF, RATOMA_LIE, DIXINN, MATAM, P_COYAH, RATOMA_COYAH, MANEA]);
    expect(await voisinsDe('Conakry', 'Ratoma')).toEqual(['Dixinn']);
  });

  it('distingue deux communes du meme nom dans deux prefectures', async () => {
    installer(GUINEE, [REG, PREF, RATOMA, DIXINN, MATAM, P_COYAH, RATOMA_COYAH, MANEA]);
    expect(await voisinsDe('Coyah', 'Ratoma')).toEqual(['Manéah']);
  });

  it('un lieu absent du referentiel, ou une saisie vide, n a pas de voisins connus', async () => {
    expect(await voisinsDe('Conakry', 'Kassa')).toEqual([]);
    expect(await voisinsDe('', 'Ratoma')).toEqual([]);
    expect(await voisinsDe('Conakry', null)).toEqual([]);
  });

  it('suit les niveaux du pays installe', async () => {
    installer(NIGERIA, [
      lieu('s-lagos', 'state', 'Lagos', null),
      lieu('l-ikeja', 'lga', 'Ikeja', 's-lagos'),
      lieu('w-1', 'ward', 'Alausa', 'l-ikeja', ['w-2']),
      lieu('w-2', 'ward', 'Oregun', 'l-ikeja', ['w-1']),
    ]);
    // Au Nigeria, la zone d'elargissement est la LGA et la base le ward.
    expect(await voisinsDe('Ikeja', 'Alausa')).toEqual(['Oregun']);
  });
});

// R8 : la prefecture qu'un patient declare en demenageant.
describe('zoneElargissementConnue', () => {
  const parNiveau = (lieux: typeof ARBRE) => ({ where }: { where: { niveau: string } }) =>
    Promise.resolve(lieux.filter((l) => l.niveau === where.niveau));
  const KINDIA = lieu('p-kindia', 'prefecture', 'Kindia', 'r-kindia');

  it('rend le nom exact du referentiel, sans casse ni espaces', async () => {
    installer(GUINEE);
    prisma.lieuGeo.findMany.mockImplementation(parNiveau([...ARBRE, KINDIA]));
    expect(await zoneElargissementConnue('  KINDIA ')).toBe('Kindia');
    expect(prisma.lieuGeo.findMany.mock.calls[0][0].where).toEqual({ niveau: 'prefecture' });
  });

  it('une zone inconnue du referentiel rend null, une commune aussi', async () => {
    installer(GUINEE);
    prisma.lieuGeo.findMany.mockImplementation(parNiveau(ARBRE));
    expect(await zoneElargissementConnue('Atlantis')).toBeNull();
    expect(await zoneElargissementConnue('Ratoma')).toBeNull();
  });

  it('suit le niveau d elargissement du pays installe', async () => {
    installer(NIGERIA);
    prisma.lieuGeo.findMany.mockImplementation(parNiveau([lieu('l-ikeja', 'lga', 'Ikeja', 's-lagos')]));
    expect(await zoneElargissementConnue('ikeja')).toBe('Ikeja');
  });

  it('tant que le referentiel n a aucune zone, garde le texte saisi', async () => {
    installer(GUINEE);
    prisma.lieuGeo.findMany.mockImplementation(parNiveau([REG]));
    expect(await zoneElargissementConnue('  Boké ')).toBe('Boké');
  });

  it('un texte vide rend null', async () => {
    installer(GUINEE);
    expect(await zoneElargissementConnue('   ')).toBeNull();
    expect(prisma.lieuGeo.findMany).not.toHaveBeenCalled();
  });
});

describe('configuration', () => {
  it('rend le decoupage du pays installe et dit si un jeu de depart existe', async () => {
    expect(await configuration()).toMatchObject({ code: 'GN', niveauBase: 'commune', jeuDeDepartDisponible: true });
  });

  it('pas de jeu de depart pour un pays qui n en a pas', async () => {
    installer(NIGERIA);
    expect((await configuration()).jeuDeDepartDisponible).toBe(false);
  });

  // Meme pays, autre decoupage : charger le jeu le placerait aux mauvais niveaux.
  it('pas de jeu de depart si le decoupage differe, meme pour la Guinee', async () => {
    installer({ ...GUINEE, niveaux: GUINEE.niveaux.slice(1), niveauElargissement: 'prefecture' });
    expect((await configuration()).jeuDeDepartDisponible).toBe(false);
  });
});

describe('listerLieux', () => {
  it('filtre par niveau et donne le nom du parent et des voisins', async () => {
    const communes = await listerLieux({ niveau: 'commune' });
    expect(communes.map((c) => c.nom)).toEqual(['Ratoma', 'Dixinn', 'Matam']);
    expect(communes[0]).toMatchObject({ parent: 'Conakry', voisins: [{ id: 'c-dixinn', nom: 'Dixinn' }] });
  });

  it('dans : les descendants d un lieu nomme, a n importe quel niveau au-dessus, sans casse', async () => {
    const autre = lieu('c-coyah', 'commune', 'Coyah-Centre', 'p-coyah');
    installer(GUINEE, [...ARBRE, lieu('p-coyah', 'prefecture', 'Coyah', 'r-kindia'), lieu('r-kindia', 'region', 'Kindia', null), autre]);

    expect((await listerLieux({ niveau: 'commune', dans: 'conakry' })).map((c) => c.nom)).toEqual(['Ratoma', 'Dixinn', 'Matam']);
    expect((await listerLieux({ niveau: 'commune', dans: 'Kindia' })).map((c) => c.nom)).toEqual(['Coyah-Centre']);
  });

  it('parent : les enfants directs', async () => {
    expect((await listerLieux({ parent: 'r-cky' })).map((c) => c.id)).toEqual(['p-cky']);
  });
});

describe('creerLieu', () => {
  beforeEach(() => {
    prisma.lieuGeo.create.mockImplementation(({ data }) => Promise.resolve({ id: 'nouveau', voisins: [], ...data }));
  });

  it('range une commune sous sa prefecture, confirmee d emblee', async () => {
    prisma.lieuGeo.findUnique.mockResolvedValue(PREF);
    prisma.lieuGeo.findMany.mockResolvedValue([]);

    const cree = await creerLieu({ niveau: 'commune', nom: '  Kassa ', idParent: 'p-cky' });

    expect(prisma.lieuGeo.create.mock.calls[0][0].data).toEqual({ niveau: 'commune', nom: 'Kassa', idParent: 'p-cky', aValider: false });
    expect(cree.parent).toBe('Conakry');
  });

  // Avec ou sans parent, c'est le niveau qui est refuse, et c'est ce que dit l'erreur.
  it('refuse un niveau absent du decoupage du pays', async () => {
    prisma.lieuGeo.findUnique.mockResolvedValue(PREF);
    await expect(creerLieu({ niveau: 'lga', nom: 'Ikeja' })).rejects.toThrow('absent du decoupage');
    await expect(creerLieu({ niveau: 'lga', nom: 'Ikeja', idParent: 'p-cky' })).rejects.toThrow('absent du decoupage');
    expect(prisma.lieuGeo.create).not.toHaveBeenCalled();
  });

  // Au Nigeria, le meme code marche : le decoupage vient des parametres.
  it('suit le decoupage d un autre pays', async () => {
    installer(NIGERIA, []);
    prisma.lieuGeo.findUnique.mockResolvedValue(lieu('s-lagos', 'state', 'Lagos', null));
    prisma.lieuGeo.findMany.mockResolvedValue([]);

    await creerLieu({ niveau: 'lga', nom: 'Ikeja', idParent: 's-lagos' });

    expect(prisma.lieuGeo.create.mock.calls[0][0].data).toMatchObject({ niveau: 'lga', idParent: 's-lagos' });
  });

  it('refuse un parent qui n est pas du niveau immediatement au-dessus', async () => {
    prisma.lieuGeo.findUnique.mockResolvedValue(REG);
    await expect(creerLieu({ niveau: 'commune', nom: 'Kassa', idParent: 'r-cky' })).rejects.toThrow('prefecture');
    expect(prisma.lieuGeo.create).not.toHaveBeenCalled();
  });

  it('exige un parent sous le niveau le plus large, et le refuse au plus large', async () => {
    await expect(creerLieu({ niveau: 'commune', nom: 'Kassa' })).rejects.toBeInstanceOf(ValidationError);
    await expect(creerLieu({ niveau: 'region', nom: 'Boké', idParent: 'r-cky' })).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.lieuGeo.create).not.toHaveBeenCalled();
  });

  it('404 sur un parent inconnu', async () => {
    prisma.lieuGeo.findUnique.mockResolvedValue(null);
    await expect(creerLieu({ niveau: 'commune', nom: 'Kassa', idParent: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  // « ratoma » et « Ratoma » sont le meme lieu : un doublon couperait les zones en deux.
  it('refuse un doublon sous le meme parent, sans tenir compte de la casse', async () => {
    prisma.lieuGeo.findUnique.mockResolvedValue(PREF);
    prisma.lieuGeo.findMany.mockResolvedValue([{ id: 'c-ratoma' }]);

    await expect(creerLieu({ niveau: 'commune', nom: 'ratoma', idParent: 'p-cky' })).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.lieuGeo.findMany.mock.calls[0][0].where).toEqual({
      niveau: 'commune', idParent: 'p-cky', nom: { equals: 'ratoma', mode: 'insensitive' },
    });
    expect(prisma.lieuGeo.create).not.toHaveBeenCalled();
  });
});

describe('modifierLieu : voisinage', () => {
  it('ajoute le lien dans l autre sens', async () => {
    const vue = await modifierLieu('c-ratoma', { voisins: ['c-dixinn', 'c-matam'] });

    expect(vue.voisins.map((v) => v.nom)).toEqual(['Dixinn', 'Matam']);
    expect(ecrituresChez('c-matam')).toEqual([['c-ratoma']]);
    // Dixinn avait deja le lien : on n'y touche pas.
    expect(ecrituresChez('c-dixinn')).toEqual([]);
  });

  it('retire le lien dans l autre sens quand un voisin est enleve', async () => {
    await modifierLieu('c-ratoma', { voisins: ['c-matam'] });

    expect(ecrituresChez('c-dixinn')).toEqual([[]]);
    expect(ecrituresChez('c-matam')).toEqual([['c-ratoma']]);
  });

  it('ignore les doublons et le lieu lui-meme', async () => {
    await modifierLieu('c-ratoma', { voisins: ['c-dixinn', 'c-dixinn', 'c-ratoma'] });
    expect(ecrituresChez('c-ratoma')).toEqual([['c-dixinn']]);
  });

  it('refuse un voisin inconnu ou d un autre niveau, sans rien ecrire', async () => {
    await expect(modifierLieu('c-ratoma', { voisins: ['p-cky'] })).rejects.toThrow('p-cky');
    await expect(modifierLieu('c-ratoma', { voisins: ['inconnu'] })).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.lieuGeo.update).not.toHaveBeenCalled();
  });

  it(`refuse plus de ${MAX_VOISINS} voisins`, async () => {
    const beaucoup = Array.from({ length: MAX_VOISINS + 1 }, (_, i) => lieu(`c${i}`, 'commune', `C${i}`, 'p-cky'));
    installer(GUINEE, [...ARBRE, ...beaucoup]);

    await expect(modifierLieu('c-ratoma', { voisins: beaucoup.map((c) => c.id) })).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.lieuGeo.update).not.toHaveBeenCalled();
  });

  it('valider sans toucher au voisinage', async () => {
    await modifierLieu('c-ratoma', { aValider: false });
    expect(prisma.lieuGeo.update).toHaveBeenCalledTimes(1);
    expect(prisma.lieuGeo.update.mock.calls[0][0].data).toEqual({ aValider: false });
  });

  it('404 sur un lieu inconnu', async () => {
    await expect(modifierLieu('x', { aValider: false })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('chargerJeuDeDepart', () => {
  let n = 0;
  beforeEach(() => {
    n = 0;
    prisma.lieuGeo.create.mockImplementation(() => Promise.resolve({ id: `g${++n}` }));
  });

  it('charge la Guinee : 8 regions, 34 prefectures avec Conakry, 13 communes', async () => {
    installer(GUINEE, []);

    const r = await chargerJeuDeDepart();

    const parNiveau = (niv: string) => prisma.lieuGeo.create.mock.calls.filter(([a]) => a.data.niveau === niv).length;
    expect([parNiveau('region'), parNiveau('prefecture'), parNiveau('commune')]).toEqual([8, 34, 13]);
    expect(r).toEqual({ crees: 55, dejaPresents: 0 });
    // Les communes sont rangees sous la prefecture Conakry, pas a la racine.
    const ratoma = prisma.lieuGeo.create.mock.calls.find(([a]) => a.data.nom === 'Ratoma')![0].data;
    expect(ratoma.idParent).not.toBeNull();
  });

  it('relancer ne cree pas de doublon', async () => {
    const r = await chargerJeuDeDepart();
    // Conakry (region, prefecture) et ses 3 communes deja la : elles ne sont pas recreees.
    expect(r.dejaPresents).toBe(5);
    expect(prisma.lieuGeo.create.mock.calls.some(([a]) => a.data.nom === 'Ratoma')).toBe(false);
  });

  it('refuse sans jeu pour le pays installe, sans rien ecrire', async () => {
    installer(NIGERIA, []);
    await expect(chargerJeuDeDepart()).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.lieuGeo.create).not.toHaveBeenCalled();
  });
});

describe('horsReferentiel', () => {
  it('remonte les lieux de base saisis hors liste, rattaches a leur zone, les plus frequents d abord', async () => {
    prisma.patientProfile.groupBy.mockResolvedValue([
      { prefecture: 'Conakry', commune: 'Ratoma', _count: { _all: 40 } },
      { prefecture: 'Conakry', commune: 'Ratomaa', _count: { _all: 2 } },
      { prefecture: 'Kindia', commune: 'Mambia', _count: { _all: 3 } },
      // Ratoma existe, mais dans Conakry : saisie sous Coyah, elle est hors referentiel.
      { prefecture: 'Coyah', commune: 'Ratoma', _count: { _all: 1 } },
    ]);
    prisma.structureSante.groupBy.mockResolvedValue([
      { prefecture: 'kindia', commune: 'mambia ', _count: { _all: 1 } },
      { prefecture: 'Conakry', commune: '  ', _count: { _all: 5 } },
    ]);
    prisma.livreurProfile.groupBy.mockResolvedValue([{ prefecture: 'CONAKRY', commune: 'RATOMA', _count: { _all: 4 } }]);

    expect(await horsReferentiel()).toEqual([
      { zone: 'Kindia', lieu: 'Mambia', patients: 3, structures: 1, livreurs: 0, total: 4 },
      { zone: 'Conakry', lieu: 'Ratomaa', patients: 2, structures: 0, livreurs: 0, total: 2 },
      { zone: 'Coyah', lieu: 'Ratoma', patients: 1, structures: 0, livreurs: 0, total: 1 },
    ]);
  });

  it('ne compte que les saisies qui ont un lieu de base', async () => {
    for (const m of [prisma.patientProfile, prisma.structureSante, prisma.livreurProfile]) m.groupBy.mockResolvedValue([]);
    await horsReferentiel();
    expect(prisma.patientProfile.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['prefecture', 'commune'], where: { commune: { not: null } },
    });
  });
});
