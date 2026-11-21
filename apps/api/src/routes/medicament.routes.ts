import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import * as pharmacienService from '../services/pharmacien.service';

/**
 * Catalogue des medicaments prescriptibles, en lecture seule.
 *
 * La seule liste existante etait GET /pharmacien/medicaments, reservee au role
 * PHARMACIEN : l'agent de sante qui redige une ordonnance depuis la fiche de
 * consultation n'avait aucun moyen de choisir un medicament. Le catalogue ne
 * contient aucune donnee patient, il est donc ouvert aux roles soignants.
 *
 * Depuis le 2026-10-01 le catalogue de l'officine contient aussi des articles
 * non medicamenteux. Cette route n'en rend aucun : un ecran de prescription
 * qui propose du lait infantile fait perdre son temps au prescripteur, et
 * l'API refuserait de toute facon.
 */
const router = Router();

router.use(authenticate);

router.get(
  '/',
  requireRole('ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'PHARMACIEN', 'ADMIN_STRUCTURE'),
  async (_req: AuthRequest, res: Response) => {
    const data = await pharmacienService.getMedicamentsPrescriptibles();
    res.json({ success: true, data });
  }
);

export default router;
