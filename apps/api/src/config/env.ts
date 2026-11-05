import 'dotenv/config';
import { z } from 'zod';

/**
 * Validation des variables d'environnement au démarrage.
 *
 * L'application plante immédiatement (fail fast) si une variable
 * requise est manquante ou invalide, au lieu de crasher plus tard
 * de façon silencieuse.
 */
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

  // ─── Email (optionnel en dev) ────────────────────────
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),

  // ─── Limites de requetes (par fenetre de 15 minutes) ─
  // Valeurs de production par defaut. Les relever est un choix
  // d'exploitation : l'environnement E2E le fait, car un parcours de test
  // complet depasse 300 requetes en un quart d'heure.
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),

  // ─── Redis (optionnel) ──────────────────────────────
  REDIS_URL: z.string().url().optional(),

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
  SENTRY_DSN: z.string().url().optional(),

  // ─── OTP dev fallback ───────────────────────────────
  EMAIL_OTP_DEV_FALLBACK: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),
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
