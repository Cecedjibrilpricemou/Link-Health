// Deux promesses faites a l'administration qui cree un compte.
//
// **La premiere : ne pas dire qu'un courriel est parti quand il n'est pas
// parti.** La modale de succes annoncait « identifiants envoyes par email »
// des qu'une adresse etait saisie, meme quand aucun expediteur n'etait
// configure. L'administrateur fermait la modale en croyant le responsable
// servi, et le mot de passe temporaire etait perdu : personne ne pouvait plus
// entrer dans le compte. Le serveur dit desormais s'il est **parti**.
//
// **La seconde : une seule porte pour creer une assurance.** La route des
// structures n'en creait que la structure, et qui s'arretait la laissait un
// responsable devant « Cette structure n'est rattachee a aucune compagnie
// d'assurance ». Elle refuse desormais ce type et renvoie vers la bonne.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

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
// Le dossier a ses propres tests : ici on ne juge que ce que dit la reponse.
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

import { creerPharmacieAvecPharmacien, creerStructureAvecAdmin } from '../src/services/admin-structure.service';
import * as courriels from '../src/services/email.service';
import { createStructureSchema, updateStructureSchema } from '../src/validators/api.schemas';
import type { JwtPayload } from '../src/types/auth.types';

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { structureSante: { create: M }; utilisateur: { create: M; findUnique: M }; pharmacienProfile: { create: M } };
};
const mails = courriels as unknown as { envoyerEmailAdminStructure: M; envoyerEmailAgent: M };

const SUPER_ADMIN = { userId: 'admin-1', role: 'SUPER_ADMIN' } as JwtPayload;

function structure(email?: string) {
  return {
    nom: 'Centre de Ratoma', type: 'CENTRE', prefecture: 'Conakry', commune: 'Ratoma',
    admin: { prenom: 'Awa', nom: 'Bah', telephone: '622000001', ...(email ? { email } : {}) },
  } as never;
}

function pharmacie(email?: string) {
  return {
    nom: 'Pharmacie de Kipé', prefecture: 'Conakry', commune: 'Ratoma',
    pharmacien: { prenom: 'Awa', nom: 'Bah', telephone: '622000002', ...(email ? { email } : {}) },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.utilisateur.findUnique.mockResolvedValue(null);
  prisma.structureSante.create.mockResolvedValue({ id: 'structure-1', nom: 'Centre de Ratoma' });
  prisma.utilisateur.create.mockResolvedValue({
    id: 'compte-1', telephone: '622000001', email: 'awa@example.gn', prenom: 'Awa', nom: 'Bah', role: 'ADMIN_STRUCTURE',
  });
  prisma.pharmacienProfile.create.mockResolvedValue({});
  mails.envoyerEmailAdminStructure.mockResolvedValue(undefined);
  mails.envoyerEmailAgent.mockResolvedValue(undefined);
});

describe('dire si le courriel des identifiants est parti', () => {
  it('le dit quand il est parti', async () => {
    const r = await creerStructureAvecAdmin(structure('awa@example.gn'), []);
    expect(r.emailEnvoye).toBe(true);
  });

  it('ne le dit pas quand l envoi echoue, et garde le mot de passe pour l afficher', async () => {
    mails.envoyerEmailAdminStructure.mockRejectedValue(new Error('aucun expediteur configure'));

    const r = await creerStructureAvecAdmin(structure('awa@example.gn'), []);

    expect(r.emailEnvoye).toBe(false);
    expect(r.motDePasseTemporaire).toBeTruthy();
  });

  it('ne le dit pas quand aucune adresse n a ete saisie', async () => {
    const r = await creerStructureAvecAdmin(structure(), []);
    expect(mails.envoyerEmailAdminStructure).not.toHaveBeenCalled();
    expect(r.emailEnvoye).toBe(false);
  });

  it('vaut aussi pour le titulaire d une officine', async () => {
    mails.envoyerEmailAgent.mockRejectedValue(new Error('aucun expediteur configure'));

    const echec = await creerPharmacieAvecPharmacien(SUPER_ADMIN, pharmacie('titulaire@example.gn'), []);
    expect(echec.emailEnvoye).toBe(false);

    mails.envoyerEmailAgent.mockResolvedValue(undefined);
    const reussi = await creerPharmacieAvecPharmacien(SUPER_ADMIN, pharmacie('titulaire@example.gn'), []);
    expect(reussi.emailEnvoye).toBe(true);
  });
});

describe('une seule porte pour creer une assurance', () => {
  const base = {
    nom: 'Sunu Assurances', prefecture: 'Conakry', commune: 'Kaloum',
    admin: { prenom: 'Awa', nom: 'Bah', telephone: '+224620000001' },
  };

  it('refuse ASSURANCE a la creation d une structure, en nommant la bonne porte', () => {
    const r = createStructureSchema.safeParse({ ...base, type: 'ASSURANCE' });

    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'type');
    expect(issue?.message).toMatch(/onglet Assurances/);
  });

  it('accepte toujours les autres types', () => {
    expect(createStructureSchema.safeParse({ ...base, type: 'CLINIQUE' }).success).toBe(true);
  });

  // Les assurances existantes restent modifiables : seule leur creation a
  // quitte cette route.
  it('laisse modifier une assurance existante', () => {
    expect(updateStructureSchema.safeParse({ type: 'ASSURANCE', nom: 'Sunu Assurances SA' }).success).toBe(true);
  });
});
