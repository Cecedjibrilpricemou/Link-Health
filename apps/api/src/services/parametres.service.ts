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
import { ConflictError, ValidationError } from '../utils/app-error';
import type {
  IdentitePlateformeView,
  ParametresIdentiteView,
  ParametresPaysView,
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
  // R1 : au-dela de ce delai depuis l'ouverture, l'appel s'arrete au lieu
  // d'attendre sans fin. 60 minutes laissent passer les deux elargissements.
  zones: {
    delaiElargissementCommandeMinutes: 10,
    delaiElargissementCourseMinutes: 10,
    delaiFinalCommandeMinutes: 60,
    delaiFinalCourseMinutes: 60,
  },
  // M1 : une installation par pays. La Guinee est la configuration fournie,
  // pas une hypothese du code : un autre pays declare ici ses propres niveaux.
  pays: {
    code: 'GN',
    nom: 'Guinée',
    indicatifTelephone: '+224',
    // R14 : chiffres du numero national, sans l'indicatif (627 08 26 02).
    // 10 au Nigeria, 9 au Senegal : c'est un reglage, plus une regle ecrite.
    longueurNumero: 9,
    niveaux: [
      { code: 'region', libelles: { fr: 'Région', en: 'Region', pt: 'Região' } },
      { code: 'prefecture', libelles: { fr: 'Préfecture', en: 'Prefecture', pt: 'Prefeitura' } },
      { code: 'commune', libelles: { fr: 'Commune', en: 'Commune', pt: 'Comuna' } },
    ],
    niveauBase: 'commune',
    niveauElargissement: 'prefecture',
  },
};

/**
 * R1 : le delai final doit laisser passer les deux elargissements (voisines
 * puis prefecture, chacun apres le delai d'elargissement). Plus court, il
 * arreterait l'appel avant qu'il ait atteint toute la prefecture.
 */
export function verifierZones(zones: ParametresSystemeValeurs['zones']): void {
  if (zones.delaiFinalCommandeMinutes <= 2 * zones.delaiElargissementCommandeMinutes) {
    throw new ValidationError("Le delai final des commandes doit depasser deux fois le delai d'elargissement");
  }
  if (zones.delaiFinalCourseMinutes <= 2 * zones.delaiElargissementCourseMinutes) {
    throw new ValidationError("Le delai final des courses doit depasser deux fois le delai d'elargissement");
  }
}

/**
 * R10 : un produit reglemente (stupefiant, psychotrope) raccourcit la
 * validite d'une ordonnance. Reglee plus longue que la validite ordinaire,
 * elle ferait l'inverse : le produit le plus controle resterait delivrable le
 * plus longtemps.
 */
export function verifierPrescription(p: ParametresSystemeValeurs['prescription']): void {
  if (p.dureeValiditeReglementeJours > p.dureeValiditeJours) {
    throw new ValidationError(
      "La validite d'une ordonnance a produit reglemente ne peut pas depasser la validite ordinaire",
    );
  }
}

/** R11 : sans aucun moyen de paiement actif, plus rien ne pourrait etre paye. */
export function verifierFacturation(f: ParametresSystemeValeurs['facturation']): void {
  if (!f.paiementEspeces && !f.paiementOrangeMoney && !f.paiementMomo) {
    throw new ValidationError('Gardez au moins un moyen de paiement actif : sinon plus rien ne peut etre paye');
  }
}

/**
 * R12 : les montants sont enregistres comme des nombres, sans devise. Changer
 * la devise une fois des prix saisis les reetiquetterait sans les convertir
 * (50 000 GNF deviendraient 50 000 XOF). Un seul montant suffit a la figer.
 */
export async function montantsEnregistres(): Promise<boolean> {
  const presences = await Promise.all([
    prisma.facture.findFirst({ select: { id: true } }),
    prisma.venteComptoir.findFirst({ select: { id: true } }),
    prisma.commande.findFirst({ select: { id: true } }),
    prisma.course.findFirst({ select: { id: true } }),
    prisma.lotStock.findFirst({ select: { id: true } }),
    prisma.contratAssurance.findFirst({ select: { id: true } }),
    prisma.medicament.findFirst({ where: { prixUnitaireGnf: { gt: 0 } }, select: { id: true } }),
    prisma.consultation.findFirst({ where: { tarifGnf: { not: null } }, select: { id: true } }),
    prisma.examen.findFirst({ where: { prixGnf: { not: null } }, select: { id: true } }),
    prisma.plateauTechnique.findFirst({ where: { prixGnf: { not: null } }, select: { id: true } }),
  ]);
  return presences.some(Boolean);
}

/**
 * Le decoupage declare doit tenir debout : des codes uniques, et un niveau
 * d'elargissement **plus large** que le niveau de base — sinon un appel
 * « elargi » se retrecirait.
 */
export function verifierPays(pays: ParametresPaysView): void {
  const codes = pays.niveaux.map((n) => n.code);
  if (new Set(codes).size !== codes.length) {
    throw new ValidationError('Deux niveaux administratifs portent le meme code');
  }
  const base = codes.indexOf(pays.niveauBase);
  const elargissement = codes.indexOf(pays.niveauElargissement);
  if (base < 0) throw new ValidationError(`Niveau de base « ${pays.niveauBase} » absent des niveaux declares`);
  if (elargissement < 0) {
    throw new ValidationError(`Niveau d'elargissement « ${pays.niveauElargissement} » absent des niveaux declares`);
  }
  if (elargissement >= base) {
    throw new ValidationError("Le niveau d'elargissement doit etre plus large que le niveau de base");
  }
}

/**
 * R6 : le decoupage, c'est ce qui donne un sens aux adresses enregistrees -
 * les codes des niveaux **dans leur ordre**, le niveau de base (champ
 * `commune`) et le niveau d'elargissement (champ `prefecture`). Les libelles
 * n'en font pas partie : renommer « Commune » en « Sous-prefecture » a l'ecran
 * ne change pas ce que la base contient.
 */
export function decoupageChange(avant: ParametresPaysView, apres: ParametresPaysView): boolean {
  const codes = (p: ParametresPaysView) => p.niveaux.map((n) => n.code).join('>');
  return codes(avant) !== codes(apres)
    || avant.niveauBase !== apres.niveauBase
    || avant.niveauElargissement !== apres.niveauElargissement;
}

/**
 * Une adresse est-elle deja enregistree selon le decoupage ? Le referentiel,
 * et toute table qui porte une `prefecture` ou une `commune`.
 */
export async function adressesEnregistrees(): Promise<boolean> {
  const presences = await Promise.all([
    prisma.lieuGeo.findFirst({ select: { id: true } }),
    prisma.structureSante.findFirst({ select: { id: true } }),
    prisma.patientProfile.findFirst({ select: { id: true } }),
    prisma.livreurProfile.findFirst({ select: { id: true } }),
    prisma.commande.findFirst({ select: { id: true } }),
    prisma.course.findFirst({ select: { id: true } }),
    prisma.alerteEpidemique.findFirst({ select: { id: true } }),
  ]);
  return presences.some(Boolean);
}

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

  // R13 : un seul nom de pays, celui de l'installation. L'ancien champ libre
  // « Identite > Pays » pouvait le contredire ; il en est desormais le reflet.
  resultat.identite = { ...resultat.identite, pays: resultat.pays.nom };
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
    decoupageFige: await adressesEnregistrees(),
    deviseFigee: await montantsEnregistres(),
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

  if (dto.zones) verifierZones(valeurs.zones);
  if (dto.prescription) verifierPrescription(valeurs.prescription);
  if (dto.facturation) verifierFacturation(valeurs.facturation);
  // R12 : verifiee apres fusion et contre la valeur deja enregistree. Un
  // envoi qui repete la meme devise passe : seul un changement est refuse.
  if (valeurs.identite.devise !== actuelles.identite.devise && (await montantsEnregistres())) {
    throw new ConflictError(
      `La devise ne se modifie plus : des prix et des montants sont deja enregistres en ${actuelles.identite.devise}, `
      + 'et ils ne seraient pas convertis.',
    );
  }
  if (dto.pays) {
    verifierPays(valeurs.pays);
    // R6 : le decoupage donne leur sens aux champs `commune` et `prefecture`
    // deja enregistres. Une fois des donnees saisies, il ne bouge plus.
    if (decoupageChange(actuelles.pays, valeurs.pays) && (await adressesEnregistrees())) {
      throw new ConflictError(
        "Le decoupage du pays ne se modifie plus : des adresses sont deja enregistrees selon lui. "
        + 'Le nom, l indicatif et les libelles des niveaux restent modifiables.',
      );
    }
    // Un niveau retire alors que des lieux le portent laisserait le
    // referentiel incoherent : on le refuse plutot que de les orpheliner.
    const codes = valeurs.pays.niveaux.map((n) => n.code);
    const orphelins = await prisma.lieuGeo.count({ where: { niveau: { notIn: codes } } });
    if (orphelins > 0) {
      throw new ValidationError(
        `${orphelins} lieu(x) du referentiel portent un niveau retire : retirez-les ou gardez ce niveau`,
      );
    }
  }

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
    decoupageFige: await adressesEnregistrees(),
    deviseFigee: await montantsEnregistres(),
  };
}
