// src/routes/resultats.routes.ts
// P2 — Cote prescripteur (EF-04-07/08/10) : alertes de resultats critiques
// avec accuse de lecture, compte rendu, courbes d'evolution d'un patient.
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { assertHistoriqueSiMedecin } from '../services/acces-dossier.service';
import { validateQuery } from '../middlewares/validate.middleware';
import * as labo from '../services/laboratoire.service';
import { evolutionQuerySchema } from '../validators/api.schemas';
import { ValidationError } from '../utils/app-error';
import type { AlerteCritiqueView, EvolutionResultatView, ExamenSuiviView } from '@baobaoheath/shared-types';

const router = Router();

router.use(authenticate);
// L'accueil avait ce droit parce qu'il prescrivait. Depuis l'addendum du
// 2026-09-28 il ne prescrit plus, donc plus aucune alerte ne lui est destinee
// et il n'a plus de raison de lire un resultat.
router.use(requireRole('MEDECIN', 'ADMIN_STRUCTURE', 'ASC', 'ASC_SUPERVISOR'));

router.get('/alertes', async (req: AuthRequest, res: Response) => {
  const data: AlerteCritiqueView[] = await labo.mesAlertes(req.user!);
  res.json({ success: true, data });
});

router.post('/alertes/:id/accuser', async (req: AuthRequest, res: Response) => {
  const data: AlerteCritiqueView = await labo.accuserAlerte(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

router.get('/demandes/:id/compte-rendu', async (req: AuthRequest, res: Response) => {
  const html = await labo.compteRenduPrescripteur(req.user!, req.params['id'] as string);
  res.type('html').send(html);
});

// L'evolution des resultats est de l'historique : pour un medecin, elle suit
// l'accord du patient.
router.get('/patients/:idPatient/examens-suivis', async (req: AuthRequest, res: Response) => {
  await assertHistoriqueSiMedecin(req.user!, req.params['idPatient'] as string);
  const data: ExamenSuiviView[] = await labo.examensSuivisPourProfessionnel(req.user!, req.params['idPatient'] as string);
  res.json({ success: true, data });
});

router.get('/patients/:idPatient/evolution', validateQuery(evolutionQuerySchema), async (req: AuthRequest, res: Response) => {
  await assertHistoriqueSiMedecin(req.user!, req.params['idPatient'] as string);
  const codeLoinc = req.query['codeLoinc'];
  if (typeof codeLoinc !== 'string') throw new ValidationError('codeLoinc requis');
  const data: EvolutionResultatView = await labo.evolutionPourProfessionnel(req.user!, req.params['idPatient'] as string, codeLoinc);
  res.json({ success: true, data });
});

export default router;
