// Le bureau d'un médecin (EF-03).
//
// **Où le patient doit se rendre**, lu par l'accueil juste après l'avoir
// pointé. Facultatif : beaucoup d'hôpitaux ne numérotent pas leurs bureaux et
// l'agent accompagne à pied — c'est le cas décrit par l'utilisateur après deux
// séjours en hôpital.
//
// **Ce garde a été faux.** Il lisait `medecinProfile.idStructure`, que seul
// `creerAgent` renseigne : un médecin venu du jeu de démonstration ou d'un jeu
// de test avait ce champ nul, et l'administrateur de sa propre structure se
// voyait répondre « Médecin introuvable ». L'appartenance se lit sur le
// compte, comme partout ailleurs dans l'application.

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn(), findFirst: jest.fn() },
    medecinProfile: { update: jest.fn() },
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/services/email.service', () => ({
  envoyerEmailAdminStructure: jest.fn(), envoyerEmailAgent: jest.fn(),
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M; findFirst: M };
    medecinProfile: { update: M };
  };
};

import { definirBureau } from '../src/services/admin-structure.service';

const ADMIN = { userId: 'u-admin', role: 'ADMIN_STRUCTURE' } as never;
const MEDECIN = { prenom: 'David', nom: 'Camara', medecinProfile: { id: 'mp-1' } };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 's-1' });
  prisma.utilisateur.findFirst.mockResolvedValue(MEDECIN);
  prisma.medecinProfile.update.mockResolvedValue({});
});

describe('definirBureau', () => {
  it('enregistre le bureau, sans ses espaces', async () => {
    const r = await definirBureau(ADMIN, 'u-doc', '  Bâtiment B, bureau 12  ');
    const [args] = prisma.medecinProfile.update.mock.calls[0] as [{ data: { bureau: string | null } }];
    expect(args.data.bureau).toBe('Bâtiment B, bureau 12');
    expect(r).toEqual({ id: 'u-doc', nomComplet: 'David Camara', bureau: 'Bâtiment B, bureau 12' });
  });

  // **Le cas de l'hôpital sans numérotation.** Effacer doit être possible :
  // sinon un bureau saisi par erreur reste affiché, et le patient y va.
  it.each([null, '', '   '])('efface le bureau quand on envoie %p', async (valeur) => {
    const r = await definirBureau(ADMIN, 'u-doc', valeur);
    const [args] = prisma.medecinProfile.update.mock.calls[0] as [{ data: { bureau: string | null } }];
    expect(args.data.bureau).toBeNull();
    expect(r.bureau).toBeNull();
  });

  // **La règle qui compte** : un administrateur ne touche qu'aux médecins de
  // sa structure. Sans elle, l'admin d'un hôpital pourrait déplacer le bureau
  // d'un médecin d'un autre hôpital, et envoyer ses patients au mauvais endroit.
  //
  // Elle doit porter sur le compte : c'est la colonne que remplissent tous les
  // chemins de création, et celle que lisent la liste des agents,
  // l'orientation et `structureDe()`.
  it('cherche le médecin par la structure de son compte', async () => {
    await definirBureau(ADMIN, 'u-doc', 'B12');
    const where = prisma.utilisateur.findFirst.mock.calls[0]![0].where;
    // Un praticien : medecin ou sage-femme, qui recoit aussi dans un bureau.
    expect(where).toMatchObject({ id: 'u-doc', role: { in: ['MEDECIN', 'SAGE_FEMME'] }, idStructure: 's-1' });
  });

  it('refuse un médecin d une autre structure', async () => {
    prisma.utilisateur.findFirst.mockResolvedValue(null);
    await expect(definirBureau(ADMIN, 'u-doc', 'B12')).rejects.toThrow(/introuvable/i);
    expect(prisma.medecinProfile.update).not.toHaveBeenCalled();
  });

  it('refuse un compte qui n est pas médecin', async () => {
    prisma.utilisateur.findFirst.mockResolvedValue(null);
    await expect(definirBureau(ADMIN, 'u-accueil', 'B12')).rejects.toThrow(/introuvable/i);
    expect(prisma.medecinProfile.update).not.toHaveBeenCalled();
  });

  it('refuse un administrateur sans structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: null });
    await expect(definirBureau(ADMIN, 'u-doc', 'B12')).rejects.toThrow(/structure/i);
    expect(prisma.utilisateur.findFirst).not.toHaveBeenCalled();
    expect(prisma.medecinProfile.update).not.toHaveBeenCalled();
  });

  // Le cas qui a cassé l'écran : compte bien rattaché, profil absent. On le
  // dit, au lieu de laisser l'agent cliquer sans effet.
  it('le dit quand le compte médecin n a pas de profil', async () => {
    prisma.utilisateur.findFirst.mockResolvedValue({ ...MEDECIN, medecinProfile: null });
    await expect(definirBureau(ADMIN, 'u-doc', 'B12')).rejects.toThrow(/profil/i);
    expect(prisma.medecinProfile.update).not.toHaveBeenCalled();
  });
});
