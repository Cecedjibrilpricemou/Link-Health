// src/routes/recherche.routes.ts
// A1 : la recherche publique de produits, sans compte.
//
// **Aucune authentification, et c'est le but** : quelqu'un qui cherche un
// medicament la nuit ne va pas d'abord creer un compte. La limitation de
// debit generale de /api/v1 s'applique.
//
// Cette route n'est volontairement pas journalisee (voir l'en-tete du
// service) : ce qu'une personne cherche en pharmacie revele souvent ce dont
// elle souffre.
import { Router, Request, Response } from 'express';
import { validateQuery } from '../middlewares/validate.middleware';
import { cataloguePharmacieSchema, rechercheProduitsSchema } from '../validators/api.schemas';
import { catalogueDe, chercherProduits } from '../services/recherche.service';
import type { PharmacieDetailView, RechercheProduitsView } from '@baobaoheath/shared-types';

const router = Router();

router.get('/produits', validateQuery(rechercheProduitsSchema), async (req: Request, res: Response) => {
  const { q, prefecture, commune } = req.query as {
    q: string;
    prefecture?: string;
    commune?: string;
  };
  const resultat = await chercherProduits({ q, prefecture, commune });
  const data: RechercheProduitsView = {
    zoneUtilisee: resultat.zoneUtilisee,
    prefecture: resultat.prefecture,
    commune: resultat.commune,
    communesVoisines: resultat.communesVoisines,
    pharmaciesTrouvees: resultat.pharmaciesTrouvees,
    produits: resultat.produits.map((p) => ({
      ...p,
      declareLe: p.declareLe.toISOString(),
      pharmacies: p.pharmacies.map((ph) => ({
        ...ph,
        declareLe: ph.declareLe.toISOString(),
      })),
    })),
  };
  res.json({ success: true, data });
});

/**
 * A3 : la page d'une officine. Adresse publique et partageable : on envoie le
 * lien a quelqu'un pour lui dire ou aller chercher son traitement.
 */
router.get('/pharmacies/:id', validateQuery(cataloguePharmacieSchema), async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  const id = req.params['id'];
  const officine = await catalogueDe(typeof id === 'string' ? id : '', q);
  const data: PharmacieDetailView = {
    ...officine,
    produits: officine.produits.map((p) => ({ ...p, declareLe: p.declareLe.toISOString() })),
  };
  res.json({ success: true, data });
});

export default router;
