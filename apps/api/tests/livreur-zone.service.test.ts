// Disponibilite et zone de travail du motard (M4).
//
// Ce qui compte : un motard hors service n'est plus prevenu (voir
// course.service.test.ts), et sa zone reste celle d'un motard — sa commune
// plus cinq autres au plus, sans doublon ni sa propre commune.
import {
  definirCommunesDesservies,
  definirEnService,
  monProfilLivreur,
} from '../src/services/livreur-zone.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';
import type { JwtPayload } from '../src/types/auth.types';

jest.mock('../src/config/prisma', () => ({
  prisma: { livreurProfile: { findUnique: jest.fn(), update: jest.fn() } },
}));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { livreurProfile: { findUnique: jest.Mock; update: jest.Mock } };
};

const LIVREUR = { userId: 'u-livreur', role: 'LIVREUR' } as JwtPayload;
const PATIENT = { userId: 'u-patient', role: 'PATIENT' } as JwtPayload;

const PROFIL = {
  id: 'profil-1', prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
  communesDesservies: [] as string[], enService: false, enServiceDepuis: null as Date | null, estActif: true,
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.livreurProfile.findUnique.mockResolvedValue(PROFIL);
  // L'update renvoie le profil tel qu'il serait apres ecriture.
  prisma.livreurProfile.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...PROFIL, ...data }));
});

describe('profil et disponibilite du motard', () => {
  it('refuse tout autre role que LIVREUR', async () => {
    await expect(monProfilLivreur(PATIENT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(definirEnService(PATIENT, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.livreurProfile.findUnique).not.toHaveBeenCalled();
  });

  it('repond 404 sans profil livreur', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue(null);
    await expect(monProfilLivreur(LIVREUR)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('entrer en service pose la date, en sortir l efface', async () => {
    const entree = await definirEnService(LIVREUR, true);
    expect(entree.enService).toBe(true);
    expect(entree.enServiceDepuis).toEqual(expect.any(String));

    const sortie = await definirEnService(LIVREUR, false);
    expect(prisma.livreurProfile.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'profil-1' },
      data: { enService: false, enServiceDepuis: null },
    }));
    expect(sortie.enServiceDepuis).toBeNull();
  });

  it('un compte suspendu ne peut pas entrer en service, mais peut en sortir', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...PROFIL, estActif: false, enService: true });

    await expect(definirEnService(LIVREUR, true)).rejects.toThrow('suspendu');
    expect(prisma.livreurProfile.update).not.toHaveBeenCalled();

    await definirEnService(LIVREUR, false);
    expect(prisma.livreurProfile.update).toHaveBeenCalledTimes(1);
  });
});

describe('communes desservies', () => {
  it('nettoie : espaces, vides, doublons sans casse, et sa propre commune', async () => {
    const vue = await definirCommunesDesservies(LIVREUR, ['  Dixinn ', 'dixinn', '', 'Ratoma', 'Matam', 'RATOMA']);

    expect(prisma.livreurProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { communesDesservies: ['Dixinn', 'Matam'] },
    }));
    expect(vue.communesDesservies).toEqual(['Dixinn', 'Matam']);
  });

  it('accepte cinq communes, refuse la sixieme sans rien ecrire', async () => {
    await definirCommunesDesservies(LIVREUR, ['Dixinn', 'Matam', 'Kaloum', 'Matoto', 'Sonfonia']);
    expect(prisma.livreurProfile.update).toHaveBeenCalledTimes(1);

    await expect(definirCommunesDesservies(LIVREUR, ['Dixinn', 'Matam', 'Kaloum', 'Matoto', 'Sonfonia', 'Lambanyi']))
      .rejects.toBeInstanceOf(ValidationError);
    expect(prisma.livreurProfile.update).toHaveBeenCalledTimes(1);
  });

  it('les doublons et sa propre commune ne comptent pas dans la limite', async () => {
    await definirCommunesDesservies(LIVREUR, ['Dixinn', 'DIXINN', 'Ratoma', 'Matam', 'Kaloum', 'Matoto', 'Sonfonia']);
    expect(prisma.livreurProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { communesDesservies: ['Dixinn', 'Matam', 'Kaloum', 'Matoto', 'Sonfonia'] },
    }));
  });
});
