import * as appro from '../services/approvisionnement.service';
import * as pharmacien from '../services/pharmacien.service';
import * as vente from '../services/vente.service';
import * as caisse from '../services/caisse.service';
import type {
  HorairesOfficineView,
  PositionOfficineView,
  ApprovisionnementView,
  LotStockView,
  PeremptionProcheView,
  TableauDeBordOfficineView,
  VenteComptoirView,
  SessionCaisseView,
  RapportCaisseView,
} from '@baobaoheath/shared-types';
import { creerApprovisionnementSchema, definirHorairesSchema, definirPositionSchema } from '../validators/api.schemas';
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireOfficineRole, requireRole } from '../middlewares/rbac.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import * as ctrl from '../controllers/pharmacien.controller';
import {
  annulerVenteSchema,
  createAgentPharmacieSchema,
  creerVenteSchema,
  delivrerOrdonnanceSchema,
  refuserLigneSchema,
  substituerLigneSchema,
  reapprovisionnerStockSchema,
  verifierOrdonnanceSchema,
  etatAgentSchema,
  permissionTemporaireAgentSchema,
  roleAgentSchema,
  creerProduitOfficineSchema,
  modifierProduitOfficineSchema,
  ouvrirSessionCaisseSchema,
  cloturerSessionCaisseSchema,
  rapportCaisseQuerySchema,
  ajusterLotStockSchema,
  mouvementsStockQuerySchema,
} from '../validators/api.schemas';

const router = Router();
const requireTitulaire = requireOfficineRole('TITULAIRE');
const requirePersonnelClinique = requireOfficineRole('TITULAIRE', 'ADJOINT', 'PREPARATEUR');
const requirePersonnelCaisse = requireOfficineRole('TITULAIRE', 'ADJOINT', 'PREPARATEUR', 'CAISSIER');

router.use(authenticate);
router.use(requireRole('PHARMACIEN'));

router.get('/scan/:qrCode', requirePersonnelClinique, ctrl.scanPatientController);
// EF-07-01 : controle d'une ordonnance presentee sans QR patient (papier,
// ordonnance d'un proche). Declaree avant `/ordonnances/:id/...` pour que
// « verifier » ne soit pas capture comme un identifiant.
router.post('/ordonnances/verifier', requirePersonnelClinique, validateBody(verifierOrdonnanceSchema), ctrl.verifierOrdonnanceController);
// EF-05-09 : `:id` designe ici l'ordonnance entiere, pas une ligne — un
// renouvellement rouvre tout le traitement.
router.post('/ordonnances/:id/renouveler', requirePersonnelClinique, ctrl.renouvelerOrdonnanceController);
// `:id` designe une ligne : la delivrance se fait medicament par medicament.
router.post('/ordonnances/:id/delivrer', requirePersonnelClinique, validateBody(delivrerOrdonnanceSchema), ctrl.delivrerOrdonnanceController);
// EF-07-04 / EF-07-05. Trois gestes distincts et nommes plutot qu'un seul
// avec des drapeaux : une substitution n'est pas une delivrance avec une
// option, et un refus n'est pas une delivrance de zero.
router.post('/ordonnances/:id/substituer', requirePersonnelClinique, validateBody(substituerLigneSchema), ctrl.substituerLigneController);
router.post('/ordonnances/:id/refuser', requirePersonnelClinique, validateBody(refuserLigneSchema), ctrl.refuserLigneController);
// ── Horaires d'ouverture ─────────────────────────────────────────────
// Le public voit ces horaires et s'en sert pour se deplacer : les annoncer
// engage l'officine, donc seul le titulaire les fixe. La lecture, elle, est
// ouverte a tout le personnel, qui doit pouvoir repondre au telephone.
router.get('/horaires', requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data: HorairesOfficineView = await pharmacien.getHorairesOfficine(req.user!.userId);
  res.json({ success: true, data });
});

router.put('/horaires', requireTitulaire, validateBody(definirHorairesSchema), async (req: AuthRequest, res: Response) => {
  const data: HorairesOfficineView = await pharmacien.definirHorairesOfficine(req.user!.userId, req.body);
  res.json({ success: true, data, message: 'Horaires enregistres' });
});

// ── Position sur la carte ────────────────────────────────────
// Le public se deplace jusqu'a ce marqueur : seul le titulaire le pose, comme
// pour les horaires. La lecture reste ouverte au personnel, qui renseigne les
// clients au telephone.
router.get('/position', requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data: PositionOfficineView = await pharmacien.getPositionOfficine(req.user!.userId);
  res.json({ success: true, data });
});

router.put('/position', requireTitulaire, validateBody(definirPositionSchema), async (req: AuthRequest, res: Response) => {
  const data: PositionOfficineView = await pharmacien.definirPositionOfficine(req.user!.userId, req.body);
  res.json({ success: true, data, message: 'Position enregistree' });
});

// ── Approvisionnement et peremptions (addendum, points 1.3 et 1.4) ───
// Saisie assistee : la facture est attachee en justificatif. L'extraction
// automatique viendra ensuite, et devra toujours etre relue avant
// enregistrement.
router.post('/approvisionnements', requireTitulaire, validateBody(creerApprovisionnementSchema), async (req: AuthRequest, res: Response) => {
  const data: ApprovisionnementView = await appro.enregistrerApprovisionnement(req.user!, req.body);
  res.status(201).json({ success: true, data, message: 'Entree en stock enregistree' });
});

router.get('/approvisionnements', requireTitulaire, async (req: AuthRequest, res: Response) => {
  const data: ApprovisionnementView[] = await appro.listerApprovisionnements(req.user!);
  res.json({ success: true, data });
});

router.get('/peremptions', requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const jours = typeof req.query['jours'] === 'string' ? Number(req.query['jours']) : undefined;
  const data: PeremptionProcheView[] = await appro.peremptionsProches(req.user!, Number.isFinite(jours) ? jours : undefined);
  res.json({ success: true, data });
});

router.get('/medicaments/:id/lots', async (req: AuthRequest, res: Response) => {
  const data: LotStockView[] = await appro.lotsDuMedicament(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

// ── Vente au comptoir et tableau de bord (addendum, points 1.1 et 1.2) ───
//
// `tableau-de-bord` est declare avant `/ventes/:id` pour qu'il ne soit pas
// capture comme un identifiant de vente.
router.get('/tableau-de-bord', async (req: AuthRequest, res: Response) => {
  const data: TableauDeBordOfficineView = await vente.tableauDeBord(req.user!);
  res.json({ success: true, data });
});

router.get('/caisse/session', requirePersonnelCaisse, async (req: AuthRequest, res: Response) => {
  const data: SessionCaisseView | null = await caisse.sessionCourante(req.user!);
  res.json({ success: true, data });
});

router.post('/caisse/sessions', requirePersonnelCaisse, validateBody(ouvrirSessionCaisseSchema), async (req: AuthRequest, res: Response) => {
  const data: SessionCaisseView = await caisse.ouvrirSession(req.user!, req.body);
  res.status(201).json({ success: true, data, message: 'Session de caisse ouverte' });
});

router.post('/caisse/sessions/:id/cloturer', requirePersonnelCaisse, validateBody(cloturerSessionCaisseSchema), async (req: AuthRequest, res: Response) => {
  const data: SessionCaisseView = await caisse.cloturerSession(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data, message: 'Session de caisse cloturee' });
});

router.get('/caisse/rapport', requirePersonnelCaisse, validateQuery(rapportCaisseQuerySchema), async (req: AuthRequest, res: Response) => {
  const { periode, date } = req.query as { periode: 'JOUR' | 'MOIS' | 'ANNEE'; date?: string };
  const data: RapportCaisseView = await caisse.rapportCaisse(req.user!, periode, date);
  res.json({ success: true, data });
});

router.post('/ventes', validateBody(creerVenteSchema), async (req: AuthRequest, res: Response) => {
  const data: VenteComptoirView = await vente.creerVente(req.user!, req.body);
  res.status(201).json({ success: true, data, message: `Vente ${data.numero} enregistree` });
});

router.get('/ventes', async (req: AuthRequest, res: Response) => {
  const limite = typeof req.query['limite'] === 'string' ? Number(req.query['limite']) : undefined;
  const data: VenteComptoirView[] = await vente.listerVentes(req.user!, Number.isFinite(limite) ? limite : undefined);
  res.json({ success: true, data });
});

router.get('/ventes/:id', async (req: AuthRequest, res: Response) => {
  const data: VenteComptoirView = await vente.getVente(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

// Correction d'une erreur de saisie, pas un retour client (EF-07-11) : les
// lots consommes sont remis exactement.
/**
 * Ou en est le paiement du client ?
 *
 * Le pharmacien a le client devant lui : la route interroge la passerelle et
 * repond tout de suite, au lieu d'attendre un rappel qui peut ne jamais
 * arriver.
 */
router.get('/ventes/:id/paiement', async (req: AuthRequest, res: Response) => {
  const data: VenteComptoirView = await vente.rafraichirPaiementVente(
    req.user!, req.params['id'] as string,
  );
  res.json({ success: true, data });
});

router.post('/ventes/:id/annuler', validateBody(annulerVenteSchema), async (req: AuthRequest, res: Response) => {
  const data: VenteComptoirView = await vente.annulerVente(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data, message: 'Vente annulee, stock remis' });
});

router.get('/stocks/mouvements', requireTitulaire, validateQuery(mouvementsStockQuerySchema), ctrl.getMouvementsStockController);
router.post('/stocks/lots/:idLot/ajuster', requireTitulaire, validateBody(ajusterLotStockSchema), ctrl.ajusterLotStockController);
router.get('/stocks', ctrl.getStocksController);
router.post('/stocks/reapprovisionner', requireTitulaire, validateBody(reapprovisionnerStockSchema), ctrl.reapprovisionnerStockController);
router.get('/ordonnances', requirePersonnelClinique, ctrl.getOrdonnancesController);
router.get('/medicaments', ctrl.getMedicamentsController);
router.post('/catalogue-local', requireTitulaire, validateBody(creerProduitOfficineSchema), ctrl.creerProduitOfficineController);
router.patch('/catalogue-local/:id', requireTitulaire, validateBody(modifierProduitOfficineSchema), ctrl.modifierProduitOfficineController);
router.delete('/catalogue-local/:id', requireTitulaire, ctrl.desactiverProduitOfficineController);
router.get('/connexions', requireTitulaire, ctrl.getJournalConnexionsController);
router.get('/agents', requireTitulaire, ctrl.getAgentsController);
router.post('/agents', requireTitulaire, validateBody(createAgentPharmacieSchema), ctrl.creerAgentController);
router.patch('/agents/:id/statut', requireTitulaire, validateBody(etatAgentSchema), ctrl.mettreAJourEtatAgentController);
router.put('/agents/:id/role-permanent', requireTitulaire, validateBody(roleAgentSchema), ctrl.changerRoleAgentController);
router.put('/agents/:id/permission-temporaire', requireTitulaire, validateBody(permissionTemporaireAgentSchema), ctrl.definirPermissionTemporaireController);
router.delete('/agents/:id/permission-temporaire', requireTitulaire, ctrl.revoquerPermissionTemporaireController);

export default router;
