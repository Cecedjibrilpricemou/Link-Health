// Ce que l'administration cree quand elle ouvre une structure.
//
// **Cette porte cree tous les types**, du poste de sante a la compagnie
// d'assurance. Elle donnait le meme role a tous les responsables, et deux
// metiers s'en trouvaient enfermes dehors : le titulaire d'officine, qui ne
// pouvait ni tenir sa caisse ni voir ses commandes, et le responsable
// d'assurance, dont l'espace etait inatteignable faute qu'aucun compte ne
// porte jamais le role `ASSUREUR`.
//
// Le role ne suffit d'ailleurs pas pour une officine : tous ses agents le
// portent. C'est le profil qui designe le titulaire.
jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    structureSante: { create: jest.fn(), findUnique: jest.fn() },
    pieceAgrement: { createMany: jest.fn() },
    utilisateur: { create: jest.fn(), findUnique: jest.fn() },
    pharmacienProfile: { create: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn(async () => 'hache') }));
jest.mock('../src/services/email.service', () => ({
  envoyerEmailAdminStructure: jest.fn(),
  envoyerEmailAgent: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// Le dossier reglementaire a son propre fichier de tests : ici on ne juge que
// le compte cree, pas la validation des pieces.
jest.mock('../src/services/piece-agrement.service', () => {
  const vrai = jest.requireActual('../src/services/piece-agrement.service');
  return {
    ...vrai,
    validerPieces: jest.fn(() => []),
    validerIdentifiants: jest.fn((_t: unknown, identifiants: unknown) => identifiants),
    ecrireFichiers: jest.fn(async () => []),
    supprimerFichiers: jest.fn(async () => undefined),
  };
});

import { creerStructureAvecAdmin } from '../src/services/admin-structure.service';

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    structureSante: { create: jest.Mock };
    utilisateur: { create: jest.Mock };
    pharmacienProfile: { create: jest.Mock };
  };
};

function dossier(type: string) {
  return {
    nom: 'Structure d essai',
    type,
    prefecture: 'Conakry',
    commune: 'Ratoma',
    telephone: '620000001',
    admin: {
      prenom: 'Awa',
      nom: 'Bah',
      telephone: '622000001',
      email: 'awa@example.gn',
    },
  } as never;
}

/** Le role passe a `utilisateur.create` lors du dernier appel. */
function roleCree(): string {
  return prisma.utilisateur.create.mock.calls[0]![0].data.role;
}

describe('le compte du responsable, a la creation administrative', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.structureSante.create.mockResolvedValue({ id: 'structure-1', nom: 'Structure d essai' });
    prisma.utilisateur.create.mockResolvedValue({
      id: 'compte-1', telephone: '622000001', email: 'awa@example.gn',
      prenom: 'Awa', nom: 'Bah', role: 'ADMIN_STRUCTURE',
    });
    prisma.pharmacienProfile.create.mockResolvedValue({});
  });

  // L'espace assureur existait sans qu'aucun compte puisse y entrer.
  it('fait du responsable d une assurance un ASSUREUR', async () => {
    await creerStructureAvecAdmin(dossier('ASSURANCE'), []);

    expect(roleCree()).toBe('ASSUREUR');
    expect(prisma.pharmacienProfile.create).not.toHaveBeenCalled();
  });

  it('fait du responsable d une officine un PHARMACIEN titulaire', async () => {
    await creerStructureAvecAdmin(dossier('PHARMACIE'), []);

    expect(roleCree()).toBe('PHARMACIEN');
    expect(prisma.pharmacienProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idUtilisateur: 'compte-1',
          idStructure: 'structure-1',
          estResponsable: true,
          roleOfficine: 'TITULAIRE',
        }),
      }),
    );
  });

  it.each(['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'LABORATOIRE'])(
    'laisse le responsable d un %s administrateur de structure',
    async (type) => {
      await creerStructureAvecAdmin(dossier(type), []);

      expect(roleCree()).toBe('ADMIN_STRUCTURE');
      expect(prisma.pharmacienProfile.create).not.toHaveBeenCalled();
    },
  );

  // Le compte doit pointer vers la structure qui vient d'etre creee : c'est
  // par ce rattachement que l'espace assureur retrouve sa compagnie, et que
  // le titulaire retrouve son officine.
  it('rattache le compte a la structure creee', async () => {
    await creerStructureAvecAdmin(dossier('ASSURANCE'), []);

    expect(prisma.utilisateur.create.mock.calls[0]![0].data.idStructure).toBe('structure-1');
  });
});
