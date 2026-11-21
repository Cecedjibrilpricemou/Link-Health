import { Router } from 'express';
import { getChangesController, getConfigController, pushMutationsController } from '../controllers/sync.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import { syncChangesQuerySchema, syncPushSchema } from '../validators/api.schemas';

const router = Router();

router.use(authenticate);
// La synchronisation hors ligne emporte des dossiers : l'administration n'a
// pas de mode hors ligne, et n'a pas a les emporter.
router.use(requireRole('PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'PHARMACIEN'));

// Lu par le client web au demarrage : mode hors-ligne autorise, frequence de rejeu.
router.get('/config', getConfigController);
router.get('/changes', validateQuery(syncChangesQuerySchema), getChangesController);
router.post('/push', validateBody(syncPushSchema), pushMutationsController);

export default router;
