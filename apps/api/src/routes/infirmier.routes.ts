// L'espace de l'infirmier : les patients en visite, le dossier de la visite,
// les soins. Il soigne sans prescrire : aucune route de ce fichier n'ecrit une
// ordonnance, une analyse ou une cloture.
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { soinInfirmierSchema } from '../validators/api.schemas';
import * as infirmier from '../services/infirmier.service';
import type { DossierVisiteInfirmierView, PatientEnVisiteView, SoinInfirmierView } from '@baobaoheath/shared-types';

const router = Router();
router.use(authenticate);
router.use(requireRole('INFIRMIER'));

router.get('/patients', async (req: AuthRequest, res: Response) => {
  const data: PatientEnVisiteView[] = await infirmier.patientsDuJour(req.user!);
  res.json({ success: true, data });
});

router.get('/visites/:id', async (req: AuthRequest, res: Response) => {
  const data: DossierVisiteInfirmierView = await infirmier.dossierDeVisite(req.user!, String(req.params['id']));
  res.json({ success: true, data });
});

router.post('/visites/:id/soins', validateBody(soinInfirmierSchema), async (req: AuthRequest, res: Response) => {
  const data: SoinInfirmierView = await infirmier.enregistrerSoin(req.user!, String(req.params['id']), req.body);
  res.status(201).json({ success: true, data });
});

export default router;
