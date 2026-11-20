// src/routes/hopital.routes.ts
// P1 — Hopital (EF-03) : admission, episodes de soins, orientation, demandes
// d'analyse, tableau de bord. Reserve au personnel d'une structure.
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { sansValeursDAnalysePour } from '../middlewares/secret-medical.middleware';
import { validateBody, validateQuery } from '../middlewares/validate.middleware';
import * as hopital from '../services/hopital.service';
import * as demandeRdv from '../services/demande-rendez-vous.service';
import * as plateau from '../services/plateau-technique.service';
import {
  annulerDemandeSchema,
  choixLaboratoiresQuerySchema,
  createDemandeAnalyseSchema,
  ouvrirConsultationSchema,
  createEpisodeSchema,
  episodesQuerySchema,
  orientationSchema,
  orienterDemandeRendezVousSchema,
  updateEpisodeSchema,
  creerPatientComptoirSchema,
} from '../validators/api.schemas';
import type {
  ChoixLaboratoiresView,
  DemandeRendezVousView,
  PresenceDuJourView,
  DemandeAnalyseView,
  EpisodeSoinsView,
  ExamenView,
  PatientRechercheView,
  StructureRefView,
  TableauDeBordHopitalView,
} from '@baobaoheath/shared-types';

const router = Router();

router.use(authenticate);
router.use(requireRole('AGENT_ACCUEIL', 'MEDECIN', 'ADMIN_STRUCTURE'));
// L'accueil et l'administration suivent le parcours sans en lire le contenu :
// aucune reponse de ce routeur ne leur porte une valeur d'analyse.
router.use(sansValeursDAnalysePour('AGENT_ACCUEIL', 'ADMIN_STRUCTURE'));

/**
 * Addendum du 2026-09-28 : l'accueil ne fait plus rien de medical. Il cherche
 * ou cree le patient, ouvre l'episode de la visite, pointe la presence et
 * redirige. Prescrire une analyse, la lire, l'annuler : c'est le medecin.
 *
 * Le routeur laisse passer l'accueil pour tout le reste, donc chaque route
 * medicale porte sa propre garde.
 */
//
// L'administrateur de la structure non plus : il dirige l'etablissement, il
// ne soigne pas. Prescrire, ouvrir une consultation, clore la prise en charge
// sont des actes du medecin.
const ACTE_MEDICAL = requireRole('MEDECIN');

// Les erreurs metier (AppError) remontent au middleware global : pas de
// try/catch ici, Express 5 propage les rejets des handlers async.

// ── Demandes de rendez-vous à distance sans médecin désigné ──────────
// L'accueil les oriente : c'est son métier, et le seul qu'il garde sur ce
// circuit. Il ne fixe pas l'heure.
router.get('/demandes', async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView[] = await demandeRdv.demandesAOrienter(req.user!);
  res.json({ success: true, data });
});

router.post('/demandes/:id/orienter', validateBody(orienterDemandeRendezVousSchema), async (req: AuthRequest, res: Response) => {
  const data: DemandeRendezVousView = await demandeRdv.orienterDemande(req.user!, req.params['id'] as string, req.body.idMedecin);
  res.json({ success: true, data, message: 'Demande orientée : le médecin est prévenu' });
});

// ── Pointage de présence (addendum du 2026-09-28, point 2) ───────────
// Le seul geste de l'accueil sur un rendez-vous : il ne le crée pas et n'en
// change pas l'heure.
/**
 * Creer le dossier d'un patient au comptoir (EF-03-01).
 *
 * **L'accueil reste chez lui.** Il etait renvoye vers la page publique
 * d'inscription, dans un nouvel onglet, et perdait l'admission en cours.
 *
 * Le mot de passe temporaire est rendu **une seule fois**, pour etre remis au
 * patient : il n'est stocke nulle part en clair, et le patient doit le changer
 * a sa premiere connexion.
 */
router.post('/patients', validateBody(creerPatientComptoirSchema), async (req: AuthRequest, res: Response) => {
  const data = await hopital.creerPatientAuComptoir(req.user!, req.body);
  res.status(201).json({
    success: true,
    data,
    message: `Dossier de ${data.patient.prenom} ${data.patient.nom} cree. `
      + `Remettez-lui son mot de passe : il devra le changer a sa premiere connexion.`,
  });
});

router.get('/presences', async (req: AuthRequest, res: Response) => {
  const data: PresenceDuJourView[] = await hopital.presencesDuJour(
    req.user!,
    typeof req.query['jour'] === 'string' ? req.query['jour'] : undefined
  );
  res.json({ success: true, data });
});

router.post('/rendez-vous/:id/presence', async (req: AuthRequest, res: Response) => {
  const data: PresenceDuJourView = await hopital.pointerPresence(req.user!, req.params['id'] as string);
  res.json({ success: true, data, message: 'Arrivée pointée : le médecin est prévenu' });
});

// ── Tableau de bord (EF-03-07) ───────────────────────────────────────
router.get('/tableau-de-bord', async (req: AuthRequest, res: Response) => {
  const data: TableauDeBordHopitalView = await hopital.tableauDeBord(req.user!);
  res.json({ success: true, data });
});

// ── Recherche patient avant admission (EF-03-01) ─────────────────────
router.get('/patients/recherche', async (req: AuthRequest, res: Response) => {
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
  const data: PatientRechercheView[] = await hopital.rechercherPatients(req.user!, q);
  res.json({ success: true, data });
});

// ── Referentiels ─────────────────────────────────────────────────────
router.get('/examens', async (req: AuthRequest, res: Response) => {
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined;
  const categorie = typeof req.query['categorie'] === 'string' ? req.query['categorie'] : undefined;
  const data: ExamenView[] = await hopital.listerExamens(q, categorie);
  res.json({ success: true, data });
});

/**
 * Les laboratoires proposes, groupes et couverture chiffree.
 *
 * **Remplace la liste plate**, qui rendait tous les laboratoires actifs du
 * pays sans dire lesquels savaient faire les examens coches : le laboratoire
 * recevait la demande et decouvrait qu'il ne la realisait pas. Le patient,
 * lui, s'etait deplace.
 */
router.get('/laboratoires', validateQuery(choixLaboratoiresQuerySchema), async (req: AuthRequest, res: Response) => {
  const q = req.query as { examens?: string | string[]; toutLePays?: boolean };
  const examens = q.examens === undefined ? [] : Array.isArray(q.examens) ? q.examens : [q.examens];
  const data: ChoixLaboratoiresView = await plateau.laboratoiresPour(
    req.user!, examens, q.toutLePays === true,
  );
  res.json({ success: true, data });
});

router.get('/medecins', async (req: AuthRequest, res: Response) => {
  const data = await hopital.listerMedecinsDeLaStructure(req.user!);
  res.json({ success: true, data });
});

// ── Episodes de soins (EF-03-02, EF-03-05) ───────────────────────────
router.get('/episodes', validateQuery(episodesQuerySchema), async (req: AuthRequest, res: Response) => {
  const { statut, q, page, limit } = req.query as { statut?: string; q?: string; page?: number; limit?: number };
  const data = await hopital.listerEpisodes(req.user!, { statut, q, page: page ?? 1, limit: limit ?? 20 });
  res.json({ success: true, data });
});

router.post('/episodes', validateBody(createEpisodeSchema), async (req: AuthRequest, res: Response) => {
  const data: EpisodeSoinsView = await hopital.creerEpisode(req.user!, req.body);
  res.status(201).json({ success: true, data });
});

router.get('/episodes/:id', async (req: AuthRequest, res: Response) => {
  const data: EpisodeSoinsView = await hopital.getEpisode(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

router.patch('/episodes/:id', validateBody(updateEpisodeSchema), async (req: AuthRequest, res: Response) => {
  const data: EpisodeSoinsView = await hopital.modifierEpisode(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data });
});

router.post('/episodes/:id/cloturer', ACTE_MEDICAL, async (req: AuthRequest, res: Response) => {
  const data: EpisodeSoinsView = await hopital.cloturerEpisode(req.user!, req.params['id'] as string, false);
  res.json({ success: true, data });
});

router.post('/episodes/:id/annuler', async (req: AuthRequest, res: Response) => {
  const data: EpisodeSoinsView = await hopital.cloturerEpisode(req.user!, req.params['id'] as string, true);
  res.json({ success: true, data });
});

router.post('/episodes/:id/orientation', validateBody(orientationSchema), async (req: AuthRequest, res: Response) => {
  const data: EpisodeSoinsView = await hopital.orienter(req.user!, req.params['id'] as string, req.body);
  res.json({ success: true, data });
});

// ── Demandes d'analyse (EF-03-03, EF-03-04, EF-03-06) ────────────────
/**
 * Ouvrir la consultation de cette visite.
 *
 * Reserve a l'acte medical : l'accueil oriente et pointe, il ne consulte pas
 * (addendum du 2026-09-28, point 9).
 */
router.post('/episodes/:id/consultation', ACTE_MEDICAL, validateBody(ouvrirConsultationSchema), async (req: AuthRequest, res: Response) => {
  const data = await hopital.ouvrirConsultationDeLEpisode(req.user!, String(req.params.id), req.body);
  res.status(201).json({ success: true, data });
});

router.post('/episodes/:id/demandes-analyse', ACTE_MEDICAL, validateBody(createDemandeAnalyseSchema), async (req: AuthRequest, res: Response) => {
  const data: DemandeAnalyseView = await hopital.creerDemandeAnalyse(req.user!, req.params['id'] as string, req.body);
  res.status(201).json({ success: true, data });
});

router.get('/demandes-analyse/:id', ACTE_MEDICAL, async (req: AuthRequest, res: Response) => {
  const data: DemandeAnalyseView = await hopital.getDemandeAnalyse(req.user!, req.params['id'] as string);
  res.json({ success: true, data });
});

router.post('/demandes-analyse/:id/annuler', ACTE_MEDICAL, validateBody(annulerDemandeSchema), async (req: AuthRequest, res: Response) => {
  const data: DemandeAnalyseView = await hopital.annulerDemandeAnalyse(req.user!, req.params['id'] as string, req.body.motif);
  res.json({ success: true, data });
});

// Bon d'examen imprimable (HTML pret pour window.print).
router.get('/demandes-analyse/:id/document', ACTE_MEDICAL, async (req: AuthRequest, res: Response) => {
  const html = await hopital.documentDemandeAnalyse(req.user!, req.params['id'] as string);
  res.type('html').send(html);
});

export default router;
