// Les images des pages publiques, remplacees par le super-admin.
//
// De vraies images, fabriquees ici et passees par sharp : on verifie ce qui
// est ecrit sur le disque, pas seulement ce qui est appele.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { decrireVisuel, remplacerVisuel, retablirVisuel } from '../src/services/visuels.service';
import { ValidationError } from '../src/utils/app-error';

jest.mock('../src/middlewares/upload.middleware', () => {
  const os = jest.requireActual('os') as typeof import('os');
  const fsr = jest.requireActual('fs') as typeof import('fs');
  const p = jest.requireActual('path') as typeof import('path');
  return {
    VISUELS_DIR: fsr.mkdtempSync(p.join(os.tmpdir(), 'visuels-')),
    VISUELS_PUBLIC_PATH: '/uploads/visuels',
  };
});
jest.mock('../src/services/parametres.service', () => ({
  enregistrerVisuel: jest.fn(),
  getValeursParametres: jest.fn(),
}));

type M = jest.Mock;
const { VISUELS_DIR } = jest.requireMock('../src/middlewares/upload.middleware') as { VISUELS_DIR: string };
const parametres = jest.requireMock('../src/services/parametres.service') as { enregistrerVisuel: M; getValeursParametres: M };

const vide = { url: '', urlPetite: '', description: '' };
function visuels(acc: Partial<typeof vide> = {}) {
  return {
    ACCUEIL: { ...vide, ...acc }, CONNEXION: vide,
    ETAPE_1: vide, ETAPE_2: vide, ETAPE_3: vide, ETAPE_4: vide, ETAPE_5: vide, ETAPE_6: vide, ETAPE_7: vide,
  };
}

function image(largeur: number, hauteur: number, orientation?: number): Promise<Buffer> {
  const s = sharp({ create: { width: largeur, height: hauteur, channels: 3, background: { r: 40, g: 120, b: 90 } } }).jpeg();
  return (orientation ? s.withMetadata({ orientation }) : s).toBuffer();
}

const fichiers = () => fs.readdirSync(VISUELS_DIR);
const chemin = (url: string) => path.join(VISUELS_DIR, path.basename(url));
/** Lu depuis la memoire : sous Windows, sharp garderait le fichier ouvert. */
const lire = (url: string) => sharp(fs.readFileSync(chemin(url))).metadata();

sharp.cache(false);

/** Faire comme si des fichiers avaient ete ecrits il y a onze minutes. */
function vieillir(...noms: string[]) {
  const passe = new Date(Date.now() - 11 * 60 * 1000);
  for (const n of noms) fs.utimesSync(path.join(VISUELS_DIR, n), passe, passe);
}

beforeEach(() => {
  jest.resetAllMocks();
  for (const f of fichiers()) fs.rmSync(path.join(VISUELS_DIR, f));
  parametres.getValeursParametres.mockResolvedValue({ visuels: visuels() });
  parametres.enregistrerVisuel.mockImplementation(async (_u: string, e: string, v: unknown) => ({ ...visuels(), [e]: v }));
});

afterAll(() => fs.rmSync(VISUELS_DIR, { recursive: true, force: true }));

describe('remplacerVisuel — une image propre, quelle que soit celle recue', () => {
  it('reduit, convertit en WebP, et prepare une version pour petits ecrans', async () => {
    const r = await remplacerVisuel('admin', 'ACCUEIL', await image(2400, 1600));

    const v = r.ACCUEIL;
    expect(v.url).toMatch(/^\/uploads\/visuels\/visuel-accueil-.*-1600\.webp$/);
    expect(v.urlPetite).toMatch(/^\/uploads\/visuels\/visuel-accueil-.*-800\.webp$/);
    const grande = await lire(v.url);
    const petite = await lire(v.urlPetite);
    expect([grande.format, grande.width, grande.height]).toEqual(['webp', 1600, 1067]);
    expect([petite.format, petite.width]).toEqual(['webp', 800]);
    expect(fichiers()).toHaveLength(2);
    expect(parametres.enregistrerVisuel).toHaveBeenCalledWith('admin', 'ACCUEIL', expect.objectContaining({ description: '' }));
  });

  it('n agrandit jamais une image', async () => {
    const r = await remplacerVisuel('admin', 'ETAPE_2', await image(1000, 700));
    expect((await lire(r.ETAPE_2.url)).width).toBe(1000);
  });

  it('refuse une image trop petite, en disant la taille attendue', async () => {
    const e = await remplacerVisuel('admin', 'ACCUEIL', await image(700, 500)).catch((x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/700 px.*900/);
    expect(fichiers()).toHaveLength(0);
    expect(parametres.enregistrerVisuel).not.toHaveBeenCalled();
  });

  it('mesure une photo de telephone telle qu elle s affiche, tournee', async () => {
    // 500 x 800 enregistree, 800 x 500 affichee (orientation 6) : assez large.
    const r = await remplacerVisuel('admin', 'ETAPE_1', await image(500, 800, 6));
    const m = await lire(r.ETAPE_1.url);
    expect([m.width, m.height]).toEqual([800, 500]);
  });

  it('refuse une image trop allongee', async () => {
    await expect(remplacerVisuel('admin', 'ETAPE_3', await image(3200, 900))).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse un fichier qui n est pas une image', async () => {
    const e = await remplacerVisuel('admin', 'ETAPE_3', Buffer.from('<script>alert(1)</script>')).catch((x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/illisible/);
  });

  it('refuse un emplacement inconnu', async () => {
    await expect(remplacerVisuel('admin', '../../etc', await image(1600, 1000))).rejects.toBeInstanceOf(ValidationError);
    expect(fichiers()).toHaveLength(0);
  });

  it('garde la description deja saisie', async () => {
    const premiere = await remplacerVisuel('admin', 'ACCUEIL', await image(1600, 1000));
    parametres.getValeursParametres.mockResolvedValue({ visuels: visuels({ ...premiere.ACCUEIL, description: 'Une infirmiere sourit' }) });
    const seconde = await remplacerVisuel('admin', 'ACCUEIL', await image(1800, 1200));
    expect(seconde.ACCUEIL.description).toBe('Une infirmiere sourit');
  });

  // La reponse publique reste une minute dans les navigateurs : supprimer
  // l'ancienne image aussitot afficherait une image cassee.
  it('l image remplacee reste servie un moment, puis part au changement suivant', async () => {
    const premiere = await remplacerVisuel('admin', 'ACCUEIL', await image(1600, 1000));
    const seconde = await remplacerVisuel('admin', 'ACCUEIL', await image(1800, 1200));
    const noms = (v: { url: string; urlPetite: string }) => [path.basename(v.url), path.basename(v.urlPetite)];
    expect(fichiers().sort()).toEqual([...noms(premiere.ACCUEIL), ...noms(seconde.ACCUEIL)].sort());

    vieillir(...noms(premiere.ACCUEIL));
    const troisieme = await remplacerVisuel('admin', 'ACCUEIL', await image(1700, 1100));
    expect(fichiers().sort()).toEqual([...noms(seconde.ACCUEIL), ...noms(troisieme.ACCUEIL)].sort());
  });

  it('ne touche jamais aux images d un autre emplacement', async () => {
    const etape = await remplacerVisuel('admin', 'ETAPE_1', await image(1200, 800));
    vieillir(path.basename(etape.ETAPE_1.url), path.basename(etape.ETAPE_1.urlPetite));
    await remplacerVisuel('admin', 'ACCUEIL', await image(1600, 1000));
    expect(fichiers()).toContain(path.basename(etape.ETAPE_1.url));
  });
});

describe('retablirVisuel — revenir a l image d origine', () => {
  it('vide l emplacement ; les fichiers partent apres le delai', async () => {
    const r = await remplacerVisuel('admin', 'CONNEXION', await image(1200, 1600));
    parametres.getValeursParametres.mockResolvedValue({ visuels: { ...visuels(), CONNEXION: r.CONNEXION } });

    const apres = await retablirVisuel('admin', 'CONNEXION');
    expect(apres.CONNEXION).toEqual(vide);
    expect(fichiers()).toHaveLength(2);

    vieillir(...fichiers());
    await retablirVisuel('admin', 'CONNEXION');
    expect(fichiers()).toHaveLength(0);
  });
});

describe('decrireVisuel — pour qui ne voit pas l image', () => {
  it('enregistre une phrase propre, sans toucher a l image', async () => {
    parametres.getValeursParametres.mockResolvedValue({ visuels: visuels({ url: '/uploads/visuels/a.webp', urlPetite: '/uploads/visuels/b.webp' }) });
    const r = await decrireVisuel('admin', 'ACCUEIL', '  Une   pharmacienne\n conseille une patiente  ');
    expect(r.ACCUEIL).toEqual({ url: '/uploads/visuels/a.webp', urlPetite: '/uploads/visuels/b.webp', description: 'Une pharmacienne conseille une patiente' });
  });

  it('refuse un roman', async () => {
    await expect(decrireVisuel('admin', 'ACCUEIL', 'x'.repeat(201))).rejects.toBeInstanceOf(ValidationError);
    expect(parametres.enregistrerVisuel).not.toHaveBeenCalled();
  });
});
