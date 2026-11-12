export { SEPARATEUR_CSV, BOM_UTF8, champCsv, enCsv } from './csv';

// ─── Common API wrapper types ──────────────────────────────────────────────────
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: PaginationMeta;
  error?: string;
  message?: string;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Enums (mirror Prisma schema values) ──────────────────────────────────────
export type Role =
  | 'PATIENT'
  | 'ASC'
  | 'ASC_SUPERVISOR'
  | 'MEDECIN'
  | 'PHARMACIEN'
  | 'AGENT_ACCUEIL'
  | 'TECHNICIEN_LABO'
  | 'LIVREUR'
  /** Agent d'un assureur : il se connecte lui-meme, et ne lit aucun dossier medical. */
  | 'ASSUREUR'
  | 'ADMIN_STRUCTURE'
  | 'ADMIN_REGIONAL'
  | 'ADMIN_NATIONAL'
  | 'SUPER_ADMIN';

/** Responsabilites d'un utilisateur au sein de son officine. */
export type RoleOfficine = 'TITULAIRE' | 'ADJOINT' | 'PREPARATEUR' | 'CAISSIER';

export type EncounterStatus =
  | 'PLANIFIEE'
  | 'EN_COURS'
  | 'TERMINEE'
  | 'ANNULEE'
  | 'REFERENCEE';

export type ReferralStatus =
  | 'EN_ATTENTE'
  | 'ACCEPTE'
  | 'REFUSE'
  | 'COMPLETE';

export type InvoiceStatus =
  | 'EN_ATTENTE'
  | 'PAYEE'
  | 'PARTIELLE'
  | 'ANNULEE'
  | 'REMBOURSEE';

export type ModePaiement =
  | 'ESPECES'
  | 'ORANGE_MONEY'
  | 'MTN_MOMO';

export type TypeStructure =
  | 'POSTE'
  | 'CENTRE'
  | 'HOPITAL_PREF'
  | 'HOPITAL_REG'
  | 'CHU'
  | 'CLINIQUE'
  | 'PHARMACIE'
  | 'LABORATOIRE'
  // Un assureur : ses agents se connectent comme les autres (EF-09).
  | 'ASSURANCE';

/**
 * Partage par l'ordonnance (le document) et par ses lignes. Une ligne ne prend
 * que `EN_ATTENTE` ou `DELIVREE` ; le document ajoute `PARTIELLEMENT_SERVIE` et
 * `SERVIE`, deduits de ses lignes.
 */
export type StatutOrdonnance =
  | 'EN_ATTENTE'
  | 'DELIVREE'
  | 'PARTIELLEMENT_SERVIE'
  | 'SERVIE'
  | 'EXPIREE'
  | 'ANNULEE';

export type Urgence = 'ROUTINE' | 'URGENT' | 'URGENCE_VITALE';

export type StatutEpisode = 'OUVERT' | 'EN_COURS' | 'CLOS' | 'ANNULE';
export type StatutDemandeAnalyse = 'TRANSMISE' | 'RECUE' | 'PRELEVEE' | 'EN_ANALYSE' | 'VALIDEE' | 'ANNULEE';
export type LieuPrelevement = 'SUR_PLACE' | 'DOMICILE';
export type InterpretationResultat = 'NORMAL' | 'ANORMAL' | 'CRITIQUE';

export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE';

export type ConsentScope =
  | 'DOSSIER_MEDICAL'
  | 'FHIR_EXPORT'
  | 'RAPPELS_SMS'
  | 'RECHERCHE_ANONYMISEE';

export type TypeNotification =
  | 'RAPPEL_RENDEZ_VOUS'
  | 'REFERENCEMENT_ACCEPTE'
  | 'REFERENCEMENT_REFUSE'
  | 'ALERTE_STOCK'
  | 'RAPPEL_VACCINATION'
  | 'ORDONNANCE_SIGNEE'
  | 'NOUVEAU_MESSAGE'
  | 'ALERTE_VITALE'
  | 'EPISODE_OUVERT'
  | 'DEMANDE_ANALYSE'
  | 'ORIENTATION'
  | 'PRELEVEMENT_PLANIFIE'
  | 'RESULTATS_DISPONIBLES'
  | 'RESULTAT_CRITIQUE'
  | 'ESCALADE_CRITIQUE'
  | 'COMMANDE_A_SERVIR'
  | 'COMMANDE_PRISE_EN_CHARGE'
  | 'COMMANDE_SANS_PHARMACIE'
  | 'COMMANDE_A_PAYER'
  | 'COMMANDE_PAYEE'
  | 'COMMANDE_PRETE'
  | 'COMMANDE_REMISE'
  | 'COMMANDE_ANNULEE'
  | 'ORDONNANCE_SUBSTITUTION'
  | 'ORDONNANCE_LIGNE_REFUSEE'
  | 'COURSE_OUVERTE'
  | 'OFFRE_COURSE'
  | 'COURSE_ATTRIBUEE'
  | 'COURSE_SANS_MOTARD';

/** Statut d'une commande pharmacie (EF-07). */
// ═══════════════════════════════════════════════════════════════════
// P6 / EF-07 — La commande en pharmacie
//
// **Ce que la pharmacie voit du patient : son nom, et les produits.** Elle va
// les lui delivrer, elle a besoin des deux. Rien d'autre du dossier ne sort :
// ni diagnostic, ni motif de consultation, ni antecedent. Un pharmacien n'a
// pas a savoir pourquoi on soigne quelqu'un pour lui remettre une boite.
//
// L'API rendait jusqu'ici l'objet Prisma complet — ordonnance, consultation,
// patient imbriques. Cette vue est le contrat, et elle dit ou s'arrete le
// partage.
// ═══════════════════════════════════════════════════════════════════

export interface LigneCommandeView {
  id: string;
  libelle: string;
  dosage?: string | null;
  forme?: string | null;
  quantite: number;
  /** Ce que le medecin a ecrit sur la facon de prendre le produit. */
  posologie?: string | null;

  /**
   * Le prix de cette officine, **fige au chiffrage**.
   *
   * Absent tant que la commande n'est pas chiffree : avant, il n'y a qu'une
   * prescription, et annoncer un prix tire du catalogue national serait
   * annoncer un prix que personne ne tiendra. Prix de reference plus la
   * marge de l'officine, exactement la regle du comptoir.
   */
  prixUnitaireGnf?: number | null;
  /** `quantite * prixUnitaireGnf`, figee elle aussi. */
  montantGnf?: number | null;
}

/** Ce qu'une pharmacie sollicitee a repondu. */
export interface ReponsePharmacieView {
  idStructure: string;
  nom: string;
  aTousLesProduits: boolean;
  repondueLe: HorodatageApi;
}

/** Ce que la pharmacie sait du motard qui vient chercher le colis. */
export interface LivreurAttribueView {
  prenom: string;
  nom: string;
  telephone: string;
  /** Chemin `/uploads/avatars/…`, ou null si le motard n'a pas mis de photo. */
  photoUrl: string | null;
}

export interface CommandeView {
  id: string;
  /** Identifiant de la course active, pour les gestes patient/pharmacie en livraison. */
  idCourse?: string | null;
  /** Etat de la course active, pour ne proposer que les gestes permis. */
  statutCourse?: StatutCourse | null;
  statut: StatutCommande;
  /** Le quartier ou l'appel a ete lance. */
  quartierRecherche?: string | null;
  modeRemise?: ModeRemise | null;
  creeLe: HorodatageApi;

  numeroOrdonnance: string;
  patient: { id: string; prenom: string; nom: string };
  lignes: LigneCommandeView[];

  /** La pharmacie qui a pris la commande, le cas echeant. */
  pharmacie?: { id: string; nom: string; quartier?: string | null } | null;

  /**
   * Les reponses deja recues.
   *
   * Utile au comptoir : savoir que trois officines ont dit « non » avant soi
   * change la facon dont on regarde sa propre disponibilite.
   */
  reponses: ReponsePharmacieView[];

  /** Vrai quand **cette** pharmacie l'a prise : l'API le calcule pour elle. */
  estLaMienne?: boolean;

  /**
   * Le motard choisi par le patient, rendu a la seule pharmacie qui lui remet
   * le colis, de l'attribution a la livraison : elle le reconnait au comptoir
   * avant de scanner son QR.
   */
  livreur?: LivreurAttribueView;

  /**
   * Le total du panier, nul tant qu'il n'est pas chiffre.
   *
   * Redondant avec la somme des lignes, et garde par un declencheur
   * differe cote base : l'ecran n'a pas a recalculer un total pour
   * l'afficher, et les deux ne peuvent pas se contredire.
   */
  montantTotalGnf?: number | null;
  chiffreeLe?: HorodatageApi | null;
  preteLe?: HorodatageApi | null;
  remiseLe?: HorodatageApi | null;
  clotureeLe?: HorodatageApi | null;
  motifAnnulation?: string | null;
}

/**
 * Ou en est une commande.
 *
 * Le tronc commun va de l'appel au quartier jusqu'a la preparation, puis
 * deux sorties selon le mode de remise choisi par le patient.
 *
 * `PRETE_POUR_LIVRAISON` est le point de jonction avec P8 : a cet etat, une
 * course d'appel d'offres est ouverte dans la meme transaction.
 */
export type StatutCommande =
  | 'RECHERCHE_PHARMACIE'
  | 'PRISE_EN_CHARGE'
  | 'A_PAYER'
  | 'PAYEE'
  | 'EN_PREPARATION'
  | 'PRETE_POUR_RETRAIT'
  | 'PRETE_POUR_LIVRAISON'
  | 'RETIREE'
  | 'CLOTUREE'
  | 'SANS_PHARMACIE'
  | 'ANNULEE';

/**
 * Comment le patient recupere ses produits. La livraison n'est jamais
 * imposee : beaucoup de patients habitent a cote d'une pharmacie.
 */
export type ModeRemise = 'RETRAIT_PHARMACIE' | 'LIVRAISON';

/** Etats propres a l'appel d'offres et a la livraison d'une commande P8-a. */
export type StatutCourse =
  | 'APPEL_OFFRES'
  | 'ATTRIBUEE'
  | 'EN_COURS'
  | 'LIVREE'
  | 'SANS_MOTARD'
  | 'ANNULEE';

/** Vue explicite de la course remise au patient et aux professionnels autorises. */
export interface CourseView {
  id: string;
  numero: string;
  statut: StatutCourse;
  quartier: string;
  prefecture: string;
  prixGnf: number | null;
  delaiAnnonceMinutes: number | null;
  creeeLe: HorodatageApi;
  attribueeLe: HorodatageApi | null;
  remiseLe: HorodatageApi | null;
  livreeLe: HorodatageApi | null;
  annuleeLe: HorodatageApi | null;
  motifAnnulation: string | null;
  pharmacie: { id: string; nom: string } | null;
}

/**
 * Vue exclusivement destinee au livreur. Elle ne contient jamais de produit,
 * d'ordonnance, de posologie ni de diagnostic : le livreur transporte un colis
 * scelle et n'a pas a connaitre le soin. Le nom et le telephone du patient ne
 * sont rendus qu'apres attribution, pour permettre la remise a domicile.
 */
export interface CourseLivreurView {
  id: string;
  numero: string;
  statut: StatutCourse;
  quartier: string;
  prefecture: string;
  prixGnf: number | null;
  delaiAnnonceMinutes: number | null;
  creeeLe: HorodatageApi;
  attribueeLe: HorodatageApi | null;
  remiseLe: HorodatageApi | null;
  livreeLe: HorodatageApi | null;
  pharmacie: { id: string; nom: string } | null;
  patient?: { prenom: string; nom: string; telephone: string };
  /**
   * M3 : ou livrer. Seulement pendant que la course est en main (attribuee ou
   * en cours) : une fois livree, le motard n'a plus a savoir ou habite le patient.
   */
  adresseLivraison?: AdresseLivraisonView;
}

// ── M1 : referentiel geographique generique ──────────────────────────
// Un arbre de lieux, aux niveaux declares par le pays (ParametresPaysView).
// Il propose des noms ; les saisies restent du texte libre.

/** GET /geographie/configuration — public : le decoupage du pays installe. */
export interface ConfigurationGeoView {
  code: string;
  nom: string;
  indicatifTelephone: string;
  niveaux: NiveauAdministratifView[];
  niveauBase: string;
  niveauElargissement: string;
  /** Un jeu de depart existe-t-il pour ce pays et ce decoupage ? */
  jeuDeDepartDisponible: boolean;
}

/** GET /geographie/lieux */
export interface LieuGeoView {
  id: string;
  niveau: string;
  nom: string;
  idParent: string | null;
  /** Nom du parent, pour l'affichage (« Ratoma — Conakry »). */
  parent: string | null;
  /** Lieux limitrophes du meme niveau. */
  voisins: { id: string; nom: string }[];
  /** Donnee de depart pas encore confirmee par un administrateur. */
  aValider: boolean;
}

/** POST /geographie/lieux (administration). */
export interface CreerLieuGeoDto {
  niveau: string;
  nom: string;
  /** Obligatoire, sauf pour le niveau le plus large. */
  idParent?: string;
}

/** PUT /geographie/lieux/:id (administration). */
export interface ModifierLieuGeoDto {
  voisins?: string[];
  aValider?: boolean;
}

/** POST /geographie/jeu-de-depart (administration). */
export interface JeuDeDepartGeoView {
  crees: number;
  dejaPresents: number;
}

/**
 * GET /geographie/hors-referentiel : les lieux du niveau de base saisis sur
 * des patients, structures ou motards et absents du referentiel, a ajouter.
 * `zone` est le lieu du niveau d'elargissement saisi avec (champ `prefecture`).
 */
export interface LieuHorsReferentielView {
  zone: string;
  lieu: string;
  patients: number;
  structures: number;
  livreurs: number;
  total: number;
}

/** Ce que le motard voit de l'adresse du patient (M3). */
export interface AdresseLivraisonView {
  commune: string | null;
  quartier: string | null;
  pointRepere: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** GET/PUT /patients/me/adresse — l'adresse du patient, vue par lui-meme (M3). */
export interface AdressePatientView extends AdresseLivraisonView {
  prefecture: string;
  positionLe: HorodatageApi | null;
}

/**
 * PUT /patients/me/adresse. La position est facultative et ne s'envoie
 * qu'avec l'accord du patient ; `effacerPosition` la retire.
 */
export interface DefinirAdresseDto {
  commune: string;
  quartier: string;
  pointRepere?: string;
  latitude?: number;
  longitude?: number;
  effacerPosition?: boolean;
}

/** Courses attribuees au livreur et QR de son profil, y compris sans course active. */
export interface MesCoursesLivreurView {
  qrCode: string;
  courses: CourseLivreurView[];
}

/** Disponibilite et zone de travail du motard, vues par lui-meme. */
export interface LivreurZoneView {
  prefecture: string;
  commune: string | null;
  quartier: string;
  /** Communes desservies en plus de la sienne, dans la meme prefecture (5 au plus). */
  communesDesservies: string[];
  /** Seul un motard en service est prevenu des courses et peut proposer une offre. */
  enService: boolean;
  enServiceDepuis: HorodatageApi | null;
  estActif: boolean;
}
export interface DefinirEnServiceDto { enService: boolean; }
export interface DefinirCommunesDesserviesDto { communes: string[]; }

/** Offre d'un livreur, ordonnee par prix puis par delai pour le patient. */
export interface OffreCourseView {
  id: string;
  prixGnf: number;
  delaiMinutes: number;
  creeeLe: HorodatageApi;
}

/** Prix et delai proposes par un livreur pour une course ouverte. */
export interface ProposerOffreCourseDto {
  prixGnf: number;
  delaiMinutes: number;
}

/** Identifiant de l'offre retenue par le patient proprietaire de la commande. */
export interface ChoisirOffreCourseDto {
  idOffre: string;
}

/** Motif de la decision du patient de revenir au retrait en pharmacie. */
export interface RenoncerALaLivraisonDto {
  motif: string;
}

/** QR du livreur scanne par le pharmacien avant la remise du colis. */
export interface RemettreAuMotardDto {
  qrCodeScanne: string;
}

export type CanalNotification = 'SMS' | 'PUSH' | 'IN_APP';

// ─── Auth DTOs ─────────────────────────────────────────────────────────────────
export interface LoginDto {
  identifiant: string;
  motDePasse: string;
}

export interface RegisterDto {
  telephone: string;
  /**
   * Facultatif : l'inscription publique cree un compte PATIENT, qui se
   * connecte par telephone. L'email professionnel n'est exige que pour les
   * comptes crees par une structure ou une compagnie (createAgentStructure,
   * creerAgentAssureur), et `registerSchema` le laisse facultatif.
   */
  email?: string;
  motDePasse: string;
  prenom: string;
  nom: string;
}

export interface VerifyLoginOtpDto {
  email: string;
  code: string;
}

export interface OtpRequestDto {
  telephone: string;
}

export interface OtpVerifyDto {
  telephone: string;
  code: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  nouveauMotDePasse: string;
}

export interface OtpLoginChallenge {
  requiresOtp: true;
  email: string;
  message: string;
  expiresInMinutes: number;
  devOtp?: string;
}

export interface UserDto {
  id: string;
  telephone: string;
  email?: string;
  nom: string;
  prenom: string;
  role: Role;
  roleOfficine?: RoleOfficine | null;
  langue: string;
  photoUrl?: string;
  estActif: boolean;
  doitChangerMotDePasse: boolean;
  /** EF-01-08 : une fois l ordre verifie, le professionnel ne change plus son nom seul. */
  ordreVerifieLe?: string | null;
  creeLe: string;
  modifieLe: string;
}

// ─── Patient DTOs ──────────────────────────────────────────────────────────────
export interface CreatePatientDto {
  telephone: string;
  motDePasse: string;
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: string;
  prefecture: string;
  sousPrefecture?: string;
  village?: string;
  groupeSanguin?: string;
  allergies?: string[];
  maladiesChroniques?: string[];
  urgenceNom?: string;
  urgenceTelephone?: string;
}

export interface UpdatePatientDto {
  prenom?: string;
  nom?: string;
  email?: string;
  langue?: string;
  photoUrl?: string;
  groupeSanguin?: string;
  allergies?: string[];
  maladiesChroniques?: string[];
  sousPrefecture?: string;
  village?: string;
  urgenceNom?: string;
  urgenceTelephone?: string;
}

export interface PatientFilters {
  prefecture?: string;
  page?: number;
  limit?: number;
  search?: string;
}

// ─── Consultation DTOs ─────────────────────────────────────────────────────────
export interface CreateConsultationDto {
  idPatient: string;
  motifPrincipal: string;
  symptomes?: string[];
}

export interface VitalsDto {
  temperature?: number;
  poidsKg?: number;
  tailleCm?: number;
  perimetreBrachial?: number;
  tensionSystolique?: number;
  tensionDiastolique?: number;
  frequenceCardiaque?: number;
  frequenceRespiratoire?: number;
  spo2?: number;
  glycemie?: number;
}

/**
 * La severite d'un diagnostic.
 *
 * **Nommee parce que le front l'avait recopiee de travers** : son selecteur
 * proposait `LEGERE` et `MODEREE`, et le serveur rejetait le diagnostic en
 * 400. Un type nomme fait echouer la compilation au lieu de laisser la faute
 * se decouvrir a l'usage.
 */
export type SeveriteDiagnostic = 'LEGER' | 'MODERE' | 'SEVERE' | 'CRITIQUE';

export type TypeDiagnostic = 'PRINCIPAL' | 'DIFFERENTIEL' | 'SECONDAIRE';

export type SourceDiagnostic = 'IA_LOCALE' | 'IA_CLAUDE' | 'MEDECIN' | 'ASC';

export interface DiagnosticDto {
  libelle: string;
  codeIcd11?: string;
  typeDiagnostic?: TypeDiagnostic;
  severite?: SeveriteDiagnostic;
  source: SourceDiagnostic;
}

export interface OrdonnanceDto {
  idMedicament: string;
  posologie: string;
  frequence: string;
  dureeJours: number;
  quantite?: number;
  instructions?: string;
  /**
   * EF-05-06 : pourquoi le prescripteur passe outre une alerte. L'API
   * recalcule les alertes de son cote — ce champ ne les declare pas, il les
   * justifie.
   */
  motifDepassement?: string;

  /**
   * EF-05-09 : renouvellements accordes, portes par l'ordonnance entiere. La
   * derniere valeur transmise fait foi pour le document en cours de redaction.
   * Refuse des qu'un produit reglemente y figure.
   */
  renouvellementsAutorises?: number;
}

export interface ReferralDto {
  idStructureCible: string;
  urgence: Urgence;
  resumeClinique: string;
}

export interface ConsultationFilters {
  idPatient?: string;
  idAsc?: string;
  statut?: EncounterStatus;
  page?: number;
  limit?: number;
}

// ─── Vaccination DTOs ──────────────────────────────────────────────────────────
export interface CreateVaccinationDto {
  idPatient: string;
  vaccinNom: string;
  codeEpi?: string;
  numeroLot?: string;
  siteInjection?: string;
  reaction?: string;
  dateProchaineD?: string;
}

export interface UpdateVaccinationDto {
  reaction?: string;
  urlCertificat?: string;
  dateProchaineD?: string;
}

export interface VaccinationFilters {
  idPatient?: string;
  vaccinNom?: string;
  page?: number;
  limit?: number;
}

// ─── Paiement DTOs ────────────────────────────────────────────────────────────
export interface InitierPaiementDto {
  idConsultation: string;
  montantGnf: number;
  modePaiement: ModePaiement;
  numeroOperateur?: string;
}

/**
 * Payer le panier d'une commande de pharmacie.
 *
 * **Aucun montant.** Il est fige en base au chiffrage par l'officine, et le
 * client n'a pas a le proposer : un montant qui vient du navigateur est un
 * montant qu'on peut baisser. Le paiement d'une consultation, lui, accepte
 * encore un montant propose — plafonne — pour les cas ou aucun tarif n'est
 * enregistre.
 */
export interface PayerCommandeDto {
  modePaiement: ModePaiement;
  numeroOperateur?: string;
}

export interface ConfirmerPaiementDto {
  referenceOperateur: string;
}

/**
 * Une facture telle que le patient la voit (EF-08).
 *
 * **Le front la typait jusqu'ici avec `montant`, `devise` et `methode`, qui
 * n'existent nulle part cote API** : il lisait des champs absents et affichait
 * du vide. Cette vue est le contrat, et elle porte les noms reels.
 */
export interface FactureView {
  id: string;
  /** La consultation reglee : c'est par elle qu'on rouvre un paiement. */
  idConsultation?: string | null;
  montantGnf: number;
  statut: InvoiceStatus;
  modePaiement?: ModePaiement | null;
  numeroOperateur?: string | null;
  /** La reference rendue par la passerelle : c'est la preuve du paiement. */
  referenceOperateur?: string | null;
  /**
   * Le lien de paiement de la passerelle. Present tant que la facture n'est
   * pas reglee : le patient peut y revenir sans qu'on recree une operation.
   */
  urlPaiement?: string | null;
  /**
   * Le dernier etat connu cote passerelle : `new`, `pending`, `success`,
   * `canceled`, `failed`, `error`, `expired`.
   *
   * Il existe pour que l'ecran dise ce qui s'est passe — « votre dernier
   * paiement a echoue » — sans rappeler la passerelle a chaque affichage.
   */
  statutOperateur?: string | null;
  payeeLe?: HorodatageApi | null;
  creeLe: HorodatageApi;
  consultation?: {
    motifPrincipal?: string | null;
    consulteeLE?: HorodatageApi | null;
  } | null;
}

/**
 * GET /paiements/a-regler — ce que le patient doit encore.
 *
 * **Une consultation tarifee n'a pas forcement de facture.** Rien ne facture
 * automatiquement : la facture naît au moment ou le paiement s'ouvre. Une
 * liste batie sur les seules factures laisserait donc invisible tout ce qui
 * n'a jamais ete paye — c'est-a-dire precisement ce qu'on vient regarder.
 */
export interface ADeReglerView {
  idConsultation: string;
  motif?: string | null;
  consulteeLE?: HorodatageApi | null;
  montantGnf: number;
  /** Absente tant que le paiement n'a jamais ete ouvert. */
  facture?: FactureView | null;
}

/** GET /paiements/historique */
export interface PageFacturesView {
  data: FactureView[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface PaiementFilters {
  statut?: InvoiceStatus;
  modePaiement?: ModePaiement;
  page?: number;
  limit?: number;
}

// ─── Notification DTOs ─────────────────────────────────────────────────────────
export interface SendNotificationDto {
  idDestinataire: string;
  type: TypeNotification;
  titre: string;
  contenu: string;
  canal: CanalNotification;
  metadata?: Record<string, unknown>;
}

export interface NotificationFilters {
  lu?: boolean;
  type?: TypeNotification;
  page?: number;
  limit?: number;
}

// ─── Structure DTOs ───────────────────────────────────────────────────────────
export interface CreateStructureDto {
  nom: string;
  type: TypeStructure;
  prefecture: string;
  commune?: string;
  quartier?: string;
  adresse?: string;
  telephone?: string;
  latitude?: number;
  longitude?: number;
  admin: {
    prenom: string;
    nom: string;
    telephone: string;
    email?: string;
  };
}

export interface CreatePharmacieDto {
  nom: string;
  prefecture: string;
  commune?: string;
  quartier?: string;
  adresse?: string;
  telephone?: string;
  latitude?: number;
  longitude?: number;
  pharmacien: {
    prenom: string;
    nom: string;
    telephone: string;
    email?: string;
  };
}

// ─── Triage DTOs ──────────────────────────────────────────────────────────────
export interface TriagePayload {
  ageAnnees?: number;
  symptomes: string[];
  constantes?: {
    temperature?: number;
    spo2?: number;
    frequenceRespiratoire?: number;
    frequenceCardiaque?: number;
    tensionSystolique?: number;
    glycemie?: number;
  };
}

export interface TriageHypothese {
  pathologie: string;
  score: number;
  signes: string[];
  conduite: string;
  urgence: Urgence;
}

export interface TriageResult {
  moteur: string;
  urgence: Urgence;
  alertes: string[];
  hypotheses: TriageHypothese[];
  recommandation: string;
  avertissement: string;
}

// ─── ASC DTOs ─────────────────────────────────────────────────────────────────
export interface CreateStockDto {
  idMedicament: string;
  quantite: number;
  unite: string;
  seuilAlerte?: number;
  datePeremption?: string;
}

export interface UpdateStockDto {
  quantite: number;
  unite: string;
  seuilAlerte?: number;
  datePeremption?: string;
}

export interface StockFilters {
  seuilAlerte?: boolean;
  page?: number;
  limit?: number;
}

export interface RapportFilters {
  mois: number;
  annee: number;
}

// ─── Médecin DTOs ─────────────────────────────────────────────────────────────
export interface SignerOrdonnanceDto {
  idOrdonnance: string;
}

/**
 * POST /pharmacien/ordonnances/verifier (EF-07-01). Le numero seul ne suffit
 * pas : il est sequentiel, donc devinable. Le code prouve que le porteur a
 * l'ordonnance en main.
 */
export interface VerifierOrdonnanceDto {
  numero: string;
  codeVerification: string;
}

export interface ValiderConsultationDto {
  /** Facultatif : le serveur ne l'a jamais exige. */
  notesMedecin?: string;
  idOrdonnances?: string[];
  tarifGnf?: number;
}

export interface RepondreReferencementDto {
  statut: 'ACCEPTE' | 'REFUSE';
  motifRefus?: string;
}

export interface MedecinFilters {
  statut?: ReferralStatus;
  prefecture?: string;
  page?: number;
  limit?: number;
}

export interface SendMessageDto {
  idDestinataire: string;
  contenu: string;
  idConsultation?: string;
}

// ─── Pharmacien DTOs ──────────────────────────────────────────────────────────
export interface DelivrancePayload {
  lignesDelivrees: {
    idLigneOrdonnance: string;
    quantiteDelivree: number;
    substitutId?: string;
  }[];
}

// ─── Canonical view models (API response shapes) ──────────────────────────────

// Les colonnes nullables de Prisma arrivent en `null`, pas en `undefined`.
export interface DiagnosticView {
  id: string;
  libelle: string;
  codeIcd11?: string | null;
  typeDiagnostic?: string;
  severite?: string | null;
  source: string;
}

/**
 * Gravite d'une alerte de prescription (EF-05-05). L'ordre compte :
 * `PRECAUTION` informe, les deux autres appellent un motif de depassement.
 */
export type NiveauInteraction =
  | 'PRECAUTION'
  | 'ASSOCIATION_DECONSEILLEE'
  | 'CONTRE_INDICATION';

/**
 * `RESULTATS_EN_ATTENTE` : des analyses ont ete demandees et ne sont pas
 * revenues. **C'est un avertissement, pas un verrou** — on prescrit parfois
 * un antipyretique tout de suite et on ajuste quand les resultats arrivent.
 * Son niveau reste `PRECAUTION`, donc il n'exige aucun motif.
 */
export type TypeAlertePrescription =
  | 'ALLERGIE'
  | 'INTERACTION'
  | 'CONTRE_INDICATION'
  | 'RESULTATS_EN_ATTENTE';

/**
 * Une raison de ne pas prescrire ce medicament a ce patient. L'alerte ne
 * bloque jamais : elle informe le prescripteur, qui reste seul juge et motive
 * son choix s'il passe outre (EF-05-06).
 */
export interface AlertePrescriptionView {
  type: TypeAlertePrescription;
  niveau: NiveauInteraction;
  /** Titre court, affichable tel quel. */
  libelle: string;
  detail: string;
  /** Conduite a tenir, quand le referentiel en propose une. */
  conduite?: string | null;
  /** Le medicament deja prescrit qui entre en interaction, le cas echeant. */
  medicamentEnCause?: string | null;
  /** Referentiel d'origine, pour pouvoir reexaminer une regle contestee. */
  source?: string | null;
}

/** Reponse de POST /consultations/:id/ordonnances/alertes. */
export interface AlertesPrescriptionView {
  alertes: AlertePrescriptionView[];
  /**
   * Calcule par l'API : au moins une alerte depasse la simple precaution, un
   * motif est donc attendu. Le client ne recalcule pas ce seuil.
   */
  motifRequis: boolean;
}

/** POST /consultations/:id/ordonnances/alertes */
export interface VerifierPrescriptionDto {
  idMedicament: string;
}

/** Un medicament prescrit. La delivrance se fait a ce niveau. */
export interface LigneOrdonnanceView {
  id: string;
  statut: StatutOrdonnance;
  posologie: string;
  frequence: string;
  dureeJours: number;
  quantite?: number | null;
  instructions?: string | null;
  medicament?: { id: string; libelle: string; dci?: string | null; nomCommercial?: string | null; forme?: string | null; dosage?: string | null; estReglemente?: boolean };
  /** Ce qui a ete montre au prescripteur au moment de la prescription. */
  alertes?: AlertePrescriptionView[] | null;
  motifDepassement?: string | null;
}

/**
 * L'ordonnance est un document, pas un medicament : c'est lui qui porte le
 * numero et le code que la pharmacie controle avant de delivrer (EF-05-07/08).
 * `codeVerification` n'est expose qu'au patient et au prescripteur — jamais
 * dans une liste destinee a un tiers.
 */
export interface OrdonnanceView {
  id: string;
  numero: string;
  statut: StatutOrdonnance;
  codeVerification?: string;
  valideJusquau: HorodatageApi;
  /** Calcule par l'API : `valideJusquau` depasse. */
  expiree: boolean;
  signeLe?: HorodatageApi | null;
  signataire?: { prenom: string; nom: string } | null;
  creeLe: HorodatageApi;
  lignes: LigneOrdonnanceView[];

  /** EF-05-09. Le numero et le code ne changent pas d'un cycle a l'autre. */
  renouvellementsAutorises: number;
  renouvellementsUtilises: number;
  /** Calcule par l'API : renouvellements restants, une fois l'ordonnance servie. */
  renouvellementsRestants: number;
  /** Calcule par l'API : au moins un medicament est a circuit reglemente (EF-05-12). */
  contientProduitReglemente: boolean;
}

// Une constante non saisie arrive en `null` (colonne nullable Prisma serialisee
// telle quelle), pas en `undefined` : le type le dit desormais, pour que le
// client traite le cas au lieu de le supposer absent.
export interface ConstantesVitalesView {
  id?: string;
  temperature?: number | null;
  poidsKg?: number | null;
  tailleCm?: number | null;
  perimetreBrachial?: number | null;
  tensionSystolique?: number | null;
  tensionDiastolique?: number | null;
  frequenceCardiaque?: number | null;
  frequenceRespiratoire?: number | null;
  spo2?: number | null;
  glycemie?: number | null;
  alertes?: string[];
}

export interface ConsultationView {
  id: string;
  statut: EncounterStatus;
  motifPrincipal: string;
  consulteeLE: string;
  notesAsc?: string;
  notesMedecin?: string;
  idPatient?: string;
  constantes?: ConstantesVitalesView;
  asc?: { utilisateur: { prenom: string; nom: string } };
  medecinValideur?: { prenom: string; nom: string };
  diagnostics?: DiagnosticView[];
  ordonnances?: OrdonnanceView[];
}

// ─── Analytics DTOs ───────────────────────────────────────────────────────────
export interface AnalyticsFilters {
  prefecture?: string;
  debut?: string;
  fin?: string;
  annee?: number;
  mois?: number;
}

export interface ExportFilters {
  format: 'JSON' | 'CSV' | 'DHIS2';
  debut?: string;
  fin?: string;
  prefecture?: string;
  page?: number;
  limit?: number;
}

// ─── Analytics — vues renvoyees par l'API ─────────────────────────────────────
// Ces formes sont le contrat entre analytics.service.ts (qui les declare comme
// type de retour) et le tableau de bord admin. Les declarer ici plutot que de
// les redeclarer dans le composant evite la derive silencieuse : un champ
// renomme cote API casse desormais le build de l'API, au lieu de vider un
// onglet sans aucun signal.

export interface AnalyticsKpisView {
  totalPatients: number;
  totalConsultations: number;
  /** Doses administrees. */
  totalVaccinations: number;
  /** Patients ayant recu au moins une dose : base de la jauge de couverture. */
  patientsVaccines: number;
  totalReferencements: number;
  totalAsc: number;
}

export interface ConsultationsParStatutView {
  statut: string;
  count: number;
}

export interface TopPathologieView {
  pathologie: string;
  count: number;
}

export interface DashboardAnalyticsView {
  kpis: AnalyticsKpisView;
  consultationsParStatut: ConsultationsParStatutView[];
  topPathologies: TopPathologieView[];
}

/**
 * Un point de la carte epidemiologique : une prefecture, ses cas.
 * R4 : aucune coordonnee de patient ; la carte compte, elle ne localise personne.
 */
export interface HeatmapPointView {
  prefecture: string;
  count: number;
  pathologies: Record<string, number>;
}

export type NiveauAlerte = 'ATTENTION' | 'ALERTE' | 'URGENCE';

export interface AlerteEpidemiqueView {
  pathologie: string;
  prefecture: string;
  nombre: number;
  seuil: number;
  niveau: NiveauAlerte;
  /** Serialise en chaine ISO par la reponse JSON. */
  dateDetection: string;
}

export interface CouvertureVaccinView {
  vaccin: string;
  patientsVaccines: number;
  totalPatients: number;
  tauxCouverture: number;
}

/** GET /analytics/vaccinations/couverture renvoie un objet, pas un tableau. */
export interface CouvertureVaccinaleView {
  totalPatients: number;
  couverture: CouvertureVaccinView[];
  prefecture: string;
}

export interface TendanceView {
  mois: string;
  consultations: number;
  vaccinations: number;
  referencements: number;
}

// ─── Consultation — vue detaillee (GET /consultations/:id) ────────────────────
// ConsultationView ci-dessus decrit la vue liste. Le detail renvoie davantage :
// le patient, les constantes, les diagnostics, les ordonnances et le
// referencement avec sa structure cible.
//
// Les champs de date sont typees `HorodatageApi` : le fil transporte toujours
// une chaine ISO, mais le meme type annote aussi le controleur, ou Prisma
// fournit un Date. L'union laisse passer les deux. Ce qui est garanti — et
// c'est le point — ce sont les noms et la presence des champs.
export type HorodatageApi = string | Date;

export interface PatientResumeView {
  id: string;
  qrCode?: string;
  dateNaissance?: HorodatageApi;
  sexe?: string;
  groupeSanguin?: string | null;
  allergies?: string[];
  utilisateur?: {
    prenom: string;
    nom: string;
    telephone: string;
    photoUrl?: string | null;
  };
}

export interface DiagnosticDetailView extends DiagnosticView {
  statutClinique: string;
  creeLe: HorodatageApi;
}

export interface ReferencementView {
  id: string;
  urgence: string;
  statut: string;
  resumeClinique: string;
  structureCible?: {
    id: string;
    nom: string;
    type: string;
    prefecture: string;
  };
}

export interface ConsultationDetailView {
  id: string;
  statut: EncounterStatus;
  motifPrincipal: string;
  symptomes: string[];
  notesAsc?: string | null;
  protocoleUtilise?: string | null;
  confianceIa?: number | null;
  resumeIa?: string | null;
  consulteeLE: HorodatageApi;
  patient: PatientResumeView;
  constantes?: ConstantesVitalesView | null;
  diagnostics: DiagnosticDetailView[];
  ordonnances: OrdonnanceView[];
  referencement?: ReferencementView | null;
}

// ─── Catalogues (listes deroulantes) ──────────────────────────────────────────

/**
 * Ce que le catalogue peut contenir, en liste fermee (decision du 2026-10-01).
 * Porte les exclusions d'assurance. Seul `MEDICAMENT` se prescrit.
 */
export type CategorieProduit =
  | 'MEDICAMENT'
  | 'LAIT_INFANTILE'
  | 'COMPLEMENT_ALIMENTAIRE'
  | 'COSMETIQUE'
  | 'HYGIENE'
  | 'PARAPHARMACIE'
  | 'DISPOSITIF_MEDICAL'
  | 'AUTRE';

export interface MedicamentView {
  id: string;
  /** Le nom a afficher, quelle que soit la categorie. Toujours present. */
  libelle: string;
  categorie: CategorieProduit;
  /**
   * DCI, forme et dosage n'existent que pour un medicament : un lait infantile
   * n'en a pas. La contrainte SQL `medicaments_medicament_complet` garantit
   * qu'un `MEDICAMENT` les porte toutes les trois.
   */
  dci?: string | null;
  nomCommercial?: string | null;
  forme?: string | null;
  dosage?: string | null;
  /**
   * EF-05-12 : circuit reglemente (stupefiant, psychotrope). L'ecran de
   * prescription le signale avant la saisie ; l'API applique la regle de toute
   * facon.
   */
  estReglemente?: boolean;
}

/**
 * Ce qu'il faut d'un produit du catalogue pour l'afficher dans une liste.
 * Remplace deux formes en ligne identiques, qui annonçaient `dci` et `dosage`
 * obligatoires alors qu'un article non medicamenteux n'en a pas.
 */
export interface ProduitResumeView {
  id: string;
  libelle: string;
  categorie: CategorieProduit;
  dci?: string | null;
  nomCommercial?: string | null;
  dosage?: string | null;
  forme?: string | null;
}

export interface StructureView {
  id: string;
  nom: string;
  type: string;
  prefecture: string;
}

// ─── Stocks (poste ASC) ───────────────────────────────────────────────────────
// GET /asc/stocks renvoie la ligne de stock avec son medicament, plus un
// indicateur `enAlerte` calcule par le service.
export interface StockAscView {
  id: string;
  quantite: number;
  seuilAlerte: number;
  unite: string;
  /**
   * La peremption la plus proche parmi les lots encore en stock, puisque la
   * sortie se fait au plus proche de la date. `Stock.datePeremption` a disparu
   * le 2026-09-30 ; ce contrat l'annoncait encore, et les deux ecrans de stock
   * affichaient donc une date que l'API n'envoyait plus.
   */
  peremptionLaPlusProche?: HorodatageApi | null;
  enAlerte: boolean;
  medicament: MedicamentView & { classeTherapeutique?: string | null };
}

// ─── Planning (rendez-vous d'un agent) ────────────────────────────────────────
// GET /asc/planning renvoie les rendez-vous a venir avec leur patient.
// L'horodatage s'appelle `prevuLe` : il n'y a ni `date` ni `heure` separes.
export interface RendezVousAscView {
  id: string;
  statut: string;
  motif?: string | null;
  prevuLe: HorodatageApi;
  patient?: {
    utilisateur?: { prenom: string; nom: string; telephone: string };
  };
}

// ─── Espace medecin ───────────────────────────────────────────────────────────

/** GET /medecin/consultations — consultations terminees en attente de validation. */
export interface ConsultationAValiderView {
  id: string;
  statut: EncounterStatus;
  motifPrincipal: string;
  consulteeLE: HorodatageApi;
  notesMedecin?: string | null;
  idMedecinValideur?: string | null;
  patient?: PatientResumeView;
  // La relation ASC est optionnelle en base : une consultation saisie hors
  // parcours agent arrive avec `asc: null`.
  asc?: { utilisateur: { prenom: string; nom: string } } | null;
  constantes?: ConstantesVitalesView | null;
  diagnostics: DiagnosticDetailView[];
  ordonnances: OrdonnanceView[];
}

/** GET /medecin/dashboard. `structure` est la structure de rattachement. */
export interface MedecinDashboardView {
  consultationsValidees: number;
  consultationsEnAttente: number;
  referencementsEnAttente: number;
  messagesNonLus: number;
  structure: { nom: string; type: string; prefecture: string } | null;
}

/**
 * Interlocuteur d'un message. `id` est absent du select cote API : le client
 * le reconstruit depuis idExpediteur / idDestinataire du message porteur.
 */
export interface UtilisateurResumeView {
  id?: string;
  prenom: string;
  nom: string;
  photoUrl?: string | null;
  role?: string;
}

/** GET /medecin/messages. */
export interface MessageView {
  id: string;
  contenu: string;
  envoyeLe: HorodatageApi;
  lu: boolean;
  idExpediteur: string;
  idDestinataire: string;
  expediteur: UtilisateurResumeView;
  destinataire: UtilisateurResumeView;
}

// ─── Espace pharmacien ────────────────────────────────────────────────────────
// Medicament + tarif : le catalogue porte un prix national de reference.
export interface MedicamentTarifeView extends MedicamentView {
  /** Classe therapeutique en texte libre (« Antalgique »). Autre axe que `categorie`. */
  classeTherapeutique?: string | null;
  prixUnitaireGnf: number;
  /** Indique un produit cree et gere par l'officine connectee. */
  estPropreOfficine?: boolean;
}

export interface CreateProduitOfficineDto {
  libelle: string;
  categorie: Exclude<CategorieProduit, 'MEDICAMENT'>;
  prixUnitaireGnf: number;
  seuilAlerte?: number;
  unite?: string;
}

export type UpdateProduitOfficineDto = Partial<CreateProduitOfficineDto>;

/** Une ligne de l'ordonnance au comptoir : c'est l'unite de delivrance. */
export interface LigneDelivranceView {
  id: string;
  posologie: string;
  frequence: string;
  dureeJours: number;
  quantite: number;
  statut: StatutOrdonnance;
  instructions?: string | null;
  medicament: MedicamentTarifeView;
  /** EF-05-12 : circuit reglemente, signale ligne par ligne au comptoir. */
  estReglemente: boolean;

  /**
   * Ce qui a deja ete remis sur cette ligne, substitutions comprises (P6-b).
   *
   * Une ligne peut avoir ete entamee dans une autre officine : la quantite
   * prescrite ne dit pas ce qu'il reste a servir.
   */
  quantiteServie: number;
  /** `quantite - quantiteServie`, jamais negatif. */
  resteAServir: number;

  /**
   * Calcule par l'API : **ce qui reste a servir** x prix unitaire.
   *
   * Et non la quantite prescrite : une ligne entamee ailleurs se facturait en
   * entier, et le comptoir annoncait le prix des dix boites alors que trois
   * etaient deja parties.
   */
  prixTotalGnf: number;
  /** Calcule par l'API : le principe actif figure dans les allergies du patient. */
  alerteAllergie: boolean;
}

/** Ordonnance telle que presentee au comptoir (GET /pharmacien/scan/:qrCode). */
export interface OrdonnanceDelivranceView {
  id: string;
  numero: string;
  statut: StatutOrdonnance;
  valideJusquau: HorodatageApi;
  /** Calcule par l'API : `valideJusquau` depasse au moment de la lecture. */
  expiree: boolean;
  signeLe: HorodatageApi | null;
  /** Calcule par l'API : signataire de l'ordonnance, ou l'agent a defaut. */
  medecinNom: string;
  lignes: LigneDelivranceView[];
  /** Calcule par l'API : somme des lignes restant a delivrer. */
  totalGnf: number;

  /** EF-05-09 : ce qu'il reste apres la delivrance en cours. */
  renouvellementsRestants: number;
  /** EF-05-12 : impose le controle d'identite au comptoir. */
  contientProduitReglemente: boolean;
}

/**
 * Reponse de POST /pharmacien/ordonnances/verifier (EF-07-01). Une ordonnance
 * refusee renvoie toujours un motif lisible au comptoir : le pharmacien doit
 * pouvoir l'expliquer au patient.
 */
export interface VerificationOrdonnanceView {
  valide: boolean;
  motif?: string;
  ordonnance?: OrdonnanceDelivranceView;
  patient?: PatientScanView;
}

/**
 * GET /pharmacien/ordonnances — ordonnances en attente des patients de la
 * prefecture de la pharmacie. `qrCode` permet d'ouvrir directement la
 * delivrance (meme parcours que le scan).
 */
export interface OrdonnanceEnAttenteView {
  id: string;
  numero: string;
  statut: StatutOrdonnance;
  valideJusquau: HorodatageApi;
  expiree: boolean;
  creeLe: HorodatageApi;
  signeLe: HorodatageApi | null;
  /** Les medicaments restant a delivrer, pour situer l'ordonnance en un coup d'oeil. */
  medicaments: MedicamentView[];
  patient: { prenom: string; nom: string; qrCode: string };
}

export interface PatientScanView {
  /**
   * L'identifiant du dossier. Necessaire au comptoir pour le tiers payant :
   * sans lui, un pharmacien pouvait scanner un patient sans pouvoir ensuite
   * controler son eligibilite.
   */
  id: string;
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: string;
  groupeSanguin?: string;
  allergiesCritiques: string[];
}

export interface ScanPatientView {
  patient: PatientScanView;
  ordonnances: OrdonnanceDelivranceView[];
  totalOrdonnances: number;
}

/** GET /pharmacien/stocks — ligne de stock d'une officine. */
export interface StockPharmacieView {
  id: string;
  quantite: number;
  seuilAlerte: number;
  unite: string;
  /**
   * La peremption la plus proche parmi les lots encore en stock, puisque la
   * sortie se fait au plus proche de la date. `Stock.datePeremption` a disparu
   * le 2026-09-30 ; ce contrat l'annoncait encore, et les deux ecrans de stock
   * affichaient donc une date que l'API n'envoyait plus.
   */
  peremptionLaPlusProche?: HorodatageApi | null;
  margeGnf: number;
  medicament: MedicamentTarifeView;
}

export type MouvementStockType = 'ENTREE' | 'SORTIE' | 'AJUSTEMENT' | 'CORRECTION';

/** Mouvement signe dans le registre immuable de l'officine. */
export interface MouvementStockView {
  id: string;
  type: MouvementStockType;
  quantite: number;
  reference: string | null;
  motif: string | null;
  creeLe: HorodatageApi;
  medicament: { id: string; libelle: string } | null;
  lot: { id: string; numeroLot: string | null } | null;
  utilisateur: { id: string; prenom: string; nom: string };
}

export interface AjusterLotStockDto {
  quantiteComptee: number;
  motif: string;
}

export interface AjustementLotStockView {
  idLot: string;
  quantiteAvant: number;
  quantiteComptee: number;
  variation: number;
  idMouvement: string | null;
}

// ─── Vaccinations ─────────────────────────────────────────────────────────────
// GET /vaccinations/me renvoie les lignes Prisma avec l'agent administrant.
// Les noms sont ceux du schema : `vaccinNom` et `administreLe`. Le front a
// longtemps tente `nomVaccin` et `dateAdministration`, qui n'existent pas.
export interface VaccinationView {
  id: string;
  vaccinNom: string;
  codeEpi?: string | null;
  numeroLot?: string | null;
  siteInjection?: string | null;
  reaction?: string | null;
  urlCertificat?: string | null;
  dateProchaineD?: HorodatageApi | null;
  administreLe: HorodatageApi;
  administrePar?: { prenom: string; nom: string; role?: string };
}

// ─── Structures de sante ──────────────────────────────────────────────────────

/**
 * GET /admin-structure/structures/publiques — liste ouverte, servie sans
 * authentification, qui alimente le choix de structure preferee du patient.
 * Le select est volontairement etroit : ni `estActive` (seules les actives
 * sortent), ni compteurs, ni utilisateurs rattaches.
 */
export interface StructurePubliqueView {
  id: string;
  nom: string;
  type: string;
  prefecture: string;
  adresse?: string | null;
  telephone?: string | null;
}

/**
 * GET /admin-structure/structures — vue super-admin : metadonnees des
 * structures, desactivees comprises. Les comptes rattaches restent prives.
 */
export interface StructureAdminView {
  id: string;
  nom: string;
  type: string;
  idStructureParente?: string | null;
  prefecture: string;
  adresse?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  telephone?: string | null;
  photoUrl?: string | null;
  estActive: boolean;
  creeLe: HorodatageApi;
}

/** Compte cree en meme temps qu'une structure ou une pharmacie. */
export interface CompteCreeView {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  email?: string | null;
  role: Role;
}

/**
 * POST /admin-structure/structures et /pharmacies.
 *
 * Les deux renvoient la structure sous la cle `structure` — il n'existe pas de
 * cle `pharmacie`. Seul le compte cree change de nom : `admin` d'un cote,
 * `pharmacien` de l'autre.
 *
 * `motDePasseTemporaire` n'est present que si l'API a genere le mot de passe,
 * c'est-a-dire quand l'appelant n'en a pas fourni.
 */
// ─── Le dossier reglementaire d'une structure privee ──────────────────────────
//
// **La creation n'exigeait aucune preuve.** Une pharmacie sans agrement, une
// clinique sans autorisation d'exploitation entraient sur la plateforme comme
// les autres. Depuis le 2026-10-28, les quatre types prives ne se creent plus
// sans leur dossier : il bloque.

/**
 * Les pieces retenues.
 *
 * On ne garde que ce que les controles exigent reellement (campagne du
 * 27 juillet 2026) : aucun arrete d'application ne publie de liste
 * exhaustive, et inventer les autres aurait pose des obstacles que
 * l'administration elle-meme ne pose pas. `AUTRE` est la soupape — le jour ou
 * une direction exige le plan architectural, la piece se depose sans
 * migration.
 */
export type TypePieceAgrement =
  | 'AGREMENT_CREATION'
  | 'AGREMENT_EXPLOITATION'
  | 'DIPLOME_RESPONSABLE'
  | 'INSCRIPTION_ORDRE'
  /** L'assureur releve de la Banque Centrale, pas du ministere de la Sante. */
  | 'AGREMENT_ASSURANCE'
  | 'AUTRE';

/** Une piece deposee. Le contenu ne passe jamais par le JSON : voir `GET /pieces/:id`. */
export interface PieceAgrementView {
  id: string;
  type: TypePieceAgrement;
  /** En octets, pour l'afficher sans toucher au disque. */
  taille: number;
  /** Renseigne pour `AUTRE`, qui ne dit rien de lui-meme. */
  libelle: string | null;
  deposeLe: HorodatageApi;
}

/** GET /admin-structure/structures/:id/dossier */
export interface DossierAgrementView {
  idStructure: string;
  nom: string;
  type: string;
  rccm: string | null;
  numeroAgrementCreation: string | null;
  numeroAgrementExploitation: string | null;
  lieuAutorise: string | null;
  /** Faux pour une structure publique : elle n'a rien a produire. */
  exigeDesPieces: boolean;
  /** Vrai aussi quand rien n'est exige — une structure publique est complete. */
  complet: boolean;
  manquantes: TypePieceAgrement[];
  pieces: PieceAgrementView[];
}

/**
 * Les identifiants reglementaires, a la creation.
 *
 * Tous optionnels dans le type : l'exigence depend du type de structure, et
 * c'est le serveur qui tranche. Une structure publique n'en fournit aucun.
 *
 * Le RCCM identifie l'entite juridique ; il **n'autorise aucune activite
 * sanitaire**. Deux formes circulent en Guinee et aucun texte officiel n'en
 * fixe le format : le serveur normalise plutot que de refuser.
 */
export interface IdentifiantsReglementairesDto {
  rccm?: string;
  /** Pour un assureur, la reference de la decision de la Banque Centrale. */
  numeroAgrementCreation?: string;
  /** Sans objet pour un assureur : pas d'arrete d'exploitation distinct. */
  numeroAgrementExploitation?: string;
  /** Le lieu que l'agrement autorise. Il peut differer de l'adresse. */
  lieuAutorise?: string;
}

export interface CreationStructureView {
  structure: StructureAdminView;
  admin: CompteCreeView;
  motDePasseTemporaire?: string;
}

export interface CreationPharmacieView {
  structure: StructureAdminView;
  pharmacien: CompteCreeView;
  motDePasseTemporaire?: string;
}

// ─── Espace admin de structure ────────────────────────────────────────────────

/** GET /admin-structure/agents — agents actifs rattaches a la structure. */
export interface AgentStructureView {
  id: string;
  telephone: string;
  email?: string | null;
  prenom: string;
  nom: string;
  role: Role;
  creeLe: HorodatageApi;
  derniereConnexion?: HorodatageApi | null;
  /**
   * Ou le patient doit se rendre, pour un medecin : « Batiment B, bureau 12 ».
   *
   * **Facultatif** : beaucoup d hopitaux ne numerotent pas leurs bureaux et
   * l agent accompagne le patient a pied. `null` ne s affiche pas.
   */
  bureau?: string | null;
}

/** PUT /admin-structure/agents/:id/bureau — un bureau change, un medecin demenage. */
export interface DefinirBureauDto {
  bureau: string | null;
}

/**
 * POST /admin-structure/agents.
 *
 * `agent` ne porte pas l'email : l'ecran affiche l'adresse saisie, pas une
 * valeur renvoyee par l'API. `motDePasseTemporaire` n'est present que si
 * l'API a genere le mot de passe.
 */
export interface CreationAgentView {
  agent: {
    id: string;
    telephone: string;
    prenom: string;
    nom: string;
    role: Role;
  };
  motDePasseTemporaire?: string;
}

/** POST /comptes/livreurs. La piece QR reste privee de l'administration. */
/**
 * POST /comptes/administrateurs — le super administrateur recrute l'encadrement.
 *
 * **Ces deux roles n'etaient creables par personne.** Ils figuraient dans
 * l'enumeration et dans les gardes de routes, mais aucun schema ne les
 * acceptait : le seul moyen d'en obtenir un etait le seed ou une insertion
 * SQL. En pratique, un unique super administrateur portait toute la
 * plateforme.
 *
 * **Aucune region n'est demandee, et ce n'est pas un oubli.** `Utilisateur`
 * ne porte aucun champ geographique, et `ADMIN_REGIONAL` figure dans les roles
 * que le controle d'acces laisse passer sans filtre : son perimetre est
 * aujourd'hui celui du national. Demander une prefecture ici afficherait un
 * cloisonnement qui n'existe pas. Le jour ou il sera pose, le champ viendra
 * avec lui.
 */
export interface CreerAdministrateurDto {
  prenom: string;
  nom: string;
  telephone: string;
  /** Son identifiant de connexion : tout non-patient se connecte par email. */
  email: string;
  role: 'ADMIN_REGIONAL' | 'ADMIN_NATIONAL';
}

/** GET /comptes/administrateurs. Sans mot de passe. */
export interface AdministrateurView {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  email: string;
  role: 'ADMIN_REGIONAL' | 'ADMIN_NATIONAL';
  estActif: boolean;
  creeLe: HorodatageApi;
}

export interface CreationAdministrateurView {
  administrateur: AdministrateurView;
  motDePasseTemporaire: string;
}

// ═══════════════════════════════════════════════════════════════════
// EF-04 — Le plateau technique des laboratoires
//
// **Le renvoi vers un laboratoire se faisait a l'aveugle.** La liste proposee
// au medecin rendait tous les laboratoires actifs du pays, sans filtre sur ce
// qu'ils savent faire ni sur la geographie : le laboratoire recevait la
// demande et decouvrait qu'il ne faisait pas l'examen. Le patient, lui,
// s'etait deplace.
// ═══════════════════════════════════════════════════════════════════

/** D'ou vient ce laboratoire dans la liste du medecin. L'ordre est le parcours. */
export type OrigineLaboratoire = 'INTERNE' | 'CONSEILLE' | 'AUTRE';

/** Un examen que le laboratoire choisi ne realise pas. */
export interface ExamenNonCouvertView {
  id: string;
  libelle: string;
  codeLoinc: string;
}

/**
 * Un laboratoire, tel que l'ecran de prescription le montre.
 *
 * `couverts` / `demandes` sont le compte exact, pas un booleen : le medecin
 * doit voir « 3 sur 5 » et lesquels manquent **avant** de choisir, pas
 * decouvrir le probleme une fois le patient parti.
 */
export interface LaboratoireChoixView {
  id: string;
  nom: string;
  type: string;
  prefecture: string;
  origine: OrigineLaboratoire;
  /** Nombre d'examens demandes que ce laboratoire realise. */
  couverts: number;
  /** Nombre d'examens demandes. Zero quand aucun n'est encore coche. */
  demandes: number;
  /** Nommes, pour que la confirmation puisse les dire. */
  nonCouverts: ExamenNonCouvertView[];
  /**
   * Aucun examen declare : le laboratoire est repute tout savoir faire. Sans
   * cette regle, toutes les structures existantes disparaitraient des listes
   * le jour du deploiement.
   */
  plateauNonDeclare: boolean;
}

/** GET /hopital/laboratoires. Les trois groupes, dans l'ordre du parcours. */
export interface ChoixLaboratoiresView {
  interne: LaboratoireChoixView[];
  conseilles: LaboratoireChoixView[];
  autres: LaboratoireChoixView[];
  /** La prefecture sur laquelle `autres` est filtre, sauf elargissement. */
  prefecture: string | null;
  /** Vrai quand l'appelant a demande tout le pays. */
  toutLePays: boolean;
}

/** Une ligne du plateau technique, vue par le laboratoire qui la declare. */
export interface LignePlateauView {
  idExamen: string;
  codeLoinc: string;
  libelle: string;
  categorie: string;
  realise: boolean;
  delaiHeures: number | null;
  /** Renseigne seulement s'il differe du prix du referentiel national. */
  prixGnf: number | null;
  prixReferenceGnf: number | null;
}

/** GET /laboratoire/plateau-technique. */
export interface PlateauTechniqueView {
  idStructure: string;
  nom: string;
  /** Rien de declare : tout est repute realisable. L'ecran doit le dire. */
  nonDeclare: boolean;
  lignes: LignePlateauView[];
}

/** PUT /laboratoire/plateau-technique — la declaration complete, en un geste. */
export interface DeclarerPlateauDto {
  examens: {
    idExamen: string;
    realise: boolean;
    delaiHeures?: number | null;
    prixGnf?: number | null;
  }[];
}

/** Une structure conseillee par l'etablissement. */
export interface StructureConseilleeView {
  id: string;
  idStructureConseillee: string;
  nom: string;
  type: string;
  prefecture: string;
  declareLe: HorodatageApi;
}

/** POST /admin-structure/conseillees. */
export interface ConseillerStructureDto {
  idStructureConseillee: string;
}

export interface CreerLivreurDto {
  prenom: string;
  nom: string;
  telephone: string;
  quartier: string;
  prefecture: string;
  /** Commune de travail : la zone des courses qu'il recoit. */
  commune?: string;
}

/** GET /comptes/livreurs. Ne contient ni QR ni mot de passe. */
export interface LivreurAdminView {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  quartier: string;
  prefecture: string;
  commune: string | null;
  estActif: boolean;
  creeLe: HorodatageApi;
}

export interface CreationLivreurView {
  livreur: LivreurAdminView;
  motDePasseTemporaire: string;
}

/**
 * GET /admin-structure/stats.
 * `structure` provient d'un findUnique : le type garde la nullabilite.
 */
/** `GET /admin-structure/ma-structure` : ce que le menu doit savoir. */
export interface MaStructureView {
  id: string;
  nom: string;
  type: TypeStructure;
  hospitaliere: boolean;
}

export interface StatsStructureView {
  structure: StructureAdminView | null;
  totalAgents: number;
  totalConsultations: number;
  totalPatients: number;
}

// ─── Referencements (espace medecin) ─────────────────────────────────────────

/**
 * GET /medecin/referencements — referencement dirige vers la structure du
 * medecin, avec le contexte clinique de la consultation d'origine.
 * PUT /medecin/referencements/:id/repondre renvoie la meme forme.
 */
export interface ReferencementATraiterView {
  id: string;
  urgence: Urgence;
  statut: ReferralStatus;
  resumeClinique: string;
  motifRefus: string | null;
  urlDocument: string | null;
  creeLe: HorodatageApi;
  reponduLe: HorodatageApi | null;
  consultation: {
    id: string;
    motifPrincipal: string;
    symptomes: string[];
    consulteeLE: HorodatageApi;
    patient: PatientResumeView & { prefecture: string };
    constantes: ConstantesVitalesView | null;
    diagnostics: DiagnosticView[];
  };
  structureSource: StructureView | null;
  structureCible: StructureView;
}

// ─── Confidentialite patient ─────────────────────────────────────────────────

// `ConsentementView` vivait ici : c etait la ligne brute de la table. Elle est
// remplacee par la vue versionnee plus bas (EF-02-01), qui porte en plus le
// texte reellement presente et dit si l accord a seulement ete presume. Garder
// les deux aurait fait coexister deux notions de « consentement », dont une
// qui ne sait pas a quoi la personne a dit oui.

/** PUT /privacy/me/consents */
export interface SetConsentementDto {
  scope: ConsentScope;
  actif: boolean;
  source?: string;
  commentaire?: string;
}

/** GET /privacy/me/audit-logs — acces journalises au dossier du patient. */
/**
 * Une ligne du journal des acces au dossier, telle que le patient la lit
 * (EF-02-08).
 */
export interface AccesDossierView {
  id: string;
  /**
   * Le motif de route enregistre (`GET /:id`). Conserve pour une enquete ou
   * un signalement : c'est la trace technique. **Ne pas l'afficher seul** —
   * un patient ne lit pas « GET /:id ». Voir `libelle`.
   */
  action: string;
  ressource: string;
  idRessource: string | null;
  /**
   * La meme chose en mots de patient, sous forme de **cles de traduction** :
   * la phrase, et l'objet qu'elle designe.
   *
   * L'API ne rend pas de texte. L'application est bilingue — le selecteur de
   * langue est a l'ecran — et une phrase francaise figee s'afficherait telle
   * quelle a un patient ayant choisi l'anglais. La formulation vit donc dans
   * `apps/web/src/app/shared/i18n/{fr,en}.json`, comme tout le reste de
   * l'interface.
   *
   * La phrase attend un parametre `objet`, a remplacer par la traduction de
   * `libelleObjet`. Ce dernier est vide pour les phrases qui se suffisent a
   * elles-memes, comme le scan d'un code au comptoir.
   */
  libelle: string;
  libelleObjet: string;
  /**
   * `true` quand c'est le patient lui-meme qui a agi.
   *
   * Sans cette distinction, ses propres consultations noient celles des
   * tiers : dans la base de demonstration, elles representaient 273 lignes
   * sur 850.
   */
  parMoi: boolean;
  /** Le code HTTP rendu. Un refus (>= 400) est une tentative, pas un acces. */
  statutHttp: number | null;
  creeLe: HorodatageApi;
  utilisateur: {
    id: string;
    prenom: string;
    nom: string;
    role: Role;
  };
}

// ─── Notifications in-app ────────────────────────────────────────────────────

/** GET /notifications/me — une notification destinee a l'utilisateur connecte. */
export interface NotificationView {
  id: string;
  type: TypeNotification;
  titre: string;
  contenu: string;
  lienAction: string | null;
  metadonnees: Record<string, unknown> | null;
  luLe: HorodatageApi | null;
  creeLe: HorodatageApi;
}

/** GET /notifications/me/non-lues */
export interface NotificationsNonLuesView {
  nonLues: number;
}

/** Evenement Socket.IO `notification:new` — meme forme que la vue REST. */
export type NotificationTempsReel = NotificationView;

// ─── Parametres systeme (super-admin) ────────────────────────────────────────

export interface ParametresFacturationView {
  paiementEspeces: boolean;
  paiementOrangeMoney: boolean;
  paiementMomo: boolean;
  /** Marge par defaut appliquee sur les medicaments, en pourcentage. */
  margePct: number;
}

export interface ParametresSecuriteView {
  /**
   * A la creation d'un dossier, accorder d'office les consentements
   * necessaires aux soins (DOSSIER_MEDICAL, RAPPELS_SMS). FHIR_EXPORT et
   * RECHERCHE_ANONYMISEE restent toujours au choix du patient.
   */
  consentementDefaut: boolean;
}

export interface ParametresAlertesView {
  /** Cas de paludisme par prefecture sur 30 jours avant alerte. */
  seuilPaludisme: number;
  /** Cas d'Ebola par prefecture sur 30 jours avant alerte. */
  seuilEbola: number;
  activerIA: boolean;
}

export interface ParametresSyncView {
  offlineMode: boolean;
  frequenceMinutes: number;
  ussdTimeoutSecondes: number;
}

/** GET /sync/config — sous-ensemble des parametres lu par le client web (file hors-ligne). */
export interface ConfigSyncView {
  offlineMode: boolean;
  frequenceMinutes: number;
}

/**
 * Identite de la plateforme (nom, logo, coordonnees). Editee par le
 * super-admin ; consommee par le web (landing, auth, footer, onglet), les
 * e-mails, les SMS/USSD et la documentation API. Aucune de ces valeurs ne
 * doit exister en dur dans le code.
 */
export interface ParametresIdentiteView {
  /** Nom affiche partout (ex. « KÈNÈYA »). */
  nom: string;
  /** Nom sans accent ni caracteres speciaux, pour les SMS et l'USSD (alphabet GSM). Derive du nom si vide. */
  nomCourt: string;
  slogan: string;
  /** URL absolue du logo televerse (vide = pas de logo, le nom est affiche seul). */
  logoUrl: string;
  adresse: string;
  ville: string;
  pays: string;
  telephone: string;
  telephoneSupport: string;
  emailContact: string;
  emailSupport: string;
  /** Nom d'expediteur des e-mails ; l'adresse reste celle du compte SMTP. */
  emailExpediteur: string;
  siteWeb: string;
  facebook: string;
  whatsapp: string;
  /** Mention de pied de page ; vide = « © <annee> <nom> — Tous droits reserves ». */
  copyright: string;
  /** Code ISO 4217 de la devise affichee (ex. GNF). */
  devise: string;
}

/**
 * GET /parametres/publics — sous-ensemble sans authentification, lu par le
 * web au demarrage (landing, pages d'auth, footer, titre d'onglet).
 */
export type IdentitePlateformeView = ParametresIdentiteView;

/** Valeurs persistees, toujours completes (defauts fusionnes cote serveur). */
/**
 * Duree de validite d'une ordonnance. Le cahier des charges en fait un
 * parametre administrable (decision D2 en attente) : jamais une constante.
 */
export interface ParametresPrescriptionView {
  /** Jours de validite a compter de la signature. */
  dureeValiditeJours: number;
  /** Longueur du code de verification remis au patient. */
  longueurCodeVerification: number;
  /**
   * Decision D2, non tranchee : faut-il la signature d'un medecin pour qu'une
   * ordonnance soit delivrable ? Tant qu'elle ne l'est pas, une ordonnance
   * redigee par un ASC et cloturee reste delivrable (`false`), ce qui est le
   * fonctionnement actuel sur le terrain. Passer a `true` impose la validation
   * medecin avant tout passage en pharmacie.
   */
  signatureObligatoire: boolean;

  /**
   * EF-05-12 : validite d'une ordonnance portant un produit a circuit
   * reglemente (stupefiant, psychotrope). Toujours plus courte que la duree
   * ordinaire ; la signature d'un medecin y est exigee quoi qu'il arrive.
   */
  dureeValiditeReglementeJours: number;

  /** EF-05-09 : plafond de renouvellements qu'un prescripteur peut accorder. */
  renouvellementsMax: number;
}

/** Regles du comptoir d'officine (addendum du 2026-09-28, point 1.1). */
export interface ParametresPharmacieView {
  /**
   * Categories soumises a ordonnance **en plus** des produits reglementes,
   * qui le sont toujours (EF-05-12).
   *
   * La question E de l'addendum — « la vente sans ordonnance est-elle
   * autorisee pour tous les produits ? » — n'est pas tranchee. La reponse
   * s'administre donc ici, comme les decisions D1 a D10, plutot que de vivre
   * en constante dans le code.
   */
  categoriesExigeantOrdonnance: CategorieProduit[];
}

/**
 * Elargissement des appels (M5) : sans preneur dans sa commune au bout de ce
 * delai, une ordonnance ou une course s'ouvre a toute la prefecture.
 */
export interface ParametresZonesView {
  delaiElargissementCommandeMinutes: number;
  delaiElargissementCourseMinutes: number;
  /** R1 : au-dela, depuis l'ouverture, l'appel s'arrete (sans pharmacie / sans motard). */
  delaiFinalCommandeMinutes: number;
  delaiFinalCourseMinutes: number;
}

/** Langues dans lesquelles un niveau administratif peut etre nomme. */
export type LangueLibelle = 'fr' | 'en' | 'pt';

/**
 * Un niveau administratif du pays (M1) : « Prefecture » en Guinee, « LGA » au
 * Nigeria, « Distrito » au Mozambique. Du plus large au plus fin.
 */
export interface NiveauAdministratifView {
  /** Identifiant stable, en minuscules : `prefecture`, `lga`, `distrito`... */
  code: string;
  libelles: { fr: string; en?: string; pt?: string };
}

/**
 * Le pays de l'installation (M1). Une installation sert un seul pays : ses
 * donnees de sante y restent, et son decoupage administratif y est declare.
 *
 * Les champs `commune` et `prefecture` des patients, structures et motards
 * portent respectivement le lieu du **niveau de base** (ou l'on cherche
 * d'abord une pharmacie ou un motard) et celui du **niveau d'elargissement**
 * (ou l'appel s'etend ensuite). Leurs noms techniques datent de la Guinee ;
 * leur sens vient d'ici.
 */
export interface ParametresPaysView {
  /** ISO 3166-1 alpha-2 : GN, SN, NG, MZ... */
  code: string;
  nom: string;
  /** Indicatif international : +224, +221, +234... */
  indicatifTelephone: string;
  niveaux: NiveauAdministratifView[];
  /** Code du niveau ou l'on cherche d'abord (la commune en Guinee). */
  niveauBase: string;
  /** Code du niveau ou l'appel s'etend ensuite (la prefecture en Guinee). */
  niveauElargissement: string;
}

export interface ParametresSystemeValeurs {
  identite: ParametresIdentiteView;
  facturation: ParametresFacturationView;
  securite: ParametresSecuriteView;
  alertes: ParametresAlertesView;
  sync: ParametresSyncView;
  prescription: ParametresPrescriptionView;
  pharmacie: ParametresPharmacieView;
  zones: ParametresZonesView;
  pays: ParametresPaysView;
}

/** GET/PUT /admin-structure/parametres */
export interface ParametresSystemeView extends ParametresSystemeValeurs {
  modifieLe: HorodatageApi | null;
  idModifiePar: string | null;
}

/** PUT /admin-structure/parametres — chaque section et chaque champ est optionnel. */
export interface UpdateParametresSystemeDto {
  identite?: Partial<ParametresIdentiteView>;
  facturation?: Partial<ParametresFacturationView>;
  securite?: Partial<ParametresSecuriteView>;
  alertes?: Partial<ParametresAlertesView>;
  sync?: Partial<ParametresSyncView>;
  prescription?: Partial<ParametresPrescriptionView>;
  pharmacie?: Partial<ParametresPharmacieView>;
  zones?: Partial<ParametresZonesView>;
  pays?: Partial<ParametresPaysView>;
}

/** POST /admin-structure/parametres/logo — reponse. */
export interface LogoPlateformeView {
  logoUrl: string;
}

// ═══════════════════════════════════════════════════════════════════
// P1 — Hopital : episode de soins et demande d'analyse (EF-03)
// Routes /hopital/* (AGENT_ACCUEIL, MEDECIN, ADMIN_STRUCTURE) et /patients/me/episodes.
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /medecin/orientations — un patient que l'accueil a oriente vers ce
 * medecin (EF-03-05).
 *
 * L'orientation posait `EpisodeSoins.idResponsable` et creait un rendez-vous,
 * mais rien dans l'espace medecin ne lisait l'un ni l'autre : le patient
 * etait oriente vers quelqu'un qui ne le voyait jamais arriver.
 */
export interface OrientationMedecinView {
  idEpisode: string;
  numeroEpisode: string;
  statutEpisode: StatutEpisode;
  motif: string;
  service?: string | null;
  ouvertLe: HorodatageApi;
  /** Moment ou l'orientation a ete posee. */
  orienteLe: HorodatageApi;
  patient: {
    id: string;
    prenom: string;
    nom: string;
    dateNaissance: HorodatageApi;
    sexe: string;
    telephone: string;
  };
  structure: { id: string; nom: string };
  /** Present seulement si l'accueil a propose une date. */
  rendezVous?: {
    id: string;
    prevuLe: HorodatageApi;
    statut: string;
    motif?: string | null;
  } | null;
}

/**
 * POST /medecin/resultats/:idDemande/liberer — le medecin rend les resultats
 * visibles au patient (addendum du 2026-09-28).
 *
 * Le commentaire est la « traduction » : un resultat est ecrit pour un soignant,
 * et le patient qui le lit seul ne sait pas s'il doit s'inquieter.
 */
export interface LibererResultatsDto {
  commentaire?: string;
}

/**
 * GET /laboratoire/scan/:qrCode — ce que voit le laborantin qui scanne un
 * patient au comptoir.
 *
 * Volontairement etroit : l'identite minimale et les demandes encore a traiter
 * dans SON laboratoire. Un QR est un identifiant, pas une cle du dossier
 * medical — le pharmacien qui scanne le meme code voit des ordonnances et
 * aucune analyse.
 */
export interface ScanLaboratoireView {
  patient: {
    id: string;
    prenom: string;
    nom: string;
    dateNaissance: HorodatageApi;
    sexe: string;
    telephone: string;
  };
  demandes: {
    id: string;
    numero: string;
    statut: StatutDemandeAnalyse;
    urgence: Urgence;
    creeLe: HorodatageApi;
    consignesPatient?: string | null;
    examens: string[];
    /** Au moins un examen exige d'etre a jeun : a savoir avant de prelever. */
    aJeun: boolean;
  }[];
  totalDemandes: number;
}

/** Un lot recu : une quantite, une date de peremption, une origine. */
export interface LotStockView {
  id: string;
  numeroLot?: string | null;
  /** Ce qui reste de ce lot. */
  quantite: number;
  quantiteRecue: number;
  datePeremption?: HorodatageApi | null;
  prixAchatGnf: number;
  medicament: ProduitResumeView;
}

/** POST /pharmacien/approvisionnements — une ligne de la facture. */
export interface LigneApprovisionnementDto {
  idMedicament: string;
  quantite: number;
  numeroLot?: string;
  datePeremption?: HorodatageApi;
  prixAchatGnf?: number;
  unite?: string;
}

export interface CreerApprovisionnementDto {
  fournisseur: string;
  dateFacture: HorodatageApi;
  numeroFacture?: string;
  /** Photo ou scan de la facture : la piece qui justifie l'entree. */
  justificatifUrl?: string;
  lignes: LigneApprovisionnementDto[];
}

export interface ApprovisionnementView {
  id: string;
  numero: string;
  numeroFacture?: string | null;
  fournisseur: string;
  dateFacture: HorodatageApi;
  justificatifUrl?: string | null;
  montantTotalGnf: number;
  creeLe: HorodatageApi;
  saisiPar: { id: string; prenom: string; nom: string };
  lots: LotStockView[];
}

/** GET /pharmacien/peremptions — ce qui approche de sa date, ou l'a depassee. */
export interface PeremptionProcheView {
  idLot: string;
  numeroLot?: string | null;
  quantite: number;
  datePeremption: HorodatageApi;
  /** Negatif quand la date est passee. */
  joursRestants: number;
  perime: boolean;
  unite: string;
  medicament: ProduitResumeView;
}

/** Ou en est la demande qu'un patient a faite depuis chez lui. */
export type StatutDemandeRendezVous = 'EN_ATTENTE' | 'ACCEPTEE' | 'REFUSEE' | 'ANNULEE';

/** POST /patients/me/demandes-rendez-vous — le patient demande depuis chez lui. */
export interface CreerDemandeRendezVousDto {
  motif: string;
  /** A defaut, l'etablissement prefere du dossier. */
  idStructure?: string;
  /** S'il connait un medecin ; sinon l'accueil oriente la demande. */
  idMedecin?: string;
}

/** POST /medecin/demandes/:id/accepter — accepter, c'est fixer l'heure. */
export interface AccepterDemandeRendezVousDto {
  prevuLe: HorodatageApi;
}

export interface DemandeRendezVousView {
  id: string;
  motif: string;
  statut: StatutDemandeRendezVous;
  creeLe: HorodatageApi;
  traiteeLe?: HorodatageApi | null;
  motifRefus?: string | null;
  patient: {
    id: string;
    prenom: string;
    nom: string;
    dateNaissance: HorodatageApi;
    sexe: string;
    telephone: string;
  };
  structure: { id: string; nom: string; prefecture: string };
  /**
   * `bureau` : ou le patient devra se rendre le jour du rendez-vous. Souvent
   * `null` — tous les hopitaux ne numerotent pas leurs bureaux, et l agent
   * d accueil accompagne a pied.
   */
  medecin?: { id: string; prenom: string; nom: string; bureau?: string | null } | null;
  /** Rempli a l'acceptation : la demande est devenue une visite. */
  idEpisode?: string | null;
  numeroEpisode?: string | null;
}

/** Le cycle d'un rendez-vous, de la prise au depart du patient. */
export type StatutRendezVous =
  | 'PLANIFIE'
  | 'PRESENT'
  | 'EN_CONSULTATION'
  | 'TERMINE'
  | 'ABSENT'
  | 'ANNULE';

/** POST /medecin/orientations/:idEpisode/rendez-vous — le medecin pose le creneau. */
export interface FixerRendezVousDto {
  prevuLe: HorodatageApi;
  motif?: string;
}

/** GET /medecin/rendez-vous — l'agenda, par ordre chronologique. */
export interface RendezVousMedecinView {
  id: string;
  prevuLe: HorodatageApi;
  statut: StatutRendezVous;
  motif?: string | null;
  /** Moment ou l'assistante a pointe l'arrivee ; absent tant qu'il n'est pas la. */
  arriveeLe?: HorodatageApi | null;
  patient: {
    id: string;
    prenom: string;
    nom: string;
    dateNaissance: HorodatageApi;
    sexe: string;
    telephone: string;
  };
  idEpisode?: string | null;
  numeroEpisode?: string | null;
}

/** GET /hopital/presences — les patients attendus aujourd'hui, vus de l'accueil. */
export interface PresenceDuJourView {
  idRendezVous: string;
  prevuLe: HorodatageApi;
  statut: StatutRendezVous;
  arriveeLe?: HorodatageApi | null;
  patient: { id: string; prenom: string; nom: string; telephone: string };
  /**
   * `bureau` est ce que l agent lit au patient apres l avoir pointe. Souvent
   * `null` : beaucoup d hopitaux ne numerotent pas leurs bureaux, et l agent
   * accompagne a pied. Dans ce cas l ecran n affiche rien.
   */
  medecin?: { id: string; prenom: string; nom: string; bureau?: string | null } | null;
  idEpisode?: string | null;
}

/** GET /medecin/resultats — la file des resultats qu'un medecin doit liberer. */
export interface ResultatALibererView {
  idDemande: string;
  numero: string;
  /** Validation par le laboratoire : c'est de ce moment que date l'attente du patient. */
  valideeLe: HorodatageApi;
  idEpisode: string;
  nbExamens: number;
  contientCritique: boolean;
  contientAnormal: boolean;
  patient: { id: string; prenom: string; nom: string };
  laboratoire: { id: string; nom: string };
}

/** GET /hopital/patients/recherche — identite minimale pour l'identito-vigilance (EF-03-01). */
export interface PatientRechercheView {
  id: string;
  prenom: string;
  nom: string;
  sexe: string;
  dateNaissance: HorodatageApi;
  prefecture: string;
  /** Masque sauf les 3 derniers chiffres. */
  telephoneMasque: string;
  /** Un episode ouvert existe deja dans la structure de l'agent. */
  episodeOuvert: { id: string; numero: string } | null;
}

/**
 * GET /assurance/patients/recherche — trouver la personne a qui rattacher une
 * police.
 *
 * **L'episode de soins n'a pas de sens ici** : l'administration nationale
 * n'appartient a aucune structure, et une police se rattache a une personne,
 * pas a un passage. Le reste de l'identite est le meme, numero masque
 * compris : il faut distinguer deux Camara, pas appeler le patient.
 */
export type PatientContratRechercheView = Omit<PatientRechercheView, 'episodeOuvert'>;

export interface PersonneRefView {
  id: string;
  prenom: string;
  nom: string;
  role: Role;
}

export interface StructureRefView {
  id: string;
  nom: string;
  type: TypeStructure;
  prefecture: string;
}

/** Referentiel des examens (codes LOINC). */
export interface ExamenView {
  id: string;
  codeLoinc: string;
  libelle: string;
  categorie: string;
  specimen: string;
  unite: string | null;
  aJeun: boolean;
  consignes: string | null;
  prixGnf: number | null;
  /** Valeurs de reference et seuils critiques (EF-04-04, EF-04-07). */
  refMin: number | null;
  refMax: number | null;
  refTexte: string | null;
  critiqueMin: number | null;
  critiqueMax: number | null;
}

/** Resultat d'une ligne (EF-04-04). Absent tant que rien n'est saisi. */
export interface ResultatAnalyseView {
  id: string;
  valeur: string;
  valeurNumerique: number | null;
  unite: string | null;
  refMin: number | null;
  refMax: number | null;
  refTexte: string | null;
  interpretation: InterpretationResultat;
  commentaire: string | null;
  saisiLe: HorodatageApi;
  saisiPar: PersonneRefView;
  codeEchantillon: string | null;
}

export interface LigneDemandeAnalyseView {
  id: string;
  examen: ExamenView;
  commentaire: string | null;
  resultat: ResultatAnalyseView | null;
}

/** Echantillon code (EF-04-03). */
export interface EchantillonView {
  id: string;
  code: string;
  specimen: string;
  preleveLe: HorodatageApi;
  commentaire: string | null;
  preleveur: PersonneRefView;
}

export interface DemandeAnalyseView {
  id: string;
  numero: string;
  urgence: Urgence;
  statut: StatutDemandeAnalyse;
  indicationClinique: string | null;
  consignesPatient: string | null;
  creeLe: HorodatageApi;
  transmiseLe: HorodatageApi | null;
  annuleeLe: HorodatageApi | null;
  motifAnnulation: string | null;
  idEpisode: string;
  numeroEpisode: string;
  patient: { id: string; prenom: string; nom: string };
  prescripteur: PersonneRefView;
  laboratoire: StructureRefView;
  lignes: LigneDemandeAnalyseView[];
  /** Cycle laboratoire (EF-04). */
  lieuPrelevement: LieuPrelevement | null;
  creneauPrelevement: HorodatageApi | null;
  recueLe: HorodatageApi | null;
  preleveeLe: HorodatageApi | null;
  valideeLe: HorodatageApi | null;
  valideur: PersonneRefView | null;
  commentaireLaboratoire: string | null;
  /**
   * Traduction en langage clair, ecrite par le medecin quand il a libere les
   * resultats (addendum du 2026-09-28). C'est elle qui donne son sens au
   * chiffre : sans elle, le patient lit « Hemoglobine 6 g/dL » sans savoir
   * s'il doit s'inquieter.
   */
  commentaireMedecin: string | null;
  /** Renseigne des qu'un medecin a libere : le patient peut voir ses resultats. */
  libereePar?: { id: string; prenom: string; nom: string } | null;
  /** Null tant que les resultats ne sont pas diffuses au patient (EF-04-09). */
  diffuseePatientLe: HorodatageApi | null;
  echantillons: EchantillonView[];
  /** Au moins un resultat critique non accuse par le prescripteur. */
  alerteCritiqueEnAttente: boolean;
}

export interface RendezVousEpisodeView {
  id: string;
  statut: string;
  motif: string | null;
  prevuLe: HorodatageApi;
  medecin: PersonneRefView | null;
}

export interface EpisodeSoinsView {
  id: string;
  numero: string;
  motif: string;
  service: string | null;
  statut: StatutEpisode;
  notes: string | null;
  ouvertLe: HorodatageApi;
  closLe: HorodatageApi | null;
  patient: { id: string; prenom: string; nom: string; sexe: string; dateNaissance: HorodatageApi; telephone: string };
  structure: StructureRefView;
  ouvertPar: PersonneRefView;
  responsable: PersonneRefView | null;
  demandesAnalyse: DemandeAnalyseView[];
  rendezVous: RendezVousEpisodeView[];
  nbConsultations: number;
}

/** Ligne de liste (sans les sous-collections). */
export type EpisodeSoinsResumeView = Omit<EpisodeSoinsView, 'demandesAnalyse' | 'rendezVous'> & {
  nbDemandesAnalyse: number;
};

/** GET /hopital/tableau-de-bord (EF-03-07). */
export interface TableauDeBordHopitalView {
  episodesOuverts: number;
  episodesDuJour: number;
  demandesEnAttente: number;      // TRANSMISE ou RECUE
  demandesUrgentes: number;       // URGENT / URGENCE_VITALE non validees
  orientationsAVenir: number;     // rendez-vous medecin planifies
  parStatut: { statut: StatutEpisode; nombre: number }[];
  derniersEpisodes: EpisodeSoinsResumeView[];
}

export interface CreateEpisodeDto {
  idPatient: string;
  motif: string;
  service?: string;
  idResponsable?: string;
  notes?: string;
}

export interface UpdateEpisodeDto {
  motif?: string;
  service?: string;
  idResponsable?: string | null;
  notes?: string | null;
  statut?: Extract<StatutEpisode, 'OUVERT' | 'EN_COURS'>;
}

/** POST /hopital/episodes/:id/orientation (EF-03-05). */
export interface OrientationDto {
  service?: string;
  idMedecin?: string;
  /** ISO 8601 ; si absent, l'orientation n'ouvre pas de rendez-vous. */
  prevuLe?: string;
  motif?: string;
}

export interface CreateDemandeAnalyseDto {
  idLaboratoire: string;
  urgence?: Urgence;
  indicationClinique?: string;
  consignesPatient?: string;
  examens: { idExamen: string; commentaire?: string }[];
}

/** GET /patients/me/episodes — vue patient de son parcours hospitalier. */
export interface EpisodePatientView {
  id: string;
  numero: string;
  motif: string;
  service: string | null;
  statut: StatutEpisode;
  ouvertLe: HorodatageApi;
  closLe: HorodatageApi | null;
  structure: StructureRefView;
  responsable: PersonneRefView | null;
  demandesAnalyse: DemandeAnalyseView[];
  rendezVous: RendezVousEpisodeView[];
}

// ═══════════════════════════════════════════════════════════════════
// P2 — Laboratoire (EF-04)
// Routes /laboratoire/* (TECHNICIEN_LABO, ADMIN_STRUCTURE),
// /resultats/* (prescripteurs) et /patients/me/resultats/*.
// ═══════════════════════════════════════════════════════════════════

/** GET /laboratoire/tableau-de-bord. */
export interface TableauDeBordLaboView {
  aRecevoir: number;              // TRANSMISE
  aPrelever: number;              // RECUE
  enAnalyse: number;              // PRELEVEE + EN_ANALYSE
  aValider: number;               // EN_ANALYSE avec toutes les lignes renseignees
  urgentes: number;               // URGENT / URGENCE_VITALE non validees
  critiquesNonAccusees: number;
  valideesDuJour: number;
  prochainsPrelevements: DemandeAnalyseView[];
  fileUrgente: DemandeAnalyseView[];
}

/** POST /laboratoire/demandes/:id/prelevement/planifier (EF-04-02). */
export interface PlanifierPrelevementDto {
  lieu: LieuPrelevement;
  /** ISO 8601. */
  creneau?: string;
}

/** POST /laboratoire/demandes/:id/prelevement (EF-04-03). */
export interface EnregistrerPrelevementDto {
  /** Si absent : un echantillon par type de specimen de la demande. */
  echantillons?: { specimen: string; commentaire?: string }[];
  lieu?: LieuPrelevement;
}

/** Une valeur saisie ou importee (EF-04-04, EF-04-06). */
export interface SaisieResultatDto {
  /** Cible : la ligne, ou le code LOINC (import depuis un automate). */
  idLigne?: string;
  codeLoinc?: string;
  valeur: string;
  unite?: string;
  commentaire?: string;
  idEchantillon?: string;
  /** Force la lecture, sinon elle est calculee d'apres les references. */
  interpretation?: InterpretationResultat;
}

/** PUT /laboratoire/demandes/:id/resultats. */
export interface SaisirResultatsDto {
  resultats: SaisieResultatDto[];
}

/** POST /laboratoire/demandes/:id/valider (EF-04-05). */
export interface ValiderResultatsDto {
  commentaire?: string;
}

/** Alerte de resultat critique (EF-04-07/08). */
export interface AlerteCritiqueView {
  id: string;
  creeLe: HorodatageApi;
  accuseeLe: HorodatageApi | null;
  escaladeeLe: HorodatageApi | null;
  demande: { id: string; numero: string; idEpisode: string; patient: { id: string; prenom: string; nom: string }; laboratoire: StructureRefView };
  resultat: { libelle: string; codeLoinc: string; valeur: string; unite: string | null; refMin: number | null; refMax: number | null };
  destinataire: PersonneRefView;
}

/** Courbe d'evolution d'une valeur (EF-04-10). */
export interface EvolutionResultatView {
  codeLoinc: string;
  libelle: string;
  unite: string | null;
  refMin: number | null;
  refMax: number | null;
  points: { date: HorodatageApi; valeur: number; interpretation: InterpretationResultat; numeroDemande: string }[];
}

/** Examens pour lesquels le patient a au moins un resultat numerique diffuse. */
export interface ExamenSuiviView {
  codeLoinc: string;
  libelle: string;
  unite: string | null;
  nbPoints: number;
}


// ═══════════════════════════════════════════════════════════════════
// P6 — Vente au comptoir et tableau de bord d'officine
// Routes /pharmacien/ventes et /pharmacien/tableau-de-bord (PHARMACIEN).
// Addendum du 2026-09-28, points 1.1 et 1.2.
// ═══════════════════════════════════════════════════════════════════

/**
 * Une vente au comptoir est payee sur place : il n'y a pas d'etat « en
 * attente ». `ANNULEE` ne sert pas a un retour client — EF-07-11 l'interdit —
 * mais a corriger une erreur de saisie, et elle remet les lots consommes.
 */
/**
 * `EN_ATTENTE` : la vente existe, les lots sont reserves, le paiement mobile
 * n'a pas encore abouti. Les medicaments ne se remettent pas avant.
 *
 * Tout ce qui compte de l'argent filtre sur `PAYEE` et ignore donc une vente
 * en attente : consommation de l'assureur, chiffre d'affaires du jour.
 */
export type StatutVente = 'EN_ATTENTE' | 'PAYEE' | 'ANNULEE';

export interface LigneVenteView {
  id: string;
  quantite: number;
  /** Prix figes a la vente : tarif de reference plus la marge de l'officine. */
  prixUnitaireGnf: number;
  montantGnf: number;
  medicament: ProduitResumeView;
  /** Couverture figee a la vente (addendum, point 5.4). */
  couvert: boolean;
  tauxAppliquePourcent: number;
  montantAssureGnf: number;
  motifExclusion?: string | null;
}

export interface VenteComptoirView {
  id: string;
  numero: string;
  statut: StatutVente;
  montantBrutGnf: number;
  /** Champ historique conservé en lecture ; les nouvelles ventes ont toujours une valeur nulle. */
  remiseGnf: number;
  montantNetGnf: number;
  /** Tiers payant : 0 sans contrat, l'assure payant alors tout. */
  montantAssureGnf: number;
  montantPatientGnf: number;
  assureur?: AssureurResumeView | null;
  modePaiement: ModePaiement;
  numeroOperateur?: string | null;
  creeLe: HorodatageApi;
  annuleeLe?: HorodatageApi | null;
  motifAnnulation?: string | null;
  /** Personne ayant exécuté l'annulation et titulaire qui l'a autorisée, le cas échéant. */
  annulation?: {
    par: { id: string; prenom: string; nom: string } | null;
    autoriseePar: { id: string; prenom: string; nom: string } | null;
  } | null;
  vendeur: { id: string; prenom: string; nom: string };
  /** Absent pour un client de passage, qui n'a pas de dossier. */
  patient?: { id: string; prenom: string; nom: string } | null;
  /** Renseigne quand la vente sert une ordonnance. */
  numeroOrdonnance?: string | null;

  /**
   * Le lien de paiement de la passerelle, affiche en QR au comptoir.
   *
   * Le client le scanne avec son propre telephone : la caisse n'a pas a
   * manipuler son compte, et il tape son code chez lui.
   */
  urlPaiement?: string | null;

  /** Le dernier etat connu cote passerelle (`new`, `pending`, `success`...). */
  statutOperateur?: string | null;

  /**
   * **La preuve.** La reference rendue par l'operateur une fois le paiement
   * abouti. Sans elle, « paye en Orange Money » n'est qu'une case cochee.
   */
  referenceTransaction?: string | null;
  /**
   * La session de caisse de cette vente. **Toujours presente** : la colonne
   * est `NOT NULL` depuis la migration du 22/10/2026, et le service refuse
   * une vente sans session ouverte. Les deux ventes d'essai anterieures aux
   * sessions ont ete supprimees plutot que rattachees a une session inventee.
   */
  idSessionCaisse: string;

  lignes: LigneVenteView[];
}

/** POST /pharmacien/ventes — une ligne du panier. */
export interface LigneVenteDto {
  idMedicament: string;
  quantite: number;
}

export interface CreerVenteDto {
  lignes: LigneVenteDto[];
  modePaiement: ModePaiement;
  /** Numero mobile money, hors paiement en especes. */
  numeroOperateur?: string;
  /** Facultatif : un passant n'a pas de dossier. */
  idPatient?: string;
  /**
   * Obligatoire si le panier contient un produit reglemente, ou d'une
   * categorie que les parametres soumettent a ordonnance.
   */
  idOrdonnance?: string;
  /**
   * Appliquer le tiers payant. Suppose `idPatient` : on ne couvre pas un
   * passant anonyme. Sans contrat utilisable, la vente est refusee plutot que
   * d'encaisser le patient a son insu.
   */
  avecAssurance?: boolean;
  /** Jeton opaque encode dans le QR de la carte d'assurance presentee. */
  jetonCarteAssurance?: string;
  /**
   * La pharmacie confirme avoir compare la photo de la fiche avec la personne
   * presente. Obligatoire quand la carte porte une photo.
   */
  photoComparee?: boolean;
}

export interface AnnulerVenteDto {
  /** Motif obligatoire : une annulation sans raison n'est pas tracable. */
  motif: string;
  /** Revalidation du titulaire requise lorsqu'un opérateur demande l'annulation. */
  autorisationTitulaire?: {
    telephone: string;
    motDePasse: string;
  };
}

/** Une ligne du classement des produits les plus vendus. */
export interface ProduitVenduView {
  medicament: ProduitResumeView;
  quantite: number;
  montantGnf: number;
}

/** Un produit dont le stock est au seuil d'alerte ou en dessous. */
export interface RuptureStockView {
  medicament: ProduitResumeView;
  quantite: number;
  seuilAlerte: number;
  unite: string;
}

/** GET /pharmacien/tableau-de-bord. */
export interface TableauDeBordOfficineView {
  /** Le jour couvert par les chiffres « du jour », au fuseau du serveur. */
  jour: HorodatageApi;
  chiffreDuJourGnf: number;
  nombreVentesDuJour: number;
  panierMoyenGnf: number;
  /** Ce que la caisse a encaisse, par moyen de paiement, sur le jour. */
  encaissementsParMode: { modePaiement: ModePaiement; montantGnf: number; nombre: number }[];
  /** Classement sur les 30 derniers jours, ventes annulees exclues. */
  produitsLesPlusVendus: ProduitVenduView[];
  ruptures: RuptureStockView[];
  /** Nombre de lots qui approchent de leur date, ou l'ont depassee. */
  lotsAPerimer: number;
}

export type StatutSessionCaisse = 'OUVERTE' | 'CLOTUREE';

export interface SessionCaisseView {
  id: string;
  statut: StatutSessionCaisse;
  montantOuvertureGnf: number;
  montantEspecesEncaisseGnf: number;
  montantOrangeMoneyGnf: number;
  montantMtnMomoGnf: number;
  montantTheoriqueGnf: number;
  montantCompteGnf: number | null;
  ecartGnf: number | null;
  motifEcart: string | null;
  nombreVentesPayees: number;
  nombreVentesEnAttente: number;
  nombreVentesAnnulees: number;
  ouverteLe: HorodatageApi;
  clotureeLe: HorodatageApi | null;
  utilisateur: { id: string; prenom: string; nom: string };
}

export interface RapportCaisseView {
  periode: 'JOUR' | 'MOIS' | 'ANNEE';
  dateDebut: HorodatageApi;
  dateFin: HorodatageApi;
  chiffreAffairesGnf: number;
  nombreVentesPayees: number;
  nombreVentesEnAttente: number;
  nombreVentesAnnulees: number;
  encaissementsParMode: { modePaiement: ModePaiement; montantGnf: number; nombre: number }[];
  parUtilisateur: {
    utilisateur: { id: string; prenom: string; nom: string };
    chiffreAffairesGnf: number;
    nombreVentesPayees: number;
  }[];
  sessions: SessionCaisseView[];
}

export interface OuvrirSessionCaisseDto {
  montantOuvertureGnf: number;
}

export interface CloturerSessionCaisseDto {
  montantCompteGnf: number;
  motifEcart?: string;
}


// ═══════════════════════════════════════════════════════════════════
// P10 — Assurance et tiers payant (EF-09)
// Routes /assurance/* et /pharmacien/ventes (part assureur).
// Addendum du 2026-09-28, point 5.
// ═══════════════════════════════════════════════════════════════════

export type ModeEchangeAssureur = 'MANUEL' | 'PORTAIL' | 'API';
export type StatutContrat = 'ACTIF' | 'SUSPENDU' | 'RESILIE' | 'EXPIRE';

export interface AssureurResumeView {
  id: string;
  nom: string;
  /** Code court, celui qui figure sur la carte de l'assure. */
  code: string;
}

/**
 * GET/POST /assurance/eligibilite — le controle au comptoir.
 *
 * La reponse est **figee en base** : c'est elle qui justifiera le tiers
 * payant si l'assureur le conteste. Un refus porte toujours son motif, sans
 * quoi le comptoir n'aurait rien a expliquer au patient.
 */
export interface ControleEligibiliteView {
  id: string;
  eligible: boolean;
  /** Toujours renseigne quand `eligible` est faux. */
  motif?: string | null;
  numeroPolice?: string | null;
  tauxBasePourcent?: number | null;
  creeLe: HorodatageApi;
  patient: { id: string; prenom: string; nom: string };
  assureur?: AssureurResumeView | null;
}

/** Le detail de la couverture pour une ligne (addendum, point 5.4). */
export interface CouvertureLigneView {
  libelle: string;
  /** Montant de la ligne avant remise de caisse. */
  montantGnf: number;
  couvert: boolean;
  tauxAppliquePourcent: number;
  montantAssureGnf: number;
  /** Pourquoi la ligne n'est pas prise : exclusion, ou taux nul. */
  motifExclusion?: string | null;
}

/**
 * POST /assurance/simulation — ce que l'assureur prendrait, **avant**
 * paiement. « Un reste a charge sans explication se conteste au comptoir. »
 */
export interface PriseEnChargeView {
  typeCouverture: TypeCouverture;
  /** Contrat individuel, ou contrat collectif de l'adhesion. */
  idContrat: string;
  idAdhesionAssurance?: string | null;
  assureur: AssureurResumeView;
  montantNetGnf: number;
  montantAssureGnf: number;
  montantPatientGnf: number;
  /**
   * Ce qui a rabote la part de l'assureur : franchise, plafond par ligne,
   * plafond annuel. Affiche tel quel, pour que le reste a charge s'explique.
   */
  notes: string[];
  lignes: (CouvertureLigneView & { idMedicament: string })[];
}

/** POST /assurance/assureurs — creation par l'administration. */
export interface CreerAssureurDto {
  nom: string;
  code: string;
  telephone?: string;
  email?: string;
  modeEchange?: ModeEchangeAssureur;
  idStructure?: string;
}

export interface AssureurView extends AssureurResumeView {
  telephone?: string | null;
  email?: string | null;
  estActif: boolean;
  modeEchange: ModeEchangeAssureur;
  nombreContrats: number;
  regles: RegleCouvertureView[];
  /** Renseigne par la liste d'administration pour eviter les comptes agents en double. */
  agentExistant?: boolean;
  /** Vrai quand la convention provient de l'hopital parent de la pharmacie. */
  conventionHeritee?: boolean;
}

/** Catalogue disponible et capacite de gestion des conventions de la structure. */
export interface CatalogueAssureursView {
  assureurs: AssureurView[];
  conventionsModifiables: boolean;
  conventionsHeritees: boolean;
}

export interface RegleCouvertureView {
  id: string;
  categorie: CategorieProduit;
  exclu: boolean;
  /** Null : le taux de base du contrat s'applique. */
  tauxPourcent?: number | null;
  plafondLigneGnf: number;
  dateEffet: HorodatageApi;
}

/**
 * POST /assurance/assureurs/{id}/regles — une regle de couverture.
 *
 * Une categorie exclue n'a pas de taux : porter les deux serait
 * contradictoire, et une contrainte SQL le refuse.
 */
export interface CreerRegleCouvertureDto {
  categorie: CategorieProduit;
  exclu?: boolean;
  tauxPourcent?: number;
  plafondLigneGnf?: number;
  dateEffet?: HorodatageApi;
}

export interface CreerContratDto {
  idAssureur: string;
  idPatient: string;
  numeroPolice: string;
  tauxBasePourcent?: number;
  plafondAnnuelGnf?: number;
  franchiseGnf?: number;
  dateEffet: HorodatageApi;
  dateFin?: HorodatageApi;
  carenceJours?: number;
}

export interface ContratAssuranceView {
  id: string;
  numeroPolice: string;
  periodeGraceJours?: number;
  tauxBasePourcent: number;
  plafondAnnuelGnf: number;
  franchiseGnf: number;
  dateEffet: HorodatageApi;
  dateFin?: HorodatageApi | null;
  carenceJours: number;
  statut: StatutContrat;
  assureur: AssureurResumeView;
  patient: { id: string; prenom: string; nom: string };
  /** Ce que l'assureur a deja pris cette annee sur ce contrat. */
  consommeAnneeGnf: number;
}

export type TypeCouverture = 'INDIVIDUELLE' | 'COLLECTIVE';

/**
 * Le resume d'une garantie, tel qu'il figure sur la carte : « Medicaments
 * 80 % ». **Indicatif** : le montant exact se calcule a la caisse, sur le
 * panier reel, apres franchise et plafonds.
 */
export interface GarantieCategorieView {
  categorie: CategorieProduit;
  exclu: boolean;
  tauxPourcent: number;
}

/**
 * GET /assurance/mes-cartes — une carte d'assurance du patient connecte.
 *
 * Le QR ne porte que `jetonCarte`, un jeton opaque : aucune donnee
 * personnelle ni medicale. Une carte imprimee ne prouve rien a elle seule,
 * c'est la verification serveur au comptoir qui confirme les droits.
 */
export interface CarteAssuranceView {
  jetonCarte: string;
  typeCouverture: TypeCouverture;
  numeroPolice: string;
  numeroAdherent: string;
  /** Regime du contrat collectif ; absent pour une police individuelle. */
  nomRegime?: string | null;
  tauxBasePourcent: number;
  garanties: GarantieCategorieView[];
  dateEffet: HorodatageApi;
  /** La fin effective : la plus proche entre l'adhesion et le contrat. */
  dateFin?: HorodatageApi | null;
  statut: StatutContrat;
  assureur: AssureurResumeView;
  /** L'entreprise qui a souscrit le contrat collectif. */
  souscripteur?: string | null;
  beneficiaire: { prenom: string; nom: string };
  /** Vrai quand la fiche de la compagnie porte une photo du beneficiaire. */
  photoDisponible: boolean;
}

/**
 * POST /assurance/cartes/verifier — le controle au comptoir, sur la carte
 * scannee. La reponse est enregistree (`idControle`) : refus compris.
 */
export interface CarteAssuranceVerifieeView extends CarteAssuranceView {
  idControle: string;
  /**
   * La pharmacie doit comparer la photo avec la personne au comptoir avant
   * d'appliquer le tiers payant : la vente l'exige (`photoComparee`).
   */
  photoAComparer: boolean;
  eligible: boolean;
  /** Toujours renseigne quand `eligible` est faux. */
  motif?: string | null;
  patient: { id: string; prenom: string; nom: string };
}

/** POST /assurance/cartes/verifier */
export interface VerifierCarteAssuranceDto {
  jetonCarte: string;
}

/** POST /assurance/moi/contrats-collectifs — la compagnie se deduit du compte. */
export interface CreerContratCollectifDto {
  entreprise: {
    raisonSociale: string;
    identifiantLegal?: string;
    telephone?: string;
    email?: string;
  };
  numeroContrat: string;
  nomRegime: string;
  tauxBasePourcent: number;
  plafondAnnuelGnf?: number;
  franchiseGnf?: number;
  dateEffet: HorodatageApi;
  dateFin: HorodatageApi;
  carenceJours?: number;
  periodeGraceJours?: number;
}

export interface ContratCollectifView {
  id: string;
  numeroContrat: string;
  nomRegime: string;
  tauxBasePourcent: number;
  /** Par beneficiaire et par annee civile. 0 = pas de plafond. */
  plafondAnnuelGnf: number;
  franchiseGnf: number;
  dateEffet: HorodatageApi;
  dateFin?: HorodatageApi | null;
  carenceJours: number;
  periodeGraceJours: number;
  /** EXPIRE des que la date de fin (grace comprise) est passee. */
  statut: StatutContrat;
  entreprise: { id: string; raisonSociale: string; identifiantLegal?: string | null };
  nombreAdhesionsActives: number;
  /** Les taux propres a ce contrat, qui priment sur ceux de la compagnie. */
  regles: RegleCouvertureView[];
}

/** POST /assurance/moi/contrats-collectifs/{id}/adhesions */
export interface CreerAdhesionAssuranceDto {
  idPatient: string;
  numeroAdherent: string;
  dateEffet?: HorodatageApi;
  /** Absente : l'adhesion suit la fin du contrat collectif. */
  dateFin?: HorodatageApi;
}

export interface AdhesionAssuranceView {
  id: string;
  numeroAdherent: string;
  dateEffet: HorodatageApi;
  dateFin?: HorodatageApi | null;
  statut: StatutContrat;
  motifFin?: string | null;
  finEnregistreeLe?: HorodatageApi | null;
  patient: { id: string; prenom: string; nom: string };
  /** La fiche d'identite tenue par la compagnie, si elle existe. */
  personne?: ResumePersonneAssureeView | null;
}

/**
 * POST /assurance/moi/adhesions/{id}/fin — fin d'une adhesion (depart de
 * l'entreprise, perte d'eligibilite). L'auteur est le compte connecte.
 */
export interface TerminerAdhesionDto {
  motif: string;
  /** Absente : immediatement. Future : l'adhesion couvre jusqu'a cette date. */
  dateEffet?: HorodatageApi;
}

/** POST /assurance/moi/contrats-collectifs/{id}/renouveler — nouvelle echeance. */
export interface RenouvelerContratDto {
  dateFin: HorodatageApi;
}

/** POST /assurance/moi/contrats — police individuelle, saisie par la compagnie. */
export type CreerContratIndividuelDto = Omit<CreerContratDto, 'idAssureur'> & {
  periodeGraceJours?: number;
};

/**
 * POST /assurance/moi/polices/regles — un taux, une exclusion ou un plafond
 * propre a une police : c'est ainsi que deux entreprises ont des taux
 * differents chez la meme compagnie.
 */
export interface CreerReglePoliceDto extends CreerRegleCouvertureDto {
  typeCouverture: TypeCouverture;
  /** Contrat individuel ou contrat collectif, selon `typeCouverture`. */
  idContrat: string;
}

/**
 * L'identite d'une personne assuree, telle que sa piece d'identite la porte.
 * Saisie par la compagnie ; la photo s'ajoute ensuite (envoi de fichier).
 */
export interface PersonneAssureeDto {
  nom: string;
  prenoms: string;
  sexe: 'M' | 'F';
  dateNaissance: HorodatageApi;
  lieuNaissance: string;
  nationalite: string;
  typePiece: TypePieceIdentite;
  numeroPiece: string;
  dateDelivrancePiece?: HorodatageApi;
  dateExpirationPiece?: HorodatageApi;
  /** Sert aussi d'identifiant de connexion au compte patient. */
  telephone: string;
  adresse?: string;
  /** Prefecture de residence, requise par le dossier patient. */
  prefecture: string;
}

/**
 * PATCH /assurance/moi/personnes/{id} — mise a jour de la fiche (piece
 * renouvelee, faute de saisie). Le telephone ne change pas ici : c'est
 * l'identifiant de connexion du patient.
 */
export type ModifierPersonneAssureeDto = Partial<Omit<PersonneAssureeDto, 'telephone' | 'prefecture'>>;

/** Ce que les listes montrent d'une fiche. */
export interface ResumePersonneAssureeView {
  id: string;
  typePiece: TypePieceIdentite;
  numeroPiece: string;
  photoDisponible: boolean;
  /** La piece a depasse sa date d'expiration : le tiers payant la refuse. */
  pieceExpiree: boolean;
}

export interface PersonneAssureeView extends ResumePersonneAssureeView {
  idPatient: string;
  nom: string;
  prenoms: string;
  sexe: 'M' | 'F';
  dateNaissance: HorodatageApi;
  lieuNaissance: string;
  nationalite: string;
  dateDelivrancePiece?: HorodatageApi | null;
  dateExpirationPiece?: HorodatageApi | null;
  telephone: string;
  adresse?: string | null;
  creeLe: HorodatageApi;
}

/** POST /assurance/moi/contrats-collectifs/{id}/travailleurs */
export interface AjouterTravailleurDto {
  personne: PersonneAssureeDto;
  numeroAdherent: string;
  dateEffet?: HorodatageApi;
  dateFin?: HorodatageApi;
}

/** POST /assurance/moi/personnes — une personne et sa police individuelle. */
export interface AssurerPersonneDto {
  personne: PersonneAssureeDto;
  police: Omit<CreerContratIndividuelDto, 'idPatient'>;
}

/**
 * Le resultat d'un enregistrement. Quand le compte patient vient d'etre cree,
 * le mot de passe temporaire n'est rendu **qu'une fois** : il est a remettre
 * a la personne, qui devra le changer a sa premiere connexion.
 */
export interface PersonneEnregistreeView {
  personne: PersonneAssureeView;
  compteCree: boolean;
  motDePasseTemporaire?: string | null;
  adhesion?: AdhesionAssuranceView | null;
  contrat?: ContratAssuranceView | null;
}

/** POST /assurance/moi/contrats-collectifs/{id}/import — la liste du personnel en CSV. */
export interface ImporterTravailleursDto {
  contenu: string;
}

export type StatutLigneImportTravailleur = 'CREE' | 'RATTACHE' | 'REFUSE';

export interface LigneImportTravailleurView {
  /** Le rang dans le fichier de l'operateur, en-tete compris. */
  numero: number;
  statut: StatutLigneImportTravailleur;
  nom?: string | null;
  numeroAdherent?: string | null;
  motif?: string | null;
  /** Rendu une seule fois, pour un compte cree par l'import. */
  motDePasseTemporaire?: string | null;
}

export interface RapportImportTravailleursView {
  lignes: LigneImportTravailleurView[];
  crees: number;
  rattaches: number;
  refuses: number;
}

/**
 * GET /assurance/moi/patients?telephone= — retrouver la personne a rattacher.
 *
 * **Recherche exacte par telephone**, jamais par nom : la compagnie retrouve
 * la personne qu'elle assure, elle ne parcourt pas la population.
 */
export interface PatientAssureurRechercheView {
  id: string;
  prenom: string;
  nom: string;
  telephoneMasque: string;
  anneeNaissance?: number | null;
}


// ═══════════════════════════════════════════════════════════════════
// EF-09 — L'espace de l'assureur (addendum du 2026-09-28, point 5.2)
//
// **Rien de medical ne traverse cette frontiere.** L'assureur voit qui est
// assure chez lui, ce que sa compagnie a pris en charge et dans quelles
// pharmacies — jamais un produit delivre, une ordonnance ni un diagnostic. Un
// assureur qui lirait ce qu'on soigne pourrait refuser un contrat dessus.
//
// C'est pourquoi tout est agrege : des montants et des comptes, pas des
// lignes de vente. Le decompte detaille, s'il devient necessaire, releve de
// l'echange conventionne avec la compagnie (EF-09-02), pas de cet ecran.
// ═══════════════════════════════════════════════════════════════════

/** POST /assurance/assureurs/{id}/agents — le compte par lequel l'assureur se connecte. */
export interface CreerAgentAssureurDto {
  prenom: string;
  nom: string;
  telephone: string;
  email: string;
  /** Siege de la compagnie, si sa structure reste a creer. */
  prefecture?: string;
}

export interface AgentAssureurCreeView {
  agent: { id: string; prenom: string; nom: string; telephone: string };
  assureur: { id: string; nom: string; code: string };
  /** Rendu une seule fois, a remettre. Le compte devra le changer. */
  motDePasseTemporaire: string;
}

/** GET /assurance/moi — l'assureur de l'agent connecte. */
export interface MonAssureurView {
  id: string;
  nom: string;
  code: string;
  estActif: boolean;
  modeEchange: ModeEchangeAssureur;
  regles: RegleCouvertureView[];
  /** Nombre de polices, tous statuts confondus. */
  nombreContrats: number;
  nombreContratsActifs: number;
}

/**
 * GET /assurance/moi/assures — un assure de la compagnie.
 *
 * L'identite et le contrat, rien de plus : l'assureur sait deja qui il
 * assure, il a besoin de retrouver la personne et de suivre son plafond.
 */
export interface AssureView {
  typeCouverture: TypeCouverture;
  /** Police individuelle, ou contrat collectif de l'adhesion. */
  idContrat: string;
  idAdhesion?: string | null;
  numeroAdherent?: string | null;
  souscripteur?: string | null;
  numeroPolice: string;
  statut: StatutContrat;
  tauxBasePourcent: number;
  plafondAnnuelGnf: number;
  franchiseGnf: number;
  dateEffet: HorodatageApi;
  dateFin?: HorodatageApi | null;
  patient: { prenom: string; nom: string };
  /** Ce que la compagnie a pris en charge cette annee sur cette police. */
  consommeAnneeGnf: number;
  /** Nombre de passages en pharmacie ayant donne lieu a prise en charge. */
  nombrePassages: number;
  /** Taux propres a la police individuelle ; vide pour une adhesion. */
  regles: RegleCouvertureView[];
  /** La fiche d'identite tenue par la compagnie, si elle existe. */
  personne?: ResumePersonneAssureeView | null;
}

/**
 * GET /assurance/moi/pharmacies — la situation par officine (point 5.2).
 *
 * « Ce qui a ete delivre, ce qui lui est facture, ce qui est paye, ce qui
 * reste du, et les ecarts. »
 */
export interface SituationPharmacieView {
  idStructure: string;
  nom: string;
  prefecture: string;
  /** Nombre de ventes prises en charge, et leur montant total encaisse. */
  nombreVentes: number;
  montantDelivreGnf: number;
  /** La part de la compagnie : ce qu'elle doit a cette officine. */
  montantFactureGnf: number;
  /** Ce qu'elle a verse, d'apres les reglements saisis. */
  montantPayeGnf: number;
  /**
   * `facture - paye`. Negatif quand la compagnie a verse plus que du : c'est
   * un ecart aussi, et le masquer le rendrait introuvable.
   */
  resteDuGnf: number;
  /** Le dernier versement connu, pour savoir si le suivi est a jour. */
  dernierReglementLe?: HorodatageApi | null;
}

/** POST /assurance/moi/reglements — un versement a une officine. */
export interface CreerReglementDto {
  idStructure: string;
  montantGnf: number;
  periodeDebut: HorodatageApi;
  periodeFin: HorodatageApi;
  reference?: string;
}

export interface ReglementView {
  id: string;
  montantGnf: number;
  periodeDebut: HorodatageApi;
  periodeFin: HorodatageApi;
  reference?: string | null;
  structure: { id: string; nom: string };
  saisiPar: { prenom: string; nom: string };
  creeLe: HorodatageApi;
}

// ═══════════════════════════════════════════════════════════════════
// P11 — Referentiels importables (EF-12-03)
// Routes /referentiels/* (ADMIN_NATIONAL, SUPER_ADMIN).
// ═══════════════════════════════════════════════════════════════════

export type TypeReferentiel = 'examens' | 'interactions' | 'medicaments';

export type StatutLigneImport = 'CREEE' | 'MISE_A_JOUR' | 'REFUSEE';

/** Le verdict d'une ligne. Aucune n'est passee sous silence. */
export interface LigneImportView {
  /** Le numero dans le fichier de l'operateur : la ligne 1 est l'en-tete. */
  ligne: number;
  /** De quoi reconnaitre la ligne : code LOINC, paire de DCI, libelle. */
  cle: string;
  statut: StatutLigneImport;
  /** Toujours renseigne quand la ligne est refusee. */
  motif?: string | null;
}

/**
 * POST /referentiels/{type}/import.
 *
 * « Un import qui echoue en silence sur trois lignes est pire que pas
 * d'import » : chaque ligne a son verdict, et `simulation` permet de tout
 * valider avant d'ecrire quoi que ce soit.
 *
 * Les lignes valides sont appliquees meme si d'autres sont refusees :
 * rejeter deux mille bonnes lignes pour trois mauvaises serait pire.
 */
export interface RapportImportView {
  type: TypeReferentiel;
  simulation: boolean;
  total: number;
  creees: number;
  misesAJour: number;
  refusees: number;
  lignes: LigneImportView[];
}

export interface ImporterReferentielDto {
  /** Le contenu du fichier CSV, tel quel. Le BOM d'Excel est tolere. */
  contenu: string;
  /** Valider sans rien ecrire. */
  simulation?: boolean;
}

/** GET /referentiels/{type}/colonnes — ce qu'un operateur doit preparer. */
export interface ColonnesReferentielView {
  type: TypeReferentiel;
  obligatoires: string[];
  facultatives: string[];
}

// --- Journal d audit : recherche et export (EF-12-05) -----------------------

/**
 * Les criteres d une recherche dans le journal d audit.
 *
 * Sans `du`, la recherche ne remonte pas au-dela de 30 jours : une requete
 * sans critere ne doit pas balayer la table entiere.
 */
export interface FiltreJournalDto {
  /** Borne basse, ISO. Par defaut : il y a 30 jours. */
  du?: string;
  /** Borne haute, ISO. Une date seule vaut la fin de la journee. */
  au?: string;
  /** L auteur de l action. */
  idUtilisateur?: string;
  /** Le patient dont le dossier a ete touche. */
  idPatient?: string;
  /** Le role de l auteur. */
  role?: Role;
  /** Le premier segment de l URL : patients, consultations, laboratoire... */
  ressource?: string;
  /** Ne garder que les refus (code HTTP >= 400) : une tentative, pas un acces. */
  echecsSeulement?: boolean;
  /** Avec `idPatient` : exclure les acces du patient a son propre dossier. */
  parTiers?: boolean;
  page?: number;
  limit?: number;
}

/** Une ligne du journal, telle qu une enquete la lit. */
export interface LigneJournalView {
  id: string;
  creeLe: HorodatageApi;
  /** La trace technique : le motif de route. */
  action: string;
  ressource: string;
  idRessource: string | null;
  /** Cles d i18n, comme pour le journal du patient. */
  libelle: string;
  libelleObjet: string;
  statutHttp: number | null;
  ipAdresse: string | null;
  idUtilisateur: string;
  acteur: { prenom: string; nom: string; role: string };
  idPatientConcerne: string | null;
  /** Nom du patient, ou null quand l action ne concernait aucun dossier. */
  patientConcerne: string | null;
}

export interface PageJournalView {
  lignes: LigneJournalView[];
  meta: PaginationMeta;
  /**
   * Au-dela de ce nombre, l export est refuse plutot que tronque : un export
   * d audit ampute sans le dire est pire qu un export absent.
   */
  maxExport: number;
}

// --- Suspension de compte (EF-12-01) ---------------------------------------

/** Ce qui a ferme un compte, quand la fermeture est documentee. */
export interface SuspensionDetail {
  suspenduLe: HorodatageApi;
  motif: string;
  /** Null si l auteur de la decision a depuis ete supprime. */
  parQui: string | null;
}

export interface CompteView {
  id: string;
  prenom: string;
  nom: string;
  email: string | null;
  telephone: string;
  role: Role;
  estActif: boolean;
  structure: string | null;
  derniereConnexion: HorodatageApi | null;
  suspension: SuspensionDetail | null;
  /**
   * Compte ferme sans date ni motif : il vient de l ancienne voie, reservee a
   * l admin de structure. On le dit plutot que de laisser croire a une
   * suspension documentee.
   */
  fermeSansMotif: boolean;
  /** EF-01-08 : role qui releve d un ordre professionnel (medecin, pharmacien...). */
  soumisOrdre: boolean;
  numeroOrdre: string | null;
  /** Null tant que l administration n a pas confronte le numero au registre. */
  ordreVerifieLe: HorodatageApi | null;
}

/** Correction du nom d un compte professionnel par l administration. */
export interface CorrigerNomCompteDto {
  prenom?: string;
  nom?: string;
  motif: string;
}

/** Le resultat d une suspension ou d une reactivation. */
export interface SuspensionView {
  id: string;
  nomComplet: string;
  estActif: boolean;
  motif: string | null;
  /** Ce qui a reellement ete coupe : la mesure est dite « immediate ». */
  sessionsFermees: number;
  socketsFermes: number;
}

export interface SuspendreCompteDto {
  motif: string;
}

// --- Detection d anomalies d acces (EF-12-06) ------------------------------

export type TypeAnomalie = 'REFUS_REPETES' | 'VOLUME_DOSSIERS' | 'ADRESSES_MULTIPLES';

/**
 * Les seuils de detection.
 *
 * **Ce sont des points de depart, pas des verites.** Ils n ont pas ete
 * calibres sur du trafic reel, et devront probablement varier selon le role :
 * un comptoir de pharmacie et un medecin n ont pas le meme volume normal.
 */
export interface SeuilsAnomalies {
  /** Refus d acces (401 ou 403) par le meme compte sur la fenetre. */
  refusRepetes: number;
  /** Dossiers distincts touches par le meme compte sur la fenetre. */
  dossiersDistincts: number;
  /** Adresses IP distinctes pour le meme compte sur la fenetre. */
  adressesDistinctes: number;
  fenetreHeures: number;
}

/**
 * Un signal a examiner — **pas un verdict**.
 *
 * Un soignant de garde consulte beaucoup de dossiers la nuit sans rien faire
 * de mal. Ce que porte cette vue sert a aller voir le detail dans le journal,
 * pas a decider seul.
 */
export interface AnomalieView {
  type: TypeAnomalie;
  /** `ALERTE` au-dela du triple du seuil ; `ADRESSES_MULTIPLES` reste toujours un signal. */
  gravite: 'SIGNAL' | 'ALERTE';
  idUtilisateur: string;
  acteur: string;
  role: Role | null;
  /** Faux si le compte est deja ferme : inutile de proposer de le suspendre. */
  acteurActif: boolean;
  /** Ce qui a ete mesure, et ce qui etait attendu. */
  mesure: number;
  seuil: number;
  depuis: HorodatageApi;
}

// --- Demandes d exercice de droits (EF-12-09) ------------------------------

export type TypeDemandeRgpd =
  | 'ACCES'
  | 'RECTIFICATION'
  | 'EFFACEMENT'
  | 'PORTABILITE'
  | 'OPPOSITION'
  | 'LIMITATION';

export type StatutDemandeRgpd = 'RECUE' | 'EN_COURS' | 'SATISFAITE' | 'REFUSEE';

/**
 * Une demande et ce qu elle est devenue.
 *
 * **L effacement d un dossier de soins n est pas une suppression.** Des
 * obligations de conservation s y opposent, et le journal d audit doit
 * survivre. Une demande d effacement se traite par une anonymisation de l
 * identite, ou se refuse avec son motif — jamais en silence.
 */
export interface DemandeRgpdView {
  id: string;
  type: TypeDemandeRgpd;
  statut: StatutDemandeRgpd;
  /** Ce que le patient demande, dans ses mots. */
  precision: string | null;
  creeLe: HorodatageApi;
  dateLimite: HorodatageApi;
  /** Null quand la demande est close : son delai ne court plus. */
  joursRestants: number | null;
  enRetard: boolean;
  /** La reponse ecrite. Toujours presente des que la demande est close. */
  reponse: string | null;
  traiteLe: HorodatageApi | null;
  /** Null si l agent qui a traite a depuis quitte la plateforme. */
  traitePar: string | null;
  demandeur: string;
}

export interface FileDemandesView {
  demandes: DemandeRgpdView[];
  ouvertes: number;
  enRetard: number;
  /** Le delai de reponse applique, en jours. */
  delaiJours: number;
}

export interface DeposerDemandeRgpdDto {
  type: TypeDemandeRgpd;
  /** Obligatoire pour une rectification : sans cela on ne sait pas quoi corriger. */
  precision?: string;
}

export interface RepondreDemandeRgpdDto {
  satisfaite: boolean;
  reponse: string;
}

// --- Identito-vigilance (EF-01-04/10) --------------------------------------

export type NiveauIdentite = 'PROVISOIRE' | 'VERIFIEE';

export type TypePieceIdentite =
  | 'CARTE_NATIONALE'
  | 'PASSEPORT'
  | 'ACTE_NAISSANCE'
  | 'CARTE_CONSULAIRE'
  | 'PERMIS_CONDUIRE'
  | 'AUTRE';

/**
 * L identite d un patient, telle qu un agent d accueil la voit.
 *
 * **Le niveau ne conditionne pas les soins.** Un patient provisoire est
 * consulte, suivi et prescrit normalement. Il ne verrouille que ce qui engage
 * un tiers : le tiers payant, et plus tard les produits reglementes.
 */
export interface IdentitePatientView {
  id: string;
  nomComplet: string;
  /** Separes pour la correction (R15) ; `nomComplet` reste pour l affichage. */
  prenom: string;
  nom: string;
  telephone: string;
  dateNaissance: HorodatageApi;
  sexe: string;
  prefecture: string;
  /** Trait distinctif. Figure sur toutes les pieces. */
  lieuNaissance: string | null;
  /** Trait distinctif le plus discriminant quand les noms se repetent. */
  nomMere: string | null;
  niveauIdentite: NiveauIdentite;
  typePiece: TypePieceIdentite | null;
  /**
   * Le numero de la piece, **masque** : il sert a prouver qu une piece a ete
   * vue, pas a etre recopie. L afficher en entier sur un ecran de comptoir,
   * devant la file d attente, serait une fuite gratuite.
   */
  numeroPieceMasque: string | null;
  verifieeLe: HorodatageApi | null;
  /** Null si l agent qui a verifie a depuis quitte la plateforme. */
  verifieePar: string | null;
  /** Les traits qui manquent encore, pour que l ecran sache quoi demander. */
  traitsManquants: string[];
}

export interface VerifierIdentiteDto {
  typePiece: TypePieceIdentite;
  numeroPiece: string;
  /** Exige : il figure sur la piece que l agent a en main. */
  lieuNaissance: string;
  /** Facultatif : absent d un passeport. */
  nomMere?: string;
  /** Confirmer le remplacement d une piece deja enregistree. */
  remplacerPiece?: boolean;
}

export interface NoterTraitsDto {
  lieuNaissance?: string;
  nomMere?: string;
}

/**
 * Changement de numero de telephone, etape 1 : un code est parti au nouveau
 * numero. Le numero n est montre que masque.
 */
export interface DemandeChangementTelephoneView {
  telephoneMasque: string;
  expireDansMinutes: number;
  /** Developpement seulement (EMAIL_OTP_DEV_FALLBACK=true, jamais en production). */
  codeDeveloppement?: string;
}

/** R15 : un trait d identite corrigeable par l accueil ou l administration. */
export type ChampCorrigeable = 'prenom' | 'nom' | 'sexe' | 'dateNaissance';

/**
 * R15 : corriger l identite d un patient. Seuls les traits fournis et
 * differents de l actuel sont ecrits ; le motif est exige.
 */
export interface CorrigerIdentiteDto {
  prenom?: string;
  nom?: string;
  sexe?: 'M' | 'F';
  /** Date seule, AAAA-MM-JJ. */
  dateNaissance?: string;
  motif: string;
}

/** Une correction passee, telle que l historique la montre. */
export interface CorrectionIdentiteView {
  id: string;
  champ: ChampCorrigeable;
  ancienneValeur: string;
  nouvelleValeur: string;
  motif: string;
  creeLe: HorodatageApi;
  /** Null si l agent a depuis quitte la plateforme. */
  auteur: string | null;
}

// --- Bris de glace (EF-02-06) ----------------------------------------------

/**
 * Pourquoi la vitre a ete brisee.
 *
 * Liste **fermee** : on ne peut ni juger ni compter des motifs ecrits comme
 * chacun veut. Le texte libre vient en plus, pas a la place.
 */
export type MotifBrisDeGlace =
  /** Pronostic vital engage, decision immediate. */
  | 'URGENCE_VITALE'
  /** Le patient ne peut pas consentir : inconscient, confus, trop jeune. */
  | 'PATIENT_HORS_ETAT'
  /** Le patient est adresse par une autre structure et son dossier y vit. */
  | 'CONTINUITE_DES_SOINS'
  /** Suspicion d interaction ou d allergie a verifier avant de prescrire. */
  | 'VERIFICATION_AVANT_PRESCRIPTION'
  | 'AUTRE';

export type StatutRevueBrisDeGlace = 'A_REVOIR' | 'JUSTIFIE' | 'INJUSTIFIE';

export type MotifRefusBrisDeGlace =
  | 'PATIENT_INTROUVABLE'
  /** Seuls les roles qui donnent des soins peuvent briser la glace. */
  | 'ROLE_NON_AUTORISE'
  /** Son propre dossier est deja ouvert : le declarer serait une fausse urgence. */
  | 'SON_PROPRE_DOSSIER'
  | 'EXPLICATION_TROP_COURTE'
  | 'BRIS_INTROUVABLE'
  | 'PAS_VOTRE_ACCES'
  | 'DEJA_REFERME'
  /** Un garde-fou qu on s applique a soi-meme n en est pas un. */
  | 'PAS_SON_PROPRE_ACCES'
  | 'DEJA_REVU'
  | 'AVIS_TROP_COURT';

/**
 * Un acces en urgence, tel qu il se lit.
 *
 * **Ce n est pas un passe-partout** : un motif est exige, l acces expire, le
 * patient est prevenu, et l administration repasse derriere.
 */
export interface BrisDeGlaceView {
  id: string;
  motif: MotifBrisDeGlace;
  /** Ce que le soignant a explique en toutes lettres. Ne se reecrit pas. */
  explication: string;
  ouvertLe: HorodatageApi;
  expireLe: HorodatageApi;
  refermeLe: HorodatageApi | null;
  /** Encore ouvert : ni referme, ni expire. */
  ouvert: boolean;
  statutRevue: StatutRevueBrisDeGlace;
  avisRevue: string | null;
  revuLe: HorodatageApi | null;
  revuPar: string | null;
  /**
   * `null` : **le patient n a pas pu etre prevenu.** La declaration tient
   * quand meme — il y a un patient au bout — mais le manque se voit.
   */
  notifieLe: HorodatageApi | null;
  patient: { id: string; nomComplet: string };
  auteur: { id: string; nomComplet: string; role: string };
  structure: string | null;
}

export interface DeclarerBrisDeGlaceDto {
  idPatient: string;
  motif: MotifBrisDeGlace;
  explication: string;
}

export interface ReviserBrisDeGlaceDto {
  statut: 'JUSTIFIE' | 'INJUSTIFIE';
  avis: string;
}

// --- Consentement versionne (EF-02-01/03/07) -------------------------------

/**
 * Un texte de consentement, dans une version et une langue.
 *
 * **Un consentement ne vaut que pour ce qui a ete explique.** Garder le texte
 * exact qui etait a l ecran est ce qui permet de prouver ce qui a ete accepte,
 * et de le remontrer a l interesse.
 */
export interface TexteConsentementView {
  id: string;
  scope: ConsentScope;
  langue: string;
  version: number;
  titre: string;
  corps: string;
  publieLe: HorodatageApi | null;
  /**
   * Le texte n existe pas dans la langue du patient et lui est montre dans
   * une autre. **Le taire ferait passer pour eclaire un consentement qui ne
   * l est pas.**
   */
  dansUneAutreLangue: boolean;
}

/**
 * Ou en est le consentement par rapport au texte en vigueur.
 *
 * `JAMAIS_RECUEILLI` est le cas le plus important : l accord a ete pose sans
 * que personne ne voie rien — par le systeme a la creation du dossier, ou
 * avant le versionnage. Ce n est pas un consentement.
 */
export type EtatTexteConsentement = 'A_JOUR' | 'TEXTE_PLUS_RECENT' | 'JAMAIS_RECUEILLI';

export interface ConsentementView {
  scope: ConsentScope;
  actif: boolean;
  /** `false` : la question ne lui a jamais ete posee. */
  repondu: boolean;
  donneLe: HorodatageApi | null;
  retireLe: HorodatageApi | null;
  source: string | null;
  /** Le texte accepte, tel qu il etait — pas celui d aujourd hui. */
  texteAccepte: TexteConsentementView | null;
  texteEnVigueur: TexteConsentementView | null;
  etat: EtatTexteConsentement;
}

export type SensConsentement = 'ACCORDE' | 'RETIRE';

/** Une ligne de l historique, qui ne s efface jamais. */
export interface EvenementConsentementView {
  id: string;
  scope: ConsentScope;
  sens: SensConsentement;
  source: string;
  commentaire: string | null;
  creeLe: HorodatageApi;
  versionTexte: number | null;
  langueTexte: string | null;
  titreTexte: string | null;
  parQui: string;
}

export interface EnregistrerConsentementDto {
  scope: ConsentScope;
  accorde: boolean;
  commentaire?: string;
}

export interface PublierTexteConsentementDto {
  scope: ConsentScope;
  langue: string;
  titre: string;
  corps: string;
}

// --- Fusion de dossiers patients (EF-01-06) --------------------------------

/**
 * Pourquoi une fusion a ete refusee.
 *
 * Chacun de ces refus protege d un melange de dossiers medicaux : c est la
 * faute la plus grave que ce produit puisse commettre.
 */
export type MotifRefusFusion =
  | 'DOSSIER_INTROUVABLE'
  | 'MEME_DOSSIER'
  | 'MOTIF_TROP_COURT'
  /** L un des deux dossiers est deja fusionne : il n y a pas de chaine. */
  | 'DEJA_FUSIONNE'
  /**
   * Les deux identites sont verifiees, sur **deux pieces differentes**. Ou
   * bien ce sont deux personnes, ou bien l une des verifications est fausse.
   * Une machine ne peut pas trancher : un agent doit reprendre la piece.
   */
  | 'DEUX_PIECES_DIFFERENTES'
  | 'FUSION_INTROUVABLE'
  | 'DEJA_ANNULEE';

export type OperationFusion = 'DEPLACEMENT' | 'RESTRICTION_CONSENTEMENT';

/** Ce qu une fusion a deplace, resume par table. */
export interface LigneFusionView {
  tableCible: string;
  operation: OperationFusion;
  nombre: number;
}

/**
 * Une fusion de dossiers, telle qu un agent la lit.
 *
 * **Le dossier absorbe n est jamais supprime** : il garde son identifiant et
 * son code QR, et la fusion peut etre defaite.
 */
export interface FusionView {
  id: string;
  motif: string;
  statut: 'ACTIVE' | 'ANNULEE';
  fusionneLe: HorodatageApi;
  fusionnePar: string;
  motifAnnulation: string | null;
  annuleeLe: HorodatageApi | null;
  annuleePar: string | null;
  principal: { id: string; nomComplet: string };
  absorbe: { id: string; nomComplet: string };
  /** Resume de ce qui a bouge. C est cela qui rend la reversibilite credible. */
  lignes: LigneFusionView[];
}

export interface FusionnerDto {
  idAbsorbe: string;
  motif: string;
}

export interface AnnulerFusionDto {
  motifAnnulation: string;
}

// --- Detection de doublons (EF-01-05) --------------------------------------

/** Ce qui a fait ressembler deux dossiers. */
export type TraitConcordant =
  | 'NOM_IDENTIQUE'
  | 'NOM_PROCHE'
  /**
   * Le meme nom ecrit autrement : « Conde » et « Konde », « Diallo » et
   * « Dialo ». Les noms sont transcrits a l oreille et varient d un guichet a
   * l autre ; c est ainsi que naissent la plupart des doublons.
   */
  | 'NOM_VARIANTE' 
  | 'MERE_IDENTIQUE'
  | 'LIEU_IDENTIQUE'
  | 'DATE_IDENTIQUE'
  /**
   * Meme date, mais une date par defaut — le 1er janvier, saisi quand on
   * ignore le jour. Elle n apprend presque rien : 9 patients sur 10 la
   * portaient dans la base du 2026-10-04.
   */
  | 'DATE_PAR_DEFAUT'
  | 'TELEPHONE_IDENTIQUE'
  /**
   * Les traits concordent, mais **pas le nom**. C est la signature de deux
   * freres : meme mere, meme lieu, meme telephone familial, et pour des
   * jumeaux meme date. Le score est alors borne sous le seuil « probable » —
   * fusionner deux freres melangerait leurs dossiers medicaux.
   */
  | 'SANS_CONCORDANCE_DE_NOM'
  /**
   * Le nom concorde, mais ecrit autrement. « Aissatou » et « Aissata » :
   * variante d ecriture, ou deux soeurs ? La machine ne peut pas trancher, et
   * personne ne le peut sans regarder le dossier. Le cas remonte en tete de
   * liste, jamais annonce comme probable.
   */
  | 'ORTHOGRAPHE_A_CONFIRMER';

/**
 * Un dossier qui pourrait etre la meme personne.
 *
 * **Ce n est pas un verdict.** Un agent decide ; aucune fusion n est
 * automatique. Fusionner deux personnes distinctes melange leurs dossiers
 * medicaux, ce qui est bien plus dangereux que de laisser un doublon.
 */
export interface CandidatDoublonView {
  id: string;
  nomComplet: string;
  telephone: string;
  dateNaissance: HorodatageApi;
  lieuNaissance: string | null;
  nomMere: string | null;
  prefecture: string;
  niveauIdentite: NiveauIdentite;
  /** Somme des traits concordants. Un ordre de grandeur, pas une probabilite. */
  score: number;
  /** Au-dela du seuil : a regarder en priorite. En deca : un doute a lever. */
  probable: boolean;
  traits: TraitConcordant[];
}
