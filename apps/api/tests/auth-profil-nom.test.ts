// R15 : la fenetre « Mon profil » est commune a tous les roles. Pour un
// patient dont l'identite est verifiee, elle ne doit pas rouvrir la porte que
// son espace a fermee : meme regle, meme garde.
jest.mock('../src/config/prisma', () => ({
  prisma: { utilisateur: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() } },
}));
jest.mock('../src/services/patient.service', () => ({ assertNomModifiableParLePatient: jest.fn() }));
jest.mock('../src/services/compte.service', () => ({ assertNomModifiableParLeProfessionnel: jest.fn() }));
jest.mock('../src/services/email.service', () => ({
  envoyerOtpConnexion: jest.fn(),
  envoyerEmailResetMotDePasse: jest.fn(),
}));
jest.mock('../src/services/privacy.service', () => ({ initialiserConsentementsParDefaut: jest.fn() }));

import { updateProfil } from '../src/services/auth.service';
import { ForbiddenError } from '../src/utils/app-error';

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { utilisateur: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock } };
};
const { assertNomModifiableParLePatient } = jest.requireMock('../src/services/patient.service') as {
  assertNomModifiableParLePatient: jest.Mock;
};
const { assertNomModifiableParLeProfessionnel } = jest.requireMock('../src/services/compte.service') as {
  assertNomModifiableParLeProfessionnel: jest.Mock;
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.utilisateur.findFirst.mockResolvedValue(null);
});

describe('PUT /auth/profile et le nom du patient', () => {
  it('passe le nom souhaite a la garde du patient', async () => {
    await updateProfil('u1', { prenom: 'Awa', nom: 'Camara', email: 'awa@example.org' });
    expect(assertNomModifiableParLePatient).toHaveBeenCalledWith('u1', { prenom: 'Awa', nom: 'Camara' });
    expect(prisma.utilisateur.update).toHaveBeenCalled();
  });

  it('n ecrit rien quand la garde refuse', async () => {
    assertNomModifiableParLePatient.mockRejectedValue(new ForbiddenError('identite verifiee'));
    await expect(updateProfil('u1', { nom: 'Camara' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.utilisateur.update).not.toHaveBeenCalled();
  });

  // Et la meme fenetre, pour un professionnel dont l'ordre est verifie.
  it('passe aussi par la garde du professionnel, et n ecrit rien si elle refuse', async () => {
    await updateProfil('u1', { prenom: 'Awa', nom: 'Camara' });
    expect(assertNomModifiableParLeProfessionnel).toHaveBeenCalledWith('u1', { prenom: 'Awa', nom: 'Camara' });

    prisma.utilisateur.update.mockClear();
    assertNomModifiableParLeProfessionnel.mockRejectedValue(new ForbiddenError('ordre verifie'));
    await expect(updateProfil('u1', { nom: 'Camara' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.utilisateur.update).not.toHaveBeenCalled();
  });
});

// Le numero est la cle du compte : il ne change plus par ce formulaire.
describe('PUT /auth/profile et le numero de telephone', () => {
  beforeEach(() => prisma.utilisateur.findUnique.mockResolvedValue({ telephone: '620100010' }));

  it('refuse un autre numero, sans rien ecrire', async () => {
    await expect(updateProfil('u1', { telephone: '620999999' })).rejects.toThrow('code envoye au nouveau numero');
    expect(prisma.utilisateur.update).not.toHaveBeenCalled();
  });

  it('laisse passer le meme numero renvoye avec le formulaire, sans l ecrire', async () => {
    await updateProfil('u1', { telephone: ' 620100010 ', prenom: 'Awa' });
    expect(prisma.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { prenom: 'Awa' } });
  });
});
