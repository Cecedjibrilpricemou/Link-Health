// Les demandes d'agrement : le depot par le candidat, l'examen par
// l'administration.
//
// **Une seule route de ce fichier est publique** : le depot. Elle est la seule
// de l'API qui ecrive en base et sur le disque sans aucun compte derriere,
// d'ou le limiteur de debit pose sur elle dans `index.ts` - plus serre que
// celui de l'API, parce qu'un depot coute dix fichiers de cinq megaoctets.
//
// Les pieces deposees se consultent par `GET /admin-structure/pieces/:id`,
// qui existait deja et verifie les droits : l'administration nationale lit
// tout, une structure ne lit que les siennes, et une piece de demande - qui
// n'a pas encore de structure - n'est donc lisible que par l'administration.
// En ouvrir une seconde ici aurait dedouble la regle d'acces, donc le risque
// de la voir diverger.
import { Router, type Request, type Response } from 'express';

import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { corpsJsonMultipart, recevoirPiecesAgrement } from '../middlewares/upload.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import * as service from '../services/demande-agrement.service';
import type { FichierRecu } from '../services/piece-agrement.service';
import {
  demandeAgrementSchema,
  motifDemandeAgrementSchema,
  refusDemandeAgrementSchema,
  validationDemandeAgrementSchema,
} from '../validators/api.schemas';

const router = Router();

/**
 * Ce que le formulaire doit reclamer, par type d'etablissement.
 *
 * Publique et sans compte, comme le formulaire qui la lit. L'ecran pourrait
 * recopier cette liste dans son code - et elle finirait par mentir le jour ou
 * l'administration exigera une piece de plus. Elle vient donc d'ici.
 */
router.get('/pieces-attendues', (_req: Request, res: Response) => {
  const data = service.TYPES_AVEC_DOSSIER.map((type) => ({
    type,
    // Tous les types qui produisent un dossier sont la, pas seulement ceux
    // qui se demandent : l'ecran d'administration cree aussi des postes et
    // des centres, et doit lire la meme liste que le formulaire public.
    demandable: service.TYPES_DEMANDE.includes(type),
    estPublique: service.estStructurePublique(type),
    pieces: service.piecesDemandeesPour(type).map((piece) => ({
      type: piece,
      libelle: service.libellePiece(type, piece),
    })),
  }));
  res.json({ success: true, data });
});

/**
 * Deposer une demande. **Sans compte : c'est tout l'objet de cette porte.**
 *
 * L'ordre des middlewares est celui de la creation administrative, et pour la
 * meme raison : `multer` seul sait lire un corps `multipart/form-data`, puis
 * `corpsJsonMultipart` remet a sa place l'objet envoye dans le champ
 * `donnees` - un corps multipart ne porte que des chaines plates, donc pas
 * d'objet `responsable` imbrique -, puis seulement la validation du schema.
 */
router.post(
  '/',
  recevoirPiecesAgrement,
  corpsJsonMultipart,
  validateBody(demandeAgrementSchema),
  async (req: Request, res: Response) => {
    const fichiers = (req.files ?? []) as FichierRecu[];
    const libelles = (req.body ?? {}) as Record<string, string | undefined>;
    const data = await service.deposer(req.body, fichiers, libelles);
    res.status(201).json({ success: true, data });
  },
);

// ── L'examen, reserve a l'administration nationale ───────────────

router.use(authenticate);

/** La liste, filtrable par etat : `?statut=RECUE`, ou rien pour tout voir. */
router.get('/', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'), async (req: AuthRequest, res: Response) => {
  const data = await service.lister(req.query['statut'] as string | undefined);
  res.json({ success: true, data });
});

/** Le dossier complet, avec ses pieces et ce qui manque. */
router.get('/:id', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'), async (req: AuthRequest, res: Response) => {
  const data = await service.detail(req.params['id'] as string);
  res.json({ success: true, data });
});

/**
 * Mettre le dossier en cours de verification, avec un motif envoye au
 * candidat.
 *
 * Sans ce geste, deux agents instruisent le meme dossier sans le savoir, et
 * le candidat qui rappelle s'entend dire que son dossier « est en attente »
 * alors qu'il est sur un bureau. Le motif lui dit ce qui est verifie, ou ce
 * qu'on attend de lui.
 */
router.post(
  '/:id/analyse',
  requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'),
  validateBody(motifDemandeAgrementSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await service.mettreEnAnalyse(req.user!, req.params['id'] as string, req.body.motif);
    res.json({ success: true, data });
  },
);

/**
 * Valider, avec un motif : la structure et le compte de son responsable
 * naissent ici - et pour une assurance, la compagnie, au code eventuellement
 * corrige par l'administration.
 *
 * Le mot de passe temporaire part par courriel au responsable, avec le motif.
 * Il n'est **jamais** dans cette reponse : l'agent qui valide n'a aucune
 * raison de connaitre le mot de passe d'un tiers.
 */
router.post(
  '/:id/validation',
  requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'),
  validateBody(validationDemandeAgrementSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await service.valider(
      req.user!,
      req.params['id'] as string,
      req.body.motif,
      req.body.codeAssureur,
    );
    res.json({ success: true, data });
  },
);

/** Refuser, avec un motif que le candidat recevra tel quel. */
router.post(
  '/:id/refus',
  requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'),
  validateBody(refusDemandeAgrementSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await service.refuser(req.user!, req.params['id'] as string, req.body.motif);
    res.json({ success: true, data });
  },
);

export default router;
