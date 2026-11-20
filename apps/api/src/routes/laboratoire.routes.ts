// src/routes/laboratoire.routes.ts
// P2 — Laboratoire (EF-04) : file des demandes, prelevement, resultats,
// validation par le laborantin, compte rendu. Reserve au personnel du laboratoire.
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { sansValeursDAnalysePour } from '../middlewares/secret-medical.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import * as plateau from '../services/plateau-technique.service';
import * as labo from '../services/laboratoire.service';
import {
  declarerPlateauSchema,
  enregistrerPrelevementSchema,
  fileLaboQuerySchema,
  planifierPrelevementSchema,
  saisirResultatsSchema,
  validerResultatsSchema,
} from '../validators/api.schemas';
import type { DemandeAnalyseView, PlateauTechniqueView, ScanLaboratoireView, TableauDeBordLaboView } from '@baobaoheath/shared-types';

const router = Router();

router.use(authenticate);
router.use(requireRole('TECHNICIEN_LABO', 'ADMIN_STRUCTURE'));
// L'administration voit l'activite du laboratoire (plateau, file, delais),
// jamais les valeurs : elles sont au laborantin qui les produit et au medecin
// qui les lit.
router.use(sansValeursDAnalysePour('ADMIN_STRUCTURE'));

// ── Scan du QR patient au comptoir ───────────────────────────────────
// Même geste que côté pharmacie, fenêtre différente : le laborantin voit ce
// qui reste à faire pour ce patient dans SON laboratoire, et rien d'autre.
/**
 * Le plateau technique : ce que ce laboratoire realise.
 *
 * **Tant que rien n'est declare, tout est repute realisable.** Sans cette
 * regle, toutes les structures existantes disparaitraient des listes des
 * medecins le jour du deploiement. L'ecran doit le dire, sinon le premier qui
 * coche un seul examen croira avoir ajoute alors qu'il aura restreint.
 */
router.get('/plateau-technique', async (req: AuthRequest, res: Response) => {
  const data: PlateauTechniqueView = await plateau.plateauDeMaStructure(req.user!);
  res.json({ success: true, data });
});

/**
 * La declaration complete, en un geste : on remplace l'ensemble plutot que de
 * modifier ligne a ligne. Un plateau technique se lit comme un tout, et une
 * declaration partielle laisserait des lignes dont personne ne saurait si
 * elles valent encore.
 */
router.put('/plateau-technique', validateBody(declarerPlateauSchema), async (req: AuthRequest, res: Response) => {
  const data: PlateauTechniqueView = await plateau.declarerPlateau(req.user!, req.body);
  res.json({ success: true, data });
});

router.get('/scan/:qrCode', async (req: AuthRequest, res: Response) => {
  const data: ScanLaboratoireView = await labo.scanPatient(req.user!, req.params['qrCode'] as string);
  res.json({ success: true, data });
});

router.get('/tableau-de-bord', async (req: AuthRequest, res: Response) => {
  const data: TableauDeBordLaboView = await labo.tableauDeBord(req.user!);
  res.json({ success: true, data });
});

// ── File des demandes (EF-04-01) ──────────────────────────────────────
router.get('/demandes', validateQuery(fileLaboQuerySchema), async (req: AuthRequest, res: Response) => {
  const { statut, q, page, limit } = req.query as { statut?: string; q?: string; page?: number; limit?: number };
  const data = await labo.fileDesDemandes(req.user!, { statut, q, page: page ?? 1, limit: limit ?? 20 });
  res.json({ success: true, data });
});

router.get('/demandes/:id', async (req: AuthRequest, res: Response) => {
  const data: DemandeAnalyseView = await labo.getDemande(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

router.post('/demandes/:id/reception', async (req: AuthRequest, res: Response) => {
  const data = await labo.accuserReception(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

// ── Prelevement (EF-04-02, EF-04-03) ──────────────────────────────────
router.post('/demandes/:id/prelevement/planifier', validateBody(planifierPrelevementSchema), async (req: AuthRequest, res: Response) => {
  const data = await labo.planifierPrelevement(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data });
});

router.post('/demandes/:id/prelevement', validateBody(enregistrerPrelevementSchema), async (req: AuthRequest, res: Response) => {
  const data = await labo.enregistrerPrelevement(req.user!, req.params['id'] as string, req.body);
  res.status(201).json({ success: true, data });
});

// ── Resultats : saisie ou import (EF-04-04, EF-04-06) ─────────────────
router.put('/demandes/:id/resultats', requireRole('TECHNICIEN_LABO'), validateBody(saisirResultatsSchema), async (req: AuthRequest, res: Response) => {
  const data = await labo.saisirResultats(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data });
});

// ── Validation nominative du laborantin (EF-04-05) ────────────────────
// Le role BIOLOGISTE a ete supprime le 2026-09-30 (addendum, point 4) : il
// n'y a pas de biologiste dans ces laboratoires. La validation reste
// bloquante et nominative — quelqu'un continue de signer.
router.post('/demandes/:id/valider', requireRole('TECHNICIEN_LABO'), validateBody(validerResultatsSchema), async (req: AuthRequest, res: Response) => {
  const data = await labo.validerResultats(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data });
});

// ── Compte rendu imprimable ───────────────────────────────────────────
// Il porte les valeurs : au laborantin seul (le medecin passe par /resultats).
router.get('/demandes/:id/compte-rendu', requireRole('TECHNICIEN_LABO'), async (req: AuthRequest, res: Response) => {
  const html = await labo.compteRenduLabo(req.user!, req.params['id'] as string);
  res.type('html').send(html);
});

export default router;
