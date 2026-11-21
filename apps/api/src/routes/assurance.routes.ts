import { NextFunction, Request, Router, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import * as assurance from '../services/assurance.service';
import * as personnes from '../services/personne-assuree.service';
import { corpsJsonMultipart, recevoirPiecesAgrement, uploadPhotoAssure } from '../middlewares/upload.middleware';
import type { FichierRecu } from '../services/piece-agrement.service';
import { ValidationError } from '../utils/app-error';
import {
  creerAssuranceSchema,
  creerReglementSchema,
  creerRegleCouvertureSchema,
  simulerPriseEnChargeSchema,
  verifierEligibiliteSchema,
  verifierCarteAssuranceSchema,
  creerContratCollectifSchema,
  creerContratIndividuelSchema,
  creerAdhesionAssuranceSchema,
  terminerAdhesionSchema,
  renouvelerContratSchema,
  creerReglePoliceSchema,
  ajouterTravailleurSchema,
  assurerPersonneSchema,
  modifierPersonneAssureeSchema,
  importerTravailleursSchema,
} from '../validators/api.schemas';
import type {
  CreationAssuranceView,
  AssureView,
  AssureurView,
  MonAssureurView,
  ReglementView,
  SituationPharmacieView,
  ContratAssuranceView,
  ControleEligibiliteView,
  PriseEnChargeView,
  AdhesionAssuranceView,
  CarteAssuranceView,
  CarteAssuranceVerifieeView,
  ContratCollectifView,
  PatientAssureurRechercheView,
  RegleCouvertureView,
  PersonneAssureeView,
  PersonneEnregistreeView,
  RapportImportTravailleursView,
} from '@baobaoheath/shared-types';

/**
 * Assurance et tiers payant (EF-09, addendum du 2026-09-28 point 5).
 *
 * Deux publics, deux niveaux de droits :
 *
 *   - **le comptoir** (pharmacie, accueil) controle l'eligibilite et chiffre
 *     une prise en charge. Il ne cree ni assureur ni contrat ;
 *   - **l'administration nationale** saisit les assureurs, leurs regles de
 *     couverture et les contrats, tant que les echanges automatiques avec les
 *     assureurs (EF-09-02) ne sont pas conventionnes.
 */
const router = Router();

router.use(authenticate);

/**
 * Une photo d'identite : jamais mise en cache, ni par le navigateur ni par un
 * intermediaire. Elle ne doit pas survivre a l'ecran qui l'a demandee.
 */
function envoyerPhoto(res: Response, image: Buffer) {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'no-store, private');
  res.send(image);
}

/** Recoit la photo envoyee, et traduit les refus de multer en erreurs lisibles. */
function recevoirPhoto(req: Request, res: Response, next: NextFunction) {
  uploadPhotoAssure(req, res, (err: unknown) => {
    if (err) {
      next(new ValidationError(
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Image trop volumineuse (5 Mo maximum).'
          : err instanceof Error ? err.message : 'Échec du téléversement.'
      ));
      return;
    }
    next();
  });
}

// ── Le comptoir ──────────────────────────────────────────────────────

/**
 * Controle d'eligibilite. La reponse est **enregistree** : c'est elle qui
 * justifiera le tiers payant si l'assureur le conteste (point 5.1).
 */
router.post(
  '/eligibilite',
  requireRole('PHARMACIEN', 'AGENT_ACCUEIL', 'ADMIN_STRUCTURE'),
  validateBody(verifierEligibiliteSchema),
  async (req: AuthRequest, res: Response) => {
    const data: ControleEligibiliteView = await assurance.verifierEligibilite(req.user!, req.body.idPatient);
    res.status(201).json({ success: true, data });
  }
);

router.get(
  '/patients/:id/eligibilite',
  requireRole('PHARMACIEN', 'AGENT_ACCUEIL', 'ADMIN_STRUCTURE'),
  async (req: AuthRequest, res: Response) => {
    const data: ControleEligibiliteView[] = await assurance.historiqueEligibilite(
      req.user!,
      req.params['id'] as string
    );
    res.json({ success: true, data });
  }
);

/**
 * Controle sur la carte d'assurance scannee : la pharmacie ne recherche que
 * la couverture du beneficiaire present, jamais la liste des assures. La
 * reponse est enregistree, refus compris.
 */
router.post(
  '/cartes/verifier',
  requireRole('PHARMACIEN', 'AGENT_ACCUEIL'),
  validateBody(verifierCarteAssuranceSchema),
  async (req: AuthRequest, res: Response) => {
    const data: CarteAssuranceVerifieeView = await assurance.verifierCarteAssurance(req.user!, req.body.jetonCarte);
    res.status(201).json({ success: true, data });
  }
);

/**
 * La photo de la carte presentee, pour la comparer a la personne au comptoir.
 * POST et non GET : le jeton de la carte ne doit pas apparaitre dans une URL,
 * donc dans les journaux.
 */
router.post(
  '/cartes/photo',
  requireRole('PHARMACIEN', 'AGENT_ACCUEIL'),
  validateBody(verifierCarteAssuranceSchema),
  async (req: AuthRequest, res: Response) => {
    envoyerPhoto(res, await personnes.photoPourComptoir(req.user!, req.body.jetonCarte));
  }
);

/**
 * Chiffre une prise en charge **sans rien enregistrer**, pour que le comptoir
 * la montre avant le paiement : « un reste a charge sans explication se
 * conteste au comptoir » (point 5.4).
 */
router.post(
  '/simulation',
  requireRole('PHARMACIEN', 'AGENT_ACCUEIL'),
  validateBody(simulerPriseEnChargeSchema),
  async (req: AuthRequest, res: Response) => {
    const data: PriseEnChargeView = await assurance.simulerPriseEnCharge(
      req.user!,
      req.body.jetonCarteAssurance,
      req.body.lignes,
      req.body.montantNetGnf
    );
    res.json({ success: true, data });
  }
);

// ── Le patient ───────────────────────────────────────────────────────

/** Les cartes d'assurance du patient connecte, a afficher, telecharger ou imprimer. */
router.get('/mes-cartes', requireRole('PATIENT'), async (req: AuthRequest, res: Response) => {
  const data: CarteAssuranceView[] = await assurance.mesCartesAssurance(req.user!.userId);
  res.json({ success: true, data });
});

/** La photo de sa propre carte. */
router.post(
  '/mes-cartes/photo',
  requireRole('PATIENT'),
  validateBody(verifierCarteAssuranceSchema),
  async (req: AuthRequest, res: Response) => {
    envoyerPhoto(res, await personnes.photoPourPatient(req.user!.userId, req.body.jetonCarte));
  }
);

// ── L'administration ─────────────────────────────────────────────────

router.get(
  '/assureurs',
  requireRole('ADMIN_NATIONAL', 'SUPER_ADMIN', 'PHARMACIEN', 'ADMIN_STRUCTURE'),
  async (req: AuthRequest, res: Response) => {
    const data: AssureurView[] = ['PHARMACIEN', 'ADMIN_STRUCTURE'].includes(req.user!.role)
      ? await assurance.conventionsDeLaStructure(req.user!)
      : await assurance.listerAssureursAdmin();
    res.json({ success: true, data });
  }
);

router.get(
  '/assureurs/catalogue',
  requireRole('ADMIN_STRUCTURE', 'PHARMACIEN'),
  async (req: AuthRequest, res: Response) => {
    const data = await assurance.configurationCatalogueAssureurs(req.user!);
    res.json({ success: true, data });
  }
);

router.post(
  '/assureurs/:id/convention',
  requireRole('ADMIN_STRUCTURE', 'PHARMACIEN'),
  async (req: AuthRequest, res: Response) => {
    await assurance.ajouterConventionAssureur(req.user!, req.params['id'] as string);
    res.status(201).json({ success: true, message: 'Convention assureur activee pour la structure' });
  }
);

router.delete(
  '/assureurs/:id/convention',
  requireRole('ADMIN_STRUCTURE', 'PHARMACIEN'),
  async (req: AuthRequest, res: Response) => {
    await assurance.retirerConventionAssureur(req.user!, req.params['id'] as string);
    res.json({ success: true, message: 'Convention assureur retiree de la structure' });
  }
);

/**
 * Creer une compagnie d'assurance en une fois : structure, dossier, compagnie
 * et compte du responsable, dans une seule transaction.
 *
 * C'est le chemin normal. Multipart, comme toute creation qui porte un
 * dossier : `multer` lit le corps, `corpsJsonMultipart` remet a sa place
 * l'objet envoye dans `donnees` (le responsable y est imbrique), puis
 * seulement la validation. Le mot de passe temporaire n'est rendu qu'ici, une
 * fois.
 */
router.post(
  '/compagnies',
  requireRole('ADMIN_NATIONAL', 'SUPER_ADMIN'),
  recevoirPiecesAgrement,
  corpsJsonMultipart,
  validateBody(creerAssuranceSchema),
  async (req: AuthRequest, res: Response) => {
    const fichiers = (req.files ?? []) as FichierRecu[];
    const data: CreationAssuranceView = await assurance.creerAssuranceAvecResponsable(req.body, fichiers);
    res.status(201).json({ success: true, data, message: `Compagnie ${data.assureur.code} creee` });
  }
);

/**
 * Ajoute une regle de couverture. Elle ne remplace pas la precedente : sa
 * date d'effet decide, et le calcul retient celle en vigueur a la date de la
 * vente (EF-09-03).
 */
router.post(
  '/assureurs/:id/regles',
  requireRole('ADMIN_NATIONAL', 'SUPER_ADMIN'),
  validateBody(creerRegleCouvertureSchema),
  async (req: AuthRequest, res: Response) => {
    const data: AssureurView = await assurance.ajouterRegle(req.params['id'] as string, req.body);
    res.status(201).json({ success: true, data, message: 'Regle de couverture ajoutee' });
  }
);

// ── L'espace de l'assureur (addendum, point 5.2) ─────────────────────
//
// **Aucune de ces routes ne prend d'identifiant de compagnie.** Elle se deduit
// de la structure de l'agent connecte : l'accepter en parametre laisserait un
// agent de la SONAG lire la situation d'un concurrent en changeant un chiffre
// dans l'URL.
//
// **Rien de medical n'en sort.** Des montants, des comptes et des noms
// d'assures — jamais un produit delivre ni une ordonnance. Un assureur qui
// lirait ce qu'on soigne pourrait refuser un contrat dessus.

router.get('/moi', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const data: MonAssureurView = await assurance.monAssureur(req.user!);
  res.json({ success: true, data });
});

router.get('/moi/assures', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const data: AssureView[] = await assurance.mesAssures(req.user!);
  res.json({ success: true, data });
});

/**
 * La situation par officine : ce qui a ete delivre, ce qui est facture, ce qui
 * est paye, ce qui reste du.
 */
router.get('/moi/pharmacies', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const data: SituationPharmacieView[] = await assurance.mesPharmacies(req.user!);
  res.json({ success: true, data });
});

// ── Les contrats de la compagnie (lot assurance) ──────────────────────

/** Retrouver la personne a rattacher, par son telephone exact uniquement. */
router.get('/moi/patients', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const telephone = typeof req.query['telephone'] === 'string' ? req.query['telephone'] : '';
  const data: PatientAssureurRechercheView[] = await assurance.rechercherPatientParTelephone(req.user!, telephone);
  res.json({ success: true, data });
});

router.post(
  '/moi/contrats',
  requireRole('ASSUREUR'),
  validateBody(creerContratIndividuelSchema),
  async (req: AuthRequest, res: Response) => {
    const data: ContratAssuranceView = await assurance.creerContratIndividuel(req.user!, req.body);
    res.status(201).json({ success: true, data, message: `Police ${data.numeroPolice} enregistree` });
  }
);

router.get('/moi/contrats-collectifs', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const data: ContratCollectifView[] = await assurance.listerContratsCollectifs(req.user!);
  res.json({ success: true, data });
});

router.post(
  '/moi/contrats-collectifs',
  requireRole('ASSUREUR'),
  validateBody(creerContratCollectifSchema),
  async (req: AuthRequest, res: Response) => {
    const data: ContratCollectifView = await assurance.creerContratCollectif(req.user!, req.body);
    res.status(201).json({ success: true, data, message: `Contrat ${data.numeroContrat} enregistre` });
  }
);

router.post(
  '/moi/contrats-collectifs/:id/renouveler',
  requireRole('ASSUREUR'),
  validateBody(renouvelerContratSchema),
  async (req: AuthRequest, res: Response) => {
    const data: ContratCollectifView = await assurance.renouvelerContratCollectif(
      req.user!, req.params['id'] as string, req.body,
    );
    res.json({ success: true, data, message: `Contrat ${data.numeroContrat} renouvele` });
  }
);

router.get(
  '/moi/contrats-collectifs/:id/adhesions',
  requireRole('ASSUREUR'),
  async (req: AuthRequest, res: Response) => {
    const data: AdhesionAssuranceView[] = await assurance.listerAdhesions(req.user!, req.params['id'] as string);
    res.json({ success: true, data });
  }
);

router.post(
  '/moi/contrats-collectifs/:id/adhesions',
  requireRole('ASSUREUR'),
  validateBody(creerAdhesionAssuranceSchema),
  async (req: AuthRequest, res: Response) => {
    const data: AdhesionAssuranceView = await assurance.ajouterAdhesion(
      req.user!, req.params['id'] as string, req.body,
    );
    res.status(201).json({ success: true, data, message: `Beneficiaire ${data.patient.prenom} ${data.patient.nom} ajoute` });
  }
);

/** Fin d'une adhesion : date d'effet, motif et auteur sont conserves. */
router.post(
  '/moi/adhesions/:id/fin',
  requireRole('ASSUREUR'),
  validateBody(terminerAdhesionSchema),
  async (req: AuthRequest, res: Response) => {
    const data: AdhesionAssuranceView = await assurance.terminerAdhesion(
      req.user!, req.params['id'] as string, req.body,
    );
    res.json({ success: true, data, message: "Fin d'adhesion enregistree" });
  }
);

/** Un taux, une exclusion ou un plafond propre a une police. */
router.post(
  '/moi/polices/regles',
  requireRole('ASSUREUR'),
  validateBody(creerReglePoliceSchema),
  async (req: AuthRequest, res: Response) => {
    const data: RegleCouvertureView = await assurance.ajouterReglePolice(req.user!, req.body);
    res.status(201).json({ success: true, data, message: 'Regle de la police ajoutee' });
  }
);

// ── Les personnes assurees : fiche d'identite et photo ───────────────

/** Ajouter un travailleur a un contrat d'entreprise : fiche, compte et adhesion. */
router.post(
  '/moi/contrats-collectifs/:id/travailleurs',
  requireRole('ASSUREUR'),
  validateBody(ajouterTravailleurSchema),
  async (req: AuthRequest, res: Response) => {
    const data: PersonneEnregistreeView = await personnes.ajouterTravailleur(
      req.user!, req.params['id'] as string, req.body,
    );
    res.status(201).json({
      success: true,
      data,
      message: `${data.personne.prenoms} ${data.personne.nom} ajoute au contrat`,
    });
  }
);

/** La liste du personnel en CSV : un rapport ligne par ligne. */
router.post(
  '/moi/contrats-collectifs/:id/import',
  requireRole('ASSUREUR'),
  validateBody(importerTravailleursSchema),
  async (req: AuthRequest, res: Response) => {
    const data: RapportImportTravailleursView = await personnes.importerTravailleurs(
      req.user!, req.params['id'] as string, req.body.contenu,
    );
    res.json({ success: true, data });
  }
);

/** Assurer une personne a titre individuel : fiche, compte et police. */
router.post(
  '/moi/personnes',
  requireRole('ASSUREUR'),
  validateBody(assurerPersonneSchema),
  async (req: AuthRequest, res: Response) => {
    const data: PersonneEnregistreeView = await personnes.assurerPersonne(req.user!, req.body);
    res.status(201).json({ success: true, data, message: `Police ${data.contrat?.numeroPolice ?? ''} enregistree` });
  }
);

router.get('/moi/personnes/:id', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const data: PersonneAssureeView = await personnes.obtenirPersonne(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

router.patch(
  '/moi/personnes/:id',
  requireRole('ASSUREUR'),
  validateBody(modifierPersonneAssureeSchema),
  async (req: AuthRequest, res: Response) => {
    const data: PersonneAssureeView = await personnes.modifierPersonne(req.user!, req.params['id'] as string, req.body);
    res.json({ success: true, data, message: 'Fiche mise a jour' });
  }
);

router.post('/moi/personnes/:id/photo', requireRole('ASSUREUR'), recevoirPhoto, async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new ValidationError('Aucune image reçue.');
  const data: PersonneAssureeView = await personnes.enregistrerPhoto(req.user!, req.params['id'] as string, req.file.buffer);
  res.json({ success: true, data, message: 'Photo enregistree' });
});

router.get('/moi/personnes/:id/photo', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  envoyerPhoto(res, await personnes.photoPourCompagnie(req.user!, req.params['id'] as string));
});

router.get('/moi/reglements', requireRole('ASSUREUR'), async (req: AuthRequest, res: Response) => {
  const data: ReglementView[] = await assurance.mesReglements(req.user!);
  res.json({ success: true, data });
});

router.post(
  '/moi/reglements',
  requireRole('ASSUREUR'),
  validateBody(creerReglementSchema),
  async (req: AuthRequest, res: Response) => {
    const data: ReglementView = await assurance.enregistrerReglement(req.user!, req.body);
    res.status(201).json({
      success: true,
      data,
      message: `Versement de ${data.montantGnf.toLocaleString('fr-FR')} GNF enregistré pour ${data.structure.nom}.`,
    });
  }
);

export default router;
