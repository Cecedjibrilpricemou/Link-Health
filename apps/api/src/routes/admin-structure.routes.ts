import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { corpsJsonMultipart, recevoirPiecesAgrement } from '../middlewares/upload.middleware';
import * as piecesAgrement from '../services/piece-agrement.service';
import { validateBody } from '../middlewares/validate.middleware';
import { uploadLogo, uploadVisuel } from '../middlewares/upload.middleware';
import * as visuels from '../services/visuels.service';
import * as servicesHospitaliers from '../services/services-hospitaliers.service';
import { uploadLogoController } from '../controllers/upload.controller';
import { ValidationError } from '../utils/app-error';
import * as plateau from '../services/plateau-technique.service';
import type { StructureConseilleeView, StructureRefView } from '@baobaoheath/shared-types';
import * as service from '../services/admin-structure.service';
import * as parametresService from '../services/parametres.service';
import type {
  AgentStructureView,
  CreationAgentView,
  CreationPharmacieView,
  CreationStructureView,
  ParametresSystemeView,
  ParametresVisuelsView,
  ReinitialisationMotDePasseView,
  ServiceHospitalierView,
  StructureAdminView,
  MaStructureView, StatsStructureView,
  StructurePubliqueView,
} from '@baobaoheath/shared-types';
import {
  conseillerStructureSchema,
  createAgentStructureSchema,
  definirBureauSchema,
  createPharmacieSchema,
  createStructureSchema,
  updateParametresSystemeSchema,
  updateStructureSchema,
  definirPartenariatSchema,
  decrireVisuelSchema,
  modifierProfilAgentSchema,
  creerServiceSchema,
  modifierServiceSchema,
} from '../validators/api.schemas';

const router = Router();

router.get('/structures/publiques', async (_req: Request, res: Response) => {
  // Annotation = contrat : un champ retire du select casse ici, au lieu
  // de devenir undefined dans une liste deroulante.
  const data: StructurePubliqueView[] = await service.getStructuresPubliques();
  res.json({ success: true, data });
});

router.use(authenticate);

router.get('/agents', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: AgentStructureView[] = await service.getAgentsStructure(req.user!.userId);
  res.json({ success: true, data });
});

router.get('/pharmacies', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: StructureAdminView[] = await service.getPharmaciesStructure(req.user!.userId);
  res.json({ success: true, data });
});

/**
 * Le carnet d'adresses de l'etablissement : les laboratoires et cliniques
 * qu'il conseille a ses medecins.
 *
 * **Ce n'est pas un contrat.** Celui qui est conseille n'a rien a accepter :
 * la plateforme autorise deja d'adresser une demande a n'importe quel
 * laboratoire. La declaration ne donne aucun droit, elle met en tete de liste.
 */
router.get('/conseillees', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: StructureConseilleeView[] = await plateau.conseillees(req.user!);
  res.json({ success: true, data });
});

/** Ou l'admin choisit : soi-meme et les deja-conseillees en sont retires. */
router.get('/conseillees/candidats', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: StructureRefView[] = await plateau.laboratoiresCandidats(req.user!);
  res.json({ success: true, data });
});

router.post('/conseillees', requireRole('ADMIN_STRUCTURE'), validateBody(conseillerStructureSchema), async (req: AuthRequest, res: Response) => {
  const data: StructureConseilleeView = await plateau.conseiller(req.user!, req.body.idStructureConseillee);
  res.status(201).json({ success: true, data });
});

router.delete('/conseillees/:id', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  await plateau.retirerConseil(req.user!, req.params['id'] as string);
  res.json({ success: true });
});

router.post('/agents', requireRole('ADMIN_STRUCTURE'), validateBody(createAgentStructureSchema), async (req: AuthRequest, res: Response) => {
  const data: CreationAgentView = await service.creerAgent(req.user!.userId, req.body);
  res.status(201).json({ success: true, data });
});

/**
 * Definir — ou effacer — le bureau d'un medecin.
 *
 * **Un bureau change** : un medecin demenage, un service est redecoupe. Figer
 * la valeur a la creation du compte l'aurait rendue fausse en quelques mois,
 * et un bureau faux est pire que pas de bureau : le patient y va.
 *
 * `null` efface, pour l'hopital qui ne numerote pas ses bureaux et ou l'agent
 * accompagne le patient a pied.
 */
router.put('/agents/:id/bureau', requireRole('ADMIN_STRUCTURE'), validateBody(definirBureauSchema), async (req: AuthRequest, res: Response) => {
  const data = await service.definirBureau(
    req.user!,
    req.params['id'] as string,
    (req.body as { bureau: string | null }).bureau,
  );
  res.json({
    success: true,
    data,
    message: data.bureau
      ? `Bureau de ${data.nomComplet} : ${data.bureau}.`
      : `Bureau de ${data.nomComplet} effacé. L'accueil accompagnera le patient.`,
  });
});

router.put('/agents/:id/desactiver', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  await service.desactiverAgent(req.user!.userId, String(req.params.id));
  res.json({ success: true, message: 'Agent desactive' });
});

// ── Les services de l'etablissement ──────────────────────────────────
router.get('/services', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: ServiceHospitalierView[] = await servicesHospitaliers.listerServices(req.user!.userId);
  res.json({ success: true, data });
});

router.post('/services', requireRole('ADMIN_STRUCTURE'), validateBody(creerServiceSchema), async (req: AuthRequest, res: Response) => {
  const data: ServiceHospitalierView = await servicesHospitaliers.creerService(req.user!.userId, req.body.nom);
  res.status(201).json({ success: true, data });
});

// Renommer, fermer ou rouvrir. Un service ne se supprime pas.
router.put('/services/:id', requireRole('ADMIN_STRUCTURE'), validateBody(modifierServiceSchema), async (req: AuthRequest, res: Response) => {
  const data: ServiceHospitalierView = await servicesHospitaliers.modifierService(req.user!.userId, String(req.params.id), req.body);
  res.json({ success: true, data });
});

router.put('/agents/:id/reactiver', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data = await service.reactiverAgent(req.user!.userId, String(req.params.id));
  res.json({ success: true, data, message: `Compte de ${data.nomComplet} réactivé.` });
});

// Le metier d'un medecin : specialite, numero d'ordre.
router.put('/agents/:id/profil', requireRole('ADMIN_STRUCTURE'), validateBody(modifierProfilAgentSchema), async (req: AuthRequest, res: Response) => {
  const data = await service.modifierProfilAgent(req.user!.userId, String(req.params.id), req.body);
  res.json({ success: true, data, message: `Profil de ${data.nomComplet} enregistré.` });
});

// Un mot de passe temporaire, rendu une fois ; ses sessions sont fermees.
router.post('/agents/:id/mot-de-passe', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: ReinitialisationMotDePasseView = await service.reinitialiserMotDePasseAgent(req.user!.userId, String(req.params.id));
  res.json({ success: true, data });
});

/** Ce que le menu doit savoir de la structure : son type, sans statistiques. */
router.get('/ma-structure', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: MaStructureView = await service.maStructure(req.user!.userId);
  res.json({ success: true, data });
});

router.get('/stats', requireRole('ADMIN_STRUCTURE'), async (req: AuthRequest, res: Response) => {
  const data: StatsStructureView = await service.getStatsStructure(req.user!.userId);
  res.json({ success: true, data });
});

// ── Le dossier reglementaire d'une structure ───────────────────────
//
// **Les pieces ne sont pas publiques.** Un agrement porte le nom du
// responsable, parfois son numero de diplome et l'adresse exacte du local. Le
// fichier vit dans `stockage-prive/`, jamais sous `uploads/` qui est servi
// sans authentification, et chaque lecture est journalisee.

/**
 * La structure dont l'appelant repond, pour ouvrir son dossier.
 *
 * Le titulaire d'une officine n'a pas d'espace d'administration de structure :
 * sans cette route, son ecran ne saurait pas quel dossier demander.
 */
router.get('/mon-dossier/structure', requireRole('ADMIN_STRUCTURE', 'PHARMACIEN'), async (req: AuthRequest, res: Response) => {
  const data = await piecesAgrement.maStructure(req.user!);
  res.json({ success: true, data });
});

/**
 * L'etat du dossier : ce qui est depose, ce qui manque.
 *
 * Ouverte au `PHARMACIEN` depuis que le titulaire d'une officine porte ce
 * role et non celui d'administrateur de structure : c'est lui qui renouvelle
 * son agrement. Le service verifie qu'il s'agit bien **de sa** structure, et
 * que le demandeur est le titulaire - l'adjoint et le caissier portent le
 * meme role que lui.
 */
router.get('/structures/:id/dossier', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_STRUCTURE', 'PHARMACIEN'), async (req: AuthRequest, res: Response) => {
  const data = await piecesAgrement.dossierPour(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

/**
 * Deposer ou remplacer des pieces apres la creation.
 *
 * Deux usages : completer le dossier d'une structure anterieure a cette regle,
 * et **remplacer un agrement renouvele** — le ministere prevoit un
 * renouvellement periodique. Le perimetre est verifie dans le service : un
 * administrateur de structure ne depose que pour la sienne.
 */
router.post('/structures/:id/pieces', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_STRUCTURE', 'PHARMACIEN'), recevoirPiecesAgrement, async (req: AuthRequest, res: Response) => {
  const fichiers = (req.files ?? []) as piecesAgrement.FichierRecu[];
  const libelles = (req.body ?? {}) as Record<string, string | undefined>;
  const data = await piecesAgrement.deposerPieces(req.user!, req.params['id'] as string, fichiers, libelles);
  res.status(201).json({ success: true, data });
});

/** Le contenu d'une piece. Jamais une URL devinable : une route gardee. */
router.get('/pieces/:id', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_STRUCTURE', 'PHARMACIEN'), async (req: AuthRequest, res: Response) => {
  const { contenu } = await piecesAgrement.lirePiece(req.user!, req.params['id'] as string);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Disposition', 'inline');
  res.send(contenu);
});

router.get('/structures', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'), async (_req: AuthRequest, res: Response) => {
  const data: StructureAdminView[] = await service.getStructures();
  res.json({ success: true, data });
});

/**
 * Creer une structure, avec son dossier reglementaire si elle en doit un.
 *
 * L'ordre des middlewares n'est pas indifferent : `multer` d'abord, car lui
 * seul sait lire un corps `multipart/form-data` ; puis `corpsJsonMultipart`,
 * qui remet a sa place l'objet envoye dans le champ `donnees` — un corps
 * multipart ne porte que des chaines plates, donc pas d'objet `admin`
 * imbrique ; puis seulement la validation du schema.
 *
 * Une structure publique continue de poster du JSON ordinaire : elle n'a
 * aucune piece a fournir, et les deux middlewares la laissent passer.
 */
router.post('/structures', requireRole('SUPER_ADMIN'), recevoirPiecesAgrement, corpsJsonMultipart, validateBody(createStructureSchema), async (req: AuthRequest, res: Response) => {
  // Seules les pieces exigees a la creation : elles ont un type connu et
  // n'ont pas besoin de libelle. Une piece libre se depose ensuite, par
  // `POST /structures/:id/pieces`, ou le libelle arrive avec le fichier.
  const fichiers = (req.files ?? []) as piecesAgrement.FichierRecu[];
  const data: CreationStructureView = await service.creerStructureAvecAdmin(req.body, fichiers);
  res.status(201).json({ success: true, data });
});

router.post('/pharmacies', requireRole('SUPER_ADMIN', 'ADMIN_STRUCTURE'), recevoirPiecesAgrement, corpsJsonMultipart, validateBody(createPharmacieSchema), async (req: AuthRequest, res: Response) => {
  const fichiers = (req.files ?? []) as piecesAgrement.FichierRecu[];
  const data: CreationPharmacieView = await service.creerPharmacieAvecPharmacien(req.user!, req.body, fichiers);
  res.status(201).json({ success: true, data });
});

router.put('/structures/:id', requireRole('SUPER_ADMIN'), validateBody(updateStructureSchema), async (req: AuthRequest, res: Response) => {
  const data: StructureAdminView = await service.modifierStructure(String(req.params.id), req.body);
  res.json({ success: true, data });
});

/**
 * Accorder ou retirer le partenariat.
 *
 * Reserve a l'administration nationale : c'est elle qui conventionne, et le
 * drapeau ouvre l'acces aux commandes du quartier.
 */
router.put('/structures/:id/partenariat', requireRole('SUPER_ADMIN', 'ADMIN_NATIONAL'), validateBody(definirPartenariatSchema), async (req: AuthRequest, res: Response) => {
  const data = await service.definirPartenariat(String(req.params.id), req.body.estPartenaire);
  res.json({ success: true, data });
});

router.delete('/structures/:id', requireRole('SUPER_ADMIN'), async (req: AuthRequest, res: Response) => {
  await service.supprimerStructure(String(req.params.id));
  res.json({ success: true, message: 'Structure desactivee' });
});

// ── Parametres globaux de la plateforme (page Parametres du super-admin) ──
router.get('/parametres', requireRole('SUPER_ADMIN'), async (_req: AuthRequest, res: Response) => {
  const data: ParametresSystemeView = await parametresService.getParametres();
  res.json({ success: true, data });
});

router.put('/parametres', requireRole('SUPER_ADMIN'), validateBody(updateParametresSystemeSchema), async (req: AuthRequest, res: Response) => {
  const data: ParametresSystemeView = await parametresService.modifierParametres(req.user!.userId, req.body);
  res.json({ success: true, data });
});

// Logo de la plateforme (champ multipart "logo") : redimensionne, enregistre
// dans Parametres > Identite, renvoie l'identite a jour.
router.post('/parametres/logo', requireRole('SUPER_ADMIN'), (req: AuthRequest, res: Response, next: NextFunction) => {
  uploadLogo(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Image trop volumineuse (2 Mo maximum).'
          : err instanceof Error ? err.message : 'Échec du téléversement.';
      next(new ValidationError(message));
      return;
    }
    next();
  });
}, uploadLogoController);

// ── Les images des pages publiques (Parametres > Images) ─────────────
// Remplacer (champ multipart « image »), revenir a l'image d'origine, et
// decrire l'image pour qui ne la voit pas. Le service refuse un emplacement
// inconnu et une image trop petite.
router.post('/parametres/visuels/:emplacement', requireRole('SUPER_ADMIN'), (req: AuthRequest, res: Response, next: NextFunction) => {
  uploadVisuel(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Image trop volumineuse (8 Mo maximum).'
          : err instanceof Error ? err.message : 'Échec du téléversement.';
      next(new ValidationError(message));
      return;
    }
    next();
  });
}, async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new ValidationError('Aucune image reçue.');
  const data: ParametresVisuelsView = await visuels.remplacerVisuel(req.user!.userId, req.params['emplacement'] as string, req.file.buffer);
  res.json({ success: true, data });
});

router.put('/parametres/visuels/:emplacement/description', requireRole('SUPER_ADMIN'), validateBody(decrireVisuelSchema),
  async (req: AuthRequest, res: Response) => {
    const data: ParametresVisuelsView = await visuels.decrireVisuel(
      req.user!.userId, req.params['emplacement'] as string, req.body.description,
    );
    res.json({ success: true, data });
  });

router.delete('/parametres/visuels/:emplacement', requireRole('SUPER_ADMIN'), async (req: AuthRequest, res: Response) => {
  const data: ParametresVisuelsView = await visuels.retablirVisuel(req.user!.userId, req.params['emplacement'] as string);
  res.json({ success: true, data });
});

export default router;
