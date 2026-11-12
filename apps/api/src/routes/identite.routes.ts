import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import * as identite from '../services/identite.service';
import * as doublon from '../services/doublon.service';
import * as fusion from '../services/fusion.service';
import {
  annulerFusionSchema, corrigerIdentiteSchema, filtreIdentitesSchema, fusionnerSchema, noterTraitsSchema,
  verifierIdentiteSchema,
} from '../validators/api.schemas';
import type {
  IdentitePatientView, MotifRefusFusion, NiveauIdentite,
} from '@baobaoheath/shared-types';

/**
 * Verification d'identite au comptoir (EF-01-04/10).
 *
 * Reserve a l'accueil et a l'administration de structure. Ce n'est ni un acte
 * medical ni un acte d'administration nationale : c'est le geste de celui qui
 * recoit le patient et regarde sa piece.
 *
 * **Ce que ces routes ouvrent** : le tiers payant, et plus tard la delivrance
 * de produits reglementes. **Pas les soins** — un patient a l'identite
 * provisoire est consulte, suivi et prescrit normalement.
 */
/**
 * Ce qu'un refus de fusion dit a l'agent.
 *
 * Un code d'erreur ne lui apprend rien. Chacune de ces phrases dit **ce qu'il
 * peut faire** : c'est lui qui a les deux dossiers sous les yeux.
 */
const REFUS_FUSION: Record<MotifRefusFusion, { code: number; message: string }> = {
  DOSSIER_INTROUVABLE: { code: 404, message: "L'un des deux dossiers n'existe pas." },
  FUSION_INTROUVABLE: { code: 404, message: "Cette fusion n'existe pas." },
  MEME_DOSSIER: { code: 400, message: 'Un dossier ne se fusionne pas avec lui-meme.' },
  MOTIF_TROP_COURT: {
    code: 400,
    message: 'Dites en une phrase sur quoi vous vous fondez : c\'est ce qui permettra de contester la fusion plus tard.',
  },
  DEJA_FUSIONNE: {
    code: 409,
    message: "L'un des deux dossiers est deja fusionne. Fusionnez dans le dossier qui survit, pas dans celui qui a ete absorbe.",
  },
  DEUX_PIECES_DIFFERENTES: {
    code: 409,
    message: 'Les deux identites sont verifiees, sur deux pieces differentes. Ou bien ce sont deux personnes, ou bien une verification est fausse : reprenez la piece avant de fusionner.',
  },
  DEJA_ANNULEE: { code: 409, message: 'Cette fusion a deja ete annulee.' },
};

const router = Router();

router.use(authenticate);
router.use(requireRole('AGENT_ACCUEIL', 'ADMIN_STRUCTURE'));

/**
 * Les doublons possibles d'un dossier (EF-01-05).
 *
 * **Ce ne sont pas des verdicts.** Aucune fusion n'est automatique : un agent
 * decide. Fusionner deux personnes distinctes melange leurs dossiers
 * medicaux, ce qui est bien plus dangereux que de laisser un doublon.
 *
 * Declaree avant `/:id/...` pour rester lisible.
 */
router.get('/:id/doublons', async (req: AuthRequest, res: Response) => {
  const data = await doublon.pourPatient(req.user!, req.params['id'] as string);
  // Un dossier introuvable n'a pas « aucun doublon » : il n'existe pas. Rendre
  // une liste vide ferait lire a l'agent une affirmation fausse.
  if (data === null) {
    res.status(404).json({ success: false, error: 'Dossier patient introuvable' });
    return;
  }
  res.json({ success: true, data });
});

/**
 * Fusionner un dossier dans un autre (EF-01-06).
 *
 * **Reserve a `ADMIN_STRUCTURE`**, et non a l'accueil. Verifier une piece est
 * le geste de celui qui recoit le patient ; melanger deux dossiers medicaux
 * ne l'est pas. L'allergie notee d'un cote devient celle de l'autre, et
 * personne ne s'en apercoit avant une prescription.
 *
 * `:id` est le dossier **qui survit**. C'est l'agent qui le choisit : lui seul
 * sait lequel des deux porte l'histoire la plus complete.
 */
router.post(
  '/:id/fusionner',
  requireRole('ADMIN_STRUCTURE'),
  validateBody(fusionnerSchema),
  async (req: AuthRequest, res: Response) => {
    const { idAbsorbe, motif } = req.body as { idAbsorbe: string; motif: string };
    const r = await fusion.fusionner(req.user!, req.params['id'] as string, idAbsorbe, motif);

    if ('refus' in r) {
      const { code, message } = REFUS_FUSION[r.refus];
      res.status(code).json({ success: false, error: message, motif: r.refus });
      return;
    }

    const bouge = r.fusion.lignes.reduce((n, l) => n + l.nombre, 0);
    res.json({
      success: true,
      data: r.fusion,
      message: `Dossier de ${r.fusion.absorbe.nomComplet} fusionne dans celui de `
        + `${r.fusion.principal.nomComplet}. ${bouge} ligne(s) deplacee(s). `
        + `Le dossier absorbe est conserve et la fusion peut etre annulee.`,
    });
  }
);

/**
 * Defaire une fusion.
 *
 * **C'est ce qui rend la fusion acceptable.** On ne remet pas « ce qui devrait
 * etre » : on relit la liste de ce qui a ete deplace et on le rend. Ce qui a
 * ete ajoute au dossier survivant depuis la fusion lui reste.
 */
router.post(
  '/fusions/:idFusion/annuler',
  requireRole('ADMIN_STRUCTURE'),
  validateBody(annulerFusionSchema),
  async (req: AuthRequest, res: Response) => {
    const { motifAnnulation } = req.body as { motifAnnulation: string };
    const r = await fusion.annuler(req.user!, req.params['idFusion'] as string, motifAnnulation);

    if ('refus' in r) {
      const { code, message } = REFUS_FUSION[r.refus];
      res.status(code).json({ success: false, error: message, motif: r.refus });
      return;
    }

    res.json({
      success: true,
      data: r.fusion,
      message: `Fusion annulee. Le dossier de ${r.fusion.absorbe.nomComplet} a retrouve ce qui lui appartenait.`,
    });
  }
);

/** L'historique des fusions d'un dossier, annulations comprises. */
router.get('/:id/fusions', async (req: AuthRequest, res: Response) => {
  const data = await fusion.pourPatient(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

/** Les patients et leur identite. Les provisoires d'abord : c'est le travail. */
router.get('/', validateQuery(filtreIdentitesSchema), async (req: AuthRequest, res: Response) => {
  const q = req.query as { q?: string; niveau?: NiveauIdentite };
  const data: IdentitePatientView[] = await identite.rechercher(req.user!, q);
  res.json({ success: true, data });
});

/**
 * Enregistrer une piece vue.
 *
 * L'agent declare avoir vu le document et dit lequel. Le numero est exige :
 * une verification qui ne peut pas nommer le document sur lequel elle se fonde
 * n'est ni verifiable ni contestable.
 */
router.post('/:id/verifier', validateBody(verifierIdentiteSchema), async (req: AuthRequest, res: Response) => {
  const data = await identite.verifier(req.user!, req.params['id'] as string, req.body);
  res.json({
    success: true,
    data,
    message: `Identite de ${data.nomComplet} verifiee. Le tiers payant est desormais ouvert pour ce patient.`,
  });
});

/**
 * Noter un trait distinctif sans verifier.
 *
 * Au telephone ou sur declaration, un agent peut recueillir le lieu de
 * naissance et le nom de la mere sans piece. Ces traits servent la detection
 * de doublons, qui n'attend pas une verification pour etre utile.
 */
router.post('/:id/traits', validateBody(noterTraitsSchema), async (req: AuthRequest, res: Response) => {
  const data = await identite.noterTraits(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data, message: 'Traits distinctifs enregistres.' });
});

/**
 * R15 : corriger le sexe, la date de naissance, le prenom ou le nom, avec un
 * motif. Chaque trait corrige garde son ancienne valeur et son auteur.
 */
router.post('/:id/corriger', validateBody(corrigerIdentiteSchema), async (req: AuthRequest, res: Response) => {
  const data = await identite.corrigerIdentite(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data, message: `Identite de ${data.nomComplet} corrigee.` });
});

router.get('/:id/corrections', async (req: AuthRequest, res: Response) => {
  const data = await identite.historiqueCorrections(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

export default router;
