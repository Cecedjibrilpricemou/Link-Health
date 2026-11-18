import { Router } from 'express';
import {
  initierPaiementController,
  verifierStatutPaiementController,
  confirmerPaiementController,
  getHistoriquePaiementsController,
  aReglerController,
  annulerPaiementController,
} from '../controllers/paiement.controller';
import { Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { confirmerPaiementSchema, initierPaiementSchema } from '../validators/api.schemas';
import { documentRecu } from '../services/recu-paiement.service';

const router = Router();

router.use(authenticate);

router.post('/', requireRole('PATIENT'), validateBody(initierPaiementSchema), initierPaiementController);
router.get('/historique', requireRole('PATIENT'), getHistoriquePaiementsController);
router.get('/factures/:id/recu', requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const html = await documentRecu(req.user!, req.params['id'] as string);
  res.type('html').send(html);
});
// Ce qui reste du, consultations non encore facturees comprises.
router.get('/a-regler', requireRole('PATIENT'), aReglerController);
router.get('/:id/statut', requireRole('PATIENT'), verifierStatutPaiementController);
router.post('/:id/annuler', requireRole('PATIENT'), annulerPaiementController);
router.post('/:id/confirmer', requireRole('ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'PHARMACIEN'), validateBody(confirmerPaiementSchema), confirmerPaiementController);

export default router;
