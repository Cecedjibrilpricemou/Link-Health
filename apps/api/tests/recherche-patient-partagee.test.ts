// Le comptoir cherche le patient avec le predicat partage.
//
// L'administration cherchait aussi un patient pour lui rattacher une police ;
// depuis le 2026-11-21, c'est la compagnie qui renseigne ses assures, depuis
// son espace : ce chemin-la n'existe plus.
//
// Les tests existants simulent `findMany` : ils ne regardent jamais le filtre
// produit. C'est exactement ce que ce fichier regarde.
import { filtreRecherchePatient, rechercherPatients } from '../src/services/hopital.service';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { findUnique: jest.fn() },
    patientProfile: { findMany: jest.fn() },
  };
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { utilisateur: { findUnique: M }; patientProfile: { findMany: M } };
};

const UN_PATIENT = [{
  id: 'pat-1', sexe: 'F', dateNaissance: new Date('1974-01-01'), prefecture: 'Kindia',
  utilisateur: { prenom: 'Awa', nom: 'Diallo', telephone: '620123456' },
  episodes: [],
}];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.patientProfile.findMany.mockResolvedValue(UN_PATIENT);
  // L'agent du comptoir appartient a une structure ; l'administration non.
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'str-1', medecinProfile: null });
});

describe('filtreRecherchePatient', () => {
  it('cherche le QR tel quel : il est scanne, pas tape', () => {
    const f = filtreRecherchePatient('QR-ABC-123');
    expect(f.OR?.[0]).toEqual({ qrCode: 'QR-ABC-123' });
  });

  // « 620 123 456 » lu sur une carte ne doit pas rater « 620123456 » en base.
  it('retire les espaces du numero', () => {
    const f = filtreRecherchePatient('620 123 456');
    expect(JSON.stringify(f)).toContain('620123456');
  });

  // Chaque mot doit porter : « Diallo Ma » trouve Mamadou Diallo, et non tous
  // les Diallo du pays.
  it('exige que chaque mot apparaisse dans le nom ou le prenom', () => {
    const et = (filtreRecherchePatient('Diallo Ma').OR?.[2] as { AND: unknown[] }).AND;
    expect(et).toHaveLength(2);
    expect(JSON.stringify(et)).toContain('Diallo');
    expect(JSON.stringify(et)).toContain('"Ma"');
  });

  it('ignore la casse : personne ne tape les majuscules au comptoir', () => {
    expect(JSON.stringify(filtreRecherchePatient('diallo'))).toContain('insensitive');
  });
});

describe('le comptoir cherche avec le predicat partage', () => {
  it('le comptoir passe le predicat partage', async () => {
    await rechercherPatients({ userId: 'u-1', role: 'AGENT_ACCUEIL' } as never, 'Diallo');
    expect(prisma.patientProfile.findMany.mock.calls[0]![0].where)
      .toEqual(filtreRecherchePatient('Diallo'));
  });

});
