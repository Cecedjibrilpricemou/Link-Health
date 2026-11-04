// Tableau de bord analytique : ce que chaque indicateur compte vraiment.
//
// Deux defauts relevés a la revue :
// - le filtre « prefecture » ne s'appliquait qu'aux patients et aux
//   consultations : en choisissant Kindia, les vaccinations, les
//   referencements, les ASC et les pathologies restaient nationaux, a cote
//   d'un nombre de patients de Kindia ;
// - la jauge « vaccination » divisait un nombre de **doses** par un nombre de
//   patients. Il faut le nombre de patients vaccines au moins une fois.

jest.mock('../src/config/prisma', () => ({
  prisma: {
    patientProfile: { count: jest.fn() },
    consultation: { count: jest.fn(), groupBy: jest.fn() },
    vaccination: { count: jest.fn(), groupBy: jest.fn() },
    referencement: { count: jest.fn() },
    diagnostic: { groupBy: jest.fn() },
    ascProfile: { count: jest.fn() },
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    patientProfile: { count: M };
    consultation: { count: M; groupBy: M };
    vaccination: { count: M; groupBy: M };
    referencement: { count: M };
    diagnostic: { groupBy: M };
    ascProfile: { count: M };
  };
};

import { getDashboardGlobal } from '../src/services/analytics.service';

beforeEach(() => {
  jest.resetAllMocks();
  prisma.patientProfile.count.mockResolvedValue(10);
  prisma.consultation.count.mockResolvedValue(30);
  prisma.consultation.groupBy.mockResolvedValue([{ statut: 'TERMINEE', _count: { statut: 30 } }]);
  prisma.vaccination.count.mockResolvedValue(25);
  // 25 doses, mais seulement 4 patients differents.
  prisma.vaccination.groupBy.mockResolvedValue([{ idPatient: 'a' }, { idPatient: 'b' }, { idPatient: 'c' }, { idPatient: 'd' }]);
  prisma.referencement.count.mockResolvedValue(3);
  prisma.diagnostic.groupBy.mockResolvedValue([]);
  prisma.ascProfile.count.mockResolvedValue(2);
});

const where = (m: M) => m.mock.calls[0]?.[0]?.where;

describe('analytics : indicateurs du tableau de bord', () => {
  it('compte les patients vaccinés au moins une fois, pas les doses', async () => {
    const r = await getDashboardGlobal({ prefecture: 'Nulle-part-1' });
    expect(r.kpis.totalVaccinations).toBe(25);
    expect(r.kpis.patientsVaccines).toBe(4);
    expect(prisma.vaccination.groupBy.mock.calls[0][0].by).toEqual(['idPatient']);
  });

  it('applique la préfecture à tous les indicateurs', async () => {
    await getDashboardGlobal({ prefecture: 'Kindia' });
    expect(where(prisma.patientProfile.count)).toEqual({ prefecture: 'Kindia' });
    expect(where(prisma.consultation.count)).toMatchObject({ patient: { prefecture: 'Kindia' } });
    expect(where(prisma.vaccination.count)).toMatchObject({ patient: { prefecture: 'Kindia' } });
    expect(where(prisma.vaccination.groupBy)).toMatchObject({ patient: { prefecture: 'Kindia' } });
    expect(where(prisma.referencement.count)).toMatchObject({ consultation: { patient: { prefecture: 'Kindia' } } });
    expect(where(prisma.diagnostic.groupBy)).toMatchObject({ consultation: { patient: { prefecture: 'Kindia' } } });
    expect(where(prisma.ascProfile.count)).toMatchObject({ structure: { prefecture: 'Kindia' } });
  });

  it('reste national sans préfecture', async () => {
    await getDashboardGlobal({ debut: '2026-01-01', fin: '2026-12-31' });
    expect(where(prisma.vaccination.count)).not.toHaveProperty('patient');
    expect(where(prisma.vaccination.count)).toHaveProperty('administreLe');
    expect(where(prisma.referencement.count)).not.toHaveProperty('consultation');
    expect(where(prisma.ascProfile.count) ?? {}).not.toHaveProperty('structure');
  });
});
