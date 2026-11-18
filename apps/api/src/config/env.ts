import 'dotenv/config';
import { z } from 'zod';

/**
 * Validation des variables d'environnement au démarrage.
 *
 * L'application plante immédiatement (fail fast) si une variable
 * requise est manquante ou invalide, au lieu de crasher plus tard
 * de façon silencieuse.
 */

/**
 * Traite une variable presente mais vide comme absente.
 *
 * Un fichier `.env` recopie depuis `.env.example` laisse des lignes
 * `CLE=` : la variable existe alors, et vaut la chaine vide. Un schema
 * `.optional()` ne la voit pas comme absente et la valide quand meme —
 * `.email()` refuse la chaine vide, `coerce.number()` la lit comme zero.
 * L'API refusait de demarrer a cause d'une ligne que personne n'avait
 * remplie, ce qui est exactement le contraire d'« optionnel ».
 */
function videCommeAbsent<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);
}

export const envSchema = z.object({
  // ─── Base de données ─────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),

  // ─── JWT ─────────────────────────────────────────────
  JWT_SECRET: z.string().min(16, 'JWT_SECRET doit contenir au moins 16 caracteres'),
  // Distinct de JWT_SECRET : signe avec le meme secret, un jeton de
  // rafraichissement passait pour un jeton d'acces.
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET doit contenir au moins 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // ─── Chiffrement des champs sensibles (AES-256-GCM) ──
  DB_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'DB_ENCRYPTION_KEY doit etre une chaine hexadecimale de 64 caracteres (32 octets)'),

  // ─── Serveur ─────────────────────────────────────────
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0 && val < 65536, 'PORT doit etre entre 1 et 65535'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ALLOWED_ORIGINS: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() ? val : 'http://localhost:4200')
      .split(',')
      .map((s) => s.trim()),
    z.array(z.string().min(1))
  ),

  // ─── Courriel (optionnel en dev) ─────────────────────
  // `services/courriel.service.ts` prend le premier transport configure :
  // Brevo, puis un relais SMTP quelconque, puis Gmail. L'API de Brevo sort
  // sur le port 443, que les hebergeurs laissent ouvert, contrairement aux
  // ports SMTP qu'ils ferment souvent contre le pourriel.
  BREVO_API_KEY: z.string().optional(),
  // Adresse d'expedition par defaut. Brevo refuse d'expedier depuis une
  // adresse qu'on n'a pas validee chez lui. Les reglages de la plateforme
  // passent devant, pour en changer sans redeployer.
  //
  // `videCommeAbsent` sur les deux lignes qui valident : une variable
  // presente mais laissee vide — le cas d'un .env recopie — arrive comme
  // une chaine vide, pas comme `undefined`. Sans cela, `.email()` echouerait
  // et `coerce.number()` lirait 0, et l'API refuserait de demarrer a cause
  // d'une ligne que personne n'a remplie.
  EMAIL_EXPEDITEUR: videCommeAbsent(z.string().email().optional()),
  // Ou arrivent les reponses. Le domaine qui expedie n'a pas forcement de
  // boite aux lettres : sans cette adresse, un patient qui repond a son code
  // ecrit dans le vide, et personne ne l'apprend.
  EMAIL_REPONSE: videCommeAbsent(z.string().email().optional()),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: videCommeAbsent(z.coerce.number().int().positive().optional()),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),

  // ─── Limites de requetes (par fenetre de 15 minutes) ─
  // Valeurs de production par defaut. Les relever est un choix
  // d'exploitation : l'environnement E2E le fait, car un parcours de test
  // complet depasse 300 requetes en un quart d'heure.
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),

  // ─── Redis (optionnel) ──────────────────────────────
  REDIS_URL: videCommeAbsent(z.string().url().optional()),

  // ─── Jobs ───────────────────────────────────────────
  ENABLE_JOBS: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),
  VERBOSE_JOBS: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  // ─── Frontend URL (pour les liens dans les emails) ──
  FRONTEND_URL: z.string().default('http://localhost:4200'),

  // ─── Sentry (optionnel) ─────────────────────────────
  // `.env.example` promet « Vide = desactivee » depuis toujours ; le schema
  // refusait la ligne vide, et l'API ne demarrait pas.
  SENTRY_DSN: videCommeAbsent(z.string().url().optional()),

  // ─── OTP dev fallback ───────────────────────────────
  // Lu comme le lit `utils/otp-developpement.ts`, qui decide : **seul
  // « true » l'active**. Le schema disait l'inverse (« actif sauf false »), et
  // `.env.example` le repetait : une ligne absente coupait l'OTP en clair
  // alors que la documentation promettait le contraire.
  EMAIL_OTP_DEV_FALLBACK: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
}).refine((e) => e.JWT_REFRESH_SECRET !== e.JWT_SECRET, {
  path: ['JWT_REFRESH_SECRET'],
  message: 'JWT_REFRESH_SECRET doit etre different de JWT_SECRET',
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Variables d\'environnement invalides :');
    for (const issue of result.error.issues) {
      console.error(`   → ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
