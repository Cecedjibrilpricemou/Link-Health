// L'adresse du patient (M3) : commune et quartier decident a quelles
// pharmacies part son ordonnance ; la position n'entre qu'avec son accord.
import { definirAdresse, monAdresse } from '../src/services/patient-adresse.service';
import { NotFoundError, ValidationError } from '../src/utils/app-error';
import { definirAdresseSchema } from '../src/validators/api.schemas';

jest.mock('../src/config/prisma', () => ({
  prisma: { patientProfile: { findUnique: jest.fn(), update: jest.fn() } },
}));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { patientProfile: { findUnique: jest.Mock; update: jest.Mock } };
};

const STOCKEE = {
  id: 'pat-1', prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
  pointRepere: 'Derriere la mosquee', latitude: 9.6, longitude: -13.6,
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
    expect(vue).toEqual({ ...STOCKEE, id: undefined, positionLe: '2026-11-11T10:00:00.000Z' });
  });

  // Changer de point de repere ne doit pas effacer le GPS en silence.
  it('garde la position deja donnee quand on n en envoie pas', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé' });

    expect(dataEcrite()).not.toHaveProperty('latitude');
    expect(dataEcrite()).not.toHaveProperty('positionLe');
  });

  it('un point de repere vide s efface', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', pointRepere: '   ' });
    expect(dataEcrite().pointRepere).toBeNull();
  });

  it('enregistre la position donnee, datee', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', latitude: 9.64, longitude: -13.58 });

    expect(dataEcrite()).toMatchObject({ latitude: 9.64, longitude: -13.58, positionLe: expect.any(Date) });
  });

  it('efface la position a la demande', async () => {
    await definirAdresse('u-pat', { commune: 'Ratoma', quartier: 'Kipé', effacerPosition: true });

    expect(dataEcrite()).toMatchObject({ latitude: null, longitude: null, positionLe: null });
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

  // La prefecture n'est pas modifiable ici : elle decoule de l'inscription.
  it('refuse un champ inconnu, dont la prefecture', () => {
    expect(ok({ commune: 'R', quartier: 'K', prefecture: 'Kindia' })).toBe(false);
  });
});
