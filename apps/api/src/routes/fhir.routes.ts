import { Router } from 'express';
import {
  getConsultationFhirController,
  getPatientBundleFhirController,
  getPatientFhirController,
} from '../controllers/fhir.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.use(authenticate);
// L'export emporte tout le dossier : l'administration d'une structure n'en a
// pas l'usage. Les administrations de la plateforme gardent l'interoperabilite.
router.use(requireRole('PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'));

router.get('/patients/:id', getPatientFhirController);
router.get('/patients/:id/bundle', getPatientBundleFhirController);
router.get('/consultations/:id', getConsultationFhirController);

export default router;
