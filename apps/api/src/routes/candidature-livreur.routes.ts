// Les candidatures des motards livreurs : le depot par le motard, l'examen par
// l'administration.
//
// **Une seule route de ce fichier est publique** : le depot. Elle ecrit en
// base et sur le disque sans aucun compte derriere, d'ou le limiteur de debit
// pose sur elle dans `index.ts`.
//
// La lecture d'une piece passe par ce routeur et non par celle des pieces
// d'agrement : les droits ne sont pas les memes (un administrateur regional
// recrute des livreurs, il n'examine pas d'agrements), ni les formats (un
// livreur envoie des photos).
import { Router, type Request, type Response } from 'express';

import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { corpsJsonMultipart, recevoirPiecesLivreur } from '../middlewares/upload.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import * as service from '../services/candidature-livreur.service';
import { candidatureLivreurSchema, refusDemandeAgrementSchema } from '../validators/api.schemas';

const router = Router();

/** Les roles qui recrutent : les memes que `POST /comptes/livreurs`. */
const recruteurs = requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_REGIONAL');

/**
 * Deposer une candidature. **Sans compte : c'est tout l'objet de cette porte.**
 *
 * `multer` d'abord, seul a savoir lire un corps multipart ; puis
 * `corpsJsonMultipart`, qui remet a sa place l'objet envoye dans `donnees` ;
 * puis seulement la validation du schema.
 */
router.post(
  '/',
  recevoirPiecesLivreur,
  corpsJsonMultipart,
  validateBody(candidatureLivreurSchema),
  async (req: Request, res: Response) => {
    const fichiers = (req.files ?? []) as service.FichierRecu[];
    const data = await service.deposer(req.body, fichiers);
    res.status(201).json({ success: true, data });
  },
);

// ── L'examen, reserve aux recruteurs ─────────────────────────────

router.use(authenticate);

/** La liste, filtrable par etat : `?statut=RECUE`, ou rien pour tout voir. */
router.get('/', recruteurs, async (req: AuthRequest, res: Response) => {
  const data = await service.lister(req.user!, req.query['statut'] as string | undefined);
  res.json({ success: true, data });
});

/**
 * Le contenu d'une piece. Declaree **avant** `/:id`, qui la capturerait
 * sinon. Le type renvoye est celui lu dans les octets au depot, jamais celui
 * qu'avait declare le navigateur du candidat.
 */
router.get('/pieces/:id', recruteurs, async (req: AuthRequest, res: Response) => {
  const { contenu, typeMime } = await service.lirePiece(req.user!, req.params['id'] as string);
  res.setHeader('Content-Type', typeMime);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(contenu);
});

/** Le dossier complet, avec ses pieces et ce qui manque. */
router.get('/:id', recruteurs, async (req: AuthRequest, res: Response) => {
  const data = await service.detail(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

/** Prendre le dossier en charge. */
router.post('/:id/analyse', recruteurs, async (req: AuthRequest, res: Response) => {
  const data = await service.mettreEnAnalyse(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

/**
 * Valider : le compte du livreur nait ici. Le mot de passe temporaire n'est
 * dans la reponse que s'il n'a pas pu partir par courriel.
 */
router.post('/:id/validation', recruteurs, async (req: AuthRequest, res: Response) => {
  const data = await service.valider(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

/** Refuser, avec un motif que le candidat recevra tel quel. */
router.post(
  '/:id/refus',
  recruteurs,
  validateBody(refusDemandeAgrementSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await service.refuser(req.user!, req.params['id'] as string, req.body.motif);
    res.json({ success: true, data });
  },
);

export default router;
