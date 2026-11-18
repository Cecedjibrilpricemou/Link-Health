import Redis from 'ioredis';
import { detecterEtPersisterAlertesEpidemiques } from './analytics.service';
import { verifierRappelsAEnvoyer } from './notification.service';
import { expirerSessionsUssd } from './ussd.service';
import { traiterAlertesCritiques } from './laboratoire.service';
import { conclureCommandesExpirees, elargirCommandesEnAttente } from './commande.service';
import { conclureCoursesExpirees, elargirCoursesEnAttente } from './course.service';
import { getValeursParametres } from './parametres.service';
import { logger } from '../config/logger';

let started = false;
let redis: Redis | undefined;

function isVerboseJobsEnabled(): boolean {
  return process.env.VERBOSE_JOBS === 'true';
}

async function withOptionalRedisLock<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (!redis) return fn();

  const lockKey = `baobaohealth:job-lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 60, 'NX');
  if (!acquired) return undefined;

  try {
    return await fn();
  } finally {
    await redis.del(lockKey);
  }
}

export function startBackgroundJobs() {
  if (started || process.env.ENABLE_JOBS === 'false') return;
  started = true;

  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    redis.connect().catch((error: unknown) => {
      logger.warn('Redis indisponible, jobs en mode local', { error });
      redis = undefined;
    });
  }

  const runRappels = () => {
    void withOptionalRedisLock('rappels', async () => {
      const result = await verifierRappelsAEnvoyer();
      const hasWork = result.rendezVousARappeler > 0 || result.vaccinationsARappeler > 0;
      if (hasWork || isVerboseJobsEnabled()) {
        logger.info('[JOB] rappels verifies', result);
      }
    }).catch((error: unknown) => logger.error('[JOB] rappels failed', { error }));
  };

  const runAlertes = () => {
    void withOptionalRedisLock('alertes-epidemiques', async () => {
      const result = await detecterEtPersisterAlertesEpidemiques();
      if (result.total > 0 || isVerboseJobsEnabled()) {
        logger.info('[JOB] alertes epidemiques', { total: result.total });
      }
    }).catch((error: unknown) => logger.error('[JOB] alertes failed', { error }));
  };

  const runUssdCleanup = () => {
    void withOptionalRedisLock('ussd-cleanup', async () => {
      const result = await expirerSessionsUssd();
      if (result.count > 0 || isVerboseJobsEnabled()) {
        logger.info('[JOB] sessions ussd expirees', { count: result.count });
      }
    }).catch((error: unknown) => logger.error('[JOB] ussd cleanup failed', { error }));
  };

  // Resultats : escalade des alertes critiques sans accuse (EF-04-08), et
  // relance des medecins qui n'ont pas libere leurs resultats au patient
  // (addendum du 2026-09-28). Ce job ne rend jamais un resultat visible.
  const runCritiques = () => {
    void withOptionalRedisLock('resultats-critiques', async () => {
      const result = await traiterAlertesCritiques();
      if (result.escaladees > 0 || result.relancees > 0 || result.escaladesLiberation > 0 || isVerboseJobsEnabled()) {
        logger.info('[JOB] resultats critiques', result);
      }
    }).catch((error: unknown) => logger.error('[JOB] resultats critiques failed', { error }));
  };

  // M5 : les appels restes sans preneur dans leur commune s'ouvrent a toute
  // la prefecture, au-dela du delai administrable (Parametres > Zones).
  const runElargissement = () => {
    void withOptionalRedisLock('elargissement', async () => {
      const { zones } = await getValeursParametres();
      const commandes = await elargirCommandesEnAttente(zones.delaiElargissementCommandeMinutes);
      const courses = await elargirCoursesEnAttente(zones.delaiElargissementCourseMinutes);
      if (commandes.elargies > 0 || courses.elargies > 0 || isVerboseJobsEnabled()) {
        logger.info('[JOB] appels elargis a la prefecture', { commandes: commandes.elargies, courses: courses.elargies });
      }
      // R1 : au-dela du delai final, l'appel s'arrete au lieu d'attendre sans fin.
      const commandesConclues = await conclureCommandesExpirees(zones.delaiFinalCommandeMinutes);
      const coursesConclues = await conclureCoursesExpirees(zones.delaiFinalCourseMinutes);
      if (commandesConclues.conclues > 0 || coursesConclues.conclues > 0 || isVerboseJobsEnabled()) {
        logger.info('[JOB] appels arretes au delai final', {
          commandes: commandesConclues.conclues, courses: coursesConclues.conclues,
        });
      }
    }).catch((error: unknown) => logger.error('[JOB] elargissement failed', { error }));
  };

  runRappels();
  runAlertes();
  runUssdCleanup();
  runCritiques();
  runElargissement();
  setInterval(runElargissement, 2 * 60 * 1000).unref();
  setInterval(runCritiques, 5 * 60 * 1000).unref();
  setInterval(runRappels, 60 * 60 * 1000).unref();
  setInterval(runAlertes, 6 * 60 * 60 * 1000).unref();
  setInterval(runUssdCleanup, 10 * 60 * 1000).unref();
}
