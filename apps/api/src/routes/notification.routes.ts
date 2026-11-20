import { Router } from 'express';
import {
    envoyerSmsController,
    envoyerRappelRendezVousController,
    envoyerAlerteStockController,
    envoyerNotificationReferencementController,
    envoyerRappelVaccinationController,
    envoyerSmsMasseController,
    verifierRappelsController,
    getMesNotificationsController,
    compterNonLuesController,
    marquerLueController,
    toutMarquerLuController,
} from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import { notificationsQuerySchema, sendSmsSchema, sendSmsMasseSchema } from '../validators/api.schemas';

const router = Router();

// ─── Tous les endpoints nécessitent authentification ─────
router.use(authenticate);

// ─── Notifications in-app — tout utilisateur connecté ─────
// Consommees par la cloche des layouts web (NotificationService cote Angular).
router.get('/me', validateQuery(notificationsQuerySchema), getMesNotificationsController);
router.get('/me/non-lues', compterNonLuesController);
router.put('/tout-lire', toutMarquerLuController);
router.put('/:id/lire', marquerLueController);

// ─── SMS personnalisé — Admin uniquement ──────────────────
router.post(
    '/sms',
    requireRole('ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'),
    validateBody(sendSmsSchema),
    envoyerSmsController
);

// ─── SMS en masse par préfecture — Admin ──────────────────
router.post(
    '/sms/masse',
    requireRole('ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'),
    validateBody(sendSmsMasseSchema),
    envoyerSmsMasseController
);

// ─── Rappel rendez-vous — ASC ─────────────────────────────
router.post(
    '/rappel/rendez-vous/:id',
    requireRole('ASC', 'ASC_SUPERVISOR'),
    envoyerRappelRendezVousController
);

// ─── Rappel vaccination — ASC / Médecin ───────────────────
router.post(
    '/rappel/vaccination/:id',
    requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN'),
    envoyerRappelVaccinationController
);

// ─── Alerte stock — ASC ───────────────────────────────────
router.post(
    '/alerte/stock/:id',
    requireRole('ASC', 'ASC_SUPERVISOR'),
    envoyerAlerteStockController
);

// ─── Notification référencement — Médecin ─────────────────
router.post(
    '/referencement/:id',
    requireRole('MEDECIN'),
    envoyerNotificationReferencementController
);

// ─── Vérifier rappels à envoyer — Admin ───────────────────
router.get(
    '/rappels/verifier',
    requireRole('ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'),
    verifierRappelsController
);

export default router;