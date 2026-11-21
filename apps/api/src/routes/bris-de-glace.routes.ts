import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import * as bris from '../services/bris-de-glace.service';
import {
  declarerBrisDeGlaceSchema, filtreBrisDeGlaceSchema, reviserBrisDeGlaceSchema,
} from '../validators/api.schemas';
import type { MotifRefusBrisDeGlace } from '@baobaoheath/shared-types';

/**
 * Bris de glace : l'acces en urgence a un dossier (EF-02-06).
 *
 * **Une porte declaree vaut mieux qu'une porte derobee.** Sans elle, un
 * soignant devant un patient inconscient contournerait la regle autrement —
 * compte prete, mot de passe partage — et rien n'en resterait.
 */
const router = Router();

router.use(authenticate);

/**
 * Ce qu'un refus dit a celui qui le lit.
 *
 * Un code ne lui apprend rien. Chacune de ces phrases dit **ce qu'il peut
 * faire**, parce qu'il a souvent un patient devant lui.
 */
const REFUS: Record<MotifRefusBrisDeGlace, { code: number; message: string }> = {
  PATIENT_INTROUVABLE: { code: 404, message: "Ce dossier patient n'existe pas." },
  BRIS_INTROUVABLE: { code: 404, message: "Cet accès d'urgence n'existe pas." },
  ROLE_NON_AUTORISE: {
    code: 403,
    message: "Seuls les soignants qui prennent en charge le patient peuvent ouvrir un dossier en urgence.",
  },
  SON_PROPRE_DOSSIER: {
    code: 400,
    message: 'Votre propre dossier vous est deja ouvert : il n\'y a pas de vitre a briser.',
  },
  EXPLICATION_TROP_COURTE: {
    code: 400,
    message: "Expliquez la situation en une phrase : c'est elle qui sera relue, et c'est elle qui vous protège.",
  },
  PAS_VOTRE_ACCES: {
    code: 403,
    message: "Seul le soignant qui a ouvert cet accès peut le refermer : il consulte peut-être encore le dossier.",
  },
  DEJA_REFERME: { code: 409, message: 'Cet accès est déjà refermé.' },
  PAS_SON_PROPRE_ACCES: {
    code: 403,
    message: "On ne relit pas son propre accès : un garde-fou qu'on s'applique à soi-même n'en est pas un.",
  },
  DEJA_REVU: { code: 409, message: 'Cet accès a déjà été relu.' },
  AVIS_TROP_COURT: {
    code: 400,
    message: "Dites en une phrase pourquoi l'accès était fondé ou ne l'était pas. Une case cochée ne prouve pas qu'on a regardé.",
  },
};

function repondre(res: Response, r: { refus: MotifRefusBrisDeGlace }): void {
  const { code, message } = REFUS[r.refus];
  res.status(code).json({ success: false, error: message, motif: r.refus });
}

/**
 * Declarer un acces en urgence.
 *
 * **Le patient est prevenu dans la foulee.** C'est ce qui separe cette porte
 * d'une porte derobee. Si la notification echoue, l'acces est quand meme
 * ouvert — il y a un patient inconscient au bout — mais le manque reste
 * visible dans `notifieLe`.
 */
router.post(
  '/',
  requireRole('MEDECIN', 'SAGE_FEMME', 'ASC', 'ASC_SUPERVISOR'),
  validateBody(declarerBrisDeGlaceSchema),
  async (req: AuthRequest, res: Response) => {
    const r = await bris.declarer(req.user!, req.body);
    if ('refus' in r) { repondre(res, r); return; }

    res.status(201).json({
      success: true,
      data: r.bris,
      message: `Dossier de ${r.bris.patient.nomComplet} ouvert jusqu'à `
        + `${new Date(r.bris.expireLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. `
        + (r.bris.notifieLe
          ? 'Le patient en a été informé, et cet accès sera relu.'
          : "Le patient n'a pas pu être informé — cela figure au dossier. Cet accès sera relu."),
    });
  }
);

/** Refermer avant l'heure, quand on n'a plus besoin du dossier. */
router.post(
  '/:id/refermer',
  requireRole('MEDECIN', 'SAGE_FEMME', 'ASC', 'ASC_SUPERVISOR'),
  async (req: AuthRequest, res: Response) => {
    const r = await bris.refermer(req.user!, req.params['id'] as string);
    if ('refus' in r) { repondre(res, r); return; }
    res.json({ success: true, data: r.bris, message: "Accès refermé." });
  }
);

/**
 * La liste.
 *
 * Un soignant ne voit que les siens ; l'administration voit tout, parce que
 * c'est elle qui relit. **Un garde-fou que personne ne relit n'est pas un
 * garde-fou.**
 */
router.get(
  '/',
  validateQuery(filtreBrisDeGlaceSchema),
  async (req: AuthRequest, res: Response) => {
    const q = req.query as { idPatient?: string; aRevoirSeulement?: string };
    const relecteur = ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN']
      .includes(req.user!.role);

    const data = await bris.lister({
      // Un soignant ne voit que ses propres acces : la liste complete est un
      // outil de controle, pas un annuaire des urgences des autres.
      idAuteur: relecteur ? undefined : req.user!.userId,
      idPatient: q.idPatient,
      aRevoirSeulement: q.aRevoirSeulement === 'true',
    });
    res.json({ success: true, data });
  }
);

/**
 * Rendre une revue.
 *
 * Un avis ecrit est exige **meme pour dire que l'acces etait fonde** : une
 * case cochee sans phrase ne prouve pas que quelqu'un a regarde.
 */
router.post(
  '/:id/reviser',
  requireRole('ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'),
  validateBody(reviserBrisDeGlaceSchema),
  async (req: AuthRequest, res: Response) => {
    const r = await bris.reviser(req.user!, req.params['id'] as string, req.body);
    if ('refus' in r) { repondre(res, r); return; }
    res.json({
      success: true,
      data: r.bris,
      message: r.bris.statutRevue === 'JUSTIFIE'
        ? "Accès jugé fondé. L'avis reste au dossier."
        : "Accès jugé non fondé. L'avis reste au dossier ; les suites se décident ailleurs.",
    });
  }
);

export default router;
