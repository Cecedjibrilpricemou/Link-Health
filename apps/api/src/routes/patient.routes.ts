import { Router, Response } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';
import * as hopital from '../services/hopital.service';
import * as labo from '../services/laboratoire.service';
import { ValidationError } from '../utils/app-error';
import type { EpisodePatientView, EvolutionResultatView, ExamenSuiviView } from '@baobaoheath/shared-types';
import {
  createPatientController,
  getPatientsController,
  getPatientByIdController,
  getPatientByQrCodeController,
  getMyProfileController,
  updateMyProfileController,
  exportDossierController,
  updateStructurePrefereeController,
} from '../controllers/patient.controller';
import { getMesConsultationsController } from '../controllers/consultation.controller';
import * as demandeRdv from '../services/demande-rendez-vous.service';
import type { DemandeRendezVousView } from '@baobaoheath/shared-types';
import { creerDemandeRendezVousSchema } from '../validators/api.schemas';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import {
  createPatientSchema,
  definirAdresseSchema,
  definirPinUssdSchema,
  updatePatientSchema,
  updateStructurePrefereeSchema,
} from '../validators/api.schemas';
import * as ussd from '../services/ussd.service';
import * as adresse from '../services/patient-adresse.service';
import type { AdressePatientView } from '@baobaoheath/shared-types';

const router = Router();

router.post('/', validateBody(createPatientSchema), createPatientController);

router.get('/me', authenticate, requireRole('PATIENT'), getMyProfileController);
router.put('/me', authenticate, requireRole('PATIENT'), validateBody(updatePatientSchema), updateMyProfileController);
router.put('/me/structure', authenticate, requireRole('PATIENT'), validateBody(updateStructurePrefereeSchema), updateStructurePrefereeController);
router.get('/me/export', authenticate, requireRole('PATIENT'), exportDossierController);

// M3 : l'adresse qui decide a quelles pharmacies part son ordonnance, et ou
// le motard livre. La position GPS n'y entre qu'avec son accord.
router.get('/me/adresse', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data: AdressePatientView = await adresse.monAdresse(req.user!.userId);
  res.json({ success: true, data });
});

router.put('/me/adresse', authenticate, requireRole('PATIENT'), validateBody(definirAdresseSchema), async (req: AuthRequest, res: Response) => {
  const data: AdressePatientView = await adresse.definirAdresse(req.user!.userId, req.body);
  res.json({ success: true, data, message: 'Adresse enregistree' });
});

// Le code PIN qui ouvre le dossier par USSD. Le mot de passe du compte est
// exige : une session laissee ouverte ne doit pas suffire a le poser.
router.put('/me/pin-ussd', authenticate, requireRole('PATIENT'), validateBody(definirPinUssdSchema), async (req: AuthRequest, res: Response) => {
  await ussd.definirPinUssd(req.user!.userId, req.body);
  res.json({ success: true, message: 'Code PIN enregistre' });
});

// ── Prise de rendez-vous a distance (addendum du 2026-09-28, point 6) ─
// Le patient demande depuis chez lui ; un medecin repond en fixant l'heure.
router.post('/me/demandes-rendez-vous', authenticate, requireRole('PATIENT'), validateBody(creerDemandeRendezVousSchema), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView = await demandeRdv.creerDemande(req.user!.userId, req.body);
  res.status(201).json({ success: true, data, message: 'Demande envoyee' });
});

router.get('/me/demandes-rendez-vous', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView[] = await demandeRdv.mesDemandes(req.user!.userId);
  res.json({ success: true, data });
});

router.post('/me/demandes-rendez-vous/:id/annuler', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView = await demandeRdv.annulerDemande(req.user!.userId, req.params['id'] as string);
  res.json({ success: true, data });
});
router.get('/me/consultations', authenticate, requireRole('PATIENT'), getMesConsultationsController);

// P1 — parcours hospitalier du patient : episodes, demandes d'analyse, orientations.
router.get('/me/episodes', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data: EpisodePatientView[] = await hopital.mesEpisodes(req.user!.userId);
  res.json({ success: true, data });
});
router.get('/me/demandes-analyse/:id/document', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const html = await hopital.documentDemandePourPatient(req.user!.userId, req.params['id'] as string);
  res.type('html').send(html);
});

// P2 — resultats diffuses au patient (EF-04-09) et courbes d'evolution (EF-04-10).
router.get('/me/demandes-analyse/:id/compte-rendu', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const html = await labo.compteRenduPatient(req.user!.userId, req.params['id'] as string);
  res.type('html').send(html);
});
router.get('/me/resultats/examens-suivis', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data: ExamenSuiviView[] = await labo.examensSuivisPourPatient(req.user!.userId);
  res.json({ success: true, data });
});
router.get('/me/resultats/evolution', authenticate, requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const codeLoinc = req.query['codeLoinc'];
  if (typeof codeLoinc !== 'string' || !codeLoinc.trim()) throw new ValidationError('codeLoinc requis');
  const data: EvolutionResultatView = await labo.evolutionPourPatient(req.user!.userId, codeLoinc.trim());
  res.json({ success: true, data });
});

router.get('/', authenticate, requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'ADMIN_STRUCTURE'), getPatientsController);
router.get('/qr/:qrCode', authenticate, requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN'), getPatientByQrCodeController);
router.get('/:id', authenticate, requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'ADMIN_STRUCTURE'), getPatientByIdController);

export default router;
