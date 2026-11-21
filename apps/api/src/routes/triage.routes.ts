import { Router } from 'express';
import { evaluerTriageController } from '../controllers/triage.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { triageSchema } from '../validators/api.schemas';

const router = Router();

router.use(authenticate);
router.use(requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME'));

router.post('/evaluer', validateBody(triageSchema), evaluerTriageController);

export default router;
