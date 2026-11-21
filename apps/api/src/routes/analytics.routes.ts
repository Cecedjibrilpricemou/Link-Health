import { Router } from 'express';
import {
    getDashboardGlobalController,
    getHeatmapController,
    getAlertesEpidemiquesController,
    getCouvertureVaccinaleController,
    getTendancesController,
    exporterDonneesController,
} from '../controllers/analytics.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

// ─── Tous les endpoints nécessitent authentification ─────
router.use(authenticate);

// ─── Dashboard global ─────────────────────────────────────
router.get(
    '/dashboard',
    requireRole(
        'MEDECIN', 'SAGE_FEMME', 'ASC_SUPERVISOR', 'ADMIN_STRUCTURE',
        'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'
    ),
    getDashboardGlobalController
);

// ─── Heatmap cartographique ───────────────────────────────
router.get(
    '/heatmap',
    requireRole(
        'MEDECIN', 'SAGE_FEMME', 'ASC_SUPERVISOR', 'ADMIN_STRUCTURE',
        'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'
    ),
    getHeatmapController
);

// ─── Alertes épidémiques ──────────────────────────────────
router.get(
    '/alertes',
    requireRole(
        'MEDECIN', 'SAGE_FEMME', 'ASC_SUPERVISOR', 'ADMIN_STRUCTURE',
        'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'
    ),
    getAlertesEpidemiquesController
);

// ─── Couverture vaccinale ─────────────────────────────────
router.get(
    '/vaccinations/couverture',
    requireRole(
        'MEDECIN', 'SAGE_FEMME', 'ASC_SUPERVISOR', 'ADMIN_STRUCTURE',
        'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'
    ),
    getCouvertureVaccinaleController
);

// ─── Tendances temporelles ────────────────────────────────
router.get(
    '/tendances',
    requireRole(
        'MEDECIN', 'SAGE_FEMME', 'ASC_SUPERVISOR', 'ADMIN_STRUCTURE',
        'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'
    ),
    getTendancesController
);

// ─── Export DHIS2 / CSV ───────────────────────────────────
router.get(
    '/export',
    requireRole(
        'ADMIN_STRUCTURE', 'ADMIN_REGIONAL',
        'ADMIN_NATIONAL', 'SUPER_ADMIN'
    ),
    exporterDonneesController
);

export default router;