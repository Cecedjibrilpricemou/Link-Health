// src/routes/commande.routes.ts
// P6 / EF-07 — appel aux pharmacies et attribution de la commande.
// Processus : docs/PARCOURS-COMMANDE-LIVRAISON.md
import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireOfficineRole, requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import * as commande from '../services/commande.service';
import * as paiement from '../services/paiement.service';
import {
  annulerCommandeSchema,
  choisirModeRemiseSchema,
  encaisserCommandeSchema,
  lancerRechercheSchema,
  payerCommandeSchema,
  propositionPartielleSchema,
  repondreDisponibiliteSchema,
  reponsePartielleSchema,
  retirerPriseEnChargeSchema,
} from '../validators/api.schemas';

const router = Router();
const requirePersonnelClinique = requireOfficineRole('TITULAIRE', 'ADJOINT', 'PREPARATEUR');

router.use(authenticate);

/**
 * Lance la recherche d'une pharmacie pour une ordonnance signee. Reserve aux
 * prescripteurs : l'accueil en a ete retire le 2026-09-28 (addendum, point 9 —
 * « ni prescription, ni ordonnance, ni produit »).
 */
router.post(
  '/',
  requireRole('MEDECIN', 'ASC', 'ASC_SUPERVISOR'),
  validateBody(lancerRechercheSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.lancerRecherchePharmacie(req.body.idOrdonnance);
    res.status(201).json({ success: true, data });
  }
);

/** La file du comptoir : les appels du quartier, et ce que la pharmacie a pris. */
router.get('/pharmacie', requireRole('PHARMACIEN'), requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data = await commande.commandesDeLaPharmacie(req.user!);
  res.json({ success: true, data });
});

/**
 * Reponse a l'appel. `aTousLesProduits: true` tente de prendre la commande —
 * l'attribution est atomique, un seul gagnant.
 */
router.post(
  '/:id/disponibilite',
  requireRole('PHARMACIEN'),
  requirePersonnelClinique,
  validateBody(repondreDisponibiliteSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.repondreDisponibilite(
      req.user!,
      String(req.params.id),
      req.body.aTousLesProduits
    );
    res.json({ success: true, data });
  }
);

/**
 * La pharmacie ne detient qu'une partie des produits et propose de la servir.
 * La commande lui est reservee le temps que le patient choisisse.
 */
router.post(
  '/:id/proposition-partielle',
  requireRole('PHARMACIEN'),
  requirePersonnelClinique,
  validateBody(propositionPartielleSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.proposerPrisePartielle(req.user!, String(req.params.id), req.body.lignes);
    res.json({ success: true, data });
  }
);

/**
 * Le patient repond : accepter et relancer le manquant, accepter seul, ou
 * refuser. Rien n'est servi ni paye sans cette reponse.
 */
router.post(
  '/:id/reponse-partielle',
  requireRole('PATIENT'),
  validateBody(reponsePartielleSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.repondrePropositionPartielle(req.user!, String(req.params.id), req.body.reponse);
    res.json({ success: true, data });
  }
);

/** La pharmacie rend la commande : le verrou se rouvre pour les autres. */
router.post(
  '/:id/retirer',
  requireRole('PHARMACIEN'),
  requirePersonnelClinique,
  validateBody(retirerPriseEnChargeSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.retirerPriseEnCharge(req.user!, String(req.params.id), req.body.motif);
    res.json({ success: true, data });
  }
);

/** Le patient choisit retrait ou livraison. La livraison n'est jamais imposee. */
router.post(
  '/:id/mode-remise',
  requireRole('PATIENT'),
  validateBody(choisirModeRemiseSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.choisirModeRemise(req.user!, String(req.params.id), req.body.mode);
    res.json({ success: true, data });
  }
);

// ── La machine a etats : qui fait avancer quoi ───────────────────────
//
// **Chaque geste a son acteur, et un seul.** L'officine chiffre, prepare et
// remet ; le patient paie et peut renoncer. Les gardes de role le disent au
// niveau de la route, et le service verifie en plus que la commande est bien
// celle de cette officine — une garde de role dit « un pharmacien », pas
// « ce pharmacien-la ».

/** L'officine chiffre le panier aux prix de son comptoir (EF-07-02). */
router.post('/:id/chiffrer', requireRole('PHARMACIEN'), requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data = await commande.chiffrerCommande(req.user!, String(req.params.id));
  res.json({ success: true, data });
});

/**
 * Le patient paie son panier.
 *
 * Le montant n'est pas dans le corps : il est fige en base au chiffrage.
 * C'est la facture qui est rendue, avec son lien de paiement — et c'est le
 * rappel de la passerelle qui fera avancer la commande, pas cet appel.
 */
router.post(
  '/:id/payer',
  requireRole('PATIENT'),
  validateBody(payerCommandeSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await paiement.initierPaiementCommande(
      req.user!.userId, String(req.params.id), req.body,
    );
    res.json({ success: true, data });
  }
);

/**
 * L'officine encaisse le panier au comptoir.
 *
 * Les especes ne passent par aucune passerelle : le pharmacien recoit
 * l'argent et le declare. La reference est son numero de recu — ce qui
 * permet de rapprocher la caisse plus tard.
 */
router.post(
  '/:id/encaisser',
  requireRole('PHARMACIEN'),
  requirePersonnelClinique,
  validateBody(encaisserCommandeSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await paiement.encaisserCommandeAuComptoir(
      req.user!, String(req.params.id), req.body.referenceOperateur,
    );
    res.json({ success: true, data });
  }
);

/** L'officine commence a preparer. */
router.post('/:id/preparer', requireRole('PHARMACIEN'), requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data = await commande.marquerEnPreparation(req.user!, String(req.params.id));
  res.json({ success: true, data });
});

/** Le sachet est pret. C'est le mode de remise choisi qui decide de la suite. */
router.post('/:id/prete', requireRole('PHARMACIEN'), requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data = await commande.marquerPrete(req.user!, String(req.params.id));
  res.json({ success: true, data });
});

/** L'officine remet les produits — au patient, ou au motard. */
router.post('/:id/remettre', requireRole('PHARMACIEN'), requirePersonnelClinique, async (req: AuthRequest, res: Response) => {
  const data = await commande.confirmerRemise(req.user!, String(req.params.id));
  res.json({ success: true, data });
});

/**
 * Annuler, avec un motif.
 *
 * Ouvert aux deux : le patient renonce, l'officine decouvre une rupture. Le
 * service verifie que l'appelant a bien affaire a cette commande.
 */
router.post(
  '/:id/annuler',
  requireRole('PATIENT', 'PHARMACIEN'),
  validateBody(annulerCommandeSchema),
  async (req: AuthRequest, res: Response) => {
    const data = await commande.annulerCommande(req.user!, String(req.params.id), req.body.motif);
    res.json({ success: true, data });
  }
);

/** Les commandes du patient connecte : c'est lui qui choisit son mode de remise. */
router.get('/mes-commandes', requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data = await commande.mesCommandes(req.user!);
  res.json({ success: true, data });
});

/**
 * Lire une commande.
 *
 * **Cette route n'avait aucun controle** : n'importe quel compte connecte
 * pouvait lire la commande d'un inconnu, avec son nom et ses medicaments.
 * Quatre lectures sont legitimes — le patient, la pharmacie concernee, le
 * prescripteur, l'administration.
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  await commande.assertPeutLireCommande(req.user!, id);
  const data = await commande.getCommande(id);
  res.json({ success: true, data });
});

export default router;
