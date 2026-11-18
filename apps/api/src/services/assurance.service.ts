// src/services/assurance.service.ts
//
// Assurance et tiers payant (EF-09, addendum du 2026-09-28 point 5).
//
// Deux choses vivent ici, et une seule est difficile :
//
//   - le controle d'eligibilite, qui doit etre **opposable** : la reponse est
//     figee en base, jamais recalculee ;
//   - le calcul de la prise en charge, ligne par ligne. « Un reste a charge
//     sans explication se conteste au comptoir » : chaque ligne dit donc si
//     elle est couverte, a quel taux, et sinon pourquoi.
//
// Le calcul est une **fonction pure**, separee de toute lecture de base. C'est
// la partie que l'on ne peut pas se permettre d'avoir fausse : elle est
// testee pour elle-meme.
import { CategorieProduit, ModeEchangeAssureur, NiveauIdentite, Prisma, StatutContrat, TypePieceIdentite, TypeStructure } from '../config/generated/client/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../config/prisma';
import { filtreRecherchePatient } from './hopital.service';
import { normaliserTelephone } from './doublon.service';
import { getValeursParametres } from './parametres.service';
import { genererMotDePasseTemp } from './admin-structure.service';
import { hashPassword } from '../utils/password.utils';
import { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { logger } from '../config/logger';
import { estStructureHospitaliere, estStructureOfficinale } from '../utils/officine.util';
import { dossierDe } from './piece-agrement.service';
import type {
  AgentAssureurCreeView,
  AssureView,
  AssureurView,
  CatalogueAssureursView,
  CreerReglementDto,
  MonAssureurView,
  PatientContratRechercheView,
  ReglementView,
  SituationPharmacieView,
  ContratAssuranceView,
  ControleEligibiliteView,
  CouvertureLigneView,
  CreerAssureurDto,
  CreerContratDto,
  CreerContratCollectifDto,
  CreerContratIndividuelDto,
  CreerAdhesionAssuranceDto,
  CreerReglePoliceDto,
  AdhesionAssuranceView,
  AssureurResumeView,
  CarteAssuranceView,
  CarteAssuranceVerifieeView,
  ContratCollectifView,
  CreerRegleCouvertureDto,
  GarantieCategorieView,
  PatientAssureurRechercheView,
  PriseEnChargeView,
  RegleCouvertureView,
  RenouvelerContratDto,
  ResumePersonneAssureeView,
  TerminerAdhesionDto,
  TypeCouverture,
} from '@baobaoheath/shared-types';

/** Une ligne a chiffrer, telle que la caisse la connait. */
export type LigneAChiffrer = {
  idMedicament: string;
  libelle: string;
  categorie: CategorieProduit;
  /** Montant de la ligne avant remise de caisse : quantite x prix unitaire. */
  montantGnf: number;
};

export type ContratPourCalcul = {
  id: string;
  tauxBasePourcent: number;
  plafondAnnuelGnf: number;
  franchiseGnf: number;
};

export type ReglePourCalcul = {
  categorie: CategorieProduit;
  exclu: boolean;
  tauxPourcent: number | null;
  plafondLigneGnf: number;
  dateEffet: Date;
};

/**
 * La regle en vigueur pour une categorie a une date donnee.
 *
 * `dateEffet` permet de changer un taux sans reecrire le passe : une vente de
 * mars se chiffre avec la regle de mars, pas avec celle d'aujourd'hui
 * (EF-09-03). On retient donc la plus recente parmi celles deja entrees en
 * vigueur.
 */
export function regleEnVigueur(
  regles: ReglePourCalcul[],
  categorie: CategorieProduit,
  date: Date
): ReglePourCalcul | null {
  const candidates = regles
    .filter((r) => r.categorie === categorie && r.dateEffet <= date)
    .sort((a, b) => b.dateEffet.getTime() - a.dateEffet.getTime());
  return candidates[0] ?? null;
}

/**
 * Repartit une baisse du total sur les lignes, au prorata de leur part.
 *
 * Quand une franchise ou un plafond rabote la part de l'assureur, le detail
 * ligne par ligne doit continuer a s'additionner jusqu'au total : sinon
 * l'ecran affiche une somme qui ne tombe pas juste, et c'est precisement ce
 * qu'un patient conteste. Les restes de division vont aux plus grosses
 * lignes, pour que la somme soit exacte au franc.
 */
export function repartir(montants: number[], cible: number): number[] {
  const total = montants.reduce((t, m) => t + m, 0);
  if (total === 0 || cible >= total) return [...montants];
  if (cible <= 0) return montants.map(() => 0);

  const exacts = montants.map((m) => (m * cible) / total);
  const planchers = exacts.map(Math.floor);
  let reste = cible - planchers.reduce((t, p) => t + p, 0);

  // Les plus fortes parties decimales d'abord : c'est la repartition qui
  // s'ecarte le moins du prorata exact.
  const ordre = exacts
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);

  const resultat = [...planchers];
  for (const { i } of ordre) {
    if (reste <= 0) break;
    resultat[i] = (resultat[i] ?? 0) + 1;
    reste--;
  }
  return resultat;
}

export type PriseEnCharge = {
  lignes: (CouvertureLigneView & { idMedicament: string })[];
  montantAssureGnf: number;
  montantPatientGnf: number;
  notes: string[];
};

/**
 * Ce que l'assureur prend, ligne par ligne.
 *
 * **Un taux de 100 % ne veut pas dire « tout est pris »** : il s'applique a ce
 * qui est couvert, apres exclusions, puis dans la limite de la franchise et
 * des plafonds. Un assure a 100 % paie quand meme son lait infantile.
 *
 * `montantNetGnf` est ce que la caisse encaisse, remise deduite. La part de
 * l'assureur est calculee sur les lignes **avant remise**, puis plafonnee au
 * net : la remise du pharmacien profite donc au patient, pas a l'assureur.
 * C'est un choix, signale dans les questions ouvertes.
 */
export function calculerPriseEnCharge(
  lignes: LigneAChiffrer[],
  contrat: ContratPourCalcul,
  regles: ReglePourCalcul[],
  dejaConsommeGnf: number,
  montantNetGnf: number,
  date = new Date()
): PriseEnCharge {
  const notes: string[] = [];

  const detail = lignes.map((l) => {
    const regle = regleEnVigueur(regles, l.categorie, date);

    if (regle?.exclu) {
      return {
        idMedicament: l.idMedicament,
        libelle: l.libelle,
        montantGnf: l.montantGnf,
        couvert: false,
        tauxAppliquePourcent: 0,
        montantAssureGnf: 0,
        motifExclusion: `Categorie ${l.categorie} exclue par l'assureur`,
      };
    }

    const taux = regle?.tauxPourcent ?? contrat.tauxBasePourcent;
    if (taux <= 0) {
      return {
        idMedicament: l.idMedicament,
        libelle: l.libelle,
        montantGnf: l.montantGnf,
        couvert: false,
        tauxAppliquePourcent: 0,
        montantAssureGnf: 0,
        motifExclusion: `Taux de 0 % pour la categorie ${l.categorie}`,
      };
    }

    let montant = Math.floor((l.montantGnf * taux) / 100);
    if (regle && regle.plafondLigneGnf > 0 && montant > regle.plafondLigneGnf) {
      montant = regle.plafondLigneGnf;
      notes.push(`${l.libelle} : plafond de ${regle.plafondLigneGnf} GNF par ligne applique`);
    }

    return {
      idMedicament: l.idMedicament,
      libelle: l.libelle,
      montantGnf: l.montantGnf,
      couvert: true,
      tauxAppliquePourcent: taux,
      montantAssureGnf: montant,
      motifExclusion: null as string | null,
    };
  });

  let total = detail.reduce((t, l) => t + l.montantAssureGnf, 0);

  // La franchise est toujours a la charge du patient.
  if (contrat.franchiseGnf > 0 && total > 0) {
    const avant = total;
    total = Math.max(0, total - contrat.franchiseGnf);
    notes.push(`Franchise de ${Math.min(contrat.franchiseGnf, avant)} GNF a la charge du patient`);
  }

  // Le plafond annuel : ce qui a deja ete pris cette annee compte.
  if (contrat.plafondAnnuelGnf > 0) {
    const restant = Math.max(0, contrat.plafondAnnuelGnf - dejaConsommeGnf);
    if (total > restant) {
      total = restant;
      notes.push(
        restant === 0
          ? 'Plafond annuel atteint : plus rien n est pris en charge'
          : `Plafond annuel : il restait ${restant} GNF de couverture`
      );
    }
  }

  // L'assureur ne prend jamais plus que ce que la caisse encaisse.
  if (total > montantNetGnf) {
    total = montantNetGnf;
    notes.push('Part de l assureur ramenee au montant encaisse, remise deduite');
  }

  // Le detail doit s'additionner jusqu'au total : sinon l'ecran affiche une
  // somme qui ne tombe pas juste.
  const repartis = repartir(detail.map((l) => l.montantAssureGnf), total);

  return {
    lignes: detail.map((l, i) => ({
      idMedicament: l.idMedicament,
      libelle: l.libelle,
      montantGnf: l.montantGnf,
      couvert: l.couvert && (repartis[i] ?? 0) > 0,
      tauxAppliquePourcent: (repartis[i] ?? 0) > 0 ? l.tauxAppliquePourcent : 0,
      montantAssureGnf: repartis[i] ?? 0,
      motifExclusion: l.motifExclusion,
    })),
    montantAssureGnf: total,
    montantPatientGnf: montantNetGnf - total,
    notes,
  };
}

/**
 * Pourquoi un contrat ne couvre pas, a cette date. `null` = il couvre.
 *
 * Fonction pure, pour que chaque refus soit teste pour lui-meme : c'est le
 * motif que le comptoir lira au patient, et qui sera oppose a l'assureur.
 */
export function motifDInegibilite(
  contrat: {
    statut: StatutContrat;
    dateEffet: Date;
    dateFin: Date | null;
    carenceJours: number;
    periodeGraceJours?: number;
  },
  date: Date,
  // **Sans valeur par defaut, volontairement.** Un `= VERIFIEE` laissait tout
  // appelant qui l'oubliait contourner le verrou en silence — et le compte de
  // tests restait vert, ce qui est exactement le genre de faute qu'on ne voit
  // pas. Un garde-fou doit echouer ferme. En le rendant obligatoire, c'est le
  // compilateur qui force chaque appelant a trancher.
  identite: NiveauIdentite
): string | null {
  // **Le verrou d'identito-vigilance (EF-01-10).** Le tiers payant engage un
  // tiers : si l'identite est la mauvaise, c'est l'assureur qui paie pour
  // quelqu'un d'autre, et le vrai titulaire qui voit son plafond annuel
  // consomme sans le savoir.
  //
  // Ce verrou ne refuse **pas les soins** : le patient est servi, et paie
  // comptant. Il refuse seulement de faire payer un tiers sur une identite
  // declaree. Un agent d'accueil leve le verrou en verifiant une piece, ce
  // qui prend une minute — c'est le prix de l'engagement.
  if (identite === NiveauIdentite.PROVISOIRE) {
    return "Identite provisoire : le tiers payant demande une identite verifiee. Presentez une piece a l'accueil.";
  }

  if (contrat.statut === StatutContrat.RESILIE) return 'Contrat resilie';
  if (contrat.statut === StatutContrat.SUSPENDU) return 'Contrat suspendu';
  if (contrat.statut === StatutContrat.EXPIRE) return 'Contrat expire';
  if (date < contrat.dateEffet) return "Contrat pas encore en vigueur";
  if (contrat.dateFin && date >= finDeCouverture(contrat.dateFin, contrat.periodeGraceJours ?? 0)) {
    return 'Contrat expire';
  }

  if (contrat.carenceJours > 0) {
    const finCarence = new Date(contrat.dateEffet.getTime() + contrat.carenceJours * 86_400_000);
    if (date < finCarence) {
      return `Periode de carence en cours jusqu'au ${finCarence.toISOString().slice(0, 10)}`;
    }
  }
  return null;
}

const UN_JOUR_MS = 86_400_000;

/**
 * L'instant ou une couverture cesse, borne exclue.
 *
 * **Le jour de fin est couvert en entier** : une police « valable jusqu'au
 * 31 decembre » couvre l'achat du 31 a 18 h. S'y ajoutent les jours de grace,
 * seulement si le contrat en prevoit (0 par defaut). Le calcul est en UTC,
 * qui est l'heure legale de la Guinee.
 */
export function finDeCouverture(dateFin: Date, periodeGraceJours = 0): Date {
  const debutDuJour = Date.UTC(dateFin.getUTCFullYear(), dateFin.getUTCMonth(), dateFin.getUTCDate());
  return new Date(debutDuJour + (1 + periodeGraceJours) * UN_JOUR_MS);
}

/**
 * Le statut a afficher : un contrat ACTIF dont l'echeance est passee est
 * EXPIRE, sans attendre qu'une tache le reecrive. Le controle au comptoir ne
 * depend donc d'aucun traitement de nuit.
 */
export function statutEffectif(
  statut: StatutContrat,
  dateFin: Date | null,
  periodeGraceJours: number,
  date: Date
): StatutContrat {
  if (statut === StatutContrat.ACTIF && dateFin && date >= finDeCouverture(dateFin, periodeGraceJours)) {
    return StatutContrat.EXPIRE;
  }
  return statut;
}

/**
 * Pourquoi l'adhesion d'un beneficiaire ne couvre pas. `null` = elle couvre.
 *
 * Le motif de fin saisi par l'assureur (depart, licenciement...) n'est **pas**
 * repris : la pharmacie n'a besoin que de savoir que l'adhesion est terminee.
 * Pas de grace non plus : elle releve du contrat, pas du depart d'un salarie.
 */
export function motifAdhesion(
  adhesion: { statut: StatutContrat; dateEffet: Date; dateFin: Date | null },
  date: Date
): string | null {
  if (adhesion.statut === StatutContrat.RESILIE) return 'Adhesion du beneficiaire terminee';
  if (adhesion.statut === StatutContrat.SUSPENDU) return 'Adhesion du beneficiaire suspendue';
  if (adhesion.statut === StatutContrat.EXPIRE) return 'Adhesion du beneficiaire expiree';
  if (date < adhesion.dateEffet) return 'Adhesion du beneficiaire pas encore en vigueur';
  if (adhesion.dateFin && date >= finDeCouverture(adhesion.dateFin)) {
    return `Adhesion du beneficiaire terminee le ${adhesion.dateFin.toISOString().slice(0, 10)}`;
  }
  return null;
}

/**
 * Les regles qui s'appliquent a une police : les siennes d'abord, celles de
 * la compagnie pour les categories qu'elle ne regle pas.
 *
 * C'est ce qui permet a deux entreprises d'avoir des taux differents chez le
 * meme assureur. Une categorie reglee par la police ecarte **toutes** les
 * regles de la compagnie pour cette categorie : sinon une regle compagnie plus
 * recente reprendrait la main sur le taux negocie.
 */
export function reglesApplicables(
  reglesCompagnie: ReglePourCalcul[],
  reglesPolice: ReglePourCalcul[],
  date: Date
): ReglePourCalcul[] {
  const propres = new Set(reglesPolice.filter((r) => r.dateEffet <= date).map((r) => r.categorie));
  return [...reglesPolice, ...reglesCompagnie.filter((r) => !propres.has(r.categorie))];
}

/**
 * Le resume des garanties imprime sur la carte : une ligne par categorie qui
 * a une regle en vigueur. Les autres prennent le taux de base, affiche a part.
 */
export function resumeGaranties(
  tauxBasePourcent: number,
  regles: ReglePourCalcul[],
  date: Date
): GarantieCategorieView[] {
  const categories = [...new Set(regles.map((r) => r.categorie))].sort();
  return categories.flatMap((categorie) => {
    const r = regleEnVigueur(regles, categorie, date);
    if (!r) return [];
    return [{ categorie, exclu: r.exclu, tauxPourcent: r.exclu ? 0 : (r.tauxPourcent ?? tauxBasePourcent) }];
  });
}

/** La structure du demandeur, et son type. */
type StructureAssurance = {
  idStructure: string;
  type: TypeStructure;
  idStructureParente: string | null;
  roleOfficine: string | null;
};

async function structureDe(userId: string): Promise<StructureAssurance> {
  const u = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: {
      idStructure: true,
      structure: { select: { type: true, idStructureParente: true } },
      pharmacienProfile: { select: { roleOfficine: true } },
    },
  });
  if (!u?.idStructure || !u.structure) throw new ForbiddenError('Aucune structure rattachee a votre compte');
  return {
    idStructure: u.idStructure,
    type: u.structure.type,
    idStructureParente: u.structure.idStructureParente,
    roleOfficine: u.pharmacienProfile?.roleOfficine ?? null,
  };
}

function structuresAvecConventions(structure: StructureAssurance): string[] {
  if (!estStructureOfficinale(structure.type)) return [];
  return structure.idStructureParente
    ? [structure.idStructure, structure.idStructureParente]
    : [structure.idStructure];
}

async function assureurConventionne(idStructure: string, idAssureur: string): Promise<boolean> {
  const structure = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: { id: true, type: true, idStructureParente: true },
  });
  if (!structure || !estStructureOfficinale(structure.type)) return false;
  const idStructures = structure.idStructureParente
    ? [structure.id, structure.idStructureParente]
    : [structure.id];
  return Boolean(await prisma.structureAssureur.findFirst({
    where: { idAssureur, idStructure: { in: idStructures } },
    select: { id: true },
  }));
}

/**
 * Controle d'eligibilite au comptoir (addendum, point 5.1).
 *
 * La reponse est enregistree telle quelle. On ne la recalcule jamais : c'est
 * elle qui justifiera le tiers payant si l'assureur le contente plus tard.
 */
export async function verifierEligibilite(
  user: JwtPayload,
  idPatient: string,
  maintenant = new Date()
): Promise<ControleEligibiliteView> {
  const structureCompte = await structureDe(user.userId);
  const { idStructure } = structureCompte;

  const patient = await prisma.patientProfile.findUnique({
    where: { id: idPatient },
    select: {
      id: true,
      // Le tiers payant engage un tiers : il demande une identite verifiee.
      niveauIdentite: true,
      utilisateur: { select: { prenom: true, nom: true } },
    },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');

  // Le contrat le plus recemment entre en vigueur : un patient peut avoir
  // change d'assureur, l'ancien contrat restant en base.
  const contrat = await prisma.contratAssurance.findFirst({
    where: { idPatient },
    include: { assureur: { select: { id: true, nom: true, code: true, estActif: true } } },
    orderBy: { dateEffet: 'desc' },
  });

  let eligible = false;
  let motif: string | null = null;

  if (!contrat) {
    motif = "Aucun contrat d'assurance enregistre pour ce patient";
  } else if (!contrat.assureur.estActif) {
    motif = `Assureur ${contrat.assureur.nom} inactif sur la plateforme`;
  } else {
    motif = motifDInegibilite(contrat, maintenant, patient.niveauIdentite);
    if (!motif && !(await assureurConventionne(idStructure, contrat.idAssureur))) {
      motif = `L'assureur ${contrat.assureur.nom} n'est pas conventionne avec cette pharmacie`;
    }
    eligible = motif === null;
  }

  const trace = await prisma.controleEligibilite.create({
    data: {
      eligible,
      motif,
      numeroPolice: contrat?.numeroPolice ?? null,
      tauxBasePourcent: eligible ? contrat!.tauxBasePourcent : null,
      idContrat: contrat?.id ?? null,
      idPatient,
      idStructure,
      idControlePar: user.userId,
    },
  });

  return {
    id: trace.id,
    eligible,
    motif,
    numeroPolice: trace.numeroPolice,
    tauxBasePourcent: trace.tauxBasePourcent,
    creeLe: trace.creeLe.toISOString(),
    patient: { id: patient.id, prenom: patient.utilisateur.prenom, nom: patient.utilisateur.nom },
    assureur: contrat ? { id: contrat.assureur.id, nom: contrat.assureur.nom, code: contrat.assureur.code } : null,
  };
}

/** Les controles passes sur un patient, le plus recent en tete. */
export async function historiqueEligibilite(user: JwtPayload, idPatient: string): Promise<ControleEligibiliteView[]> {
  await structureDe(user.userId);
  const traces = await prisma.controleEligibilite.findMany({
    where: { idPatient },
    include: {
      patient: { select: { id: true, utilisateur: { select: { prenom: true, nom: true } } } },
      contrat: { include: { assureur: { select: { id: true, nom: true, code: true } } } },
      adhesionAssurance: {
        select: { contratCollectif: { select: { assureur: { select: { id: true, nom: true, code: true } } } } },
      },
    },
    orderBy: { creeLe: 'desc' },
    take: 50,
  });

  return traces.map((t) => {
    const assureur = t.contrat?.assureur ?? t.adhesionAssurance?.contratCollectif.assureur ?? null;
    return {
      id: t.id,
      eligible: t.eligible,
      motif: t.motif,
      numeroPolice: t.numeroPolice,
      tauxBasePourcent: t.tauxBasePourcent,
      creeLe: t.creeLe.toISOString(),
      patient: { id: t.patient.id, prenom: t.patient.utilisateur.prenom, nom: t.patient.utilisateur.nom },
      assureur: assureur ? { id: assureur.id, nom: assureur.nom, code: assureur.code } : null,
    };
  });
}

// ── La carte d'assurance ─────────────────────────────────────────────
//
// Le QR de la carte ne porte qu'un jeton opaque. Tout ce qui decide du tiers
// payant est relu ici, au moment du scan : une carte imprimee ou une capture
// d'ecran ne prouve pas qu'une couverture est encore active.

const REGLE_SELECT = {
  categorie: true, exclu: true, tauxPourcent: true, plafondLigneGnf: true, dateEffet: true,
} as const;

const ASSUREUR_CARTE_SELECT = {
  id: true, nom: true, code: true, estActif: true,
  regles: { select: REGLE_SELECT },
} as const;

// Le niveau d'identite est lu a chaque fois : sans lui, le verrou
// d'identito-vigilance se contournerait en passant directement a la caisse.
const PATIENT_CARTE_SELECT = {
  id: true, niveauIdentite: true,
  utilisateur: { select: { prenom: true, nom: true } },
} as const;

const CONTRAT_CARTE_INCLUDE = {
  assureur: { select: ASSUREUR_CARTE_SELECT },
  patient: { select: PATIENT_CARTE_SELECT },
  reglesPersonnalisees: { select: REGLE_SELECT },
} satisfies Prisma.ContratAssuranceInclude;

const ADHESION_CARTE_INCLUDE = {
  contratCollectif: {
    include: {
      assureur: { select: ASSUREUR_CARTE_SELECT },
      entreprise: { select: { raisonSociale: true } },
      regles: { select: REGLE_SELECT },
    },
  },
  patient: { select: PATIENT_CARTE_SELECT },
} satisfies Prisma.AdhesionAssuranceInclude;

type ContratCarte = Prisma.ContratAssuranceGetPayload<{ include: typeof CONTRAT_CARTE_INCLUDE }>;
type AdhesionCarte = Prisma.AdhesionAssuranceGetPayload<{ include: typeof ADHESION_CARTE_INCLUDE }>;

/** Une couverture, qu'elle vienne d'une police individuelle ou d'une adhesion. */
type Couverture = {
  jetonCarte: string;
  typeCouverture: TypeCouverture;
  /** Police individuelle, ou contrat collectif de l'adhesion. */
  idContrat: string;
  idContratAssurance: string | null;
  idAdhesionAssurance: string | null;
  numeroPolice: string;
  numeroAdherent: string;
  nomRegime: string | null;
  souscripteur: string | null;
  conditions: ContratPourCalcul;
  contrat: {
    statut: StatutContrat; dateEffet: Date; dateFin: Date | null;
    carenceJours: number; periodeGraceJours: number;
  };
  adhesion: { statut: StatutContrat; dateEffet: Date; dateFin: Date | null } | null;
  assureur: { id: string; nom: string; code: string; estActif: boolean; regles: ReglePourCalcul[] };
  reglesPolice: ReglePourCalcul[];
  patient: { id: string; niveauIdentite: NiveauIdentite; prenom: string; nom: string };
  /** La fiche d'identite tenue par la compagnie pour ce beneficiaire. */
  fiche: FichePourControle | null;
};

/** Ce que le controle lit de la fiche : rien d'autre ne sort vers le comptoir. */
export type FichePourControle = {
  photo: string | null;
  numeroPiece: string;
  dateExpirationPiece: Date | null;
};

const FICHE_CONTROLE_SELECT = { photo: true, numeroPiece: true, dateExpirationPiece: true } as const;

/** La fiche de la compagnie pour ce patient, s'il en a une. */
async function ficheDe(idAssureur: string, idPatient: string): Promise<FichePourControle | null> {
  return prisma.personneAssuree.findUnique({
    where: { idAssureur_idPatient: { idAssureur, idPatient } },
    select: FICHE_CONTROLE_SELECT,
  });
}

/**
 * Pourquoi l'identite ne suffit pas a engager l'assureur. `null` = elle suffit.
 *
 * **Deux chemins** (decision du 2026-10-21) : une identite verifiee a
 * l'accueil d'un hopital, ou une fiche de la compagnie qui porte la piece
 * d'identite, non expiree, et la photo. Dans ce second cas, la pharmacie
 * compare la photo avec la personne presente avant d'appliquer le tiers
 * payant : c'est ce qui empeche une carte d'etre pretee.
 */
export function motifIdentiteTiersPayant(
  niveauPatient: NiveauIdentite,
  fiche: FichePourControle | null,
  date: Date
): string | null {
  if (niveauPatient === NiveauIdentite.VERIFIEE) return null;
  if (fiche) {
    if (fiche.dateExpirationPiece && date >= finDeCouverture(fiche.dateExpirationPiece)) {
      return "Piece d'identite expiree sur la fiche de l'assure : la compagnie doit la mettre a jour";
    }
    if (!fiche.photo) {
      return "Photo manquante sur la fiche de l'assure : la compagnie doit l'ajouter";
    }
    return null;
  }
  return "Identite provisoire : le tiers payant demande une identite verifiee. Presentez une piece a l'accueil.";
}

function depuisContrat(c: ContratCarte, fiche: FichePourControle | null): Couverture {
  return {
    jetonCarte: c.jetonCarte,
    typeCouverture: 'INDIVIDUELLE',
    idContrat: c.id,
    idContratAssurance: c.id,
    idAdhesionAssurance: null,
    numeroPolice: c.numeroPolice,
    numeroAdherent: c.numeroPolice,
    nomRegime: null,
    souscripteur: null,
    conditions: {
      id: c.id, tauxBasePourcent: c.tauxBasePourcent,
      plafondAnnuelGnf: c.plafondAnnuelGnf, franchiseGnf: c.franchiseGnf,
    },
    contrat: c,
    adhesion: null,
    assureur: c.assureur,
    reglesPolice: c.reglesPersonnalisees,
    patient: {
      id: c.patient.id, niveauIdentite: c.patient.niveauIdentite,
      prenom: c.patient.utilisateur.prenom, nom: c.patient.utilisateur.nom,
    },
    fiche,
  };
}

function depuisAdhesion(a: AdhesionCarte, fiche: FichePourControle | null): Couverture {
  const g = a.contratCollectif;
  return {
    jetonCarte: a.jetonCarte,
    typeCouverture: 'COLLECTIVE',
    idContrat: g.id,
    idContratAssurance: null,
    idAdhesionAssurance: a.id,
    numeroPolice: g.numeroContrat,
    numeroAdherent: a.numeroAdherent,
    nomRegime: g.nomRegime,
    souscripteur: g.entreprise.raisonSociale,
    // Le plafond annuel d'un contrat collectif vaut par beneficiaire : la
    // consommation est comptee sur l'adhesion (voir `chiffrerParCarte`).
    conditions: {
      id: g.id, tauxBasePourcent: g.tauxBasePourcent,
      plafondAnnuelGnf: g.plafondAnnuelGnf, franchiseGnf: g.franchiseGnf,
    },
    contrat: g,
    adhesion: a,
    assureur: g.assureur,
    reglesPolice: g.regles,
    patient: {
      id: a.patient.id, niveauIdentite: a.patient.niveauIdentite,
      prenom: a.patient.utilisateur.prenom, nom: a.patient.utilisateur.nom,
    },
    fiche,
  };
}

async function couvertureParJeton(jetonCarte: string): Promise<Couverture | null> {
  const [contrat, adhesion] = await Promise.all([
    prisma.contratAssurance.findUnique({ where: { jetonCarte }, include: CONTRAT_CARTE_INCLUDE }),
    prisma.adhesionAssurance.findUnique({ where: { jetonCarte }, include: ADHESION_CARTE_INCLUDE }),
  ]);
  if (contrat) return depuisContrat(contrat, await ficheDe(contrat.idAssureur, contrat.idPatient));
  if (adhesion) {
    return depuisAdhesion(adhesion, await ficheDe(adhesion.contratCollectif.idAssureur, adhesion.idPatient));
  }
  return null;
}

/**
 * Ou trouver la photo de la carte presentee : le patient et la compagnie de la
 * couverture, et le fichier de sa fiche. `null` si la carte est inconnue.
 */
export async function photoDeLaCarte(
  jetonCarte: string
): Promise<{ idPatient: string; idAssureur: string; photo: string | null } | null> {
  const c = await couvertureParJeton(jetonCarte);
  if (!c) return null;
  return { idPatient: c.patient.id, idAssureur: c.assureur.id, photo: c.fiche?.photo ?? null };
}

/**
 * Pourquoi une couverture ne joue pas a cette date. `null` = elle joue.
 *
 * Trois niveaux, chacun avec son cycle de vie : la compagnie, le contrat
 * (individuel ou collectif de l'entreprise), puis l'adhesion du beneficiaire.
 */
export function motifCouverture(
  c: Pick<Couverture, 'typeCouverture' | 'assureur' | 'contrat' | 'adhesion' | 'patient'> & {
    fiche?: FichePourControle | null;
  },
  date: Date
): string | null {
  if (!c.assureur.estActif) return `Assureur ${c.assureur.nom} inactif sur la plateforme`;
  // L'identite d'abord : sans elle, rien n'engage l'assureur. Elle est jugee
  // ici, fiche comprise ; le controle du contrat la tient donc pour acquise.
  const motifIdentite = motifIdentiteTiersPayant(c.patient.niveauIdentite, c.fiche ?? null, date);
  if (motifIdentite) return motifIdentite;
  const motifContrat = motifDInegibilite(c.contrat, date, NiveauIdentite.VERIFIEE);
  if (motifContrat) {
    return c.typeCouverture === 'COLLECTIVE'
      ? motifContrat.replace(/^Contrat/, "Contrat collectif de l'entreprise")
      : motifContrat;
  }
  return c.adhesion ? motifAdhesion(c.adhesion, date) : null;
}

/** La fin effective : la plus proche entre l'adhesion et son contrat. */
function dateFinEffective(c: Couverture): Date | null {
  const fins = [c.adhesion?.dateFin, c.contrat.dateFin].filter((d): d is Date => d instanceof Date);
  return fins.length ? new Date(Math.min(...fins.map((d) => d.getTime()))) : null;
}

function statutCarte(c: Couverture, date: Date): StatutContrat {
  if (c.adhesion) {
    const statutAdhesion = statutEffectif(c.adhesion.statut, c.adhesion.dateFin, 0, date);
    if (statutAdhesion !== StatutContrat.ACTIF) return statutAdhesion;
  }
  return statutEffectif(c.contrat.statut, c.contrat.dateFin, c.contrat.periodeGraceJours, date);
}

function versCarteView(c: Couverture, date: Date): CarteAssuranceView {
  return {
    jetonCarte: c.jetonCarte,
    typeCouverture: c.typeCouverture,
    numeroPolice: c.numeroPolice,
    numeroAdherent: c.numeroAdherent,
    nomRegime: c.nomRegime,
    tauxBasePourcent: c.conditions.tauxBasePourcent,
    garanties: resumeGaranties(
      c.conditions.tauxBasePourcent,
      reglesApplicables(c.assureur.regles, c.reglesPolice, date),
      date
    ),
    dateEffet: (c.adhesion?.dateEffet ?? c.contrat.dateEffet).toISOString(),
    dateFin: dateFinEffective(c)?.toISOString() ?? null,
    statut: statutCarte(c, date),
    assureur: { id: c.assureur.id, nom: c.assureur.nom, code: c.assureur.code },
    souscripteur: c.souscripteur,
    beneficiaire: { prenom: c.patient.prenom, nom: c.patient.nom },
    photoDisponible: Boolean(c.fiche?.photo),
  };
}

function motifSansConvention(nomAssureur: string): string {
  return `L'assureur ${nomAssureur} n'est pas conventionne avec cette pharmacie`;
}

/**
 * Controle au comptoir, sur la carte scannee (lot assurance, point 4).
 *
 * La pharmacie ne recherche que la couverture de ce beneficiaire : elle ne
 * consulte jamais la liste des assures. La reponse est enregistree, refus
 * compris — c'est elle qui sera opposable si l'assureur conteste.
 */
export async function verifierCarteAssurance(
  user: JwtPayload,
  jetonCarte: string,
  maintenant = new Date()
): Promise<CarteAssuranceVerifieeView> {
  const { idStructure } = await structureDe(user.userId);
  const c = await couvertureParJeton(jetonCarte);
  if (!c) {
    // Pas de trace en base : sans carte, il n'y a pas de patient a y rattacher.
    logger.warn('[ASSURANCE] carte inconnue presentee au comptoir', { idStructure, parQui: user.userId });
    throw new NotFoundError("Carte d'assurance inconnue ou remplacee : le tiers payant ne peut pas etre applique");
  }

  let motif = motifCouverture(c, maintenant);
  if (!motif && !(await assureurConventionne(idStructure, c.assureur.id))) {
    motif = motifSansConvention(c.assureur.nom);
  }
  const eligible = motif === null;

  const trace = await prisma.controleEligibilite.create({
    data: {
      eligible,
      motif,
      numeroPolice: c.numeroPolice,
      tauxBasePourcent: eligible ? c.conditions.tauxBasePourcent : null,
      idContrat: c.idContratAssurance,
      idAdhesionAssurance: c.idAdhesionAssurance,
      idPatient: c.patient.id,
      idStructure,
      idControlePar: user.userId,
    },
    select: { id: true },
  });

  return {
    ...versCarteView(c, maintenant),
    idControle: trace.id,
    photoAComparer: Boolean(c.fiche?.photo),
    eligible,
    motif,
    patient: { id: c.patient.id, prenom: c.patient.prenom, nom: c.patient.nom },
  };
}

/** Le resultat d'un chiffrage : la prise en charge, ou le motif du refus. */
export type ResultatChiffrage =
  | {
      ok: true;
      prise: PriseEnCharge & {
        typeCouverture: TypeCouverture;
        idContrat: string;
        idContratAssurance: string | null;
        idAdhesionAssurance: string | null;
        idPatient: string;
        assureur: AssureurResumeView;
        /** La carte porte une photo : la pharmacie doit l'avoir comparee. */
        photoAComparer: boolean;
      };
    }
  | { ok: false; motif: string };

/**
 * Le chiffrage complet a partir de la carte : relit la couverture, ses
 * regles, ce qui a deja ete consomme cette annee, puis delegue au calcul pur.
 *
 * Un refus rend son motif, en clair : l'appelant decide s'il refuse la vente
 * ou s'il encaisse en paiement direct (EF-09-09).
 */
export async function chiffrerParCarte(
  jetonCarte: string,
  lignes: LigneAChiffrer[],
  montantNetGnf: number,
  idStructure: string,
  maintenant = new Date()
): Promise<ResultatChiffrage> {
  const c = await couvertureParJeton(jetonCarte);
  if (!c) return { ok: false, motif: "Carte d'assurance inconnue ou remplacee" };

  const motif = motifCouverture(c, maintenant);
  if (motif) return { ok: false, motif };
  if (!(await assureurConventionne(idStructure, c.assureur.id))) {
    return { ok: false, motif: motifSansConvention(c.assureur.nom) };
  }

  // Ce que l'assureur a deja pris cette annee pour ce beneficiaire : sur sa
  // police individuelle, ou sur son adhesion au contrat collectif. Les ventes
  // annulees ne comptent pas.
  const debutAnnee = new Date(maintenant.getFullYear(), 0, 1);
  const parBeneficiaire: Prisma.VenteComptoirWhereInput = c.idAdhesionAssurance
    ? { idAdhesionAssurance: c.idAdhesionAssurance }
    : { idContratAssurance: c.idContratAssurance };
  const consomme = await prisma.venteComptoir.aggregate({
    where: { ...parBeneficiaire, statut: 'PAYEE', creeLe: { gte: debutAnnee } },
    _sum: { montantAssureGnf: true },
  });

  const prise = calculerPriseEnCharge(
    lignes,
    c.conditions,
    reglesApplicables(c.assureur.regles, c.reglesPolice, maintenant),
    consomme._sum.montantAssureGnf ?? 0,
    montantNetGnf,
    maintenant
  );

  return {
    ok: true,
    prise: {
      ...prise,
      typeCouverture: c.typeCouverture,
      idContrat: c.idContrat,
      idContratAssurance: c.idContratAssurance,
      idAdhesionAssurance: c.idAdhesionAssurance,
      idPatient: c.patient.id,
      assureur: { id: c.assureur.id, nom: c.assureur.nom, code: c.assureur.code },
      photoAComparer: Boolean(c.fiche?.photo),
    },
  };
}

/**
 * Chiffre une prise en charge sans rien enregistrer, pour que le comptoir la
 * montre **avant** le paiement (addendum, point 5.4).
 */
export async function simulerPriseEnCharge(
  user: JwtPayload,
  jetonCarte: string,
  lignes: LigneAChiffrer[],
  montantNetGnf: number,
  maintenant = new Date()
): Promise<PriseEnChargeView> {
  const { idStructure } = await structureDe(user.userId);
  const resultat = await chiffrerParCarte(jetonCarte, lignes, montantNetGnf, idStructure, maintenant);
  if (!resultat.ok) throw new ValidationError(`Tiers payant refuse : ${resultat.motif}`);
  const p = resultat.prise;
  return {
    typeCouverture: p.typeCouverture,
    idContrat: p.idContrat,
    idAdhesionAssurance: p.idAdhesionAssurance,
    assureur: p.assureur,
    montantNetGnf,
    montantAssureGnf: p.montantAssureGnf,
    montantPatientGnf: p.montantPatientGnf,
    notes: p.notes,
    lignes: p.lignes,
  };
}

// ── Administration des assureurs, de leurs regles et des contrats ────
//
// Saisie par l'administration tant que les echanges automatiques avec les
// assureurs (modes PORTAIL et API, EF-09-02) ne sont pas conventionnes.

type AssureurAvecInclude = {
  id: string; nom: string; code: string; telephone: string | null; email: string | null;
  estActif: boolean; modeEchange: ModeEchangeAssureur;
  regles: {
    id: string; categorie: CategorieProduit; exclu: boolean;
    tauxPourcent: number | null; plafondLigneGnf: number; dateEffet: Date;
  }[];
  _count: { contrats: number };
};

const ASSUREUR_INCLUDE = {
  regles: { orderBy: [{ categorie: 'asc' }, { dateEffet: 'desc' }] },
  _count: { select: { contrats: true } },
} satisfies Prisma.AssureurInclude;

const ASSUREUR_ADMIN_INCLUDE = {
  ...ASSUREUR_INCLUDE,
  structure: {
    select: {
      utilisateurs: {
        where: { role: 'ASSUREUR' },
        take: 1,
        select: { id: true },
      },
    },
  },
} satisfies Prisma.AssureurInclude;

function versAssureurView(a: AssureurAvecInclude): AssureurView {
  return {
    id: a.id, nom: a.nom, code: a.code,
    telephone: a.telephone, email: a.email,
    estActif: a.estActif, modeEchange: a.modeEchange,
    nombreContrats: a._count.contrats,
    regles: a.regles.map((r) => ({
      id: r.id, categorie: r.categorie, exclu: r.exclu,
      tauxPourcent: r.tauxPourcent, plafondLigneGnf: r.plafondLigneGnf,
      dateEffet: r.dateEffet.toISOString(),
    })),
  };
}

/**
 * Creer un assureur.
 *
 * **Il ne peut pas exister sans sa structure.** C'est elle qui porte l'agrement
 * de la Banque Centrale, le RCCM et le siege autorise : l'enregistrement
 * `Assureur` ne porte que la configuration metier — le code imprime sur la
 * carte, le mode d'echange. Creer un assureur sans structure revenait a
 * l'inscrire sans aucune preuve qu'il est agree.
 *
 * L'agrement vient de la **Banque Centrale**, pas du ministere de la Sante :
 * autre autorite, autre reference (forme `D/2009/CAM/LOA/07`), et pas d'arrete
 * d'exploitation distinct. La structure se cree donc par la porte generique,
 * qui exige cette piece ; ici on verifie seulement qu'elle a bien ete produite.
 */
export async function creerAssureur(dto: CreerAssureurDto): Promise<AssureurView> {
  const code = dto.code.trim().toUpperCase();
  const existant = await prisma.assureur.findUnique({ where: { code } });
  if (existant) throw new ConflictError(`Un assureur porte deja le code ${code}`);

  if (!dto.idStructure) {
    throw new ValidationError(
      "Un assureur doit etre rattache a sa structure de type ASSURANCE : c'est elle qui porte son agrement."
    );
  }

  // La structure doit etre de type ASSURANCE, sinon ses agents heriteraient des
  // droits d'un hopital ou d'une pharmacie.
  const s = await prisma.structureSante.findUnique({
    where: { id: dto.idStructure },
    select: { type: true },
  });
  if (!s) throw new NotFoundError('Structure non trouvee');
  if (s.type !== TypeStructure.ASSURANCE) {
    throw new ValidationError('La structure rattachee doit etre de type ASSURANCE');
  }

  // **La ceinture qui rend le blocage reel.** La porte de creation exige
  // l'agrement, mais une structure anterieure a cette regle — ou issue de la
  // semence — n'en a pas. Sans ce controle, il suffirait de rattacher
  // l'assureur a l'une d'elles pour contourner l'exigence.
  const dossier = await dossierDe(dto.idStructure);
  if (!dossier.complet) {
    throw new ValidationError(
      `Le dossier de ${dossier.nom} est incomplet : il manque ${dossier.manquantes.join(', ')}.`
    );
  }

  const cree = await prisma.assureur.create({
    data: {
      nom: dto.nom.trim(),
      code,
      telephone: dto.telephone?.trim() || null,
      email: dto.email?.trim() || null,
      modeEchange: dto.modeEchange ?? 'MANUEL',
      idStructure: dto.idStructure ?? null,
    },
    include: ASSUREUR_INCLUDE,
  });
  return versAssureurView(cree);
}

export async function listerAssureurs(): Promise<AssureurView[]> {
  const assureurs = await prisma.assureur.findMany({
    include: ASSUREUR_INCLUDE,
    orderBy: { nom: 'asc' },
  });
  return assureurs.map(versAssureurView);
}

/** Liste d'administration avec indicateur pour eviter de creer un second agent. */
export async function listerAssureursAdmin(): Promise<AssureurView[]> {
  const assureurs = await prisma.assureur.findMany({
    include: ASSUREUR_ADMIN_INCLUDE,
    orderBy: { nom: 'asc' },
  });
  return assureurs.map((assureur) => ({
    ...versAssureurView(assureur),
    agentExistant: (assureur.structure?.utilisateurs.length ?? 0) > 0,
  }));
}

/** Assureurs utilisables dans la structure : ceux de l'hopital parent sont herites. */
export async function conventionsDeLaStructure(user: JwtPayload): Promise<AssureurView[]> {
  const structure = await structureDe(user.userId);
  const idsStructure = estStructureHospitaliere(structure.type)
    ? [structure.idStructure]
    : structuresAvecConventions(structure);
  if (idsStructure.length === 0) return [];

  const lignes = await prisma.structureAssureur.findMany({
    where: { idStructure: { in: idsStructure } },
    include: {
      assureur: { include: ASSUREUR_INCLUDE },
      structure: { select: { id: true } },
    },
    orderBy: { assureur: { nom: 'asc' } },
  });
  const uniques = new Map<string, (typeof lignes)[number]>();
  for (const ligne of lignes) {
    if (!ligne.assureur.estActif) continue;
    const precedente = uniques.get(ligne.idAssureur);
    if (!precedente || ligne.idStructure === structure.idStructure) {
      uniques.set(ligne.idAssureur, ligne);
    }
  }
  return [...uniques.values()].map((ligne) => ({
    ...versAssureurView(ligne.assureur),
    conventionHeritee: ligne.idStructure !== structure.idStructure,
  }));
}

/** Catalogue non nominatif : il ne contient aucune police ni donnée patient. */
export async function catalogueAssureurs(): Promise<AssureurView[]> {
  return (await listerAssureurs()).filter((assureur) => assureur.estActif);
}

async function structureAdministrable(user: JwtPayload): Promise<StructureAssurance> {
  const structure = await structureDe(user.userId);
  if (user.role === 'ADMIN_STRUCTURE' && estStructureHospitaliere(structure.type)) return structure;
  if (
    user.role === 'PHARMACIEN'
    && structure.roleOfficine === 'TITULAIRE'
    && estStructureOfficinale(structure.type)
    && !structure.idStructureParente
  ) {
    return structure;
  }
  throw new ForbiddenError('La gestion des conventions est reservee a votre hopital ou a une pharmacie independante');
}

export async function configurationCatalogueAssureurs(user: JwtPayload): Promise<CatalogueAssureursView> {
  const structure = await structureDe(user.userId);
  const conventionsModifiables = (user.role === 'ADMIN_STRUCTURE' && estStructureHospitaliere(structure.type))
    || (
      user.role === 'PHARMACIEN'
      && structure.roleOfficine === 'TITULAIRE'
      && estStructureOfficinale(structure.type)
      && !structure.idStructureParente
    );
  return {
    assureurs: await catalogueAssureurs(),
    conventionsModifiables,
    conventionsHeritees: estStructureOfficinale(structure.type) && Boolean(structure.idStructureParente),
  };
}

export async function ajouterConventionAssureur(user: JwtPayload, idAssureur: string): Promise<void> {
  const structure = await structureAdministrable(user);
  const assureur = await prisma.assureur.findUnique({
    where: { id: idAssureur },
    select: { id: true, estActif: true },
  });
  if (!assureur || !assureur.estActif) throw new NotFoundError('Assureur actif introuvable');
  await prisma.structureAssureur.upsert({
    where: { idStructure_idAssureur: { idStructure: structure.idStructure, idAssureur } },
    create: { idStructure: structure.idStructure, idAssureur },
    update: {},
  });
}

export async function retirerConventionAssureur(user: JwtPayload, idAssureur: string): Promise<void> {
  const structure = await structureAdministrable(user);
  await prisma.structureAssureur.deleteMany({
    where: { idStructure: structure.idStructure, idAssureur },
  });
}

/**
 * Ajoute une regle de couverture.
 *
 * On n'ecrase pas la precedente : chaque regle porte sa date d'effet, et le
 * calcul retient celle en vigueur a la date de la vente. Changer un taux ne
 * doit pas reecrire ce qui a deja ete chiffre (EF-09-03).
 */
export async function ajouterRegle(
  idAssureur: string,
  dto: CreerRegleCouvertureDto
): Promise<AssureurView> {
  const assureur = await prisma.assureur.findUnique({
    where: { id: idAssureur },
    select: { id: true },
  });
  if (!assureur) throw new NotFoundError('Assureur non trouve');

  const { exclu } = validerRegle(dto);

  await prisma.regleCouverture.create({
    data: {
      categorie: dto.categorie,
      exclu,
      tauxPourcent: exclu ? null : dto.tauxPourcent ?? null,
      plafondLigneGnf: dto.plafondLigneGnf ?? 0,
      dateEffet: dto.dateEffet ? new Date(dto.dateEffet) : new Date(),
      idAssureur,
    },
  });

  const apres = await prisma.assureur.findUniqueOrThrow({
    where: { id: idAssureur },
    include: ASSUREUR_INCLUDE,
  });
  return versAssureurView(apres);
}

/**
 * Ce dont la creation d'un contrat a besoin : le client Prisma, ou celui d'une
 * transaction quand le contrat naît avec la fiche de la personne.
 */
export type ClientContrat = Pick<typeof prisma, 'assureur' | 'patientProfile' | 'contratAssurance'>;

export async function creerContrat(
  dto: CreerContratDto & { periodeGraceJours?: number },
  client: ClientContrat = prisma
): Promise<ContratAssuranceView> {
  const [assureur, patient] = await Promise.all([
    client.assureur.findUnique({ where: { id: dto.idAssureur }, select: { id: true, nom: true, code: true } }),
    client.patientProfile.findUnique({
      where: { id: dto.idPatient },
      select: { id: true, utilisateur: { select: { prenom: true, nom: true } } },
    }),
  ]);
  if (!assureur) throw new NotFoundError('Assureur non trouve');
  if (!patient) throw new NotFoundError('Patient non trouve');

  const dateEffet = new Date(dto.dateEffet);
  if (Number.isNaN(dateEffet.getTime())) throw new ValidationError("Date d'effet invalide");
  const dateFin = dto.dateFin ? new Date(dto.dateFin) : null;
  if (dateFin && dateFin <= dateEffet) {
    throw new ValidationError("La date de fin doit etre posterieure a la date d'effet");
  }

  const numeroPolice = dto.numeroPolice.trim();
  const doublon = await client.contratAssurance.findFirst({
    where: { idAssureur: dto.idAssureur, numeroPolice },
    select: { id: true },
  });
  if (doublon) throw new ConflictError(`La police ${numeroPolice} existe deja chez cet assureur`);

  const cree = await client.contratAssurance.create({
    data: {
      numeroPolice,
      tauxBasePourcent: dto.tauxBasePourcent ?? 80,
      plafondAnnuelGnf: dto.plafondAnnuelGnf ?? 0,
      franchiseGnf: dto.franchiseGnf ?? 0,
      dateEffet,
      dateFin,
      carenceJours: dto.carenceJours ?? 0,
      periodeGraceJours: dto.periodeGraceJours ?? 0,
      jetonCarte: nouveauJetonCarte(),
      idAssureur: dto.idAssureur,
      idPatient: dto.idPatient,
    },
  });

  return {
    id: cree.id,
    numeroPolice: cree.numeroPolice,
    periodeGraceJours: cree.periodeGraceJours,
    tauxBasePourcent: cree.tauxBasePourcent,
    plafondAnnuelGnf: cree.plafondAnnuelGnf,
    franchiseGnf: cree.franchiseGnf,
    dateEffet: cree.dateEffet.toISOString(),
    dateFin: cree.dateFin ? cree.dateFin.toISOString() : null,
    carenceJours: cree.carenceJours,
    statut: cree.statut,
    assureur,
    patient: { id: patient.id, prenom: patient.utilisateur.prenom, nom: patient.utilisateur.nom },
    consommeAnneeGnf: 0,
  };
}

/** Les contrats d'un patient, avec ce qui a deja ete consomme cette annee. */
export async function contratsDuPatient(
  idPatient: string,
  maintenant = new Date()
): Promise<ContratAssuranceView[]> {
  const contrats = await prisma.contratAssurance.findMany({
    where: { idPatient },
    include: {
      assureur: { select: { id: true, nom: true, code: true } },
      patient: { select: { id: true, utilisateur: { select: { prenom: true, nom: true } } } },
    },
    orderBy: { dateEffet: 'desc' },
  });

  const debutAnnee = new Date(maintenant.getFullYear(), 0, 1);
  return Promise.all(contrats.map(async (c) => {
    const consomme = await prisma.venteComptoir.aggregate({
      where: { idContratAssurance: c.id, statut: 'PAYEE', creeLe: { gte: debutAnnee } },
      _sum: { montantAssureGnf: true },
    });
    return {
      id: c.id,
      numeroPolice: c.numeroPolice,
      tauxBasePourcent: c.tauxBasePourcent,
      plafondAnnuelGnf: c.plafondAnnuelGnf,
      franchiseGnf: c.franchiseGnf,
      dateEffet: c.dateEffet.toISOString(),
      dateFin: c.dateFin ? c.dateFin.toISOString() : null,
      carenceJours: c.carenceJours,
      statut: c.statut,
      assureur: c.assureur,
      patient: { id: c.patient.id, prenom: c.patient.utilisateur.prenom, nom: c.patient.utilisateur.nom },
      consommeAnneeGnf: consomme._sum.montantAssureGnf ?? 0,
    };
  }));
}

/**
 * Les cartes d'assurance du patient connecte (lot assurance, point 3) : une
 * par police individuelle et une par adhesion a un contrat collectif.
 *
 * Les cartes utilisables d'abord. Les anciennes restent visibles avec leur
 * statut : le patient comprend ainsi pourquoi une carte ne passe plus.
 */
export async function mesCartesAssurance(userId: string, maintenant = new Date()): Promise<CarteAssuranceView[]> {
  const patient = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true },
  });
  if (!patient) throw new NotFoundError('Dossier patient non trouve');

  const [contrats, adhesions] = await Promise.all([
    prisma.contratAssurance.findMany({
      where: { idPatient: patient.id },
      include: CONTRAT_CARTE_INCLUDE,
      orderBy: { dateEffet: 'desc' },
    }),
    prisma.adhesionAssurance.findMany({
      where: { idPatient: patient.id },
      include: ADHESION_CARTE_INCLUDE,
      orderBy: { dateEffet: 'desc' },
    }),
  ]);

  // Les fiches de toutes ses compagnies en une requete, rangees par compagnie.
  const fiches = await prisma.personneAssuree.findMany({
    where: { idPatient: patient.id },
    select: { idAssureur: true, ...FICHE_CONTROLE_SELECT },
  });
  const ficheParAssureur = new Map(fiches.map(({ idAssureur, ...f }) => [idAssureur, f]));

  return [
    ...contrats.map((c) => depuisContrat(c, ficheParAssureur.get(c.idAssureur) ?? null)),
    ...adhesions.map((a) => depuisAdhesion(a, ficheParAssureur.get(a.contratCollectif.idAssureur) ?? null)),
  ]
    .map((c) => versCarteView(c, maintenant))
    .sort((a, b) =>
      Number(b.statut === StatutContrat.ACTIF) - Number(a.statut === StatutContrat.ACTIF)
      || new Date(b.dateEffet).getTime() - new Date(a.dateEffet).getTime()
    );
}

// ── L'assureur gere ses contrats (lot assurance, points 2, 5 et 8) ───
//
// **La compagnie se deduit toujours du compte connecte** (`assureurDe`),
// jamais d'un identifiant envoye : sinon un agent agirait sur les contrats
// d'un concurrent en changeant un chiffre dans la requete.

/** 32 octets aleatoires : un jeton de carte qu'on ne devine pas. */
export function nouveauJetonCarte(): string {
  return randomBytes(32).toString('base64url');
}

function versRegleView(r: {
  id: string; categorie: CategorieProduit; exclu: boolean;
  tauxPourcent: number | null; plafondLigneGnf: number; dateEffet: Date;
}): RegleCouvertureView {
  return {
    id: r.id, categorie: r.categorie, exclu: r.exclu,
    tauxPourcent: r.tauxPourcent, plafondLigneGnf: r.plafondLigneGnf,
    dateEffet: r.dateEffet.toISOString(),
  };
}

/**
 * Les dates d'une adhesion, controlees contre son contrat collectif : elle ne
 * commence pas avant lui et ne finit pas apres. Sans date de fin, elle suit
 * le contrat.
 */
export function periodeAdhesion(
  contrat: { dateEffet: Date; dateFin: Date | null },
  dto: { dateEffet?: string | Date; dateFin?: string | Date },
  maintenant: Date
): { dateEffet: Date; dateFin: Date | null } {
  const dateEffet = dto.dateEffet ? dateValide(dto.dateEffet as string, "Date d'effet") : maintenant;
  const dateFin = dto.dateFin ? dateValide(dto.dateFin as string, 'Date de fin') : null;
  if (debutDuJour(dateEffet) < debutDuJour(contrat.dateEffet)) {
    throw new ValidationError("L'adhesion ne peut pas commencer avant le contrat collectif");
  }
  if (contrat.dateFin && (dateEffet >= finDeCouverture(contrat.dateFin) || (dateFin && dateFin > contrat.dateFin))) {
    throw new ValidationError("Les dates de l'adhesion doivent rester dans la periode du contrat collectif");
  }
  if (dateFin && dateFin < dateEffet) {
    throw new ValidationError("La date de fin doit etre posterieure ou egale a la date d'effet");
  }
  return { dateEffet, dateFin };
}

/**
 * Le contrat collectif de la compagnie, ouvert aux nouveaux beneficiaires :
 * il doit lui appartenir et etre en vigueur.
 */
export async function contratCollectifOuvert(idAssureur: string, idContrat: string, maintenant: Date) {
  const contrat = await prisma.contratCollectifAssurance.findFirst({
    where: { id: idContrat, idAssureur },
    select: { id: true, statut: true, dateEffet: true, dateFin: true, periodeGraceJours: true },
  });
  if (!contrat) throw new NotFoundError('Contrat collectif non trouve dans votre compagnie');
  if (statutEffectif(contrat.statut, contrat.dateFin, contrat.periodeGraceJours, maintenant) !== StatutContrat.ACTIF) {
    throw new ValidationError("Impossible d'ajouter un beneficiaire a un contrat inactif ou expire");
  }
  return contrat;
}

function dateValide(valeur: string, libelle: string): Date {
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${libelle} invalide`);
  return d;
}

function debutDuJour(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Une adhesion compte comme active tant que son statut l'est et que sa fin n'est pas passee. */
function filtreAdhesionsActives(maintenant: Date): Prisma.AdhesionAssuranceWhereInput {
  return {
    statut: StatutContrat.ACTIF,
    OR: [{ dateFin: null }, { dateFin: { gte: debutDuJour(maintenant) } }],
  };
}

function contratCollectifInclude(maintenant: Date) {
  return {
    entreprise: { select: { id: true, raisonSociale: true, identifiantLegal: true } },
    regles: { orderBy: [{ categorie: 'asc' }, { dateEffet: 'desc' }] },
    _count: { select: { adhesions: { where: filtreAdhesionsActives(maintenant) } } },
  } satisfies Prisma.ContratCollectifAssuranceInclude;
}

type ContratCollectifDetail = Prisma.ContratCollectifAssuranceGetPayload<{
  include: ReturnType<typeof contratCollectifInclude>;
}>;

function versContratCollectifView(c: ContratCollectifDetail, maintenant: Date): ContratCollectifView {
  return {
    id: c.id,
    numeroContrat: c.numeroContrat,
    nomRegime: c.nomRegime,
    tauxBasePourcent: c.tauxBasePourcent,
    plafondAnnuelGnf: c.plafondAnnuelGnf,
    franchiseGnf: c.franchiseGnf,
    dateEffet: c.dateEffet.toISOString(),
    dateFin: c.dateFin?.toISOString() ?? null,
    carenceJours: c.carenceJours,
    periodeGraceJours: c.periodeGraceJours,
    statut: statutEffectif(c.statut, c.dateFin, c.periodeGraceJours, maintenant),
    entreprise: c.entreprise,
    nombreAdhesionsActives: c._count.adhesions,
    regles: c.regles.map(versRegleView),
  };
}

export async function listerContratsCollectifs(
  user: JwtPayload,
  maintenant = new Date()
): Promise<ContratCollectifView[]> {
  const { id: idAssureur } = await assureurDe(user);
  const contrats = await prisma.contratCollectifAssurance.findMany({
    where: { idAssureur },
    include: contratCollectifInclude(maintenant),
    orderBy: [{ dateEffet: 'desc' }, { numeroContrat: 'asc' }],
  });
  return contrats.map((c) => versContratCollectifView(c, maintenant));
}

export async function creerContratCollectif(
  user: JwtPayload,
  dto: CreerContratCollectifDto,
  maintenant = new Date()
): Promise<ContratCollectifView> {
  const { id: idAssureur } = await assureurDe(user);
  const dateEffet = dateValide(dto.dateEffet as string, "Date d'effet");
  const dateFin = dateValide(dto.dateFin as string, 'Date de fin');
  if (dateFin <= dateEffet) throw new ValidationError("La date de fin doit etre posterieure a la date d'effet");

  const numeroContrat = dto.numeroContrat.trim();
  const doublon = await prisma.contratCollectifAssurance.findFirst({
    where: { idAssureur, numeroContrat },
    select: { id: true },
  });
  if (doublon) throw new ConflictError(`Le contrat ${numeroContrat} existe deja dans votre compagnie`);

  const identifiantLegal = dto.entreprise.identifiantLegal?.trim() || null;
  const cree = await prisma.$transaction(async (tx) => {
    // **Une entreprise deja connue n'est pas modifiee ici** : sa fiche est
    // partagee entre compagnies, et l'une ne doit pas renommer celle de l'autre.
    const existante = identifiantLegal
      ? await tx.entrepriseAssuree.findUnique({ where: { identifiantLegal }, select: { id: true, estActive: true } })
      : null;
    if (existante && !existante.estActive) throw new ValidationError('Cette entreprise est desactivee sur la plateforme');
    const idEntreprise = existante?.id ?? (await tx.entrepriseAssuree.create({
      data: {
        raisonSociale: dto.entreprise.raisonSociale.trim(),
        identifiantLegal,
        telephone: dto.entreprise.telephone?.trim() || null,
        email: dto.entreprise.email?.trim() || null,
      },
      select: { id: true },
    })).id;

    return tx.contratCollectifAssurance.create({
      data: {
        numeroContrat,
        nomRegime: dto.nomRegime.trim(),
        tauxBasePourcent: dto.tauxBasePourcent,
        plafondAnnuelGnf: dto.plafondAnnuelGnf ?? 0,
        franchiseGnf: dto.franchiseGnf ?? 0,
        dateEffet,
        dateFin,
        carenceJours: dto.carenceJours ?? 0,
        periodeGraceJours: dto.periodeGraceJours ?? 0,
        idEntreprise,
        idAssureur,
      },
      include: contratCollectifInclude(maintenant),
    });
  });

  logger.info('[ASSURANCE] contrat collectif cree', { idAssureur, idContrat: cree.id, parQui: user.userId });
  return versContratCollectifView(cree, maintenant);
}

/**
 * Renouveler un contrat collectif : enregistrer sa nouvelle echeance.
 *
 * Sans renouvellement, le contrat expire seul a sa date de fin. Les adhesions
 * sans date de fin propre suivent le contrat : elles n'ont pas a etre
 * ressaisies, et les cartes des beneficiaires restent les memes.
 */
export async function renouvelerContratCollectif(
  user: JwtPayload,
  idContrat: string,
  dto: RenouvelerContratDto,
  maintenant = new Date()
): Promise<ContratCollectifView> {
  const { id: idAssureur } = await assureurDe(user);
  const contrat = await prisma.contratCollectifAssurance.findFirst({
    where: { id: idContrat, idAssureur },
    select: { id: true, statut: true, dateEffet: true, dateFin: true },
  });
  if (!contrat) throw new NotFoundError('Contrat collectif non trouve dans votre compagnie');
  if (contrat.statut === StatutContrat.RESILIE || contrat.statut === StatutContrat.SUSPENDU) {
    throw new ValidationError('Un contrat resilie ou suspendu ne se renouvelle pas');
  }
  const nouvelleFin = dateValide(dto.dateFin as string, 'Date de fin');
  if (nouvelleFin <= contrat.dateEffet || (contrat.dateFin && nouvelleFin <= contrat.dateFin)) {
    throw new ValidationError("La nouvelle echeance doit etre posterieure a l'echeance actuelle");
  }

  const maj = await prisma.contratCollectifAssurance.update({
    where: { id: contrat.id },
    data: { dateFin: nouvelleFin, statut: StatutContrat.ACTIF },
    include: contratCollectifInclude(maintenant),
  });
  logger.info('[ASSURANCE] contrat collectif renouvele', {
    idAssureur, idContrat: contrat.id,
    ancienneFin: contrat.dateFin?.toISOString() ?? null,
    nouvelleFin: nouvelleFin.toISOString(),
    parQui: user.userId,
  });
  return versContratCollectifView(maj, maintenant);
}

export const ADHESION_VIEW_INCLUDE = {
  patient: { select: { id: true, utilisateur: { select: { prenom: true, nom: true } } } },
} satisfies Prisma.AdhesionAssuranceInclude;

/** La piece d'une fiche est-elle expiree ? Elle couvre jusqu'au soir de sa date. */
export function pieceExpiree(fiche: { dateExpirationPiece: Date | null }, date: Date): boolean {
  return Boolean(fiche.dateExpirationPiece && date >= finDeCouverture(fiche.dateExpirationPiece));
}

const FICHE_RESUME_SELECT = {
  id: true, idPatient: true, typePiece: true, numeroPiece: true, photo: true, dateExpirationPiece: true,
} as const;

/** Ce que les listes montrent d'une fiche d'assure. */
export function versResumePersonne(
  f: { id: string; typePiece: TypePieceIdentite; numeroPiece: string; photo: string | null; dateExpirationPiece: Date | null },
  date: Date
): ResumePersonneAssureeView {
  return {
    id: f.id,
    typePiece: f.typePiece,
    numeroPiece: f.numeroPiece,
    photoDisponible: Boolean(f.photo),
    pieceExpiree: pieceExpiree(f, date),
  };
}

/** Les fiches de la compagnie pour ces patients, rangees par patient. */
async function resumesParPatient(
  idAssureur: string,
  idsPatients: string[],
  date: Date
): Promise<Map<string, ResumePersonneAssureeView>> {
  if (idsPatients.length === 0) return new Map();
  const fiches = await prisma.personneAssuree.findMany({
    where: { idAssureur, idPatient: { in: idsPatients } },
    select: FICHE_RESUME_SELECT,
  });
  return new Map(fiches.map((f) => [f.idPatient, versResumePersonne(f, date)]));
}

export function versAdhesionView(
  a: Prisma.AdhesionAssuranceGetPayload<{ include: typeof ADHESION_VIEW_INCLUDE }>,
  maintenant: Date,
  personne: ResumePersonneAssureeView | null = null
): AdhesionAssuranceView {
  return {
    id: a.id,
    numeroAdherent: a.numeroAdherent,
    dateEffet: a.dateEffet.toISOString(),
    dateFin: a.dateFin?.toISOString() ?? null,
    statut: statutEffectif(a.statut, a.dateFin, 0, maintenant),
    motifFin: a.motifFin,
    finEnregistreeLe: a.finEnregistreeLe?.toISOString() ?? null,
    patient: { id: a.patient.id, prenom: a.patient.utilisateur.prenom, nom: a.patient.utilisateur.nom },
    personne,
  };
}

export async function listerAdhesions(
  user: JwtPayload,
  idContrat: string,
  maintenant = new Date()
): Promise<AdhesionAssuranceView[]> {
  const { id: idAssureur } = await assureurDe(user);
  const contrat = await prisma.contratCollectifAssurance.findFirst({
    where: { id: idContrat, idAssureur },
    select: { id: true },
  });
  if (!contrat) throw new NotFoundError('Contrat collectif non trouve dans votre compagnie');

  const adhesions = await prisma.adhesionAssurance.findMany({
    where: { idContratCollectif: contrat.id },
    include: ADHESION_VIEW_INCLUDE,
    orderBy: [{ statut: 'asc' }, { creeLe: 'desc' }],
  });
  const fiches = await resumesParPatient(idAssureur, adhesions.map((a) => a.idPatient), maintenant);
  return adhesions.map((a) => versAdhesionView(a, maintenant, fiches.get(a.idPatient) ?? null));
}

/**
 * Rattacher un beneficiaire (employe, ou ayant droit si le contrat le prevoit)
 * a un contrat collectif. Il recoit sa propre adhesion et sa propre carte.
 */
export async function ajouterAdhesion(
  user: JwtPayload,
  idContrat: string,
  dto: CreerAdhesionAssuranceDto,
  maintenant = new Date()
): Promise<AdhesionAssuranceView> {
  const { id: idAssureur } = await assureurDe(user);
  const contrat = await contratCollectifOuvert(idAssureur, idContrat, maintenant);

  const patient = await prisma.patientProfile.findUnique({
    where: { id: dto.idPatient },
    select: { id: true },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');

  const { dateEffet, dateFin } = periodeAdhesion(contrat, dto, maintenant);

  const numeroAdherent = dto.numeroAdherent.trim();
  const doublon = await prisma.adhesionAssurance.findFirst({
    where: { idContratCollectif: contrat.id, OR: [{ idPatient: patient.id }, { numeroAdherent }] },
    select: { idPatient: true },
  });
  if (doublon) {
    throw new ConflictError(doublon.idPatient === patient.id
      ? 'Cette personne est deja adherente de ce contrat'
      : `Le numero d'adherent ${numeroAdherent} est deja attribue dans ce contrat`);
  }

  const cree = await prisma.adhesionAssurance.create({
    data: {
      idContratCollectif: contrat.id,
      idPatient: patient.id,
      numeroAdherent,
      dateEffet,
      dateFin,
      jetonCarte: nouveauJetonCarte(),
    },
    include: ADHESION_VIEW_INCLUDE,
  });
  logger.info('[ASSURANCE] adhesion ajoutee', { idAssureur, idAdhesion: cree.id, parQui: user.userId });
  return versAdhesionView(cree, maintenant);
}

/**
 * Enregistrer la fin d'une adhesion : depart de l'entreprise, perte
 * d'eligibilite. Date d'effet, motif et auteur sont conserves.
 *
 * Une fin immediate (ou passee) resilie aussitot. Une fin future laisse le
 * beneficiaire couvert jusqu'a ce jour inclus.
 */
export async function terminerAdhesion(
  user: JwtPayload,
  idAdhesion: string,
  dto: TerminerAdhesionDto,
  maintenant = new Date()
): Promise<AdhesionAssuranceView> {
  const { id: idAssureur } = await assureurDe(user);
  const adhesion = await prisma.adhesionAssurance.findFirst({
    where: { id: idAdhesion, contratCollectif: { idAssureur } },
    select: { id: true, statut: true, dateEffet: true, dateFin: true, finEnregistreeLe: true },
  });
  if (!adhesion) throw new NotFoundError('Adhesion non trouvee dans votre compagnie');
  if (adhesion.statut !== StatutContrat.ACTIF || adhesion.finEnregistreeLe) {
    throw new ConflictError('La fin de cette adhesion est deja enregistree');
  }

  const effet = dto.dateEffet ? dateValide(dto.dateEffet as string, "Date d'effet") : maintenant;
  if (debutDuJour(effet) < debutDuJour(adhesion.dateEffet)) {
    throw new ValidationError("La fin ne peut pas preceder le debut de l'adhesion");
  }
  // Repousser la fin prevue prolongerait une couverture : ce n'est pas une fin.
  if (adhesion.dateFin && effet > adhesion.dateFin) {
    throw new ValidationError(
      `Cette adhesion se termine deja le ${adhesion.dateFin.toISOString().slice(0, 10)}`
    );
  }

  const immediate = effet <= maintenant;
  const maj = await prisma.adhesionAssurance.update({
    where: { id: adhesion.id },
    data: {
      statut: immediate ? StatutContrat.RESILIE : StatutContrat.ACTIF,
      dateFin: effet,
      motifFin: dto.motif.trim(),
      finEnregistreeLe: maintenant,
      idFinEnregistreePar: user.userId,
    },
    include: ADHESION_VIEW_INCLUDE,
  });
  logger.info('[ASSURANCE] fin d adhesion enregistree', {
    idAssureur, idAdhesion: adhesion.id, effet: effet.toISOString(), immediate, parQui: user.userId,
  });
  return versAdhesionView(maj, maintenant);
}

/** Une police individuelle, saisie par la compagnie elle-meme. */
export async function creerContratIndividuel(
  user: JwtPayload,
  dto: CreerContratIndividuelDto
): Promise<ContratAssuranceView> {
  const { id: idAssureur } = await assureurDe(user);
  return creerContrat({ ...dto, idAssureur });
}

/** Les controles communs a une regle de compagnie et a une regle de police. */
function validerRegle(dto: CreerRegleCouvertureDto): { exclu: boolean } {
  const exclu = dto.exclu ?? false;
  if (exclu && dto.tauxPourcent !== undefined) {
    throw new ValidationError("Une categorie exclue n'a pas de taux : choisissez l'un ou l'autre");
  }
  if (!exclu && dto.tauxPourcent === undefined && (dto.plafondLigneGnf ?? 0) === 0) {
    throw new ValidationError('Une regle doit porter une exclusion, un taux ou un plafond');
  }
  return { exclu };
}

/**
 * Un taux, une exclusion ou un plafond propre a une police. Il prime sur la
 * regle de la compagnie pour cette categorie, sans toucher aux autres polices.
 *
 * Comme pour les regles de compagnie, on n'ecrase rien : la date d'effet
 * decide, et une vente deja enregistree garde les montants figes a sa date.
 */
export async function ajouterReglePolice(user: JwtPayload, dto: CreerReglePoliceDto): Promise<RegleCouvertureView> {
  const { id: idAssureur } = await assureurDe(user);
  const individuelle = dto.typeCouverture === 'INDIVIDUELLE';
  const police = individuelle
    ? await prisma.contratAssurance.findFirst({ where: { id: dto.idContrat, idAssureur }, select: { id: true } })
    : await prisma.contratCollectifAssurance.findFirst({ where: { id: dto.idContrat, idAssureur }, select: { id: true } });
  if (!police) throw new NotFoundError('Police non trouvee dans votre compagnie');

  const { exclu } = validerRegle(dto);
  const regle = await prisma.regleCouverturePolice.create({
    data: {
      categorie: dto.categorie,
      exclu,
      tauxPourcent: exclu ? null : dto.tauxPourcent ?? null,
      plafondLigneGnf: dto.plafondLigneGnf ?? 0,
      dateEffet: dto.dateEffet ? dateValide(dto.dateEffet as string, "Date d'effet") : new Date(),
      idContratAssurance: individuelle ? police.id : null,
      idContratCollectif: individuelle ? null : police.id,
    },
  });
  logger.info('[ASSURANCE] regle de police ajoutee', { idAssureur, idPolice: police.id, parQui: user.userId });
  return versRegleView(regle);
}

/**
 * Retrouver la personne a rattacher, **par son numero de telephone exact**.
 *
 * Jamais par nom : la compagnie retrouve la personne qu'elle assure (le
 * numero figure sur le bulletin d'adhesion), elle ne parcourt pas la
 * population. Rien de medical ne sort d'ici.
 */
export async function rechercherPatientParTelephone(
  user: JwtPayload,
  telephone: string
): Promise<PatientAssureurRechercheView[]> {
  await assureurDe(user);
  // R14 : le numero complet, a la longueur du pays installe. Un numero partiel
  // retrouverait par sa fin des patients que la compagnie n'assure pas.
  const { pays: numerotation } = await getValeursParametres();
  const chiffres = normaliserTelephone(telephone, numerotation);
  if (chiffres.length !== numerotation.longueurNumero) {
    throw new ValidationError(
      `Saisissez le numero de telephone complet du beneficiaire (${numerotation.longueurNumero} chiffres)`,
    );
  }

  const patients = await prisma.patientProfile.findMany({
    where: { utilisateur: { telephone: { endsWith: chiffres } } },
    select: {
      id: true, dateNaissance: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
    take: 3,
  });
  return patients.map((p) => ({
    id: p.id,
    prenom: p.utilisateur.prenom,
    nom: p.utilisateur.nom,
    telephoneMasque: p.utilisateur.telephone.replace(/.(?=.{3})/g, String.fromCharCode(8226)),
    anneeNaissance: p.dateNaissance ? p.dateNaissance.getUTCFullYear() : null,
  }));
}

/**
 * Trouver la personne a qui rattacher une police (point 5.2).
 *
 * **L'administration nationale n'a pas le QR du patient sous les yeux.** Au
 * comptoir le patient est la et scanne ; ici l'assureur envoie une liste de
 * noms et de numeros de police, et c'est sur ces noms qu'il faut retomber.
 *
 * Le predicat est celui du comptoir (`filtreRecherchePatient`) : un patient
 * trouvable a l'admission doit l'etre ici, sinon sa police reste en suspens.
 *
 * **Rien de medical ne sort d'ici** : l'identite, et le numero masque comme
 * partout ailleurs. Il sert a distinguer deux Camara, pas a appeler qui que
 * ce soit.
 */
export async function rechercherPatientsPourContrat(q: string): Promise<PatientContratRechercheView[]> {
  const terme = q.trim();
  if (terme.length < 3) throw new ValidationError('Saisissez au moins 3 caracteres');

  const patients = await prisma.patientProfile.findMany({
    where: filtreRecherchePatient(terme),
    select: {
      id: true, sexe: true, dateNaissance: true, prefecture: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
    orderBy: [{ utilisateur: { nom: 'asc' } }, { utilisateur: { prenom: 'asc' } }],
    take: 20,
  });

  return patients.map((p) => ({
    id: p.id,
    prenom: p.utilisateur.prenom,
    nom: p.utilisateur.nom,
    sexe: p.sexe,
    dateNaissance: p.dateNaissance,
    prefecture: p.prefecture,
    telephoneMasque: p.utilisateur.telephone.replace(/.(?=.{3})/g, String.fromCharCode(8226)),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// L'espace de l'assureur (addendum du 2026-09-28, point 5.2)
//
// **Rien de medical ne sort d'ici.** L'assureur voit qui est assure chez lui,
// ce que sa compagnie a pris en charge et dans quelles pharmacies — jamais un
// produit delivre, une ordonnance ni un diagnostic. Un assureur qui lirait ce
// qu'on soigne pourrait refuser un contrat dessus.
//
// Tout est donc agrege : des montants et des comptes, pas des lignes de
// vente. Le decompte detaille, s'il devient necessaire, releve de l'echange
// conventionne avec la compagnie (EF-09-02).
// ═══════════════════════════════════════════════════════════════════

/**
 * La compagnie de l'agent connecte.
 *
 * **Elle se deduit de sa structure, jamais d'un identifiant qu'il enverrait.**
 * Accepter un `idAssureur` en parametre laisserait un agent de la SONAG
 * demander la situation d'un concurrent en changeant un chiffre dans l'URL.
 */
export async function assureurDe(user: JwtPayload): Promise<{ id: string }> {
  const agent = await prisma.utilisateur.findUnique({
    where: { id: user.userId },
    select: { idStructure: true },
  });
  if (!agent?.idStructure) {
    throw new ForbiddenError('Aucune compagnie rattachee a ce compte');
  }

  const assureur = await prisma.assureur.findUnique({
    where: { idStructure: agent.idStructure },
    select: { id: true },
  });
  if (!assureur) {
    // Le compte existe, sa structure aussi, mais aucune compagnie n'y est
    // rattachee : c'est une erreur de configuration, et le dire evite de
    // chercher du cote des droits.
    throw new ForbiddenError(
      "Cette structure n'est rattachee a aucune compagnie d'assurance",
    );
  }
  return assureur;
}

export async function monAssureur(user: JwtPayload): Promise<MonAssureurView> {
  const { id } = await assureurDe(user);
  const a = await prisma.assureur.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, nom: true, code: true, estActif: true, modeEchange: true,
      regles: {
        select: { id: true, categorie: true, exclu: true, tauxPourcent: true, plafondLigneGnf: true, dateEffet: true },
        orderBy: [{ categorie: 'asc' }, { dateEffet: 'desc' }],
      },
      _count: { select: { contrats: true } },
    },
  });

  return {
    id: a.id,
    nom: a.nom,
    code: a.code,
    estActif: a.estActif,
    modeEchange: a.modeEchange,
    regles: a.regles,
    nombreContrats: a._count.contrats,
    nombreContratsActifs: await prisma.contratAssurance.count({
      where: { idAssureur: id, statut: StatutContrat.ACTIF },
    }),
  };
}

/**
 * Les assures de la compagnie, et ce qu'elle a pris en charge cette annee.
 *
 * Le nom du patient y figure : c'est la personne que la compagnie assure, elle
 * la connait deja par son contrat. Son telephone, son adresse et sa date de
 * naissance, non — ils ne servent a rien ici.
 */
export async function mesAssures(user: JwtPayload, maintenant = new Date()): Promise<AssureView[]> {
  const { id } = await assureurDe(user);
  const debutAnnee = new Date(maintenant.getFullYear(), 0, 1);

  const [contrats, adhesions] = await Promise.all([
    prisma.contratAssurance.findMany({
      where: { idAssureur: id },
      select: {
        id: true, numeroPolice: true, statut: true, tauxBasePourcent: true,
        plafondAnnuelGnf: true, franchiseGnf: true, dateEffet: true, dateFin: true, periodeGraceJours: true,
        idPatient: true,
        patient: { select: { utilisateur: { select: { prenom: true, nom: true } } } },
        reglesPersonnalisees: { orderBy: [{ categorie: 'asc' }, { dateEffet: 'desc' }] },
      },
      orderBy: [{ statut: 'asc' }, { dateEffet: 'desc' }],
    }),
    prisma.adhesionAssurance.findMany({
      where: { contratCollectif: { idAssureur: id } },
      select: {
        id: true, numeroAdherent: true, statut: true, dateEffet: true, dateFin: true, idPatient: true,
        contratCollectif: {
          select: {
            id: true, numeroContrat: true, statut: true, tauxBasePourcent: true,
            plafondAnnuelGnf: true, franchiseGnf: true, dateFin: true, periodeGraceJours: true,
            entreprise: { select: { raisonSociale: true } },
          },
        },
        patient: { select: { utilisateur: { select: { prenom: true, nom: true } } } },
      },
      orderBy: [{ statut: 'asc' }, { dateEffet: 'desc' }],
    }),
  ]);
  if (contrats.length === 0 && adhesions.length === 0) return [];

  // Une agregation groupee par niveau plutot qu'une requete par assure : une
  // compagnie peut en avoir des milliers.
  const [consoContrats, consoAdhesions] = await Promise.all([
    contrats.length === 0 ? [] : prisma.venteComptoir.groupBy({
      by: ['idContratAssurance'],
      where: {
        idContratAssurance: { in: contrats.map((c) => c.id) },
        statut: 'PAYEE',
        creeLe: { gte: debutAnnee },
      },
      _sum: { montantAssureGnf: true },
      _count: { _all: true },
    }),
    adhesions.length === 0 ? [] : prisma.venteComptoir.groupBy({
      by: ['idAdhesionAssurance'],
      where: {
        idAdhesionAssurance: { in: adhesions.map((a) => a.id) },
        statut: 'PAYEE',
        creeLe: { gte: debutAnnee },
      },
      _sum: { montantAssureGnf: true },
      _count: { _all: true },
    }),
  ]);
  const parContrat = new Map(consoContrats.map((c) => [c.idContratAssurance, c]));
  const parAdhesion = new Map(consoAdhesions.map((c) => [c.idAdhesionAssurance, c]));

  const fiches = await resumesParPatient(
    id,
    [...new Set([...contrats.map((c) => c.idPatient), ...adhesions.map((a) => a.idPatient)])],
    maintenant
  );

  const individuels = contrats.map((c): AssureView => {
    const conso = parContrat.get(c.id);
    return {
      typeCouverture: 'INDIVIDUELLE',
      idContrat: c.id,
      idAdhesion: null,
      numeroAdherent: null,
      souscripteur: null,
      numeroPolice: c.numeroPolice,
      statut: statutEffectif(c.statut, c.dateFin, c.periodeGraceJours, maintenant),
      tauxBasePourcent: c.tauxBasePourcent,
      plafondAnnuelGnf: c.plafondAnnuelGnf,
      franchiseGnf: c.franchiseGnf,
      dateEffet: c.dateEffet,
      dateFin: c.dateFin,
      patient: { prenom: c.patient.utilisateur.prenom, nom: c.patient.utilisateur.nom },
      consommeAnneeGnf: conso?._sum.montantAssureGnf ?? 0,
      nombrePassages: conso?._count._all ?? 0,
      regles: c.reglesPersonnalisees.map(versRegleView),
      personne: fiches.get(c.idPatient) ?? null,
    };
  });

  const collectifs = adhesions.map((a): AssureView => {
    const g = a.contratCollectif;
    const conso = parAdhesion.get(a.id);
    const statutAdhesion = statutEffectif(a.statut, a.dateFin, 0, maintenant);
    const fins = [a.dateFin, g.dateFin].filter((d): d is Date => d instanceof Date);
    return {
      typeCouverture: 'COLLECTIVE',
      idContrat: g.id,
      idAdhesion: a.id,
      numeroAdherent: a.numeroAdherent,
      souscripteur: g.entreprise.raisonSociale,
      numeroPolice: g.numeroContrat,
      statut: statutAdhesion !== StatutContrat.ACTIF
        ? statutAdhesion
        : statutEffectif(g.statut, g.dateFin, g.periodeGraceJours, maintenant),
      tauxBasePourcent: g.tauxBasePourcent,
      plafondAnnuelGnf: g.plafondAnnuelGnf,
      franchiseGnf: g.franchiseGnf,
      dateEffet: a.dateEffet,
      dateFin: fins.length ? new Date(Math.min(...fins.map((d) => d.getTime()))) : null,
      patient: { prenom: a.patient.utilisateur.prenom, nom: a.patient.utilisateur.nom },
      consommeAnneeGnf: conso?._sum.montantAssureGnf ?? 0,
      nombrePassages: conso?._count._all ?? 0,
      // Les taux d'un contrat collectif se lisent sur le contrat, pas par assure.
      regles: [],
      personne: fiches.get(a.idPatient) ?? null,
    };
  });

  return [...individuels, ...collectifs];
}

/**
 * La situation par officine (point 5.2) : « ce qui a ete delivre, ce qui lui
 * est facture, ce qui est paye, ce qui reste du, et les ecarts ».
 *
 * Les ventes annulees ne comptent nulle part : une erreur de caisse corrigee
 * ne doit ni gonfler ce que la compagnie doit, ni entamer le plafond d'un
 * assure.
 */
export async function mesPharmacies(user: JwtPayload): Promise<SituationPharmacieView[]> {
  const { id } = await assureurDe(user);

  const ventes = await prisma.venteComptoir.groupBy({
    by: ['idStructure'],
    // Polices individuelles et adhesions aux contrats collectifs : la
    // compagnie doit les deux a l'officine.
    where: {
      OR: [
        { contratAssurance: { idAssureur: id } },
        { adhesionAssurance: { contratCollectif: { idAssureur: id } } },
      ],
      statut: 'PAYEE',
    },
    _sum: { montantAssureGnf: true, montantNetGnf: true },
    _count: { _all: true },
  });

  const reglements = await prisma.reglementAssureur.groupBy({
    by: ['idStructure'],
    where: { idAssureur: id },
    _sum: { montantGnf: true },
    _max: { creeLe: true },
  });

  // Une officine peut avoir ete reglee sans vente sur la periode retenue, ou
  // avoir vendu sans avoir encore ete reglee : les deux cotes comptent.
  const idsStructures = [...new Set([
    ...ventes.map((v) => v.idStructure),
    ...reglements.map((r) => r.idStructure),
  ])];
  if (idsStructures.length === 0) return [];

  const structures = await prisma.structureSante.findMany({
    where: { id: { in: idsStructures } },
    select: { id: true, nom: true, prefecture: true },
  });
  const parVente = new Map(ventes.map((v) => [v.idStructure, v]));
  const parReglement = new Map(reglements.map((r) => [r.idStructure, r]));

  return structures
    .map((s) => {
      const v = parVente.get(s.id);
      const r = parReglement.get(s.id);
      const facture = v?._sum.montantAssureGnf ?? 0;
      const paye = r?._sum.montantGnf ?? 0;
      return {
        idStructure: s.id,
        nom: s.nom,
        prefecture: s.prefecture,
        nombreVentes: v?._count._all ?? 0,
        montantDelivreGnf: v?._sum.montantNetGnf ?? 0,
        montantFactureGnf: facture,
        montantPayeGnf: paye,
        resteDuGnf: facture - paye,
        dernierReglementLe: r?._max.creeLe ?? null,
      };
    })
    // Le plus gros reste du en tete : c'est ce qu'on vient regarder.
    .sort((a, b) => b.resteDuGnf - a.resteDuGnf);
}

/**
 * Enregistrer un versement a une officine.
 *
 * Le versement couvre une periode et non des ventes nommees : c'est ainsi
 * qu'une compagnie regle une pharmacie, par bordereau. Rattacher chaque
 * virement a des lignes supposerait un rapprochement que personne ne fait.
 */
export async function enregistrerReglement(
  user: JwtPayload,
  dto: CreerReglementDto,
): Promise<ReglementView> {
  const { id: idAssureur } = await assureurDe(user);

  const structure = await prisma.structureSante.findUnique({
    where: { id: dto.idStructure },
    select: {
      id: true,
      nom: true,
      type: true,
    },
  });
  // Les reglements sont attaches a la pharmacie, pas a son hopital parent.
  if (!structure || !estStructureOfficinale(structure.type)) {
    throw new NotFoundError('Pharmacie introuvable');
  }

  const debut = new Date(dto.periodeDebut);
  const fin = new Date(dto.periodeFin);
  if (fin < debut) {
    throw new ValidationError('La fin de periode precede son debut');
  }
  if (dto.montantGnf <= 0) {
    throw new ValidationError('Le montant verse doit etre positif');
  }

  const r = await prisma.reglementAssureur.create({
    data: {
      idAssureur,
      idStructure: structure.id,
      montantGnf: dto.montantGnf,
      periodeDebut: debut,
      periodeFin: fin,
      reference: dto.reference?.trim() || null,
      idSaisiPar: user.userId,
    },
    select: {
      id: true, montantGnf: true, periodeDebut: true, periodeFin: true,
      reference: true, creeLe: true,
      structure: { select: { id: true, nom: true } },
      saisiPar: { select: { prenom: true, nom: true } },
    },
  });

  logger.info('[ASSURANCE] reglement enregistre', {
    idAssureur, idStructure: structure.id, montantGnf: dto.montantGnf, parQui: user.userId,
  });
  return r;
}

/** Les versements de la compagnie, le plus recent en tete. */
export async function mesReglements(user: JwtPayload): Promise<ReglementView[]> {
  const { id } = await assureurDe(user);
  return prisma.reglementAssureur.findMany({
    where: { idAssureur: id },
    select: {
      id: true, montantGnf: true, periodeDebut: true, periodeFin: true,
      reference: true, creeLe: true,
      structure: { select: { id: true, nom: true } },
      saisiPar: { select: { prenom: true, nom: true } },
    },
    orderBy: { creeLe: 'desc' },
    take: 100,
  });
}

/**
 * Creer le compte par lequel un assureur se connecte (addendum, point 5.2).
 *
 * **L'assureur n'appartient a aucun hopital.** Ses agents se connectent depuis
 * une structure de type ASSURANCE qui lui est propre — sans elle, ils
 * heriteraient des droits d'une pharmacie ou d'un etablissement de soins, et
 * donc d'un acces aux dossiers.
 *
 * La structure est creee a la volee si la compagnie n'en a pas : demander a
 * l'administration de declarer d'abord un « etablissement de sante » pour une
 * compagnie d'assurance n'aurait aucun sens a l'ecran, alors que le modele,
 * lui, en a besoin.
 *
 * Le mot de passe n'est rendu qu'une fois, et devra etre change.
 */
export async function creerAgentAssureur(
  auteur: JwtPayload,
  idAssureur: string,
  dto: { prenom: string; nom: string; telephone: string; email?: string; prefecture?: string },
): Promise<AgentAssureurCreeView> {
  if (!dto.email?.trim()) {
    throw new ValidationError('Une adresse email professionnelle est obligatoire pour se connecter');
  }

  const assureur = await prisma.assureur.findUnique({
    where: { id: idAssureur },
    select: { id: true, nom: true, code: true, idStructure: true },
  });
  if (!assureur) throw new NotFoundError('Assureur introuvable');

  const existant = await prisma.utilisateur.findUnique({
    where: { telephone: dto.telephone },
    select: { prenom: true, nom: true },
  });
  if (existant) {
    throw new ConflictError(
      `Ce numero appartient deja a ${existant.prenom} ${existant.nom}.`,
    );
  }

  const motDePasseTemporaire = genererMotDePasseTemp();
  const motDePasseHash = await hashPassword(motDePasseTemporaire);

  const agent = await prisma.$transaction(async (tx) => {
    let idStructure = assureur.idStructure;
    if (!idStructure) {
      const s = await tx.structureSante.create({
        data: {
          nom: assureur.nom,
          type: TypeStructure.ASSURANCE,
          // Faute de mieux : une compagnie n'a pas de prefecture au modele, et
          // la colonne est obligatoire. Conakry est le siege par defaut.
          prefecture: dto.prefecture?.trim() || 'Conakry',
        },
        select: { id: true },
      });
      idStructure = s.id;
      await tx.assureur.update({ where: { id: assureur.id }, data: { idStructure } });
    }

    const agentExistant = await tx.utilisateur.findFirst({
      where: { idStructure, role: 'ASSUREUR' },
      select: { id: true },
    });
    if (agentExistant) {
      throw new ConflictError('Cette compagnie a déjà un compte agent');
    }

    return tx.utilisateur.create({
      data: {
        telephone: dto.telephone.trim(),
        email: dto.email?.trim() || null,
        motDePasseHash,
        prenom: dto.prenom.trim(),
        nom: dto.nom.trim(),
        role: 'ASSUREUR',
        idStructure,
        estActif: true,
        doitChangerMotDePasse: true,
      },
      select: { id: true, prenom: true, nom: true, telephone: true },
    });
  });

  logger.info('[ASSURANCE] compte agent assureur cree', {
    idAssureur: assureur.id, idAgent: agent.id, parQui: auteur.userId,
  });

  return {
    agent,
    assureur: { id: assureur.id, nom: assureur.nom, code: assureur.code },
    motDePasseTemporaire,
  };
}
