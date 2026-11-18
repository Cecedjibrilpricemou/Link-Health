// L'adresse du patient (M3) : commune et quartier decident a quelles
// pharmacies part son ordonnance ; la position n'entre qu'avec son accord.
import { definirAdresse, monAdresse } from '../src/services/patient-adresse.service';
import { NotFoundError, ValidationError } from '../src/utils/app-error';
import { definirAdresseSchema } from '../src/validators/api.schemas';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    patientProfile: { findUnique: jest.fn(), update: jest.fn() },
    journalAudit: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/services/geographie.service', () => ({ zoneElargissementConnue: jest.fn() }));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    patientProfile: { findUnique: jest.Mock; update: jest.Mock };
    journalAudit: { create: jest.Mock };
    $transaction: jest.Mock;
  };
};
const { zoneElargissementConnue } = jest.requireMock('../src/services/geographie.service') as { zoneElargissementConnue: jest.Mock };

const STOCKEE = {
  id: 'pat-1', prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
  // R4 : stockee chiffree en « lat,lng » ; elle arrive ici dechiffree.
  pointRepere: 'Derriere la mosquee', position: '9.6,-13.6',
  positionLe: new Date('2026-11-11T10:00:00Z'),
};

beforeEach(() => {
  prisma.patientProfile.findUnique.mockResolvedValue({ id: 'pat-1', idFusionneDans: null });
  prisma.patientProfile.update.mockResolvedValue(STOCKEE);
});
afterEach(() => jest.resetAllMocks());

const dataEcrite = () => prisma.patientProfile.update.mock.calls[0][0].data;

describe('definirAdresse', () => {
  it('enregistre commune, quartier et point de repere', async () => {
    const vue = await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', pointRepere: '  Derriere la mosquee ' });

    expect(prisma.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pat-1' } }));
    expect(dataEcrite()).toEqual({ commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee' });
    expect(vue).toEqual({
      prefecture: STOCKEE.prefecture, commune: STOCKEE.commune, quartier: STOCKEE.quartier,
      pointRepere: STOCKEE.pointRepere, latitude: 9.6, longitude: -13.6, positionLe: '2026-11-11T10:00:00.000Z',
    });
  });

  // Changer de point de repere ne doit pas effacer le GPS en silence.
  it('garde la position deja donnee quand on n en envoie pas', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé' });

    expect(dataEcrite()).not.toHaveProperty('position');
    expect(dataEcrite()).not.toHaveProperty('positionLe');
  });

  it('un point de repere vide s efface', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', pointRepere: '   ' });
    expect(dataEcrite().pointRepere).toBeNull();
  });

  it('enregistre la position donnee, datee', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', latitude: 9.64, longitude: -13.58 });

    expect(dataEcrite()).toMatchObject({ position: '9.64,-13.58', positionLe: expect.any(Date) });
    expect(dataEcrite()).not.toHaveProperty('latitude');
  });

  it('efface la position a la demande', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', effacerPosition: true });

    expect(dataEcrite()).toMatchObject({ position: null, positionLe: null });
  });

  // Une latitude sans longitude ne place rien sur une carte.
  it('refuse une position incomplete, sans rien ecrire', async () => {
    await expect(definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', latitude: 9.64 }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(prisma.patientProfile.update).not.toHaveBeenCalled();
  });

  // Les ordonnances vivent sur le dossier principal : c'est son adresse qui compte.
  it('ecrit sur le dossier principal quand le sien a ete fusionne', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'pat-ancien', idFusionneDans: 'pat-principal' });

    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé' });

    expect(prisma.patientProfile.update.mock.calls[0][0].where).toEqual({ id: 'pat-principal' });
  });

  it('404 sans profil patient', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(definirAdresse('u-x', { commune: 'Ratoma', quartier: 'Kipé' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('monAdresse', () => {
  it('lit l adresse du dossier principal', async () => {
    prisma.patientProfile.findUnique
      .mockResolvedValueOnce({ id: 'pat-ancien', idFusionneDans: 'pat-principal' })
      .mockResolvedValueOnce({ ...STOCKEE, positionLe: null });

    const vue = await monAdresse('u-pat');

    expect(prisma.patientProfile.findUnique.mock.calls[1][0].where).toEqual({ id: 'pat-principal' });
    expect(vue).toMatchObject({ commune: 'Ratoma', pointRepere: 'Derriere la mosquee', positionLe: null });
  });
});

describe('definirAdresseSchema', () => {
  const ok = (body: unknown) => definirAdresseSchema.safeParse(body).success;

  it('exige commune et quartier', () => {
    expect(ok({ commune: 'Ratoma', quartier: 'Kipé' })).toBe(true);
    expect(ok({ commune: 'Ratoma' })).toBe(false);
    expect(ok({ commune: ' ', quartier: 'Kipé' })).toBe(false);
  });

  it('borne la position et le point de repere', () => {
    expect(ok({ commune: 'R', quartier: 'K', latitude: 91, longitude: 0 })).toBe(false);
    expect(ok({ commune: 'R', quartier: 'K', pointRepere: 'x'.repeat(201) })).toBe(false);
  });

  it('refuse de donner et d effacer sa position en meme temps', () => {
    expect(ok({ commune: 'R', quartier: 'K', latitude: 9, longitude: -13, effacerPosition: true })).toBe(false);
  });

  // R8 : la prefecture se change ici, en demenageant ; le reste reste ferme.
  it('accepte la prefecture, refuse un champ inconnu', () => {
    expect(ok({ commune: 'R', quartier: 'K', prefecture: 'Kindia' })).toBe(true);
    expect(ok({ commune: 'R', quartier: 'K', prefecture: '  ' })).toBe(false);
    expect(ok({ commune: 'R', quartier: 'K', sexe: 'F' })).toBe(false);
  });
});

// R8 : un patient qui demenage change lui-meme de prefecture. Ce qui compte :
// seulement vers une prefecture du referentiel, sous son nom exact ; l'ancienne
// position s'efface (un motard irait a l'ancien domicile) ; le changement est
// journalise ; et sans changement reel, rien de tout cela.
describe('definirAdresse : changer de prefecture', () => {
  const MAINTENANT = new Date('2026-11-12T12:00:00Z');
  const KINDIA = { commune: 'Kindia-Centre', quartier: 'Banlieue', prefecture: '  kindia ' };

  beforeEach(() => {
    prisma.patientProfile.findUnique
      .mockResolvedValueOnce({ id: 'pat-1', idFusionneDans: null })
      .mockResolvedValueOnce({ prefecture: 'Conakry' });
    zoneElargissementConnue.mockImplementation((t: string) =>
      Promise.resolve(['Conakry', 'Kindia'].find((z) => z.toLowerCase() === t.trim().toLowerCase()) ?? null));
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  });

  it('enregistre le nom du referentiel, efface l ancienne position et journalise', async () => {
    await definirAdresse('u-pat', KINDIA, MAINTENANT);

    expect(dataEcrite()).toEqual({
      prefecture: 'Kindia', commune: 'Kindia-Centre', quartier: 'Banlieue', pointRepere: null,
      position: null, positionLe: null,
    });
    expect(prisma.journalAudit.create).toHaveBeenCalledWith({
      data: {
        action: 'CHANGEMENT_PREFECTURE', ressource: 'patients', idRessource: 'pat-1', idUtilisateur: 'u-pat',
        creeLe: MAINTENANT, metadonnees: { avant: 'Conakry', apres: 'Kindia' },
      },
    });
  });

  it('garde une nouvelle position donnee avec le demenagement', async () => {
    await definirAdresse('u-pat', { ...KINDIA, latitude: 10.05, longitude: -12.86 }, MAINTENANT);
    expect(dataEcrite()).toMatchObject({ prefecture: 'Kindia', position: '10.05,-12.86', positionLe: MAINTENANT });
  });

  it('refuse une prefecture inconnue du referentiel, sans rien ecrire', async () => {
    await expect(definirAdresse('u-pat', { ...KINDIA, prefecture: 'Atlantis' }, MAINTENANT)).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.patientProfile.update).not.toHaveBeenCalled();
    expect(prisma.journalAudit.create).not.toHaveBeenCalled();
  });

  it('la meme prefecture, autrement ecrite : ni changement, ni journal, position gardee', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', prefecture: 'CONAKRY' }, MAINTENANT);

    expect(dataEcrite()).not.toHaveProperty('prefecture');
    expect(dataEcrite()).not.toHaveProperty('position');
    expect(prisma.journalAudit.create).not.toHaveBeenCalled();
  });
});

// R4 : une position illisible (tronquee, ou encore chiffree faute de cle)
// ne doit ni planter ni guider le motard au mauvais endroit.
describe('monAdresse avec une position illisible', () => {
  it('rend une position absente, sans date', async () => {
    prisma.patientProfile.findUnique
      .mockResolvedValueOnce({ id: 'pat-1', idFusionneDans: null })
      .mockResolvedValueOnce({ ...STOCKEE, position: 'enc:v1:AAAA' });

    const vue = await monAdresse('u-pat');

    expect(vue).toMatchObject({ latitude: null, longitude: null, positionLe: null, pointRepere: 'Derriere la mosquee' });
  });
});
