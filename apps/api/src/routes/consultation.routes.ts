import { Response, Router } from 'express';
import { documentConsultation } from '../services/consultation-document.service';
import {
  createConsultationController,
  getConsultationByIdController,
  getConsultationsController,
  saveVitalsController,
  completeConsultationController,
  addDiagnosticController,
  addOrdonnanceController,
  alertesPrescriptionController,
  createReferralController,
} from '../controllers/consultation.controller';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import {
  createConsultationSchema,
  diagnosticSchema,
  alertesPrescriptionSchema,
  ordonnanceSchema,
  referralSchema,
  vitalsSchema,
} from '../validators/api.schemas';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'ADMIN_STRUCTURE'), getConsultationsController);
router.post('/', requireRole('ASC', 'ASC_SUPERVISOR'), validateBody(createConsultationSchema), createConsultationController);
router.get('/:id', requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'ADMIN_STRUCTURE'), getConsultationByIdController);
// Compte rendu imprimable (EF-05-03) : le patient pour son dossier, les
// soignants pour reprendre le suivi. Pas l'administration de la structure :
// elle gere, elle ne soigne pas. Le perimetre exact (le patient ses propres
// consultations, l'ASC les siennes...) est juge par la consultation elle-meme.
router.get('/:id/compte-rendu', requireRole('PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN'), async (req: AuthRequest, res: Response) => {
  const html = await documentConsultation(req.user!, req.params['id'] as string);
  res.type('html').send(html);
});
// Les constantes se relevent aussi en consultation hospitaliere : le medecin
// qui mene l'entretien prend la tension, il ne la fait pas prendre par un
// agent communautaire absent.
router.post('/:id/vitals', requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN'), validateBody(vitalsSchema), saveVitalsController);
router.post('/:id/complete', requireRole('ASC', 'ASC_SUPERVISOR'), completeConsultationController);
router.post('/:id/diagnostics', requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN'), validateBody(diagnosticSchema), addDiagnosticController);
// EF-05-05 : ce que le prescripteur doit savoir avant d'ajouter le
// medicament. Declaree avant la prescription elle-meme pour se lire dans
// l'ordre ou l'ecran les appelle.
router.post('/:id/ordonnances/alertes', requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN'), validateBody(alertesPrescriptionSchema), alertesPrescriptionController);
router.post('/:id/ordonnances', requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN'), validateBody(ordonnanceSchema), addOrdonnanceController);
router.post('/:id/referral', requireRole('ASC', 'ASC_SUPERVISOR'), validateBody(referralSchema), createReferralController);

export default router;
