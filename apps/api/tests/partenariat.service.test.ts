// Qui reçoit les appels de commande du quartier.
//
// **Le drapeau existait, mais aucune porte ne l'ouvrait.** `estPartenaire`
// décide si une officine est sollicitée quand un patient cherche à faire
// servir son ordonnance. Il naissait à `false` et rien dans l'application ne
// le levait : ni la création administrative, ni la validation d'une demande
// d'agrément, ni aucune route. Une pharmacie entrée avec ses quatre pièces
// réglementaires restait muette, et son titulaire ne voyait qu'un refus —
// « votre pharmacie n'est pas partenaire de la plateforme » — sans que
// personne puisse y remédier autrement qu'en écrivant dans la base.
//
// Deux choses sont donc tenues ici : le partenariat se pose à la création, et
// il se retire quand il le faut.
import { definirPartenariat } from '../src/services/admin-structure.service';
import { NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: { structureSante: { findUnique: jest.fn(), update: jest.fn() } },
}));
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn() }));
jest.mock('../src/services/email.service', () => ({
  envoyerEmailAdminStructure: jest.fn(),
  envoyerEmailAgent: jest.fn(),
}));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { structureSante: { findUnique: jest.Mock; update: jest.Mock } };
};

describe('accorder et retirer le partenariat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.structureSante.findUnique.mockResolvedValue({ id: 'ph-1', estActive: true });
    prisma.structureSante.update.mockResolvedValue({ id: 'ph-1', estPartenaire: true });
  });

  it('accorde le partenariat et retient depuis quand', async () => {
    await definirPartenariat('ph-1', true);

    const appel = prisma.structureSante.update.mock.calls[0]![0];
    expect(appel.data.estPartenaire).toBe(true);
    expect(appel.data.partenaireDepuis).toBeInstanceOf(Date);
  });

  // Une structure ecartee puis reprise redemarre une periode : l'ancienne
  // date ne doit pas lui etre comptee.
  it('efface la date quand le partenariat est retire', async () => {
    await definirPartenariat('ph-1', false);

    const appel = prisma.structureSante.update.mock.calls[0]![0];
    expect(appel.data.estPartenaire).toBe(false);
    expect(appel.data.partenaireDepuis).toBeNull();
  });

  // Elle serait sollicitee pour une ordonnance sans personne pour repondre,
  // et le patient attendrait une reponse qui ne vient pas.
  it('refuse de rendre partenaire une structure desactivee', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({ id: 'ph-1', estActive: false });

    await expect(definirPartenariat('ph-1', true)).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });

  // Le retrait, lui, reste possible : une structure fermee doit pouvoir
  // sortir du circuit, et c'est meme le cas le plus courant.
  it('laisse retirer le partenariat d une structure desactivee', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({ id: 'ph-1', estActive: false });

    await expect(definirPartenariat('ph-1', false)).resolves.toBeDefined();
    expect(prisma.structureSante.update).toHaveBeenCalled();
  });

  it('refuse une structure inconnue sans rien ecrire', async () => {
    prisma.structureSante.findUnique.mockResolvedValue(null);

    await expect(definirPartenariat('absente', true)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });
});
