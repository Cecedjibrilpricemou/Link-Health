// src/services/laboratoire.service.ts
// P2 — Laboratoire (EF-04) : file des demandes, prelevement et echantillons,
// saisie ou import des resultats, validation nominative du laborantin,
// resultats critiques (alerte, accuse de lecture, escalade), diffusion au
// patient et courbes d'evolution.
import { InterpretationResultat, Prisma, StatutDemandeAnalyse } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import {
  messagePatientInformation,
  messageProfessionnelIntervention,
  messageProfessionnelUrgent,
  messageRendezVous,
} from './message-sortant.service';
import { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { buildPatientWhereForUser } from './access-control.service';
import {
  DEMANDE_INCLUDE,
  DemandeRow,
  PERSONNE_SELECT,
  STRUCTURE_SELECT,
  echapper,
  versDemandeView,
  versDemandeViewPatient,
} from './hopital.service';
import { prochainNumero } from './numero.service';
import { envoyerSmsSimule, notifierSansBloquer } from './notification.service';
import { getIdentitePlateforme } from './parametres.service';
import type {
  AlerteCritiqueView,
  DemandeAnalyseView,
  EnregistrerPrelevementDto,
  EvolutionResultatView,
  ExamenSuiviView,
  LibererResultatsDto,
  PlanifierPrelevementDto,
  ResultatALibererView,
  ScanLaboratoireView,
  SaisirResultatsDto,
  TableauDeBordLaboView,
  ValiderResultatsDto,
} from '@baobaoheath/shared-types';
import { estPraticien } from '../utils/praticien.util';

// Delais du circuit critique (EF-04-08), en minutes.
const ESCALADE_APRES_MIN = Number(process.env.LABO_ESCALADE_MINUTES ?? 30);

// Garde-fou de la liberation (addendum du 2026-09-28). Le patient ne voit ses
// resultats que si un medecin les libere : sans relance ni escalade, un medecin
// absent le laisserait sans reponse indefiniment. On remue le medecin, puis
// l'administrateur de sa structure — jamais le patient, ce qui reviendrait a
// retablir la diffusion automatique qu'on vient precisement de supprimer.
const RELANCE_LIBERATION_APRES_MIN = Number(process.env.LABO_RELANCE_LIBERATION_MINUTES ?? 12 * 60);
const ESCALADE_LIBERATION_APRES_MIN = Number(process.env.LABO_ESCALADE_LIBERATION_MINUTES ?? 48 * 60);

// Tri de la file : urgence d'abord (ordre de declaration de l'enum en base :
// ROUTINE < URGENT < URGENCE_VITALE), puis la plus ancienne (EF-04-01).
const ORDRE_FILE: Prisma.DemandeAnalyseOrderByWithRelationInput[] = [{ urgence: 'desc' }, { transmiseLe: 'asc' }];

const ALERTE_INCLUDE = {
  demande: { select: { id: true, numero: true, idEpisode: true, patient: { select: { id: true, utilisateur: { select: { prenom: true, nom: true } } } }, laboratoire: { select: STRUCTURE_SELECT } } },
  resultat: { select: { valeur: true, unite: true, refMin: true, refMax: true, ligne: { select: { examen: { select: { libelle: true, codeLoinc: true } } } } } },
  destinataire: { select: PERSONNE_SELECT },
} satisfies Prisma.AlerteResultatCritiqueInclude;
type AlerteRow = Prisma.AlerteResultatCritiqueGetPayload<{ include: typeof ALERTE_INCLUDE }>;

function versAlerteView(a: AlerteRow): AlerteCritiqueView {
  return {
    id: a.id,
    creeLe: a.creeLe,
    accuseeLe: a.accuseeLe,
    escaladeeLe: a.escaladeeLe,
    demande: {
      id: a.demande.id, numero: a.demande.numero, idEpisode: a.demande.idEpisode,
      patient: { id: a.demande.patient.id, prenom: a.demande.patient.utilisateur.prenom, nom: a.demande.patient.utilisateur.nom },
      laboratoire: a.demande.laboratoire,
    },
    resultat: {
      libelle: a.resultat.ligne.examen.libelle, codeLoinc: a.resultat.ligne.examen.codeLoinc,
      valeur: a.resultat.valeur, unite: a.resultat.unite, refMin: a.resultat.refMin, refMax: a.resultat.refMax,
    },
    destinataire: a.destinataire,
  };
}

// ── Contexte du laboratoire ────────────────────────────────────────────
async function laboratoireDe(user: JwtPayload): Promise<string> {
  const u = await prisma.utilisateur.findUnique({ where: { id: user.userId }, select: { idStructure: true } });
  if (!u?.idStructure) throw new ForbiddenError('Aucun laboratoire rattache a votre compte');
  return u.idStructure;
}

async function demandeDuLabo(user: JwtPayload, idDemande: string): Promise<DemandeRow> {
  const idLaboratoire = await laboratoireDe(user);
  const d = await prisma.demandeAnalyse.findFirst({ where: { id: idDemande, idLaboratoire }, include: DEMANDE_INCLUDE });
  if (!d) throw new NotFoundError('Demande introuvable');
  return d;
}

function exigerStatut(d: { statut: StatutDemandeAnalyse; numero: string }, attendus: StatutDemandeAnalyse[], action: string): void {
  if (!attendus.includes(d.statut)) throw new ConflictError(`Impossible de ${action} la demande ${d.numero} (statut ${d.statut})`);
}

async function patientDeLaDemande(idPatient: string) {
  return prisma.utilisateur.findFirst({ where: { patientProfile: { id: idPatient } }, select: { id: true, telephone: true } });
}

// ── EF-04-01 : file des demandes ───────────────────────────────────────
export async function fileDesDemandes(
  user: JwtPayload,
  opts: { statut?: string; q?: string; page: number; limit: number },
): Promise<{ items: DemandeAnalyseView[]; total: number; page: number; limit: number }> {
  const idLaboratoire = await laboratoireDe(user);
  const where: Prisma.DemandeAnalyseWhereInput = {
    idLaboratoire,
    ...(opts.statut ? { statut: opts.statut as StatutDemandeAnalyse } : { statut: { notIn: ['ANNULEE'] } }),
    ...(opts.q
      ? { OR: [{ numero: { contains: opts.q, mode: 'insensitive' } }, { patient: { utilisateur: { OR: [{ nom: { contains: opts.q, mode: 'insensitive' } }, { prenom: { contains: opts.q, mode: 'insensitive' } }] } } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.demandeAnalyse.findMany({ where, include: DEMANDE_INCLUDE, orderBy: ORDRE_FILE, skip: (opts.page - 1) * opts.limit, take: opts.limit }),
    prisma.demandeAnalyse.count({ where }),
  ]);
  return { items: items.map(versDemandeView), total, page: opts.page, limit: opts.limit };
}

/**
 * Scan du QR patient au comptoir du laboratoire.
 *
 * Le patient arrive avec son code ; le laborantin le scanne et voit ce qu'il y
 * a a faire pour lui, sans chercher dans la file ni lui demander son nom.
 *
 * **Le scan ouvre une fenetre, pas le dossier.** On rend l'identite minimale et
 * les demandes encore a traiter *dans ce laboratoire* — ni les resultats
 * valides, ni les ordonnances, ni l'historique. Un QR est un identifiant, pas
 * une cle du dossier medical : le pharmacien qui scanne le meme code voit des
 * ordonnances et aucune analyse, et c'est voulu.
 */
export async function scanPatient(user: JwtPayload, qrCode: string): Promise<ScanLaboratoireView> {
  const idLaboratoire = await laboratoireDe(user);

  const patient = await prisma.patientProfile.findUnique({
    where: { qrCode },
    select: {
      id: true, dateNaissance: true, sexe: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');

  const demandes = await prisma.demandeAnalyse.findMany({
    where: {
      idPatient: patient.id,
      idLaboratoire,
      // Ce qui reste a faire. Une demande validee est close pour le laboratoire,
      // et l'afficher ici ferait croire qu'il y a encore un geste a poser.
      statut: { in: ['TRANSMISE', 'RECUE', 'PRELEVEE', 'EN_ANALYSE'] },
    },
    select: {
      id: true, numero: true, statut: true, urgence: true,
      consignesPatient: true, creeLe: true,
      lignes: { select: { examen: { select: { libelle: true, aJeun: true } } } },
    },
    // L'urgence d'abord, puis la plus ancienne : le meme ordre que la file.
    orderBy: [{ urgence: 'desc' }, { creeLe: 'asc' }],
    take: 20,
  });

  return {
    patient: {
      id: patient.id,
      prenom: patient.utilisateur.prenom,
      nom: patient.utilisateur.nom,
      dateNaissance: patient.dateNaissance.toISOString(),
      sexe: patient.sexe,
      telephone: patient.utilisateur.telephone,
    },
    demandes: demandes.map((d) => ({
      id: d.id,
      numero: d.numero,
      statut: d.statut,
      urgence: d.urgence,
      creeLe: d.creeLe.toISOString(),
      consignesPatient: d.consignesPatient,
      examens: d.lignes.map((l) => l.examen.libelle),
      // Le laborantin doit le savoir avant de prelever.
      aJeun: d.lignes.some((l) => l.examen.aJeun),
    })),
    totalDemandes: demandes.length,
  };
}

export async function getDemande(user: JwtPayload, idDemande: string): Promise<DemandeAnalyseView> {
  return versDemandeView(await demandeDuLabo(user, idDemande));
}

export async function accuserReception(user: JwtPayload, idDemande: string): Promise<DemandeAnalyseView> {
  const d = await demandeDuLabo(user, idDemande);
  exigerStatut(d, ['TRANSMISE'], 'accuser reception de');
  const maj = await prisma.demandeAnalyse.update({ where: { id: d.id }, data: { statut: 'RECUE', recueLe: new Date() }, include: DEMANDE_INCLUDE });
  return versDemandeView(maj);
}

// ── EF-04-02 : prelevement sur place ou a domicile, avec creneau ───────
export async function planifierPrelevement(user: JwtPayload, idDemande: string, dto: PlanifierPrelevementDto): Promise<DemandeAnalyseView> {
  const d = await demandeDuLabo(user, idDemande);
  exigerStatut(d, ['TRANSMISE', 'RECUE'], 'planifier le prelevement de');
  const creneau = dto.creneau ? new Date(dto.creneau) : null;
  if (creneau && creneau.getTime() < Date.now() - 60_000) throw new ValidationError('Le creneau est deja passe');

  const maj = await prisma.demandeAnalyse.update({
    where: { id: d.id },
    data: { lieuPrelevement: dto.lieu, creneauPrelevement: creneau, ...(d.statut === 'TRANSMISE' ? { statut: 'RECUE', recueLe: new Date() } : {}) },
    include: DEMANDE_INCLUDE,
  });

  const patientUser = await patientDeLaDemande(d.idPatient);
  if (patientUser) {
    const quand = creneau ? ` le ${creneau.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}` : '';
    const ou = dto.lieu === 'DOMICILE' ? 'a votre domicile' : `au laboratoire ${d.laboratoire.nom}`;
    await notifierSansBloquer({
      idUtilisateur: patientUser.id,
      type: 'PRELEVEMENT_PLANIFIE',
      titre: 'Prelevement planifie',
      contenu: `Votre prelevement pour la demande ${d.numero} aura lieu ${ou}${quand}.`,
      lienAction: '/patient/parcours',
      metadonnees: { idDemande: d.id, idEpisode: d.idEpisode },
    });
    const { nomCourt } = await getIdentitePlateforme();
    // EF-11-02 : un rendez-vous, sans dire pour quoi. La date et le lieu
    // restent, le patient devant pouvoir se presenter.
    await envoyerSmsSimule(patientUser.telephone, messageRendezVous(nomCourt, quand.trim(), ou.trim() || undefined));
  }
  return versDemandeView(maj);
}

// ── EF-04-03 : echantillons codes sans ambiguite ───────────────────────
export async function enregistrerPrelevement(user: JwtPayload, idDemande: string, dto: EnregistrerPrelevementDto): Promise<DemandeAnalyseView> {
  const d = await demandeDuLabo(user, idDemande);
  exigerStatut(d, ['TRANSMISE', 'RECUE'], 'prelever');

  // Par defaut, un echantillon par type de specimen demande.
  const specimens: { specimen: string; commentaire?: string }[] = dto.echantillons?.length
    ? dto.echantillons
    : [...new Set(d.lignes.map((l) => l.examen.specimen))].map((specimen) => ({ specimen }));
  if (specimens.length === 0) throw new ValidationError('Aucun specimen a prelever');

  const maintenant = new Date();
  const maj = await prisma.$transaction(async (tx) => {
    for (const e of specimens) {
      const code = await prochainNumero('EC', tx);
      await tx.echantillon.create({ data: { code, specimen: e.specimen.toUpperCase(), commentaire: e.commentaire ?? null, idDemande: d.id, idPreleveur: user.userId, preleveLe: maintenant } });
    }
    return tx.demandeAnalyse.update({
      where: { id: d.id },
      data: { statut: 'PRELEVEE', preleveeLe: maintenant, recueLe: d.recueLe ?? maintenant, ...(dto.lieu ? { lieuPrelevement: dto.lieu } : {}) },
      include: DEMANDE_INCLUDE,
    });
  });
  return versDemandeView(maj);
}

// ── EF-04-04 / EF-04-06 : saisie ou import des resultats ───────────────
function lireNombre(valeur: string): number | null {
  const n = Number(valeur.trim().replace(',', '.').replace(/^[<>]=?\s*/, ''));
  return Number.isFinite(n) ? n : null;
}

/** Lecture d'une valeur d'apres les references de l'examen (EF-04-07 : seuils critiques parametrables). */
export function interpreter(
  valeur: string,
  examen: { refMin: number | null; refMax: number | null; refTexte: string | null; critiqueMin: number | null; critiqueMax: number | null },
): { valeurNumerique: number | null; interpretation: InterpretationResultat } {
  const n = lireNombre(valeur);
  if (n !== null) {
    if ((examen.critiqueMin !== null && n < examen.critiqueMin) || (examen.critiqueMax !== null && n > examen.critiqueMax)) return { valeurNumerique: n, interpretation: 'CRITIQUE' };
    if ((examen.refMin !== null && n < examen.refMin) || (examen.refMax !== null && n > examen.refMax)) return { valeurNumerique: n, interpretation: 'ANORMAL' };
    return { valeurNumerique: n, interpretation: 'NORMAL' };
  }
  const normaliser = (v: string) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (examen.refTexte && normaliser(valeur) !== normaliser(examen.refTexte)) return { valeurNumerique: null, interpretation: 'ANORMAL' };
  return { valeurNumerique: null, interpretation: 'NORMAL' };
}

export async function saisirResultats(user: JwtPayload, idDemande: string, dto: SaisirResultatsDto): Promise<DemandeAnalyseView> {
  const d = await demandeDuLabo(user, idDemande);
  exigerStatut(d, ['PRELEVEE', 'EN_ANALYSE'], 'saisir les resultats de');

  const echantillonsValides = new Set(d.echantillons.map((e) => e.id));
  const saisies = dto.resultats.map((r) => {
    // Cible : par ligne (saisie manuelle) ou par code LOINC (import automate).
    const ligne = r.idLigne ? d.lignes.find((l) => l.id === r.idLigne) : d.lignes.find((l) => l.examen.codeLoinc === r.codeLoinc);
    if (!ligne) throw new ValidationError(`Examen ${r.codeLoinc ?? r.idLigne} absent de la demande ${d.numero}`);
    if (r.idEchantillon && !echantillonsValides.has(r.idEchantillon)) throw new ValidationError('Echantillon inconnu pour cette demande');
    const lu = interpreter(r.valeur, ligne.examen);
    return {
      idLigne: ligne.id,
      data: {
        valeur: r.valeur.trim(),
        valeurNumerique: lu.valeurNumerique,
        unite: r.unite ?? ligne.examen.unite,
        // References figees au moment de la saisie : le referentiel peut evoluer ensuite.
        refMin: ligne.examen.refMin, refMax: ligne.examen.refMax, refTexte: ligne.examen.refTexte,
        interpretation: r.interpretation ?? lu.interpretation,
        commentaire: r.commentaire ?? null,
        idEchantillon: r.idEchantillon ?? null,
        idSaisiPar: user.userId,
      },
    };
  });

  const maj = await prisma.$transaction(async (tx) => {
    for (const s of saisies) {
      await tx.resultatAnalyse.upsert({ where: { idLigne: s.idLigne }, create: { ...s.data, idLigne: s.idLigne }, update: s.data });
    }
    return tx.demandeAnalyse.update({ where: { id: d.id }, data: { statut: 'EN_ANALYSE' }, include: DEMANDE_INCLUDE });
  });
  return versDemandeView(maj);
}

// ── EF-04-05 : validation nominative, bloquante avant diffusion ────────
export async function validerResultats(user: JwtPayload, idDemande: string, dto: ValiderResultatsDto): Promise<DemandeAnalyseView> {
  // Le role BIOLOGISTE a ete supprime (addendum du 2026-09-28, point 4) :
  // il n'y a pas de biologiste dans ces laboratoires. La validation reste
  // nominative et bloquante — c'est le laborantin qui signe.
  if (user.role !== 'TECHNICIEN_LABO') throw new ForbiddenError('Seul un laborantin peut valider des resultats');
  const d = await demandeDuLabo(user, idDemande);
  exigerStatut(d, ['EN_ANALYSE'], 'valider');
  const manquantes = d.lignes.filter((l) => !l.resultat);
  if (manquantes.length) throw new ValidationError(`Resultat manquant : ${manquantes.map((l) => l.examen.libelle).join(', ')}`);

  const critiques = d.lignes.filter((l) => l.resultat?.interpretation === 'CRITIQUE');
  const maintenant = new Date();

  const maj = await prisma.$transaction(async (tx) => {
    for (const l of critiques) {
      await tx.alerteResultatCritique.create({ data: { idDemande: d.id, idResultat: l.resultat!.id, idDestinataire: d.idPrescripteur } });
    }
    return tx.demandeAnalyse.update({
      where: { id: d.id },
      data: {
        statut: 'VALIDEE', valideeLe: maintenant, idValideur: user.userId, commentaireLaboratoire: dto.commentaire ?? null,
        // `diffuseePatientLe` reste volontairement vide : la validation du
        // laboratoire ne rend plus rien visible au patient. Il faut qu'un
        // medecin libere (addendum du 2026-09-28).
      },
      include: DEMANDE_INCLUDE,
    });
  });

  const { nomCourt } = await getIdentitePlateforme();
  const prescripteur = await prisma.utilisateur.findUnique({ where: { id: d.idPrescripteur }, select: { id: true, telephone: true } });
  if (prescripteur) {
    if (critiques.length) {
      await notifierSansBloquer({
        idUtilisateur: prescripteur.id,
        type: 'RESULTAT_CRITIQUE',
        titre: 'Resultat critique a accuser',
        contenu: `${critiques.length} resultat(s) critique(s) pour ${d.patient.utilisateur.prenom} ${d.patient.utilisateur.nom} (demande ${d.numero}). Accusez lecture pour lever l'alerte.`,
        lienAction: '/hopital/alertes',
        metadonnees: { idDemande: d.id, idEpisode: d.idEpisode, critique: true },
      });
      // EF-11-02 : meme vers un professionnel, un SMS s'affiche sur un ecran
      // verrouille. Le numero de demande est opaque et suffit a retrouver le
      // dossier ; l'urgence passe, la nature du resultat non.
      await envoyerSmsSimule(prescripteur.telephone, messageProfessionnelUrgent(nomCourt, d.numero));
    } else {
      await notifierSansBloquer({
        idUtilisateur: prescripteur.id,
        type: 'RESULTATS_DISPONIBLES',
        titre: 'Resultats a liberer',
        // Le patient attend ce geste : tant que personne ne libere, il ne voit rien.
        contenu: `Les resultats de la demande ${d.numero} (${d.patient.utilisateur.prenom} ${d.patient.utilisateur.nom}) sont valides. Le patient ne les verra qu'apres votre liberation.`,
        lienAction: '/medecin/resultats',
        metadonnees: { idDemande: d.id, idEpisode: d.idEpisode },
      });
    }
  }
  // Le patient n'est plus informe ici : c'est la liberation par le medecin qui
  // le previendra, avec l'explication qui va avec.
  return versDemandeView(maj);
}

/** Diffusion au patient : notification neutre, sans valeur medicale dans le SMS. */
async function informerPatient(idPatient: string, idDemande: string, numero: string, idEpisode: string): Promise<void> {
  const patientUser = await patientDeLaDemande(idPatient);
  if (!patientUser) return;
  await notifierSansBloquer({
    idUtilisateur: patientUser.id,
    type: 'RESULTATS_DISPONIBLES',
    titre: 'Vos resultats sont disponibles',
    contenu: `Les resultats de vos analyses (${numero}) sont consultables dans votre espace.`,
    lienAction: '/patient/parcours',
    metadonnees: { idDemande, idEpisode },
  });
  const { nomCourt } = await getIdentitePlateforme();
  // EF-11-02 : le patient apprend qu'une information l'attend, pas laquelle.
  await envoyerSmsSimule(patientUser.telephone, messagePatientInformation(nomCourt));
}

// ── Liberation des resultats par le medecin (addendum du 2026-09-28) ───
//
// Un resultat d'analyse est ecrit pour un soignant : « TSH 0,21 mUI/L, hors
// bornes ». Le patient qui lit cela seul ne sait pas s'il doit s'inquieter.
// C'est pourquoi la visibilite n'est plus un effet de la validation ni du temps
// qui passe, mais un geste de medecin, auquel il peut joindre une explication.

/** File « a liberer » d'un medecin : ses demandes validees que le patient ne voit pas encore. */
export async function mesResultatsALiberer(user: JwtPayload): Promise<ResultatALibererView[]> {
  const rows = await prisma.demandeAnalyse.findMany({
    where: {
      statut: 'VALIDEE',
      diffuseePatientLe: null,
      // Le prescripteur, ou le medecin responsable de l'episode : les deux
      // suivent ce patient.
      OR: [{ idPrescripteur: user.userId }, { episode: { idResponsable: user.userId } }],
    },
    select: {
      id: true, numero: true, valideeLe: true, idEpisode: true,
      patient: { select: { id: true, utilisateur: { select: { prenom: true, nom: true } } } },
      laboratoire: { select: { id: true, nom: true } },
      lignes: { select: { resultat: { select: { interpretation: true } } } },
    },
    // Le plus ancien d'abord : c'est celui dont le patient attend depuis le plus longtemps.
    orderBy: { valideeLe: 'asc' },
    take: 100,
  });

  return rows.map((d) => ({
    idDemande: d.id,
    numero: d.numero,
    valideeLe: (d.valideeLe ?? new Date()).toISOString(),
    idEpisode: d.idEpisode,
    nbExamens: d.lignes.length,
    contientCritique: d.lignes.some((l) => l.resultat?.interpretation === 'CRITIQUE'),
    contientAnormal: d.lignes.some((l) => l.resultat?.interpretation === 'ANORMAL'),
    patient: { id: d.patient.id, prenom: d.patient.utilisateur.prenom, nom: d.patient.utilisateur.nom },
    laboratoire: d.laboratoire,
  }));
}

export async function libererResultats(user: JwtPayload, idDemande: string, dto: LibererResultatsDto): Promise<DemandeAnalyseView> {
  if (!estPraticien(user.role)) throw new ForbiddenError('Seul un medecin ou une sage-femme peut liberer des resultats');

  const d = await prisma.demandeAnalyse.findUnique({
    where: { id: idDemande },
    select: { id: true, numero: true, statut: true, diffuseePatientLe: true, idPrescripteur: true, idPatient: true, idEpisode: true, episode: { select: { idResponsable: true } } },
  });
  if (!d) throw new NotFoundError('Demande introuvable');
  if (d.idPrescripteur !== user.userId && d.episode.idResponsable !== user.userId) {
    throw new ForbiddenError('Vous ne suivez pas ce patient');
  }
  if (d.statut !== 'VALIDEE') throw new ConflictError('Les resultats ne sont pas encore valides par le laboratoire');
  if (d.diffuseePatientLe) throw new ConflictError('Ces resultats sont deja accessibles au patient');

  const maintenant = new Date();
  const commentaire = dto.commentaire?.trim() || null;

  await prisma.$transaction(async (tx) => {
    // Attribution atomique : deux medecins qui liberent en meme temps donnent un
    // gagnant et un perdant, jamais deux notifications au patient.
    const prise = await tx.demandeAnalyse.updateMany({
      where: { id: d.id, statut: 'VALIDEE', diffuseePatientLe: null },
      data: { diffuseePatientLe: maintenant, idLiberePar: user.userId, commentaireMedecin: commentaire },
    });
    if (prise.count === 0) throw new ConflictError('Ces resultats viennent d etre liberes');

    // Liberer, c'est avoir lu. Exiger en plus un accuse separe ferait tourner
    // l'escalade critique contre un medecin qui a deja fait le travail.
    await tx.alerteResultatCritique.updateMany({
      where: { idDemande: d.id, accuseeLe: null },
      data: { accuseeLe: maintenant },
    });
  });

  await informerPatient(d.idPatient, d.id, d.numero, d.idEpisode);
  const maj = await prisma.demandeAnalyse.findUniqueOrThrow({ where: { id: d.id }, include: DEMANDE_INCLUDE });
  return versDemandeView(maj);
}

// ── EF-04-08 : accuse de lecture du prescripteur ───────────────────────
export async function mesAlertes(user: JwtPayload): Promise<AlerteCritiqueView[]> {
  const rows = await prisma.alerteResultatCritique.findMany({
    where: { OR: [{ idDestinataire: user.userId }, { idEscaladeVers: user.userId }] },
    include: ALERTE_INCLUDE,
    orderBy: [{ accuseeLe: { sort: 'asc', nulls: 'first' } }, { creeLe: 'desc' }],
    take: 100,
  });
  return rows.map(versAlerteView);
}

export async function accuserAlerte(user: JwtPayload, idAlerte: string): Promise<AlerteCritiqueView> {
  const a = await prisma.alerteResultatCritique.findFirst({ where: { id: idAlerte, OR: [{ idDestinataire: user.userId }, { idEscaladeVers: user.userId }] }, include: ALERTE_INCLUDE });
  if (!a) throw new NotFoundError('Alerte introuvable');
  if (a.accuseeLe) return versAlerteView(a);
  const maj = await prisma.alerteResultatCritique.update({ where: { id: a.id }, data: { accuseeLe: new Date() }, include: ALERTE_INCLUDE });
  // L'accuse de lecture ne diffuse plus rien au patient : il dit que le
  // soignant a vu l'alerte, pas qu'il a explique le resultat. La visibilite
  // passe par `libererResultats` (addendum du 2026-09-28).
  return versAlerteView(maj);
}

// ── Job : escalade des alertes non accusees, relance des liberations ───
export async function traiterAlertesCritiques(maintenant = new Date()): Promise<{ escaladees: number; relancees: number; escaladesLiberation: number }> {
  const limiteEscalade = new Date(maintenant.getTime() - ESCALADE_APRES_MIN * 60_000);
  const aEscalader = await prisma.alerteResultatCritique.findMany({
    where: { accuseeLe: null, escaladeeLe: null, creeLe: { lt: limiteEscalade } },
    include: { demande: { select: { numero: true } }, destinataire: { select: { id: true, prenom: true, nom: true, idStructure: true, medecinProfile: { select: { idStructure: true } } } } },
  });

  let escaladees = 0;
  const { nomCourt } = await getIdentitePlateforme();
  for (const a of aEscalader) {
    // Escalade vers l'administrateur de la structure du prescripteur (EF-04-08).
    const idStructure = a.destinataire.idStructure ?? a.destinataire.medecinProfile?.idStructure;
    const admin = idStructure
      ? await prisma.utilisateur.findFirst({ where: { idStructure, role: 'ADMIN_STRUCTURE', estActif: true }, select: { id: true, telephone: true } })
      : null;
    await prisma.alerteResultatCritique.update({ where: { id: a.id }, data: { escaladeeLe: maintenant, idEscaladeVers: admin?.id ?? null } });
    escaladees++;
    if (!admin) continue;
    await notifierSansBloquer({
      idUtilisateur: admin.id,
      type: 'ESCALADE_CRITIQUE',
      titre: 'Resultat critique sans accuse de lecture',
      contenu: `${a.destinataire.prenom} ${a.destinataire.nom} n'a pas accuse lecture d'un resultat critique (demande ${a.demande.numero}) depuis ${ESCALADE_APRES_MIN} min.`,
      lienAction: '/hopital/alertes',
      metadonnees: { idAlerte: a.id, idDemande: a.idDemande, critique: true },
    });
    await envoyerSmsSimule(admin.telephone, messageProfessionnelIntervention(nomCourt, a.demande.numero));
  }

  // Garde-fou de la liberation (addendum du 2026-09-28). Aucune branche de ce
  // bloc ne touche `diffuseePatientLe` : on ne rend jamais un resultat visible
  // sans qu'un medecin l'ait libere, sans quoi on aurait reintroduit la
  // diffusion automatique par la fenetre.
  const relancees = await relancerLiberations(maintenant);
  const escaladesLiberation = await escaladerLiberations(maintenant);
  return { escaladees, relancees, escaladesLiberation };
}

/** Premier rappel au medecin : ses resultats valides attendent d'etre liberes. */
async function relancerLiberations(maintenant: Date): Promise<number> {
  const limite = new Date(maintenant.getTime() - RELANCE_LIBERATION_APRES_MIN * 60_000);
  const enAttente = await prisma.demandeAnalyse.findMany({
    where: { statut: 'VALIDEE', diffuseePatientLe: null, relanceLiberationLe: null, valideeLe: { lt: limite } },
    select: { id: true, numero: true, idPrescripteur: true, idEpisode: true, episode: { select: { idResponsable: true } } },
    take: 200,
  });

  for (const d of enAttente) {
    await prisma.demandeAnalyse.update({ where: { id: d.id }, data: { relanceLiberationLe: maintenant } });
    // Le responsable de l'episode d'abord : c'est lui qui suit le patient
    // aujourd'hui, le prescripteur a pu passer la main.
    const idMedecin = d.episode.idResponsable ?? d.idPrescripteur;
    await notifierSansBloquer({
      idUtilisateur: idMedecin,
      type: 'RESULTATS_DISPONIBLES',
      titre: 'Des resultats attendent votre liberation',
      contenu: `Les resultats de la demande ${d.numero} sont valides depuis plus de ${Math.round(RELANCE_LIBERATION_APRES_MIN / 60)} h. Le patient ne les verra pas tant que vous ne les aurez pas liberes.`,
      lienAction: '/medecin/resultats',
      metadonnees: { idDemande: d.id, idEpisode: d.idEpisode },
    });
  }
  return enAttente.length;
}

/** Second temps : l'administrateur de la structure est prevenu, pas le patient. */
async function escaladerLiberations(maintenant: Date): Promise<number> {
  const limite = new Date(maintenant.getTime() - ESCALADE_LIBERATION_APRES_MIN * 60_000);
  const enAttente = await prisma.demandeAnalyse.findMany({
    where: { statut: 'VALIDEE', diffuseePatientLe: null, escaladeLiberationLe: null, valideeLe: { lt: limite } },
    select: {
      id: true, numero: true, idEpisode: true,
      episode: { select: { idStructure: true } },
      prescripteur: { select: { prenom: true, nom: true } },
    },
    take: 200,
  });

  const { nomCourt } = await getIdentitePlateforme();
  for (const d of enAttente) {
    await prisma.demandeAnalyse.update({ where: { id: d.id }, data: { escaladeLiberationLe: maintenant } });
    const admin = await prisma.utilisateur.findFirst({
      where: { idStructure: d.episode.idStructure, role: 'ADMIN_STRUCTURE', estActif: true },
      select: { id: true, telephone: true },
    });
    if (!admin) continue;
    await notifierSansBloquer({
      idUtilisateur: admin.id,
      type: 'ESCALADE_CRITIQUE',
      titre: 'Resultats non liberes au patient',
      contenu: `Les resultats de la demande ${d.numero} (prescrits par ${d.prescripteur.prenom} ${d.prescripteur.nom}) sont valides depuis plus de ${Math.round(ESCALADE_LIBERATION_APRES_MIN / 60)} h et n'ont pas ete liberes. Le patient attend.`,
      lienAction: '/hopital/alertes',
      metadonnees: { idDemande: d.id, idEpisode: d.idEpisode },
    });
    await envoyerSmsSimule(admin.telephone, messageProfessionnelIntervention(nomCourt, d.numero));
  }
  return enAttente.length;
}

// ── Tableau de bord du laboratoire ─────────────────────────────────────
export async function tableauDeBord(user: JwtPayload): Promise<TableauDeBordLaboView> {
  const idLaboratoire = await laboratoireDe(user);
  const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
  const nonValidees: StatutDemandeAnalyse[] = ['TRANSMISE', 'RECUE', 'PRELEVEE', 'EN_ANALYSE'];

  const [aRecevoir, aPrelever, enAnalyse, aValider, urgentes, critiquesNonAccusees, valideesDuJour, prochains, urgentesListe] = await Promise.all([
    prisma.demandeAnalyse.count({ where: { idLaboratoire, statut: 'TRANSMISE' } }),
    prisma.demandeAnalyse.count({ where: { idLaboratoire, statut: 'RECUE' } }),
    prisma.demandeAnalyse.count({ where: { idLaboratoire, statut: { in: ['PRELEVEE', 'EN_ANALYSE'] } } }),
    prisma.demandeAnalyse.count({ where: { idLaboratoire, statut: 'EN_ANALYSE', lignes: { none: { resultat: null } } } }),
    prisma.demandeAnalyse.count({ where: { idLaboratoire, statut: { in: nonValidees }, urgence: { in: ['URGENT', 'URGENCE_VITALE'] } } }),
    prisma.alerteResultatCritique.count({ where: { accuseeLe: null, demande: { idLaboratoire } } }),
    prisma.demandeAnalyse.count({ where: { idLaboratoire, statut: 'VALIDEE', valideeLe: { gte: debutJour } } }),
    prisma.demandeAnalyse.findMany({ where: { idLaboratoire, statut: { in: ['TRANSMISE', 'RECUE'] }, creneauPrelevement: { gte: debutJour } }, include: DEMANDE_INCLUDE, orderBy: { creneauPrelevement: 'asc' }, take: 6 }),
    prisma.demandeAnalyse.findMany({ where: { idLaboratoire, statut: { in: nonValidees } }, include: DEMANDE_INCLUDE, orderBy: ORDRE_FILE, take: 8 }),
  ]);

  return {
    aRecevoir, aPrelever, enAnalyse, aValider, urgentes, critiquesNonAccusees, valideesDuJour,
    prochainsPrelevements: prochains.map(versDemandeView),
    fileUrgente: urgentesListe.map(versDemandeView),
  };
}

// ── Compte rendu de resultats (imprimable) ─────────────────────────────
export async function compteRenduLabo(user: JwtPayload, idDemande: string): Promise<string> {
  return rendreCompteRendu(versDemandeView(await demandeDuLabo(user, idDemande)));
}

/** Cote prescripteur : la demande doit venir de sa structure (via l'episode). */
export async function compteRenduPrescripteur(user: JwtPayload, idDemande: string): Promise<string> {
  const u = await prisma.utilisateur.findUnique({ where: { id: user.userId }, select: { idStructure: true, medecinProfile: { select: { idStructure: true } } } });
  const idStructure = u?.idStructure ?? u?.medecinProfile?.idStructure;
  if (!idStructure) throw new ForbiddenError('Aucune structure rattachee a votre compte');
  const d = await prisma.demandeAnalyse.findFirst({ where: { id: idDemande, episode: { idStructure } }, include: DEMANDE_INCLUDE });
  if (!d) throw new NotFoundError('Demande introuvable');
  return rendreCompteRendu(versDemandeView(d));
}

export async function compteRenduPatient(userId: string, idDemande: string): Promise<string> {
  const d = await prisma.demandeAnalyse.findFirst({ where: { id: idDemande, patient: { idUtilisateur: userId } }, include: DEMANDE_INCLUDE });
  if (!d) throw new NotFoundError('Demande introuvable');
  const vue = versDemandeViewPatient(d);
  if (!vue.diffuseePatientLe) throw new ConflictError('Les resultats ne sont pas encore disponibles');
  return rendreCompteRendu(vue);
}

async function rendreCompteRendu(d: DemandeAnalyseView): Promise<string> {
  const identite = await getIdentitePlateforme();
  const patient = await prisma.patientProfile.findUnique({ where: { id: d.patient.id }, select: { sexe: true, dateNaissance: true, qrCode: true } });
  const date = (v: string | Date | null) => (v ? new Date(v).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const valide = d.statut === 'VALIDEE';
  const reference = (l: DemandeAnalyseView['lignes'][number]) => {
    const r = l.resultat ?? l.examen;
    if (r.refMin !== null && r.refMax !== null) return `${r.refMin} – ${r.refMax}`;
    if (r.refMin !== null) return `≥ ${r.refMin}`;
    if (r.refMax !== null) return `≤ ${r.refMax}`;
    return r.refTexte ?? '';
  };
  const lignes = d.lignes.map((l) => {
    const r = l.resultat;
    const classe = r?.interpretation === 'CRITIQUE' ? ' class="critique"' : r?.interpretation === 'ANORMAL' ? ' class="anormal"' : '';
    return `<tr${classe}><td>${echapper(l.examen.libelle)}<br><small>${echapper(l.examen.codeLoinc)}</small></td><td><strong>${echapper(r?.valeur ?? 'En attente')}</strong></td><td>${echapper(r?.unite ?? l.examen.unite)}</td><td>${echapper(reference(l))}</td><td>${r ? echapper(r.interpretation === 'NORMAL' ? 'Normal' : r.interpretation === 'ANORMAL' ? 'Anormal' : 'CRITIQUE') : ''}</td><td>${echapper(r?.commentaire)}</td></tr>`;
  }).join('');
  const echantillons = d.echantillons.map((e) => `<li><strong>${echapper(e.code)}</strong> · ${echapper(e.specimen)} · preleve le ${date(e.preleveLe)} par ${echapper(e.preleveur.prenom)} ${echapper(e.preleveur.nom)}</li>`).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Compte rendu ${echapper(d.numero)}</title>
<style>
  body{font-family:Arial,sans-serif;color:#0d2b1a;margin:32px;font-size:13px;position:relative}
  header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2D7D46;padding-bottom:12px;margin-bottom:20px}
  h1{margin:0;font-size:20px;color:#2D7D46} h2{font-size:14px;margin:18px 0 6px;color:#1A5C35;text-transform:uppercase;letter-spacing:.05em}
  .meta{font-size:12px;color:#3a5848} .badge{display:inline-block;padding:3px 10px;border-radius:99px;background:#EDF7F1;color:#1A5C35;font-weight:700;font-size:11px}
  .badge--brouillon{background:#FEF3C7;color:#92400E}
  table{width:100%;border-collapse:collapse;margin-top:6px} th,td{border:1px solid #DDE8E2;padding:7px 9px;text-align:left;vertical-align:top} th{background:#F3F7F5;font-size:11.5px}
  tr.anormal td{background:#FFFBEB} tr.critique td{background:#FEF2F2;color:#B91C1C}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px} .grid div{padding:3px 0}
  .filigrane{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:64px;color:rgba(185,28,28,.12);transform:rotate(-18deg);pointer-events:none;font-weight:800}
  footer{margin-top:28px;padding-top:10px;border-top:1px solid #DDE8E2;font-size:11px;color:#7a9485;display:flex;justify-content:space-between}
  .sign{margin-top:36px;display:flex;justify-content:flex-end} .sign div{width:260px;border-top:1px solid #0d2b1a;padding-top:6px;text-align:center}
  @media print{body{margin:14mm}}
</style></head><body>
${valide ? '' : '<div class="filigrane">NON VALIDE</div>'}
<header>
  <div>${identite.logoUrl ? `<img src="${echapper(identite.logoUrl)}" alt="" style="height:40px;margin-bottom:6px"><br>` : ''}<h1>${echapper(identite.nom)}</h1><div class="meta">${echapper(d.laboratoire.nom)} — Compte rendu d'analyses</div></div>
  <div style="text-align:right"><div class="meta">N° <strong>${echapper(d.numero)}</strong></div><div class="meta">Episode ${echapper(d.numeroEpisode)}</div><div class="meta">Valide le ${date(d.valideeLe)}</div><span class="badge${valide ? '' : ' badge--brouillon'}">${valide ? 'VALIDE' : 'BROUILLON'}</span></div>
</header>
<h2>Patient</h2>
<div class="grid">
  <div><strong>${echapper(d.patient.prenom)} ${echapper(d.patient.nom)}</strong></div>
  <div>Ne(e) le ${patient ? new Date(patient.dateNaissance).toLocaleDateString('fr-FR') : '—'} · ${echapper(patient?.sexe)}</div>
  <div>Identifiant : ${echapper(patient?.qrCode)}</div>
  <div>Prescripteur : ${echapper(d.prescripteur.prenom)} ${echapper(d.prescripteur.nom)}</div>
</div>
<h2>Echantillons</h2>
<ul>${echantillons || '<li>—</li>'}</ul>
<h2>Resultats</h2>
<table><thead><tr><th>Examen</th><th>Resultat</th><th>Unite</th><th>Reference</th><th>Lecture</th><th>Commentaire</th></tr></thead><tbody>${lignes}</tbody></table>
${d.commentaireLaboratoire ? `<h2>Conclusion du laboratoire</h2><p>${echapper(d.commentaireLaboratoire)}</p>` : ''}
<div class="sign"><div>${valide && d.valideur ? `Valide par ${echapper(d.valideur.prenom)} ${echapper(d.valideur.nom)}<br><small>Laboratoire · ${date(d.valideeLe)}</small>` : 'Validation du laboratoire en attente'}</div></div>
<footer><span>${echapper(identite.copyright)}</span><span>${[identite.telephone, identite.emailContact].filter(Boolean).map(echapper).join(' · ')}</span></footer>
</body></html>`;
}

// ── EF-04-10 : courbe d'evolution d'une valeur ─────────────────────────
async function serieEvolution(idPatient: string, codeLoinc: string, diffuseesSeulement: boolean): Promise<EvolutionResultatView> {
  const examen = await prisma.examen.findUnique({ where: { codeLoinc }, select: { codeLoinc: true, libelle: true, unite: true, refMin: true, refMax: true } });
  if (!examen) throw new NotFoundError('Examen inconnu');
  const rows = await prisma.resultatAnalyse.findMany({
    where: {
      valeurNumerique: { not: null },
      ligne: { examen: { codeLoinc }, demande: { idPatient, statut: 'VALIDEE', ...(diffuseesSeulement ? { diffuseePatientLe: { not: null } } : {}) } },
    },
    select: { valeurNumerique: true, interpretation: true, ligne: { select: { demande: { select: { numero: true, valideeLe: true } } } } },
    orderBy: { ligne: { demande: { valideeLe: 'asc' } } },
  });
  return {
    ...examen,
    points: rows.map((r) => ({ date: r.ligne.demande.valideeLe ?? new Date(), valeur: r.valeurNumerique as number, interpretation: r.interpretation, numeroDemande: r.ligne.demande.numero })),
  };
}

async function examensSuivis(idPatient: string, diffuseesSeulement: boolean): Promise<ExamenSuiviView[]> {
  const rows = await prisma.resultatAnalyse.findMany({
    where: { valeurNumerique: { not: null }, ligne: { demande: { idPatient, statut: 'VALIDEE', ...(diffuseesSeulement ? { diffuseePatientLe: { not: null } } : {}) } } },
    select: { ligne: { select: { examen: { select: { codeLoinc: true, libelle: true, unite: true } } } } },
  });
  const parCode = new Map<string, ExamenSuiviView>();
  for (const r of rows) {
    const e = r.ligne.examen;
    const suivi = parCode.get(e.codeLoinc) ?? { codeLoinc: e.codeLoinc, libelle: e.libelle, unite: e.unite, nbPoints: 0 };
    suivi.nbPoints++;
    parCode.set(e.codeLoinc, suivi);
  }
  return [...parCode.values()].sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
}

export async function evolutionPourPatient(userId: string, codeLoinc: string): Promise<EvolutionResultatView> {
  const p = await prisma.patientProfile.findUnique({ where: { idUtilisateur: userId }, select: { id: true } });
  if (!p) throw new NotFoundError('Profil patient introuvable');
  return serieEvolution(p.id, codeLoinc, true);
}

export async function examensSuivisPourPatient(userId: string): Promise<ExamenSuiviView[]> {
  const p = await prisma.patientProfile.findUnique({ where: { idUtilisateur: userId }, select: { id: true } });
  if (!p) throw new NotFoundError('Profil patient introuvable');
  return examensSuivis(p.id, true);
}

/**
 * Les examens suivis d'un patient, sans controle : l'appelant a deja verifie
 * l'acces (l'historique accorde par le patient).
 */
export async function examensSuivisDuPatient(idPatient: string): Promise<ExamenSuiviView[]> {
  return examensSuivis(idPatient, false);
}

/** Cote professionnel : soumis au controle d'acces au dossier. */
async function patientAccessible(user: JwtPayload, idPatient: string): Promise<string> {
  const where = await buildPatientWhereForUser(user);
  const p = await prisma.patientProfile.findFirst({ where: { AND: [{ id: idPatient }, where] }, select: { id: true } });
  if (!p) throw new ForbiddenError("Vous n'avez pas acces a ce dossier");
  return p.id;
}

export async function evolutionPourProfessionnel(user: JwtPayload, idPatient: string, codeLoinc: string): Promise<EvolutionResultatView> {
  return serieEvolution(await patientAccessible(user, idPatient), codeLoinc, false);
}

export async function examensSuivisPourProfessionnel(user: JwtPayload, idPatient: string): Promise<ExamenSuiviView[]> {
  return examensSuivis(await patientAccessible(user, idPatient), false);
}
