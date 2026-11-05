import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import path from 'path';
import { env } from './config/env';

import authRoutes from './routes/auth.routes';
import patientRoutes from './routes/patient.routes';
import consultationRoutes from './routes/consultation.routes';
import ordonnanceRoutes from './routes/ordonnance.routes';
import commandeRoutes from './routes/commande.routes';
import courseRoutes from './routes/course.routes';
import medicamentRoutes from './routes/medicament.routes';
import ascRoutes from './routes/asc.routes';
import medecinRoutes from './routes/medecin.routes';
import paiementRoutes from './routes/paiement.routes';
import webhookChapChapRoutes from './routes/webhook-chapchap.routes';
import vaccinationRoutes from './routes/vaccination.routes';
import notificationRoutes from './routes/notification.routes';
import analyticsRoutes from './routes/analytics.routes';
import adminStructureRoutes from './routes/admin-structure.routes';
import pharmacienRoutes from './routes/pharmacien.routes';
import syncRoutes from './routes/sync.routes';
import fhirRoutes from './routes/fhir.routes';
import triageRoutes from './routes/triage.routes';
import privacyRoutes from './routes/privacy.routes';
import consentementRoutes from './routes/consentement.routes';
import brisDeGlaceRoutes from './routes/bris-de-glace.routes';
import ussdRoutes from './routes/ussd.routes';
import statsRoutes from './routes/stats.routes';
import uploadRoutes from './routes/upload.routes';
import parametresRoutes from './routes/parametres.routes';
import hopitalRoutes from './routes/hopital.routes';
import laboratoireRoutes from './routes/laboratoire.routes';
import resultatsRoutes from './routes/resultats.routes';
import assuranceRoutes from './routes/assurance.routes';
import referentielRoutes from './routes/referentiel.routes';
import journalRoutes from './routes/journal.routes';
import compteRoutes from './routes/compte.routes';
import rgpdRoutes from './routes/rgpd.routes';
import identiteRoutes from './routes/identite.routes';
import { setupSwagger } from './config/swagger';
import { getIdentitePlateforme } from './services/parametres.service';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { initSentry, captureError } from './config/sentry';
import { initRedis, getRedis } from './config/redis';
import { auditRequest } from './services/audit.service';
import { startBackgroundJobs } from './services/job.service';
import { globalErrorHandler } from './middlewares/error.middleware';
import { requestContextMiddleware } from './middlewares/request-context.middleware';
import { createServer } from 'http';
import { initSocketServer } from './realtime/socket.server';

initSentry(env.SENTRY_DSN);

process.on('uncaughtException', (err) => {
  captureError(err, { type: 'uncaughtException' });
  logger.error('uncaughtException — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  captureError(reason, { type: 'unhandledRejection' });
  logger.error('unhandledRejection — shutting down', { reason });
  process.exit(1);
});

const app = express();

// Shared Redis client (rate limiting + cache)
if (env.REDIS_URL) {
  initRedis(env.REDIS_URL);
}
const redisClient = getRedis();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && {
    store: new RedisStore({
      prefix: 'rl:api:',
      sendCommand: async (...args: string[]) => redisClient!.call(args[0], ...args.slice(1)) as any,
    }),
  }),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && {
    store: new RedisStore({
      prefix: 'rl:auth:',
      sendCommand: async (...args: string[]) => redisClient!.call(args[0], ...args.slice(1)) as any,
    }),
  }),
});

app.use(helmet());

const corsOptions = {
  origin: env.ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  // Le front tourne sur une autre origine que l'API : sans cette ligne, un
  // `fetch` ne voit **aucun** en-tete hors de la liste sure du navigateur, et
  // un telechargement lance en XHR perd le nom du fichier propose par le
  // serveur (export du journal d'audit, comptes rendus). Constate le
  // 2026-10-03 : `Content-Disposition` arrivait a `null` cote navigateur
  // alors que le serveur l'envoyait correctement.
  exposedHeaders: ['Content-Disposition'],
};
app.use(cors(corsOptions));
app.use(requestContextMiddleware);
app.use(cookieParser());

// Les rappels de la passerelle de paiement, **avant l'analyseur JSON global**.
// Leur signature porte sur les octets exacts du corps : laisser `express.json()`
// le remplacer par un objet rendrait la verification impossible, puisque
// re-serialiser produit d'autres octets. Cette route lit le corps brut
// elle-meme.
app.use('/api/v1/webhooks', webhookChapChapRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Fichiers uploadés (photos de profil) — servis sur une origine différente du
// front (localhost:4200 vs localhost:3000), donc CORP explicite requis sinon
// helmet() bloque le chargement de l'image côté navigateur.
app.use('/uploads', (_req: Request, res: Response, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(process.cwd(), 'uploads')));

app.use('/api/v1', apiLimiter);

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'error';
  }

  if (redisClient) {
    try {
      await redisClient.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }
  }

  const allOk = Object.values(checks).every((s) => s === 'ok');
  // Le nom vient des parametres ; si la base est injoignable on ne bloque
  // pas la reponse de sante pour autant.
  const nom = allOk ? await getIdentitePlateforme().then((i) => i.nom).catch(() => 'API') : 'API';
  res.status(allOk ? 200 : 503).json({
    success: allOk,
    message: allOk ? `${nom} API operationnelle` : 'Degraded',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    checks,
  });
});

setupSwagger(app);

app.use('/api/v1', auditRequest);

// Le quota anti-force brute ne vise que les routes qui verifient un secret.
// Applique a tout /auth, il etait consomme par /refresh et /me — appelees a
// chaque chargement de page — et bloquait la connexion apres une dizaine de
// navigations. Les routes de session restent couvertes par apiLimiter.
const ROUTES_SENSIBLES = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/verify-otp',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/change-password',
  '/api/v1/pharmacien/ventes/:id/annuler',
];
for (const route of ROUTES_SENSIBLES) {
  app.use(route, authLimiter);
}

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/patients', patientRoutes);
app.use('/api/v1/consultations', consultationRoutes);
app.use('/api/v1/ordonnances', ordonnanceRoutes);
app.use('/api/v1/commandes', commandeRoutes);
app.use('/api/v1/courses', courseRoutes);
app.use('/api/v1/medicaments', medicamentRoutes);
app.use('/api/v1/asc', ascRoutes);
app.use('/api/v1/medecin', medecinRoutes);
app.use('/api/v1/paiements', paiementRoutes);
app.use('/api/v1/vaccinations', vaccinationRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/admin-structure', adminStructureRoutes);
app.use('/api/v1/pharmacien', pharmacienRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/fhir', fhirRoutes);
app.use('/api/v1/triage', triageRoutes);
app.use('/api/v1/privacy', privacyRoutes);
app.use('/api/v1/textes-consentement', consentementRoutes);
app.use('/api/v1/bris-de-glace', brisDeGlaceRoutes);
app.use('/api/v1/ussd', ussdRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/uploads', uploadRoutes);
app.use('/api/v1/parametres', parametresRoutes);
app.use('/api/v1/hopital', hopitalRoutes);
app.use('/api/v1/laboratoire', laboratoireRoutes);
app.use('/api/v1/resultats', resultatsRoutes);
app.use('/api/v1/assurance', assuranceRoutes);
app.use('/api/v1/referentiels', referentielRoutes);
app.use('/api/v1/journal', journalRoutes);
app.use('/api/v1/comptes', compteRoutes);
app.use('/api/v1/demandes-rgpd', rgpdRoutes);
app.use('/api/v1/identites', identiteRoutes);

// Route 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Route non trouvee' });
});

// Middleware global de gestion des erreurs
app.use(globalErrorHandler);

const httpServer = createServer(app);
initSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`Documentation API : http://localhost:${env.PORT}/api/docs`);
  logger.info(`API : http://localhost:${env.PORT}`);
  logger.info(`Environnement   : ${env.NODE_ENV}`);
  logger.info(`CORS origins    : ${env.ALLOWED_ORIGINS.join(', ')}`);
  logger.info(`WebSocket       : ws://localhost:${env.PORT}`);
  startBackgroundJobs();
});

export default app;
