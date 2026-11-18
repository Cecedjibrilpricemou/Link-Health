// R4 : la carte epidemiologique placait chaque prefecture au domicile exact
// du premier patient trouve. Une position donnee pour le seul motard
// finissait sous les yeux des analystes. Elle compte par zone ; elle ne
// localise personne.
jest.mock('../src/config/prisma', () => ({
  prisma: { consultation: { findMany: jest.fn() } },
}));

import { getHeatmapData } from '../src/services/analytics.service';

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { consultation: { findMany: jest.Mock } };
};

describe('carte epidemiologique et position des patients', () => {
  beforeEach(() => {
    prisma.consultation.findMany.mockResolvedValue([
      { patient: { prefecture: 'Conakry', sousPrefecture: null, position: '9.64,-13.58' }, diagnostics: [{ libelle: 'Paludisme' }] },
      { patient: { prefecture: 'Conakry', sousPrefecture: null }, diagnostics: [{ libelle: 'Paludisme' }] },
    ]);
  });

  it('ne demande jamais la position du patient a la base', async () => {
    await getHeatmapData({});
    const patient = prisma.consultation.findMany.mock.calls[0][0].include.patient.select;
    expect(Object.keys(patient).sort()).toEqual(['prefecture', 'sousPrefecture']);
  });

  it('compte par prefecture, sans coordonnees', async () => {
    const points = await getHeatmapData({});
    expect(points).toEqual([{ prefecture: 'Conakry', count: 2, pathologies: { Paludisme: 2 } }]);
    expect(JSON.stringify(points)).not.toMatch(/9\.64|latitude|longitude|position/);
  });
});
