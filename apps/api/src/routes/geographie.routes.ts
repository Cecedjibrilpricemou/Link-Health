import { Router, Response, Request } from 'express';
import type {
  ConfigurationGeoView,
  JeuDeDepartGeoView,
  LieuGeoView,
  LieuHorsReferentielView,
  RenommageLieuGeoView,
  UtilisationLieuGeoView,
} from '@baobaoheath/shared-types';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import * as geo from '../services/geographie.service';
import { creerLieuGeoSchema, modifierLieuGeoSchema, renommerLieuGeoSchema } from '../validators/api.schemas';

/**
 * Referentiel geographique generique (M1).
 *
 * **La lecture est publique** : un decoupage administratif et des noms de
 * lieux ne revelent rien, et l'inscription d'un patient s'en sert avant toute
 * connexion. **L'ecriture est nationale** : un lieu vaut pour toute
 * l'installation, et un voisinage faux enverrait des appels au mauvais endroit.
 */
const router = Router();
const ADMIN_GEO = ['SUPER_ADMIN', 'ADMIN_NATIONAL'] as const;

const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

router.get('/configuration', async (_req: Request, res: Response) => {
  const data: ConfigurationGeoView = await geo.configuration();
  res.json({ success: true, data });
});

router.get('/lieux', async (req: Request, res: Response) => {
  const data: LieuGeoView[] = await geo.listerLieux({
    niveau: texte(req.query['niveau']),
    parent: texte(req.query['parent']),
    dans: texte(req.query['dans']),
  });
  res.json({ success: true, data });
});

router.get('/hors-referentiel', authenticate, requireRole(...ADMIN_GEO), async (_req: AuthRequest, res: Response) => {
  const data: LieuHorsReferentielView[] = await geo.horsReferentiel();
  res.json({ success: true, data });
});

router.post('/lieux', authenticate, requireRole(...ADMIN_GEO), validateBody(creerLieuGeoSchema), async (req: AuthRequest, res: Response) => {
  const data: LieuGeoView = await geo.creerLieu(req.body);
  res.status(201).json({ success: true, data, message: 'Lieu ajoute' });
});

router.put('/lieux/:id', authenticate, requireRole(...ADMIN_GEO), validateBody(modifierLieuGeoSchema), async (req: AuthRequest, res: Response) => {
  const data: LieuGeoView = await geo.modifierLieu(req.params['id'] as string, req.body);
  res.json({ success: true, data, message: 'Lieu mis a jour' });
});

/**
 * R7 : ce qui porte le nom d'un lieu (enfants, adresses, appels en cours).
 * L'ecran le montre avant de renommer ou de supprimer.
 */
router.get('/lieux/:id/utilisation', authenticate, requireRole(...ADMIN_GEO), async (req: AuthRequest, res: Response) => {
  const data: UtilisationLieuGeoView = await geo.utilisationLieu(req.params['id'] as string);
  res.json({ success: true, data });
});

/** R7 : renommer, en propageant le nouveau nom aux adresses et aux appels en cours. */
router.post('/lieux/:id/renommer', authenticate, requireRole(...ADMIN_GEO), validateBody(renommerLieuGeoSchema), async (req: AuthRequest, res: Response) => {
  const data: RenommageLieuGeoView = await geo.renommerLieu(req.user!.userId, req.params['id'] as string, req.body.nom);
  const r = data.renommes;
  res.json({
    success: true,
    data,
    message: `Lieu renomme. ${r.structures} structure(s), ${r.patients} patient(s), ${r.motards} motard(s) `
      + `et ${r.appelsEnCours} appel(s) en cours ont pris le nouveau nom.`,
  });
});

/** R7 : supprimer un lieu inutilise. */
router.delete('/lieux/:id', authenticate, requireRole(...ADMIN_GEO), async (req: AuthRequest, res: Response) => {
  await geo.supprimerLieu(req.user!.userId, req.params['id'] as string);
  res.json({ success: true, message: 'Lieu supprime' });
});

router.post('/jeu-de-depart', authenticate, requireRole(...ADMIN_GEO), async (_req: AuthRequest, res: Response) => {
  const data: JeuDeDepartGeoView = await geo.chargerJeuDeDepart();
  res.json({ success: true, data, message: `${data.crees} lieu(x) ajoute(s), ${data.dejaPresents} deja present(s)` });
});

export default router;
