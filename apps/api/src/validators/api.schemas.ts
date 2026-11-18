import { z } from 'zod';
import {
  CategorieProduit, ConsentScope, MotifBrisDeGlace, NiveauIdentite, Role, StatutDemandeRgpd, TypeDemandeRgpd, TypePieceIdentite,
} from '../config/generated/client/client';
import { ADRESSE_HTTP, cheminTeleverse } from '../utils/chemin-media';

const optionalEmail = z.string().email().optional().or(z.literal('').transform(() => undefined));
const phone = z.string().trim().min(6).max(30);
const id = z.string().trim().min(1);
/** Jeton opaque d'une carte d'assurance, tel que lu dans son QR. */
const jetonCarte = z.string().trim().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Carte d’assurance illisible');
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

/**
 * Photo de profil : le chemin d'un avatar televerse, ou une adresse http(s).
 * Le chemin est ce que renvoie le televersement (voir utils/chemin-media).
 */
const photoProfil = z.string().trim().max(500).refine(
  (v) => cheminTeleverse('avatars').test(v) || ADRESSE_HTTP.test(v),
  'Photo invalide : téléversez une image',
);
/** Logo : vide, le chemin d'un logo televerse, ou une adresse http(s). */
const logoOuVide = z.string().trim().max(300).refine(
  (v) => v === '' || cheminTeleverse('logos').test(v) || ADRESSE_HTTP.test(v),
  'Logo invalide : téléversez une image',
);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const registerSchema = z.object({
  telephone: phone,
  email: optionalEmail,
  motDePasse: z.string().min(6).max(128),
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  roleOfficine: z.enum(['ADJOINT', 'PREPARATEUR', 'CAISSIER']).default('ADJOINT'),
}).strict();

export const loginSchema = z.object({
  identifiant: z.string().trim().min(3).max(120),
  motDePasse: z.string().min(1).max(128),
}).strict();

export const verifyLoginOtpSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/, 'Le code OTP doit contenir 6 chiffres'),
}).strict();

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
}).strict();

export const changePasswordSchema = z.object({
  ancienMotDePasse: z.string().min(1).max(128).optional(),
  nouveauMotDePasse: z.string().min(6).max(128),
}).strict();

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(64).max(64),
  nouveauMotDePasse: z.string().min(6).max(128),
}).strict();

export const updateProfileSchema = z.object({
  prenom: z.string().trim().min(1).max(80).optional(),
  nom: z.string().trim().min(1).max(80).optional(),
  email: optionalEmail,
  telephone: phone.optional(),
  photoUrl: photoProfil.optional(),
}).strict();

// Changement de numero : mot de passe actuel, puis code envoye au nouveau numero.
export const demanderChangementTelephoneSchema = z.object({
  nouveauTelephone: phone,
  motDePasse: z.string().min(1).max(128),
}).strict();

export const confirmerChangementTelephoneSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Code a six chiffres'),
}).strict();

export const createPatientSchema = z.object({
  telephone: phone,
  motDePasse: z.string().min(6).max(128),
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  dateNaissance: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date invalide'),
  sexe: z.string().trim().min(1).max(20),
  prefecture: z.string().trim().min(1).max(80),
  sousPrefecture: z.string().trim().max(80).optional(),
  village: z.string().trim().max(120).optional(),
  groupeSanguin: z.string().trim().max(5).optional(),
  allergies: z.array(z.string().trim().min(1).max(80)).optional(),
  maladiesChroniques: z.array(z.string().trim().min(1).max(80)).optional(),
  urgenceNom: z.string().trim().max(120).optional(),
  urgenceTelephone: phone.optional(),
}).strict();

export const updatePatientSchema = createPatientSchema
  .omit({ telephone: true, motDePasse: true, dateNaissance: true, sexe: true, prefecture: true })
  .extend({
    langue: z.string().trim().min(2).max(10).optional(),
    photoUrl: photoProfil.optional(),
    // Une chaine vide efface le contact d'urgence : un numero qui n'est plus
    // le bon ne doit pas rester faute de pouvoir le retirer.
    urgenceTelephone: z.union([phone, z.literal('')]).optional(),
  })
  .partial()
  .strict();

// M3 : l'adresse du patient. La position et son effacement s'excluent : on
// ne peut pas a la fois donner et retirer sa position.
export const definirAdresseSchema = z.object({
  // R8 : en demenageant, le patient change aussi de prefecture.
  prefecture: z.string().trim().min(1).max(80).optional(),
  commune: z.string().trim().min(1).max(80),
  quartier: z.string().trim().min(1).max(80),
  pointRepere: z.string().trim().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  effacerPosition: z.boolean().optional(),
}).strict().refine(
  (d) => !(d.effacerPosition && (d.latitude !== undefined || d.longitude !== undefined)),
  { message: 'Donner et effacer sa position en meme temps n a pas de sens', path: ['effacerPosition'] },
);

// M1 : referentiel geographique generique (administration).
export const creerLieuGeoSchema = z.object({
  niveau: z.string().trim().min(1).max(30),
  nom: z.string().trim().min(1).max(80),
  idParent: id.optional(),
}).strict();

/** R7 : le nom propage aux adresses ; memes bornes qu'a la creation. */
export const renommerLieuGeoSchema = z.object({
  nom: z.string().trim().min(1).max(80),
}).strict();

export const modifierLieuGeoSchema = z.object({
  /** Identifiants des lieux limitrophes, du meme niveau. */
  voisins: z.array(id).max(30).optional(),
  aValider: z.boolean().optional(),
}).strict().refine((d) => d.voisins !== undefined || d.aValider !== undefined, {
  message: 'Rien a modifier',
});

export const updateStructurePrefereeSchema = z.object({
  idStructure: id.nullable().optional(),
}).strict();

/**
 * Liberation des resultats au patient (addendum du 2026-09-28). Le commentaire
 * est facultatif : un bilan sans particularite n'appelle pas d'explication, et
 * en exiger une produirait des « RAS » systematiques qui n'apprennent rien.
 */
/**
 * Le medecin fixe le creneau (addendum du 2026-09-28, point 3). L'accueil ne
 * propose plus d'heure : `orientationSchema` a perdu son `prevuLe`.
 */
/**
 * Prise de rendez-vous a distance (addendum du 2026-09-28, point 6). Le motif
 * est libre : c'est le patient qui l'ecrit, avec ses mots.
 */
/**
 * Facture d'approvisionnement (addendum du 2026-09-28, point 1.3). Chaque
 * ligne devient un lot : c'est la que la date de peremption se pose, et non
 * plus sur le stock.
 */
export const creerApprovisionnementSchema = z.object({
  fournisseur: z.string().trim().min(2).max(200),
  dateFacture: z.string().min(1),
  numeroFacture: z.string().trim().max(100).optional(),
  justificatifUrl: z.string().trim().max(500).optional(),
  lignes: z.array(z.object({
    idMedicament: id,
    quantite: positiveInt.max(100000),
    numeroLot: z.string().trim().max(100).optional(),
    datePeremption: z.string().optional(),
    prixAchatGnf: nonNegativeInt.optional(),
    unite: z.string().trim().max(40).optional(),
  })).min(1).max(200),
}).strict();

// ── Vente au comptoir (addendum, point 1.1) ──────────────────────────
//
// Les prix sont fixes : le schema strict rejette tout champ de remise.
export const creerVenteSchema = z.object({
  lignes: z.array(z.object({
    idMedicament: id,
    quantite: positiveInt.max(10000),
  })).min(1).max(100),
  modePaiement: z.enum(['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO']),
  numeroOperateur: z.string().trim().max(40).optional(),
  idPatient: id.optional(),
  idOrdonnance: id.optional(),
  // Tiers payant (EF-09). Le schema etant `.strict()`, oublier ce champ ici
  // fait rejeter la requete en 400 alors que le contrat et le service le
  // portent. C'est arrive le 2026-10-02, et seul le controle contre la vraie
  // API l'a vu : les tests unitaires appellent le service, pas Zod.
  avecAssurance: z.boolean().optional(),
  jetonCarteAssurance: jetonCarte.optional(),
  photoComparee: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
  if (data.avecAssurance && !data.jetonCarteAssurance) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['jetonCarteAssurance'],
      message: 'Scannez la carte d’assurance pour appliquer le tiers payant.',
    });
  }
});

export const ouvrirSessionCaisseSchema = z.object({
  montantOuvertureGnf: nonNegativeInt.max(2_000_000_000),
}).strict();

export const cloturerSessionCaisseSchema = z.object({
  montantCompteGnf: nonNegativeInt.max(2_000_000_000),
  motifEcart: z.string().trim().min(5).max(500).optional(),
}).strict();

export const rapportCaisseQuerySchema = z.object({
  periode: z.enum(['JOUR', 'MOIS', 'ANNEE']).default('JOUR'),
  date: z.string().date().optional(),
}).strict();

export const annulerVenteSchema = z.object({
  motif: z.string().trim().min(5).max(500),
  autorisationTitulaire: z.object({
    telephone: z.string().trim().min(6).max(30),
    motDePasse: z.string().min(1).max(256),
  }).strict().optional(),
}).strict();

const categorieProduitOfficineSchema = z.nativeEnum(CategorieProduit).refine(
  (categorie) => categorie !== CategorieProduit.MEDICAMENT,
  'Une officine ne peut creer localement que des produits non medicamenteux',
);

export const creerProduitOfficineSchema = z.object({
  libelle: z.string().trim().min(2).max(160),
  categorie: categorieProduitOfficineSchema,
  prixUnitaireGnf: positiveInt.max(2_000_000_000),
  seuilAlerte: z.coerce.number().int().min(0).max(100000).default(10),
  unite: z.string().trim().min(1).max(40).default('unite'),
}).strict();

export const modifierProduitOfficineSchema = z.object({
  libelle: z.string().trim().min(2).max(160).optional(),
  categorie: categorieProduitOfficineSchema.optional(),
  prixUnitaireGnf: positiveInt.max(2_000_000_000).optional(),
  seuilAlerte: z.coerce.number().int().min(0).max(100000).optional(),
  unite: z.string().trim().min(1).max(40).optional(),
}).strict().refine((dto) => Object.keys(dto).length > 0, 'Au moins un champ doit etre modifie');

export const creerDemandeRendezVousSchema = z.object({
  motif: z.string().trim().min(5).max(1000),
  idStructure: id.optional(),
  idMedecin: id.optional(),
}).strict();

export const accepterDemandeRendezVousSchema = z.object({
  prevuLe: z.string().min(1),
}).strict();

/** Un refus sans explication est un mur : le motif est obligatoire. */
export const refuserDemandeRendezVousSchema = z.object({
  motif: z.string().trim().min(5).max(500),
}).strict();

export const orienterDemandeRendezVousSchema = z.object({
  idMedecin: id,
}).strict();

export const fixerRendezVousSchema = z.object({
  prevuLe: z.string().min(1),
  motif: z.string().trim().max(500).optional(),
});

export const statutRendezVousSchema = z.object({
  statut: z.enum(['EN_CONSULTATION', 'TERMINE', 'ABSENT']),
});

export const libererResultatsSchema = z.object({
  commentaire: z.string().trim().max(2000).optional(),
});

export const roleAgentStructureSchema = z.enum(['ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'PHARMACIEN', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO']);

export const createAgentStructureSchema = z.object({
  telephone: phone,
  email: z.string().trim().email(),
  motDePasse: z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères.').max(128).optional(),
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  role: roleAgentStructureSchema,
  // Ou le patient devra se rendre. **Facultatif** : beaucoup d'hopitaux ne
  // numerotent pas leurs bureaux, et l'agent accompagne a pied. Ignore pour
  // les roles autres que MEDECIN.
  bureau: z.string().trim().min(1).max(120).optional(),
}).strict();

// --- Creation d'un patient au comptoir (EF-03-01) -------------------
//
// Pas de mot de passe : il est genere et remis au patient. Pas d'antecedents
// non plus — au comptoir on enregistre une identite, le reste se recueille en
// consultation.
export const creerPatientComptoirSchema = z.object({
  telephone: phone,
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  dateNaissance: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide'),
  sexe: z.enum(['M', 'F']),
  prefecture: z.string().trim().min(1).max(80),
  sousPrefecture: z.string().trim().max(80).optional(),
  email: optionalEmail,
}).strict();

// --- Le compte par lequel un assureur se connecte (addendum, point 5.2) ---
export const creerAgentAssureurSchema = z.object({
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  telephone: phone,
  email: z.string().trim().email(),
  prefecture: z.string().trim().max(80).optional(),
}).strict();

// --- Un versement de la compagnie a une officine (addendum, point 5.2) ---
//
// Pas d'`idAssureur` : il se deduit de la structure de l'agent connecte.
// L'accepter en entree laisserait un agent regler au nom d'un concurrent.
export const creerReglementSchema = z.object({
  idStructure: z.string().min(1, 'Choisissez une pharmacie'),
  montantGnf: z.number().int().positive('Le montant verse doit etre positif'),
  periodeDebut: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide'),
  periodeFin: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide'),
  reference: z.string().trim().max(120).optional(),
}).strict().refine((d) => new Date(d.periodeFin) >= new Date(d.periodeDebut), {
  message: 'La fin de periode precede son debut',
  path: ['periodeFin'],
});

/** Un bureau change : un medecin demenage, un service est redecoupe. */
export const definirBureauSchema = z.object({
  bureau: z.string().trim().min(1).max(120).nullable(),
}).strict();


/**
 * Les identifiants reglementaires d'une structure.
 *
 * Tous optionnels **ici**, volontairement : une structure publique n'a rien a
 * produire, et l'exigence d'une structure privee depend de son type. C'est
 * `validerIdentifiants` dans `piece-agrement.service` qui tranche, une seule
 * fois pour les trois portes de creation.
 *
 * Le RCCM n'est pas contraint par une expression reguliere : deux formes
 * circulent en Guinee et aucun texte officiel n'en fixe le format.
 */
export const identifiantsReglementaires = {
  rccm: z.string().trim().max(40).optional(),
  numeroAgrementCreation: z.string().trim().max(120).optional(),
  numeroAgrementExploitation: z.string().trim().max(120).optional(),
  lieuAutorise: z.string().trim().max(200).optional(),
} as const;

/**
 * Le point (0, 0) est en pleine mer, au large du Ghana.
 *
 * C'est la valeur que produit une saisie qui n'a pas abouti : un formulaire
 * vide coerce en zero, une geolocalisation qui echoue sans etre traitee. Une
 * structure posee la n'est pas mal placee, elle est perdue — et personne ne
 * comprend pourquoi. Le meme refus vaut deja pour la position qu'un titulaire
 * pose lui-meme (`definirPositionSchema`) : les deux portes se valent.
 */
const pasLePointZero = (d: { latitude?: number; longitude?: number }) =>
  !(d.latitude === 0 && d.longitude === 0);
const messagePointZero = {
  message: "Le point (0, 0) est en pleine mer : la position n'a pas ete relevee.",
  path: ['latitude'],
};

const structureBase = z.object({
  nom: z.string().trim().min(2).max(160),
  // `ASSURANCE` y figure desormais : c'est la structure de l'assureur qui
  // porte son agrement de la Banque Centrale, et aucune route ne savait la
  // creer — elle n'existait que par la semence. `PHARMACIE` reste absente :
  // elle a sa propre porte, qui cree aussi son pharmacien titulaire.
  type: z.enum(['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'LABORATOIRE', 'ASSURANCE']),
  prefecture: z.string().trim().min(1).max(80),
  commune: z.string().trim().min(1).max(80),
  quartier: z.string().trim().max(80).optional(),
  ...identifiantsReglementaires,
  adresse: z.string().trim().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  telephone: phone.optional(),
  admin: z.object({
    prenom: z.string().trim().min(1).max(80),
    nom: z.string().trim().min(1).max(80),
    telephone: phone,
    email: optionalEmail,
  }).strict(),
}).strict();

export const createStructureSchema = structureBase.refine(pasLePointZero, messagePointZero);

const pharmacieBase = z.object({
  nom: z.string().trim().min(2).max(160),
  idStructureParente: id.optional(),
  prefecture: z.string().trim().min(1).max(80),
  commune: z.string().trim().min(1).max(80).optional(),
  quartier: z.string().trim().max(80).optional(),
  ...identifiantsReglementaires,
  adresse: z.string().trim().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  telephone: phone.optional(),
  pharmacien: z.object({
    prenom: z.string().trim().min(1).max(80),
    nom: z.string().trim().min(1).max(80),
    telephone: phone,
    email: optionalEmail,
    motDePasse: z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères.').max(128).optional(),
  }).strict(),
}).strict();

export const createPharmacieSchema = pharmacieBase.refine(pasLePointZero, messagePointZero);

export const updateStructureSchema = structureBase
  .omit({ admin: true })
  .partial()
  .extend({ estActive: z.boolean().optional() })
  .strict()
  .refine(pasLePointZero, messagePointZero);

export const createAgentPharmacieSchema = z.object({
  telephone: phone,
  email: optionalEmail,
  motDePasse: z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères.').max(128).optional(),
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  // Le role choisi dans le formulaire. Absent du schema, il faisait refuser
  // toute creation (schema strict). Jamais TITULAIRE : un titulaire ne cree
  // pas un second titulaire.
  roleOfficine: z.enum(['ADJOINT', 'PREPARATEUR', 'CAISSIER']).optional(),
}).strict();

export const permissionTemporaireAgentSchema = z.object({
  roleOfficine: z.enum(['ADJOINT', 'PREPARATEUR', 'CAISSIER']),
  expireLe: z.string().datetime(),
}).strict();

export const etatAgentSchema = z.object({
  estActif: z.boolean(),
}).strict();

export const roleAgentSchema = z.object({
  roleOfficine: z.enum(['ADJOINT', 'PREPARATEUR', 'CAISSIER']),
}).strict();

export const reapprovisionnerStockSchema = z.object({
  idMedicament: id,
  quantiteAjoutee: positiveInt,
  unite: z.string().trim().min(1).max(40).optional(),
  datePeremption: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date invalide').optional(),
  margeGnf: nonNegativeInt.optional(),
}).strict();

export const ajusterLotStockSchema = z.object({
  quantiteComptee: nonNegativeInt,
  motif: z.string().trim().min(5).max(300),
}).strict();

export const mouvementsStockQuerySchema = z.object({
  limite: z.coerce.number().int().positive().max(200).default(100),
}).strict();

export const delivrerOrdonnanceSchema = z.object({
  modePaiement: z.enum(['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO']).optional(),
  quantiteDelivree: z.coerce.number().int().positive().optional(),
}).strict();

/**
 * Substituer un produit (EF-07-04).
 *
 * Le motif n'est pas facultatif : c'est le prescripteur qui le lira, et une
 * substitution muette est une modification de traitement decidee par
 * quelqu'un qui n'a pas vu le patient.
 */
export const substituerLigneSchema = z.object({
  idMedicamentDelivre: id,
  quantiteDelivree: z.coerce.number().int().positive().optional(),
  motif: z.string().trim().min(5).max(300),
}).strict();

/** Refuser une ligne (EF-07-05). Rien ne sort du stock, et on dit pourquoi. */
export const refuserLigneSchema = z.object({
  motif: z.string().trim().min(5).max(300),
}).strict();

// EF-07-01. Le service compare en majuscules : la casse saisie au comptoir ne
// doit pas faire echouer un controle legitime.
export const verifierOrdonnanceSchema = z.object({
  numero: z.string().trim().regex(/^OR-\d{4}-\d{6}$/i, 'Numero d ordonnance invalide'),
  codeVerification: z.string().trim().min(4).max(12),
}).strict();

// EF-05-05 : demande d'analyse des alertes avant prescription.
export const alertesPrescriptionSchema = z.object({
  idMedicament: id,
}).strict();

// ── P6 : commande pharmacie (EF-07) ──────────────────────────────────
export const lancerRechercheSchema = z.object({ idOrdonnance: id }).strict();

export const repondreDisponibiliteSchema = z.object({
  // Une pharmacie repond oui ou non : il n'y a pas de « peut-etre ». La
  // reponse partielle se traite par la delivrance ligne a ligne, plus tard.
  aTousLesProduits: z.boolean(),
}).strict();

export const retirerPriseEnChargeSchema = z.object({
  // Le patient attend une explication, pas un desistement muet.
  motif: z.string().trim().min(5).max(300),
}).strict();

export const choisirModeRemiseSchema = z.object({
  mode: z.enum(['RETRAIT_PHARMACIE', 'LIVRAISON']),
}).strict();

export const annulerCommandeSchema = z.object({
  // Le meme minimum que la retractation : le patient attend une explication,
  // et la base l'exige aussi.
  motif: z.string().trim().min(5).max(300),
}).strict();

// P8-a : seules les informations necessaires a une course sont acceptees.
export const proposerOffreCourseSchema = z.object({
  prixGnf: positiveInt,
  delaiMinutes: positiveInt,
}).strict();

export const choisirOffreCourseSchema = z.object({
  idOffre: id,
}).strict();

export const renoncerLivraisonSchema = z.object({
  motif: z.string().trim().min(5).max(300),
}).strict();

export const remettreAuMotardSchema = z.object({
  qrCodeScanne: z.string().trim().min(1).max(128),
}).strict();

export const confirmerReceptionCourseSchema = z.object({}).strict().optional();

/**
 * Payer le panier d'une commande.
 *
 * **Aucun montant.** Il est fige en base au chiffrage ; un montant qui vient
 * du navigateur est un montant qu'on peut baisser.
 */
/** Le numero de recu du comptoir : ce qui permet de rapprocher la caisse. */
export const encaisserCommandeSchema = z.object({
  referenceOperateur: z.string().trim().min(3).max(120),
}).strict();

export const payerCommandeSchema = z.object({
  // Les memes trois valeurs que `initierPaiementSchema`, parce que c'est
  // l'enum `ModePaiement` de la base. Une premiere version en inventait
  // sept — carte, virement, deux operateurs qui n'existent pas ici — et le
  // schema aurait accepte des valeurs que Prisma aurait refusees.
  modePaiement: z.enum(['ORANGE_MONEY', 'MTN_MOMO', 'ESPECES']),
  numeroOperateur: z.string().trim().min(6).max(30).optional(),
}).strict();

/**
 * Ouvrir la consultation d'une visite.
 *
 * **Aucun patient dans le corps** : il vient de l'episode. Le redemander
 * ouvrirait la porte a une consultation rattachee a une visite qui parle
 * d'autre chose. Le motif est optionnel et vaut par defaut celui de la visite.
 */
export const ouvrirConsultationSchema = z.object({
  motifPrincipal: z.string().trim().min(2).max(500).optional(),
}).strict();

export const createConsultationSchema = z.object({
  idPatient: id,
  motifPrincipal: z.string().trim().min(2).max(500),
  symptomes: z.array(z.string().trim().min(1).max(120)).optional(),
}).strict();

export const vitalsSchema = z.object({
  temperature: z.coerce.number().min(20).max(45).optional(),
  poidsKg: z.coerce.number().positive().max(300).optional(),
  tailleCm: z.coerce.number().positive().max(250).optional(),
  perimetreBrachial: z.coerce.number().positive().max(80).optional(),
  tensionSystolique: z.coerce.number().int().positive().max(300).optional(),
  tensionDiastolique: z.coerce.number().int().positive().max(200).optional(),
  frequenceCardiaque: z.coerce.number().int().positive().max(250).optional(),
  frequenceRespiratoire: z.coerce.number().int().positive().max(120).optional(),
  spo2: z.coerce.number().min(0).max(100).optional(),
  glycemie: z.coerce.number().positive().max(50).optional(),
}).strict();

export const diagnosticSchema = z.object({
  libelle: z.string().trim().min(2).max(200),
  codeIcd11: z.string().trim().max(50).optional(),
  typeDiagnostic: z.enum(['PRINCIPAL', 'DIFFERENTIEL', 'SECONDAIRE']).optional(),
  severite: z.enum(['LEGER', 'MODERE', 'SEVERE', 'CRITIQUE']).optional(),
  source: z.enum(['IA_LOCALE', 'IA_CLAUDE', 'MEDECIN', 'ASC']),
}).strict();

export const ordonnanceSchema = z.object({
  idMedicament: id,
  posologie: z.string().trim().min(1).max(300),
  frequence: z.string().trim().min(1).max(120),
  dureeJours: positiveInt.max(365),
  quantite: positiveInt.max(10000).optional(),
  instructions: z.string().trim().max(500).optional(),
  // EF-05-06 : pourquoi le prescripteur passe outre une alerte. Une longueur
  // minimale evite le « ok » qui ne documente rien.
  motifDepassement: z.string().trim().min(5).max(500).optional(),
  // EF-05-09 : le plafond reel vient du parametre systeme ; ici on borne
  // seulement pour ne pas accepter n'importe quel entier.
  renouvellementsAutorises: z.coerce.number().int().min(0).max(24).optional(),
}).strict();

export const referralSchema = z.object({
  idStructureCible: id,
  urgence: z.enum(['ROUTINE', 'URGENT', 'URGENCE_VITALE']),
  resumeClinique: z.string().trim().min(10).max(3000),
}).strict();

export const initierPaiementSchema = z.object({
  idConsultation: id,
  montantGnf: positiveInt.max(10_000_000),
  modePaiement: z.enum(['ORANGE_MONEY', 'MTN_MOMO', 'ESPECES']),
  numeroOperateur: z.string().trim().min(6).max(30).optional(),
}).strict();

export const confirmerPaiementSchema = z.object({
  referenceOperateur: z.string().trim().min(3).max(120),
}).strict();

export const syncChangesQuerySchema = z.object({
  since: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date invalide').optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  scope: z.string().trim().min(1).max(80).optional(),
}).strict();

const syncOperationSchema = z.enum(['CREATE', 'UPDATE', 'DELETE']);

export const syncPushSchema = z.object({
  mutations: z.array(z.object({
    clientMutationId: z.string().trim().min(8).max(120),
    deviceId: z.string().trim().min(2).max(120).optional(),
    entityType: z.string().trim().min(2).max(80),
    entityId: z.string().trim().min(1).max(120).optional(),
    operation: syncOperationSchema,
    payload: z.record(z.string(), z.unknown()),
    baseVersion: z.coerce.number().int().positive().optional(),
  }).strict()).min(1).max(100),
}).strict();

export const triageSchema = z.object({
  ageAnnees: z.coerce.number().int().min(0).max(130).optional(),
  symptomes: z.array(z.string().trim().min(1).max(120)).min(1).max(40),
  constantes: z.object({
    temperature: z.coerce.number().min(20).max(45).optional(),
    spo2: z.coerce.number().min(0).max(100).optional(),
    frequenceRespiratoire: z.coerce.number().int().positive().max(120).optional(),
    frequenceCardiaque: z.coerce.number().int().positive().max(250).optional(),
    tensionSystolique: z.coerce.number().int().positive().max(300).optional(),
    glycemie: z.coerce.number().positive().max(50).optional(),
  }).strict().optional(),
}).strict();

export const consentSchema = z.object({
  scope: z.enum(['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE']),
  actif: z.boolean(),
  source: z.string().trim().min(2).max(40).optional(),
  commentaire: z.string().trim().max(500).optional(),
}).strict();

export const ussdSessionSchema = z.object({
  sessionId: z.string().trim().min(3).max(120),
  phoneNumber: phone,
  text: z.string().max(500).optional().default(''),
}).strict();

/** Le patient choisit son code PIN USSD ; son mot de passe est exige. */
export const definirPinUssdSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'Le code PIN doit contenir 4 chiffres'),
  motDePasse: z.string().min(1).max(128),
}).strict();

export const createVaccinationSchema = z.object({
  idPatient: id,
  vaccinNom: z.string().trim().min(2).max(120),
  codeEpi: z.string().trim().max(40).optional(),
  numeroLot: z.string().trim().max(80).optional(),
  siteInjection: z.string().trim().max(120).optional(),
  reaction: z.string().trim().max(500).optional(),
  dateProchaineD: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide').optional(),
}).strict();

export const updateVaccinationSchema = z.object({
  reaction: z.string().trim().max(500).optional(),
  urlCertificat: z.string().url().optional(),
  dateProchaineD: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide').optional(),
}).strict();

export const createAscStockSchema = z.object({
  idMedicament: id,
  quantite: nonNegativeInt,
  unite: z.string().trim().min(1).max(40).optional(),
  seuilAlerte: nonNegativeInt.optional(),
  datePeremption: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide').optional(),
}).strict();

export const updateAscStockSchema = z.object({
  quantite: nonNegativeInt.optional(),
  seuilAlerte: nonNegativeInt.optional(),
  datePeremption: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide').optional(),
}).strict();

export const sendSmsSchema = z.object({
  telephone: phone,
  message: z.string().trim().min(1).max(480),
}).strict();

export const sendSmsMasseSchema = z.object({
  prefecture: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(480),
}).strict();

/**
 * Valider et signer une consultation.
 *
 * **`idOrdonnances` manquait ici alors que le service le lit** pour signer les
 * ordonnances choisies. Le schema etant `.strict()`, la cle faisait rejeter
 * tout le corps : l'ecran de validation du medecin recevait 400 a chaque
 * tentative, et c'est le seul qu'il ait. `ValiderConsultationDto`
 * (shared-types) decrivait le bon contrat depuis le debut.
 */
export const validerConsultationSchema = z.object({
  notesMedecin: z.string().trim().max(3000).optional(),
  tarifGnf: z.coerce.number().int().min(0).max(10_000_000).optional(),
  idOrdonnances: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
}).strict();

// `motifRefus` : nom du champ dans RepondreReferencementDto (shared-types) et
// dans medecin.service ; le schema strict rejetait la cle sous l'ancien nom.
export const repondreReferencementSchema = z.object({
  statut: z.enum(['ACCEPTE', 'REFUSE', 'COMPLETE']),
  motifRefus: z.string().trim().max(1000).optional(),
}).strict();

export const sendMessageSchema = z.object({
  contenu: z.string().trim().min(1).max(2000),
  idDestinataire: id,
}).strict();

// ─── Parametres systeme (super-admin) ────────────────────────────────────────
// Bornes alignees sur les curseurs de la page Parametres du web.
const texteCourt = z.string().trim().max(120);
const emailOuVide = z.string().trim().max(160).refine((v) => v === '' || z.string().email().safeParse(v).success, 'Adresse e-mail invalide');
const urlOuVide = z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'URL invalide (http:// ou https://)');
const telephoneOuVide = z.string().trim().max(30).refine((v) => v === '' || /^[+0-9 ().-]{6,30}$/.test(v), 'Numéro de téléphone invalide');

export const updateParametresSystemeSchema = z.object({
  identite: z.object({
    nom: z.string().trim().min(2).max(60),
    nomCourt: z.string().trim().max(20).regex(/^[A-Za-z0-9 .-]*$/, 'Lettres non accentuées et chiffres uniquement (SMS)'),
    slogan: texteCourt,
    logoUrl: logoOuVide,
    adresse: z.string().trim().max(200),
    ville: texteCourt,
    pays: texteCourt,
    telephone: telephoneOuVide,
    telephoneSupport: telephoneOuVide,
    emailContact: emailOuVide,
    emailSupport: emailOuVide,
    emailExpediteur: z.string().trim().max(60),
    siteWeb: urlOuVide,
    facebook: urlOuVide,
    whatsapp: telephoneOuVide,
    copyright: texteCourt,
    devise: z.string().trim().length(3).toUpperCase(),
  }).partial().strict().optional(),
  facturation: z.object({
    paiementEspeces: z.boolean(),
    paiementOrangeMoney: z.boolean(),
    paiementMomo: z.boolean(),
    margePct: z.coerce.number().int().min(0).max(50),
  }).partial().strict().optional(),
  securite: z.object({
    consentementDefaut: z.boolean(),
  }).partial().strict().optional(),
  alertes: z.object({
    seuilPaludisme: z.coerce.number().int().min(1).max(500),
    seuilEbola: z.coerce.number().int().min(1).max(50),
    activerIA: z.boolean(),
  }).partial().strict().optional(),
  sync: z.object({
    offlineMode: z.boolean(),
    frequenceMinutes: z.coerce.number().int().min(1).max(1440),
    ussdTimeoutSecondes: z.coerce.number().int().min(30).max(3600),
  }).partial().strict().optional(),

  // Ces deux sections manquaient. Le schema etant `.strict()`, l'onglet
  // « Ordonnances » de l'ecran d'administration envoyait un corps rejete en
  // 400 : il s'affichait, son bouton repondait, et rien ne s'enregistrait.
  // Constate le 2026-10-02 en ajoutant la section « pharmacie ».
  prescription: z.object({
    dureeValiditeJours: z.coerce.number().int().min(1).max(365),
    longueurCodeVerification: z.coerce.number().int().min(4).max(12),
    signatureObligatoire: z.boolean(),
    dureeValiditeReglementeJours: z.coerce.number().int().min(1).max(365),
    renouvellementsMax: z.coerce.number().int().min(0).max(24),
  }).partial().strict().optional(),

  pharmacie: z.object({
    categoriesExigeantOrdonnance: z.array(z.enum([
      'MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE',
      'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE',
    ])).max(8),
  }).partial().strict().optional(),

  // M5 : delai avant d'ouvrir un appel sans preneur a toute la prefecture.
  zones: z.object({
    delaiElargissementCommandeMinutes: z.coerce.number().int().min(1).max(1440),
    delaiElargissementCourseMinutes: z.coerce.number().int().min(1).max(1440),
    // R1 : au-dela, l'appel s'arrete (sans pharmacie, sans motard).
    delaiFinalCommandeMinutes: z.coerce.number().int().min(3).max(4320),
    delaiFinalCourseMinutes: z.coerce.number().int().min(3).max(4320),
  }).partial().strict().optional(),

  // M1 : le pays de l'installation et son decoupage administratif. La
  // coherence d'ensemble (niveau d'elargissement plus large que le niveau de
  // base) se verifie apres fusion, dans le service.
  pays: z.object({
    code: z.string().trim().regex(/^[A-Z]{2}$/, 'Code pays ISO a deux lettres majuscules'),
    nom: z.string().trim().min(1).max(80),
    indicatifTelephone: z.string().trim().regex(/^\+\d{1,4}$/, 'Indicatif de la forme +224'),
    // R14 : de 6 a 12 chiffres selon les pays (UIT : 15 au plus, indicatif compris).
    longueurNumero: z.coerce.number().int().min(6).max(12),
    niveaux: z.array(z.object({
      code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,29}$/, 'Code en minuscules, sans espace'),
      libelles: z.object({
        fr: z.string().trim().min(1).max(40),
        en: z.string().trim().min(1).max(40).optional(),
        pt: z.string().trim().min(1).max(40).optional(),
      }).strict(),
    }).strict()).min(2).max(6),
    niveauBase: z.string().trim().min(1).max(30),
    niveauElargissement: z.string().trim().min(1).max(30),
  }).partial().strict().optional(),
}).strict();

// ─── P1 Hopital : episodes de soins et demandes d'analyse (EF-03) ────────────
const texteLibre = (max: number) => z.string().trim().max(max);

export const createEpisodeSchema = z.object({
  idPatient: id,
  motif: z.string().trim().min(3).max(300),
  service: texteLibre(120).optional(),
  idResponsable: id.optional(),
  notes: texteLibre(2000).optional(),
}).strict();

export const updateEpisodeSchema = z.object({
  motif: z.string().trim().min(3).max(300).optional(),
  service: texteLibre(120).optional(),
  idResponsable: id.nullable().optional(),
  notes: texteLibre(2000).nullable().optional(),
  statut: z.enum(['OUVERT', 'EN_COURS']).optional(),
}).strict();

// `prevuLe` a ete retire le 2026-09-30 : l'accueil oriente, le medecin fixe
// le creneau (addendum, point 3). `.strict()` fait donc echouer un ancien
// appel qui enverrait encore une date, plutot que de l'ignorer en silence.
export const orientationSchema = z.object({
  service: texteLibre(120).optional(),
  idMedecin: id.optional(),
  motif: texteLibre(300).optional(),
}).strict().refine((v) => v.idMedecin || v.service, { message: 'Indiquez un medecin ou un service' });

export const createDemandeAnalyseSchema = z.object({
  idLaboratoire: id,
  urgence: z.enum(['ROUTINE', 'URGENT', 'URGENCE_VITALE']).optional(),
  indicationClinique: texteLibre(1000).optional(),
  consignesPatient: texteLibre(1000).optional(),
  examens: z.array(z.object({ idExamen: id, commentaire: texteLibre(300).optional() }).strict()).min(1).max(40),
}).strict();

/**
 * Les laboratoires proposes au medecin, avec la couverture des examens coches.
 *
 * `examens` est facultatif : a l'ouverture de l'ecran, rien n'est encore coche
 * et la liste se rend sans couverture.
 */
export const choixLaboratoiresQuerySchema = z.object({
  examens: z.union([z.string(), z.array(z.string())]).optional(),
  toutLePays: z.coerce.boolean().optional(),
}).strict();

/** La declaration complete du plateau technique, en un geste. */
export const declarerPlateauSchema = z.object({
  examens: z.array(z.object({
    idExamen: id,
    realise: z.boolean(),
    delaiHeures: z.coerce.number().int().positive().max(2160).nullish(),
    prixGnf: z.coerce.number().int().positive().max(10_000_000).nullish(),
  }).strict()).max(500),
}).strict();

export const conseillerStructureSchema = z.object({
  idStructureConseillee: id,
}).strict();

/**
 * Le depot de pieces sur une structure deja creee.
 *
 * Les fichiers eux-memes passent par multer, pas par zod : seuls les libelles
 * des pieces `AUTRE` arrivent en corps. La cle est le type de piece.
 */
export const deposerPiecesSchema = z.object({
  libelles: z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)).optional(),
}).strict();

export const annulerDemandeSchema = z.object({
  motif: z.string().trim().min(3).max(300),
}).strict();

export const episodesQuerySchema = paginationQuerySchema.extend({
  statut: z.enum(['OUVERT', 'EN_COURS', 'CLOS', 'ANNULE']).optional(),
  q: z.string().trim().max(100).optional(),
});

// ── P2 — Laboratoire (EF-04) ─────────────────────────────────────────
const lieuPrelevement = z.enum(['SUR_PLACE', 'DOMICILE']);

export const fileLaboQuerySchema = paginationQuerySchema.extend({
  statut: z.enum(['TRANSMISE', 'RECUE', 'PRELEVEE', 'EN_ANALYSE', 'VALIDEE', 'ANNULEE']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const planifierPrelevementSchema = z.object({
  lieu: lieuPrelevement,
  creneau: z.string().datetime({ offset: true }).optional(),
}).strict();

export const enregistrerPrelevementSchema = z.object({
  echantillons: z.array(z.object({ specimen: z.string().trim().min(2).max(40), commentaire: texteLibre(300).optional() }).strict()).max(20).optional(),
  lieu: lieuPrelevement.optional(),
}).strict();

export const saisirResultatsSchema = z.object({
  resultats: z.array(z.object({
    idLigne: id.optional(),
    codeLoinc: z.string().trim().min(1).max(20).optional(),
    valeur: z.string().trim().min(1).max(200),
    unite: z.string().trim().max(30).optional(),
    commentaire: texteLibre(500).optional(),
    idEchantillon: id.optional(),
    interpretation: z.enum(['NORMAL', 'ANORMAL', 'CRITIQUE']).optional(),
  }).strict().refine((r) => r.idLigne || r.codeLoinc, { message: 'Indiquez idLigne ou codeLoinc' })).min(1).max(100),
}).strict();

export const validerResultatsSchema = z.object({
  commentaire: texteLibre(2000).optional(),
}).strict();

export const evolutionQuerySchema = z.object({
  codeLoinc: z.string().trim().min(1).max(20),
  idPatient: id.optional(),
});

export const notificationsQuerySchema = paginationQuerySchema.extend({
  lu: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

// ── Assurance et tiers payant (EF-09, addendum point 5) ──────────────

const categorieProduit = z.enum([
  'MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE',
  'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE',
]);

export const verifierEligibiliteSchema = z.object({
  idPatient: id,
}).strict();

export const simulerPriseEnChargeSchema = z.object({
  jetonCarteAssurance: jetonCarte,
  lignes: z.array(z.object({
    idMedicament: id,
    libelle: z.string().trim().min(1).max(200),
    categorie: categorieProduit,
    montantGnf: nonNegativeInt.max(1_000_000_000),
  })).min(1).max(100),
  montantNetGnf: nonNegativeInt.max(1_000_000_000),
}).strict();

export const creerAssureurSchema = z.object({
  nom: z.string().trim().min(2).max(120),
  // Le code figure sur la carte de l'assure : court, sans espace, lisible.
  code: z.string().trim().min(2).max(16).regex(/^[A-Za-z0-9-]+$/, 'Lettres, chiffres et tirets uniquement'),
  telephone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(120).optional(),
  modeEchange: z.enum(['MANUEL', 'PORTAIL', 'API']).optional(),
  idStructure: id.optional(),
  ...identifiantsReglementaires,
}).strict();

// `exclu` et `tauxPourcent` ensemble seraient contradictoires ; le service le
// refuse, et une contrainte SQL le refuse aussi.
export const creerRegleCouvertureSchema = z.object({
  categorie: categorieProduit,
  exclu: z.boolean().optional(),
  tauxPourcent: z.coerce.number().int().min(0).max(100).optional(),
  plafondLigneGnf: nonNegativeInt.max(1_000_000_000).optional(),
  dateEffet: z.string().optional(),
}).strict();

export const creerContratAssuranceSchema = z.object({
  idAssureur: id,
  idPatient: id,
  numeroPolice: z.string().trim().min(2).max(60),
  tauxBasePourcent: z.coerce.number().int().min(0).max(100).optional(),
  plafondAnnuelGnf: nonNegativeInt.max(1_000_000_000).optional(),
  franchiseGnf: nonNegativeInt.max(1_000_000_000).optional(),
  dateEffet: z.string().min(1),
  dateFin: z.string().optional(),
  carenceJours: z.coerce.number().int().min(0).max(365).optional(),
}).strict();

export const verifierCarteAssuranceSchema = z.object({
  jetonCarte,
}).strict();

const dateAssurance = z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), 'Date invalide');

const finApresDebut = (value: { dateEffet?: string; dateFin?: string }) =>
  !value.dateFin || !value.dateEffet || Date.parse(value.dateFin) >= Date.parse(value.dateEffet);
const messageFinApresDebut = {
  message: 'La date de fin doit etre posterieure ou egale a la date d’effet.',
  path: ['dateFin'],
};
const graceJours = z.coerce.number().int().min(0).max(90).optional();
/** Un contrat dure au moins un jour : sa fin suit strictement son effet. */
const contratFinApresDebut = (value: { dateEffet?: string; dateFin?: string }) =>
  !value.dateFin || !value.dateEffet || Date.parse(value.dateFin) > Date.parse(value.dateEffet);
const messageContratFinApresDebut = {
  message: 'La date de fin doit etre posterieure a la date d’effet.',
  path: ['dateFin'],
};

export const creerContratCollectifSchema = z.object({
  entreprise: z.object({
    raisonSociale: z.string().trim().min(2).max(160),
    identifiantLegal: z.string().trim().min(2).max(80).optional(),
    telephone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(120).optional(),
  }).strict(),
  numeroContrat: z.string().trim().min(2).max(80),
  nomRegime: z.string().trim().min(2).max(120),
  tauxBasePourcent: z.coerce.number().int().min(0).max(100),
  plafondAnnuelGnf: nonNegativeInt.max(1_000_000_000).optional(),
  franchiseGnf: nonNegativeInt.max(1_000_000_000).optional(),
  dateEffet: dateAssurance,
  dateFin: dateAssurance,
  carenceJours: z.coerce.number().int().min(0).max(365).optional(),
  periodeGraceJours: graceJours,
}).strict().refine(contratFinApresDebut, messageContratFinApresDebut);

export const creerContratIndividuelSchema = z.object({
  idPatient: id,
  numeroPolice: z.string().trim().min(2).max(60),
  tauxBasePourcent: z.coerce.number().int().min(0).max(100).optional(),
  plafondAnnuelGnf: nonNegativeInt.max(1_000_000_000).optional(),
  franchiseGnf: nonNegativeInt.max(1_000_000_000).optional(),
  dateEffet: dateAssurance,
  dateFin: dateAssurance.optional(),
  carenceJours: z.coerce.number().int().min(0).max(365).optional(),
  periodeGraceJours: graceJours,
}).strict().refine(contratFinApresDebut, messageContratFinApresDebut);

export const creerAdhesionAssuranceSchema = z.object({
  idPatient: id,
  numeroAdherent: z.string().trim().min(2).max(80),
  dateEffet: dateAssurance.optional(),
  dateFin: dateAssurance.optional(),
}).strict().refine(finApresDebut, messageFinApresDebut);

export const terminerAdhesionSchema = z.object({
  motif: z.string().trim().min(5).max(500),
  dateEffet: dateAssurance.optional(),
}).strict();

export const renouvelerContratSchema = z.object({
  dateFin: dateAssurance,
}).strict();

export const creerReglePoliceSchema = z.object({
  typeCouverture: z.enum(['INDIVIDUELLE', 'COLLECTIVE']),
  idContrat: id,
  categorie: categorieProduit,
  exclu: z.boolean().optional(),
  tauxPourcent: z.coerce.number().int().min(0).max(100).optional(),
  plafondLigneGnf: nonNegativeInt.max(1_000_000_000).optional(),
  dateEffet: dateAssurance.optional(),
}).strict();

// ── Fiches d'identite des personnes assurees ─────────────────────────

const dateDuJourOuAvant = dateAssurance.refine((v) => Date.parse(v) <= Date.now(), 'La date ne peut pas etre dans le futur');

const champsPersonneAssuree = {
  nom: z.string().trim().min(1).max(80),
  prenoms: z.string().trim().min(1).max(120),
  sexe: z.enum(['M', 'F']),
  dateNaissance: dateDuJourOuAvant.refine((v) => Date.parse(v) >= Date.parse('1900-01-01'), 'Date de naissance invalide'),
  lieuNaissance: z.string().trim().min(2).max(120),
  nationalite: z.string().trim().min(2).max(60),
  typePiece: z.nativeEnum(TypePieceIdentite),
  numeroPiece: z.string().trim().min(3).max(40),
  dateDelivrancePiece: dateDuJourOuAvant.optional(),
  dateExpirationPiece: dateAssurance.optional(),
  adresse: z.string().trim().max(200).optional(),
};

const expirationApresDelivrance = (v: { dateDelivrancePiece?: string; dateExpirationPiece?: string }) =>
  !v.dateDelivrancePiece || !v.dateExpirationPiece || Date.parse(v.dateExpirationPiece) > Date.parse(v.dateDelivrancePiece);
const messageExpiration = {
  message: 'La date d’expiration de la piece doit suivre sa date de delivrance.',
  path: ['dateExpirationPiece'],
};

export const personneAssureeSchema = z.object({
  ...champsPersonneAssuree,
  telephone: phone,
  prefecture: z.string().trim().min(2).max(80),
}).strict().refine(expirationApresDelivrance, messageExpiration);

export const modifierPersonneAssureeSchema = z.object(champsPersonneAssuree)
  .partial().strict()
  .refine((v) => Object.keys(v).length > 0, 'Aucune modification')
  .refine(expirationApresDelivrance, messageExpiration);

export const ajouterTravailleurSchema = z.object({
  personne: personneAssureeSchema,
  numeroAdherent: z.string().trim().min(2).max(80),
  dateEffet: dateAssurance.optional(),
  dateFin: dateAssurance.optional(),
}).strict().refine(finApresDebut, messageFinApresDebut);

export const assurerPersonneSchema = z.object({
  personne: personneAssureeSchema,
  police: z.object({
    numeroPolice: z.string().trim().min(2).max(60),
    tauxBasePourcent: z.coerce.number().int().min(0).max(100).optional(),
    plafondAnnuelGnf: nonNegativeInt.max(1_000_000_000).optional(),
    franchiseGnf: nonNegativeInt.max(1_000_000_000).optional(),
    dateEffet: dateAssurance,
    dateFin: dateAssurance.optional(),
    carenceJours: z.coerce.number().int().min(0).max(365).optional(),
    periodeGraceJours: graceJours,
  }).strict().refine(contratFinApresDebut, messageContratFinApresDebut),
}).strict();

/** La liste du personnel : un CSV entier, borne a un millier de lignes environ. */
export const importerTravailleursSchema = z.object({
  contenu: z.string().min(1).max(500_000),
}).strict();

// ── Referentiels importables (EF-12-03) ──────────────────────────────
//
// Le contenu est un CSV entier : la borne haute est volontairement large
// (2 Mo), un referentiel national comptant des milliers de lignes. Au-dela,
// c'est un envoi de fichier qu'il faudra, pas un corps JSON.
// --- Journal d audit : recherche et export (EF-12-05) ---------------
//
// Les criteres arrivent en chaine de requete. Le schema reste `.strict()` :
// un critere mal orthographe doit se voir, pas s ignorer en silence et rendre
// un resultat trop large a une enquete.
//
// La liste des roles vient de l enumere Prisma plutot que d une copie : une
// copie se serait desynchronisee au premier role ajoute, et le filtre aurait
// refuse un role parfaitement valide.
//
// Il s applique a `req.query` via `validateQuery`, donc **toutes les valeurs
// arrivent en chaines** : les booleens sont lus depuis « true »/« false » et
// les nombres sont convertis. Une premiere version recopiait les criteres a
// la main dans le routeur, ce qui ecartait les cles inconnues avant que Zod
// ne les voie : `.strict()` ne servait a rien, et `echecSeulement` mal
// orthographie passait en silence avec un resultat trop large. Verifie contre
// l API reelle.
const booleenDeRequete = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

// --- Identito-vigilance (EF-01-04/10) -------------------------------
//
// Le numero de piece et le lieu de naissance sont exiges : ce sont eux que la
// contrainte SQL reclame pour une identite verifiee. Les redire ici permet de
// refuser tot, avec un message utile, plutot que de laisser remonter une
// violation de contrainte.
export const verifierIdentiteSchema = z.object({
  typePiece: z.nativeEnum(TypePieceIdentite),
  numeroPiece: z.string().trim().min(3).max(60),
  lieuNaissance: z.string().trim().min(2).max(120),
  nomMere: z.string().trim().min(2).max(120).optional(),
  remplacerPiece: z.boolean().optional(),
}).strict();

export const noterTraitsSchema = z.object({
  lieuNaissance: z.string().trim().min(2).max(120).optional(),
  nomMere: z.string().trim().min(2).max(120).optional(),
}).strict();

// R15 : le patient demande une correction ; l'accueil l'accepte ou la refuse.
export const demanderCorrectionIdentiteSchema = z.object({
  prenom: z.string().trim().min(1).max(80).optional(),
  nom: z.string().trim().min(1).max(80).optional(),
  sexe: z.enum(['M', 'F']).optional(),
  dateNaissance: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ').optional(),
  justification: z.string().trim().min(10).max(500),
}).strict();

export const accepterDemandeCorrectionSchema = z.object({
  motif: z.string().trim().min(10).max(500),
}).strict();

export const refuserDemandeCorrectionSchema = z.object({
  reponse: z.string().trim().min(10).max(500),
}).strict();

// R15 : correction tracee de l'identite par l'accueil ou l'administration.
export const corrigerIdentiteSchema = z.object({
  prenom: z.string().trim().min(1).max(80).optional(),
  nom: z.string().trim().min(1).max(80).optional(),
  sexe: z.enum(['M', 'F']).optional(),
  dateNaissance: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ').optional(),
  motif: z.string().trim().min(10).max(500),
}).strict();

export const filtreIdentitesSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  niveau: z.nativeEnum(NiveauIdentite).optional(),
}).strict();

// --- Numero d'ordre professionnel (EF-01-08) ------------------------
export const verifierOrdreSchema = z.object({
  numeroOrdre: z.string().trim().min(3, {
    message: "Saisissez le numero tel qu'il figure au registre de l'ordre.",
  }).max(60),
}).strict();

// Correction du nom d'un compte professionnel par l'administration.
export const corrigerNomCompteSchema = z.object({
  prenom: z.string().trim().min(1).max(80).optional(),
  nom: z.string().trim().min(1).max(80).optional(),
  motif: z.string().trim().min(10).max(500),
}).strict();

// --- Bris de glace (EF-02-06) ---------------------------------------
//
// Les bornes sont celles de la base (`bris_de_glace_*`). Le message est en
// francais et dit quoi faire : celui qui le lit a souvent un patient devant
// lui.
const EXPLICATION_BRIS =
  "Expliquez la situation en une phrase : c'est elle qui sera relue, et c'est elle qui vous protège.";

export const declarerBrisDeGlaceSchema = z.object({
  idPatient: z.string().trim().min(1, { message: 'Indiquez le dossier concerne.' }),
  motif: z.nativeEnum(MotifBrisDeGlace),
  explication: z.string().trim().min(20, { message: EXPLICATION_BRIS }).max(2000),
}).strict();

export const reviserBrisDeGlaceSchema = z.object({
  statut: z.enum(['JUSTIFIE', 'INJUSTIFIE']),
  avis: z.string().trim().min(20, {
    message: "Dites en une phrase pourquoi l'accès était fondé ou ne l'était pas.",
  }).max(2000),
}).strict();

export const filtreBrisDeGlaceSchema = z.object({
  idPatient: z.string().trim().min(1).optional(),
  aRevoirSeulement: z.enum(['true', 'false']).optional(),
}).strict();

// --- Textes de consentement (EF-02-01) ------------------------------
//
// Les bornes sont les memes qu'en base (`textes_consentement_*`) : refuser
// tot, avec un message utile, plutot que de laisser remonter une violation de
// contrainte. Un texte qui n'explique rien ne recueille pas un consentement
// eclaire — d'ou les 40 caracteres.
export const publierTexteConsentementSchema = z.object({
  scope: z.nativeEnum(ConsentScope),
  langue: z.string().trim().regex(/^[a-z]{2}$/, {
    message: 'La langue est un code de deux lettres minuscules : fr, en, pu, ml.',
  }),
  titre: z.string().trim().min(3).max(200),
  corps: z.string().trim().min(40, {
    message: "Le texte doit dire a quoi la personne s'engage : quarante caracteres au moins.",
  }).max(20000),
}).strict();

export const filtreTextesConsentementSchema = z.object({
  scope: z.nativeEnum(ConsentScope).optional(),
}).strict();

// --- Fusion de dossiers patients (EF-01-06) -------------------------
//
// Le motif est exige et sa longueur minimale est la meme qu'en base
// (`fusions_dossier_motif_dit_quelque_chose`) : le schema refuse tot, avec un
// message utile, plutot que de laisser remonter une violation de contrainte.
//
// **Le message est en francais et dit quoi faire.** Sans lui, Zod repondait
// « Too small: expected string to have >=10 characters » — l'agent lisait de
// l'anglais technique, et la phrase ecrite pour lui dans le service n'etait
// jamais atteinte, puisque la validation refuse avant. Vu en appelant la vraie
// route le 2026-10-04.
const MOTIF_FUSION =
  "Dites en une phrase sur quoi vous vous fondez : c'est ce qui permettra de contester la fusion plus tard.";

export const fusionnerSchema = z.object({
  idAbsorbe: z.string().trim().min(1, { message: 'Indiquez le dossier a absorber.' }),
  motif: z.string().trim().min(10, { message: MOTIF_FUSION }).max(2000),
}).strict();

export const annulerFusionSchema = z.object({
  motifAnnulation: z.string().trim().min(10, {
    message: "Dites en une phrase pourquoi cette fusion est annulee : c'est ce qui restera au dossier.",
  }).max(2000),
}).strict();

// --- Demandes d exercice de droits (EF-12-09) -----------------------
//
// La precision est obligatoire pour une rectification : sans elle, on ne sait
// pas quoi corriger. Le service le verifie aussi, parce qu un schema ne peut
// pas exprimer cette dependance sans devenir illisible.
export const deposerDemandeRgpdSchema = z.object({
  type: z.nativeEnum(TypeDemandeRgpd),
  precision: z.string().trim().min(1).max(2000).optional(),
}).strict();

// La reponse fait au moins dix caracteres : un refus qu on ne motive pas n est
// pas contestable. La meme regle vit dans le service et dans une contrainte
// SQL, pour qu elle ne depende d aucun des trois seul.
export const repondreDemandeRgpdSchema = z.object({
  satisfaite: z.boolean(),
  reponse: z.string().trim().min(10).max(4000),
}).strict();

export const filtreDemandesRgpdSchema = z.object({
  statut: z.nativeEnum(StatutDemandeRgpd).optional(),
  type: z.nativeEnum(TypeDemandeRgpd).optional(),
}).strict();

// --- Suspension de compte (EF-12-01) --------------------------------
//
// Le motif est long d au moins dix caracteres : « non » ou « rgpd » ne disent
// rien, et une suspension qu on ne peut pas expliquer ne peut pas etre
// contestee. La meme regle vit dans le service et dans une contrainte SQL,
// pour qu elle ne depende d aucune des trois seules.
export const suspendreCompteSchema = z.object({
  motif: z.string().trim().min(10).max(500),
}).strict();

export const filtreComptesSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.nativeEnum(Role).optional(),
  actifs: booleenDeRequete,
  page: positiveInt.optional(),
  limit: positiveInt.max(100).optional(),
}).strict();

/**
 * Le super administrateur recrute l'encadrement de la plateforme.
 *
 * **L'email est exige** : tout compte qui n'est ni PATIENT ni LIVREUR se
 * connecte par son email professionnel, puis par un code. Sans adresse, le
 * compte serait cree et ne pourrait jamais servir.
 *
 * Aucune prefecture : `Utilisateur` n'en porte pas, et `ADMIN_REGIONAL` passe
 * aujourd'hui le controle d'acces sans filtre geographique. La demander
 * afficherait un cloisonnement qui n'existe pas encore.
 */
export const creerAdministrateurSchema = z.object({
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  telephone: phone,
  email: z.string().trim().email().max(160),
  role: z.enum(['ADMIN_REGIONAL', 'ADMIN_NATIONAL']),
}).strict();

export const creerLivreurSchema = z.object({
  prenom: z.string().trim().min(1).max(100),
  nom: z.string().trim().min(1).max(100),
  telephone: z.string().trim().min(6).max(30),
  quartier: z.string().trim().min(1).max(120),
  prefecture: z.string().trim().min(1).max(120),
  /** Commune de travail : la zone des courses qu'il recoit (utils/zone.ts). */
  commune: z.string().trim().min(1).max(120).optional(),
}).strict();

export const activiteLivreurSchema = z.object({
  estActif: z.boolean(),
}).strict();

export const filtreJournalSchema = z.object({
  du: z.string().trim().min(1).optional(),
  au: z.string().trim().min(1).optional(),
  idUtilisateur: id.optional(),
  idPatient: id.optional(),
  role: z.nativeEnum(Role).optional(),
  ressource: z.string().trim().min(1).max(60).optional(),
  echecsSeulement: booleenDeRequete,
  parTiers: booleenDeRequete,
  page: positiveInt.optional(),
  limit: positiveInt.max(200).optional(),
}).strict();

export const importerReferentielSchema = z.object({
  contenu: z.string().min(1).max(2_000_000),
  simulation: z.boolean().optional(),
}).strict();

// M4 : disponibilite et zone du motard. La limite de 5 communes est appliquee
// par le service, apres retrait des doublons et de la commune du motard.
export const definirEnServiceSchema = z.object({ enService: z.boolean() }).strict();
export const definirCommunesDesserviesSchema = z.object({ communes: z.array(z.string().trim().min(1).max(80)).max(20) }).strict();

// A1 : recherche publique de produits. Deux lettres au minimum, parce qu'une
// seule ramenerait la moitie du catalogue.
//
// **La zone est facultative** : exiger de la choisir avant de pouvoir taper
// arretait net quelqu'un qui voulait juste savoir ou trouver du paracetamol.
// Sans elle, on cherche dans tout le pays et chaque pharmacie dit ou elle est.
export const rechercheProduitsSchema = z.object({
  q: z.string().trim().min(2).max(60),
  prefecture: z.string().trim().max(80).optional(),
  commune: z.string().trim().max(80).optional(),
});

// A3 : le rayon d'une officine. `q` n'est pas obligatoire — on arrive souvent
// ici depuis la recherche d'un produit, et on veut alors le retrouver sans
// parcourir deux cents lignes.
export const cataloguePharmacieSchema = z.object({
  q: z.string().trim().max(60).optional(),
});

// Horaires d'une officine : un creneau par jour, ou rien. Les heures sont
// validees ici dans leur forme ; la coherence (fermeture apres ouverture) est
// verifiee par le service, qui sait nommer les jours fautifs.
const heureDuJour = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'heure attendue au format HH:MM');

export const definirHorairesSchema = z.object({
  horaires: z.record(
    z.enum(['0', '1', '2', '3', '4', '5', '6']),
    z.object({ ouvre: heureDuJour, ferme: heureDuJour }).nullable(),
  ),
});

/**
 * La position d'une officine sur la carte.
 *
 * Les bornes sont celles du monde, pas celles du pays installe : la
 * plateforme vise plusieurs pays, et une borne nationale ferait echouer la
 * saisie le jour de l'ouverture du suivant.
 *
 * Le point (0, 0) est refuse. Il est en pleine mer, et c'est la valeur que
 * produit un formulaire dont la saisie n'a pas abouti : l'accepter poserait
 * un marqueur au large du Ghana sans que personne comprenne pourquoi.
 */
export const definirPositionSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
})
  .strict()
  .refine((d) => (d.latitude === null) === (d.longitude === null), {
    message: 'La latitude et la longitude vont ensemble : les deux, ou aucune.',
  })
  .refine((d) => !(d.latitude === 0 && d.longitude === 0), {
    message: 'Le point (0, 0) est en pleine mer : la position n\'a pas ete relevee.',
  });
