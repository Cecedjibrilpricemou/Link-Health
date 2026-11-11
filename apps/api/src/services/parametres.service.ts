// src/services/parametres.service.ts
// Parametres globaux de la plateforme, edites par le SUPER_ADMIN.
//
// Une seule ligne en base (id = "global"), stockee en JSON. Les defauts
// ci-dessous font foi : un parametre absent de la ligne (ajoute apres coup,
// ou ligne jamais creee) prend sa valeur par defaut. Les consommateurs
// (analytics, paiements, USSD) passent par getValeursParametres(), qui est
// mis en cache : la page Parametres est lue a chaque appel sensible, elle ne
// doit pas couter une requete SQL a chaque fois.
import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { cacheDel, withCache } from '../utils/cache';
import type {
  IdentitePlateformeView,
  ParametresIdentiteView,
  ParametresSystemeValeurs,
  ParametresSystemeView,
  UpdateParametresSystemeDto,
} from '@baobaoheath/shared-types';

const ID_GLOBAL = 'global';
const CACHE_KEY = 'parametres:systeme';
const CACHE_TTL_SECONDES = 60;

export const PARAMETRES_PAR_DEFAUT: ParametresSystemeValeurs = {
  // Seule source de verite pour le nom et les coordonnees de la plateforme.
  // Ces defauts ne servent qu'avant la premiere sauvegarde par le super-admin.
  identite: {
    nom: 'KÈNÈYA',
    nomCourt: '',
    slogan: 'Votre santé, plus simplement.',
    logoUrl: '',
    adresse: '',
    ville: 'Conakry',
    pays: 'Guinée',
    telephone: '',
    telephoneSupport: '',
    emailContact: '',
    emailSupport: '',
    emailExpediteur: '',
    siteWeb: '',
    facebook: '',
    whatsapp: '',
    copyright: '',
    devise: 'GNF',
  },
  facturation: {
    paiementEspeces: true,
    paiementOrangeMoney: true,
    paiementMomo: false,
    margePct: 15,
  },
  securite: {
    consentementDefaut: true,
  },
  alertes: {
    // Alignes sur les seuils historiques d'analytics.service.ts
    seuilPaludisme: 20,
    seuilEbola: 1,
    activerIA: true,
  },
  sync: {
    offlineMode: true,
    frequenceMinutes: 30,
    ussdTimeoutSecondes: 600,
  },
  // La duree de validite d'une ordonnance releve de la reglementation, pas du
  // code : la decision D2 du cahier des charges est encore en attente, donc
  // elle s'administre ici. 90 jours est la valeur de depart.
  prescription: {
    dureeValiditeJours: 90,
    longueurCodeVerification: 6,
    // Faux par defaut : c'est le fonctionnement actuel, ou un ASC prescrit et
    // la pharmacie delivre sans attendre un medecin. L'imposer sans que la
    // decision D2 soit tranchee bloquerait la delivrance dans les villages
    // sans medecin.
    signatureObligatoire: false,
    // EF-05-12 : un stupefiant ou un psychotrope ne se presente pas trois mois
    // apres avoir ete prescrit. 28 jours est l'usage le plus repandu ; comme le
    // reste, c'est un parametre et non une constante.
    dureeValiditeReglementeJours: 28,
    // EF-05-09 : plafond de ce qu'un prescripteur peut accorder d'un trait.
    renouvellementsMax: 6,
  },
  // Le comptoir d'officine (addendum du 2026-09-28, point 1.1).
  pharmacie: {
    // Sans plafond, une erreur de frappe ramene une vente a zero sans que rien
    // ne s'y oppose. 20 % est un depart prudent, administrable.

    // Vide par defaut : seuls les produits reglementes exigent une ordonnance
    // (EF-05-12), ce qui est acquis. La question E de l'addendum — faut-il en
    // soumettre d'autres categories ? — n'est pas tranchee, et la reponse se
    // posera ici sans toucher au code.
    categoriesExigeantOrdonnance: [],
  },
  // M5 : un appel sans preneur dans sa commune s'ouvre a toute la prefecture
  // au bout de ce delai. 10 minutes : assez pour qu'un pharmacien ou un
  // motard occupe reponde, pas assez pour qu'un patient se decourage.
  zones: {
    delaiElargissementCommandeMinutes: 10,
    delaiElargissementCourseMinutes: 10,
  },
};

type Section = keyof ParametresSystemeValeurs;
const SECTIONS = Object.keys(PARAMETRES_PAR_DEFAUT) as Section[];

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Fusionne des valeurs partielles (JSON en base ou DTO de mise a jour) avec
 * une base complete. Seules les cles connues des defauts sont conservees :
 * une cle inconnue en base (parametre retire) disparait silencieusement.
 */
export function fusionnerParametres(
  base: ParametresSystemeValeurs,
  partiel: unknown,
): ParametresSystemeValeurs {
  const resultat = {} as ParametresSystemeValeurs;
  const source = estObjet(partiel) ? partiel : {};

  for (const section of SECTIONS) {
    const sectionSource = estObjet(source[section]) ? source[section] : {};
    const sectionBase = base[section] as unknown as Record<string, unknown>;
    const fusion: Record<string, unknown> = {};
    for (const cle of Object.keys(sectionBase)) {
      const valeur = sectionSource[cle];
      fusion[cle] = valeur === undefined ? sectionBase[cle] : valeur;
    }
    (resultat as Record<Section, unknown>)[section] = fusion;
  }

  return resultat;
}

async function lireLigne() {
  return prisma.parametresSysteme.findUnique({ where: { id: ID_GLOBAL } });
}

/** Valeurs completes, pour les consommateurs internes (mises en cache). */
export async function getValeursParametres(): Promise<ParametresSystemeValeurs> {
  return withCache(CACHE_KEY, CACHE_TTL_SECONDES, async () => {
    const ligne = await lireLigne();
    return fusionnerParametres(PARAMETRES_PAR_DEFAUT, ligne?.valeurs);
  });
}

// ── Identite de la plateforme ───────────────────────────────────────

/**
 * Nom utilisable dans un SMS ou un menu USSD : alphabet GSM de base, donc
 * sans accents (« KÈNÈYA » → « KENEYA »). Un È dans un SMS ferait passer le
 * message en UCS-2 et diviserait sa longueur utile par deux.
 */
export function nomSms(identite: Pick<ParametresIdentiteView, 'nom' | 'nomCourt'>): string {
  const base = identite.nomCourt.trim() || identite.nom;
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .trim()
    .toUpperCase() || 'PLATEFORME';
}

/** Mention de pied de page : celle saisie, sinon « © <annee> <nom> — Tous droits reserves ». */
export function mentionCopyright(identite: Pick<ParametresIdentiteView, 'nom' | 'copyright'>): string {
  return identite.copyright.trim() || `© ${new Date().getFullYear()} ${identite.nom} — Tous droits réservés`;
}

/**
 * Identite complete pour les consommateurs internes (e-mails, SMS, USSD,
 * Swagger). Les derives (nomCourt, copyright) sont toujours renseignes.
 */
export async function getIdentitePlateforme(): Promise<IdentitePlateformeView> {
  const { identite } = await getValeursParametres();
  return {
    ...identite,
    nomCourt: nomSms(identite),
    copyright: mentionCopyright(identite),
  };
}

/** POST /admin-structure/parametres/logo — enregistre l'URL du logo televerse. */
export async function modifierLogo(userId: string, logoUrl: string): Promise<IdentitePlateformeView> {
  await modifierParametres(userId, { identite: { logoUrl } });
  return getIdentitePlateforme();
}

/** GET /admin-structure/parametres */
export async function getParametres(): Promise<ParametresSystemeView> {
  const ligne = await lireLigne();
  return {
    ...fusionnerParametres(PARAMETRES_PAR_DEFAUT, ligne?.valeurs),
    modifieLe: ligne?.modifieLe ?? null,
    idModifiePar: ligne?.idModifiePar ?? null,
  };
}

/** PUT /admin-structure/parametres — mise a jour partielle, section par section. */
export async function modifierParametres(
  userId: string,
  dto: UpdateParametresSystemeDto,
): Promise<ParametresSystemeView> {
  const ligne = await lireLigne();
  const actuelles = fusionnerParametres(PARAMETRES_PAR_DEFAUT, ligne?.valeurs);
  const valeurs = fusionnerParametres(actuelles, dto);

  const valeursJson = valeurs as unknown as Prisma.InputJsonValue;
  const sauvegarde = await prisma.parametresSysteme.upsert({
    where: { id: ID_GLOBAL },
    create: { id: ID_GLOBAL, valeurs: valeursJson, idModifiePar: userId },
    update: { valeurs: valeursJson, idModifiePar: userId },
  });

  await cacheDel(CACHE_KEY);

  return {
    ...valeurs,
    modifieLe: sauvegarde.modifieLe,
    idModifiePar: sauvegarde.idModifiePar,
  };
}
