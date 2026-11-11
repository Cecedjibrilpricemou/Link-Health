jest.mock('../src/services/analytics.service', () => ({
  detecterEtPersisterAlertesEpidemiques: jest.fn().mockResolvedValue({ total: 0 }),
}));
jest.mock('../src/services/notification.service', () => ({
  verifierRappelsAEnvoyer: jest.fn().mockResolvedValue({ rendezVousARappeler: 0, vaccinationsARappeler: 0 }),
}));
jest.mock('../src/services/ussd.service', () => ({
  expirerSessionsUssd: jest.fn().mockResolvedValue({ count: 0 }),
}));
jest.mock('../src/services/laboratoire.service', () => ({
  traiterAlertesCritiques: jest.fn().mockResolvedValue({ escaladees: 0, relancees: 0, escaladesLiberation: 0 }),
}));
jest.mock('../src/services/commande.service', () => ({
  elargirCommandesEnAttente: jest.fn().mockResolvedValue({ elargies: 0 }),
}));
jest.mock('../src/services/course.service', () => ({
  elargirCoursesEnAttente: jest.fn().mockResolvedValue({ elargies: 0 }),
}));
jest.mock('../src/services/parametres.service', () => ({
  getValeursParametres: jest.fn().mockResolvedValue({
    zones: { delaiElargissementCommandeMinutes: 7, delaiElargissementCourseMinutes: 13 },
  }),
}));
jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { startBackgroundJobs } from '../src/services/job.service';
import { elargirCommandesEnAttente } from '../src/services/commande.service';
import { elargirCoursesEnAttente } from '../src/services/course.service';

describe('startBackgroundJobs', () => {
  it('unrefs all recurring timers so they do not keep Jest alive', async () => {
    const timers = Array.from({ length: 5 }, () => ({
      unref: jest.fn(),
    } as unknown as NodeJS.Timeout));
    let nextTimer = 0;
    const setIntervalSpy = jest.spyOn(global, 'setInterval')
      .mockImplementation(() => timers[nextTimer++]!);

    const previousEnableJobs = process.env.ENABLE_JOBS;
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.ENABLE_JOBS = 'true';
    delete process.env.REDIS_URL;

    try {
      startBackgroundJobs();

      expect(setIntervalSpy).toHaveBeenCalledTimes(5);
      for (const timer of timers) expect(timer.unref).toHaveBeenCalledTimes(1);

      // M5 : l'elargissement tourne des le demarrage, avec les delais
      // administres - pas une constante du code.
      await new Promise((r) => setImmediate(r));
      expect(elargirCommandesEnAttente).toHaveBeenCalledWith(7);
      expect(elargirCoursesEnAttente).toHaveBeenCalledWith(13);
    } finally {
      if (previousEnableJobs === undefined) delete process.env.ENABLE_JOBS;
      else process.env.ENABLE_JOBS = previousEnableJobs;
      if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousRedisUrl;
      setIntervalSpy.mockRestore();
    }
  });
});
