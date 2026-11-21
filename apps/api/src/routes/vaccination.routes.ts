import { Router } from 'express';
import {
  administrerVaccinController,
  getCarnetVaccinalController,
  getMonCarnetVaccinalController,
  updateVaccinationController,
  getRappelsVaccinationController,
  getStatsVaccinationController,
} from '../controllers/vaccination.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { createVaccinationSchema, updateVaccinationSchema } from '../validators/api.schemas';

const router = Router();

// ─── Tous les endpoints nécessitent authentification ─────
router.use(authenticate);

// ─── Routes Patient ───────────────────────────────────────
router.get(
  '/me',
  requireRole('PATIENT'),
  getMonCarnetVaccinalController
);

// ─── Routes ASC / Médecin ─────────────────────────────────
router.post(
  '/',
  requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME'),
  validateBody(createVaccinationSchema),
  administrerVaccinController
);

router.get(
  '/rappels',
  // Qui doit quel vaccin : nominatif, donc au soin. Les chiffres (/stats)
  // restent a l'administration.
  requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME'),
  getRappelsVaccinationController
);

router.get(
  '/stats',
  requireRole('ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL'),
  getStatsVaccinationController
);

router.get(
  '/patient/:id',
  requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME'),
  getCarnetVaccinalController
);

router.put(
  '/:id',
  requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME'),
  validateBody(updateVaccinationSchema),
  updateVaccinationController
);

export default router;