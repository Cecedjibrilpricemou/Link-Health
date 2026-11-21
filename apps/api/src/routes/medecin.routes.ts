import { Router, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import * as demandeRdv from '../services/demande-rendez-vous.service';
import * as accesDossier from '../services/acces-dossier.service';
import type { DemandeRendezVousView } from '@baobaoheath/shared-types';
import {
  getDashboardStatsController,
  getConsultationsAValiderController,
  validerConsultationController,
  getOrientationsController,
  fixerRendezVousController,
  getAgendaController,
  changerStatutRendezVousController,
  getResultatsALibererController,
  libererResultatsController,
  getReferencementsController,
  repondreReferencementController,
  sendMessageController,
  getMessagesController,
} from '../controllers/medecin.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import {
  validerConsultationSchema,
  accepterDemandeRendezVousSchema,
  fixerRendezVousSchema,
  refuserDemandeRendezVousSchema,
  libererResultatsSchema,
  statutRendezVousSchema,
  repondreReferencementSchema,
  sendMessageSchema,
} from '../validators/api.schemas';

const router = Router();

// ─── Tous les endpoints nécessitent auth + rôle MEDECIN ──
router.use(authenticate);
// Le medecin seul : valider une consultation, repondre a un referencement,
// lire ses consultations sont des actes de soin. Les administrations
// (structure, region) n'y avaient acces que par heritage.
router.use(requireRole('MEDECIN', 'SAGE_FEMME'));

// ─── Profil et dashboard ──────────────────────────────────
router.get('/dashboard', getDashboardStatsController);

// ─── Consultations ────────────────────────────────────────
router.get('/consultations', getConsultationsAValiderController);
router.put('/consultations/:id/valider', validateBody(validerConsultationSchema), validerConsultationController);

// ─── Demandes de rendez-vous a distance (addendum, point 6) ───
// Accepter, c'est fixer l'heure — et c'est ce geste qui ouvre la visite.
router.get('/demandes', requireRole('MEDECIN', 'SAGE_FEMME'), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView[] = await demandeRdv.mesDemandesRecues(req.user!.userId);
  res.json({ success: true, data });
});

router.post('/demandes/:id/accepter', requireRole('MEDECIN', 'SAGE_FEMME'), validateBody(accepterDemandeRendezVousSchema), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView = await demandeRdv.accepterDemande(req.user!.userId, req.params['id'] as string, req.body);
  res.json({ success: true, data, message: 'Rendez-vous fixe : le patient est prevenu' });
});

router.post('/demandes/:id/refuser', requireRole('MEDECIN', 'SAGE_FEMME'), validateBody(refuserDemandeRendezVousSchema), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView = await demandeRdv.refuserDemande(req.user!.userId, req.params['id'] as string, req.body.motif);
  res.json({ success: true, data });
});

// ─── Rendez-vous ──────────────────────────────────────────
// Addendum du 2026-09-28 : c'est le médecin qui fixe le créneau, pas l'accueil.
router.post('/orientations/:idEpisode/rendez-vous', requireRole('MEDECIN', 'SAGE_FEMME'), validateBody(fixerRendezVousSchema), fixerRendezVousController);
router.get('/rendez-vous', requireRole('MEDECIN', 'SAGE_FEMME'), getAgendaController);
router.patch('/rendez-vous/:id/statut', requireRole('MEDECIN', 'SAGE_FEMME'), validateBody(statutRendezVousSchema), changerStatutRendezVousController);

// ─── Résultats d'analyse à libérer ────────────────────────
// Addendum du 2026-09-28 : le patient ne voit un résultat qu'après qu'un
// médecin l'a libéré, avec la possibilité d'y joindre une explication en
// langage clair. `requireRole('MEDECIN', 'SAGE_FEMME')` est explicite ici : le routeur laisse
// aussi passer les administrateurs, qui n'ont rien à libérer.
router.get('/resultats', requireRole('MEDECIN', 'SAGE_FEMME'), getResultatsALibererController);
router.post('/resultats/:id/liberer', requireRole('MEDECIN', 'SAGE_FEMME'), validateBody(libererResultatsSchema), libererResultatsController);

// ─── Référencements ───────────────────────────────────────
// EF-03-05 : les patients que l'accueil a orientes vers ce medecin.
router.get('/orientations', getOrientationsController);
router.get('/referencements', getReferencementsController);
router.put('/referencements/:id/repondre', validateBody(repondreReferencementSchema), repondreReferencementController);

// ─── Messagerie ───────────────────────────────────────────
router.get('/messages', getMessagesController);
router.post('/messages', validateBody(sendMessageSchema), sendMessageController);

// ── L'historique du patient, sur son accord ──────────────────────────
// Ou en est l'acces, relancer une demande restee sans reponse, et lire
// l'historique une fois accorde. Le service refuse sans accord ni bris de
// glace : la garde de role dit « un medecin », pas « ce medecin-la ».
router.get('/patients/:idPatient/acces', requireRole('MEDECIN', 'SAGE_FEMME'), async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await accesDossier.etatAcces(req.user!, req.params['idPatient'] as string) });
});
router.post('/patients/:idPatient/acces/relancer', requireRole('MEDECIN', 'SAGE_FEMME'), async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await accesDossier.relancerDemande(req.user!, req.params['idPatient'] as string) });
});
router.get('/patients/:idPatient/historique', requireRole('MEDECIN', 'SAGE_FEMME'), async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await accesDossier.historiquePatient(req.user!, req.params['idPatient'] as string) });
});

export default router;