// Jeu de demonstration « Pricemou », pour derouler le parcours complet a la
// main : hopital -> laboratoire -> consultation -> ordonnance -> pharmacie.
//
// Idempotent : chaque entree est identifiee par une cle stable (telephone,
// nom de structure, QR) et le script peut etre rejoue sans rien casser.
//
// Reserve aux bases de developpement. Le mot de passe commun des comptes n'est
// pas dans ce fichier : il est lu dans SEED_DEMO_PASSWORD (12 caracteres min.).
//
// Usage : SEED_DEMO_PASSWORD=... npx tsx prisma/seed-demo.ts
import 'dotenv/config';
import { PrismaClient, Role, TypeStructure } from '../src/config/generated/client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { hashPassword } from '../src/utils/password.utils.js';
import { lancerRecherchePharmacie } from '../src/services/commande.service.js';
import { ouvrirSession, cloturerSession } from '../src/services/caisse.service.js';
import { creerVente } from '../src/services/vente.service.js';
import { ouvrirCourse } from '../src/services/course.service.js';
import { prisma as prismaApplication } from '../src/config/prisma.js';
import { prochainNumero } from '../src/services/numero.service.js';
import { seedExamens } from './seed-examens.js';
import { lireMotDePasseDemo } from './mot-de-passe-demo.js';

// Choisi hors du depot et passe par SEED_DEMO_PASSWORD : voir mot-de-passe-demo.ts.
const MOT_DE_PASSE = lireMotDePasseDemo();

/**
 * Tout se joue dans le meme quartier : c'est la maille de l'appel aux
 * pharmacies (P6). Une pharmacie d'un autre quartier ne serait jamais
 * sollicitee, et le parcours s'arreterait la sans explication.
 */
const PREFECTURE = 'Conakry';
const COMMUNE = 'Dixinn';
const QUARTIER = 'Donka';

export const DEMO = {
  motDePasse: MOT_DE_PASSE,
  prefecture: PREFECTURE,
  commune: COMMUNE,
  quartier: QUARTIER,

  // **Les noms s'ecrivent avec leurs accents**, comme dans
  // docs/PARCOURS-DEMO.md et comme sur une vraie facade. `ancienNom` est le
  // nom que portaient ces structures avant : une base deja semee les
  // retrouve ainsi, au lieu d'en creer une seconde a cote.
  hopital: { nom: 'Hôpital Donka', ancienNom: 'Hopital Donka', type: TypeStructure.CHU, telephone: '+224620000100' },
  laboratoire: { nom: 'Laboratoire Cécé', ancienNom: 'Laboratoire Cece', type: TypeStructure.LABORATOIRE, telephone: '+224620000200' },
  pharmacie: { nom: 'Pharmacie Pricemou', type: TypeStructure.PHARMACIE, telephone: '+224620000300' },
  // Une pharmacie rattachee a l'hopital : elle herite des conventions que
  // l'hopital declare avec les assureurs, et ne gere pas les siennes.
  pharmacieHopital: { nom: "Pharmacie de l'Hôpital Donka", ancienNom: 'Pharmacie de l Hopital Donka', type: TypeStructure.PHARMACIE, telephone: '+224620000400' },

  // Un compte par metier du parcours : chacun ouvre un espace different.
  accueil:    { telephone: '620100001', email: 'accueil.donka@demo.test',   prenom: 'Fatoumata', nom: 'Keïta' },
  medecin:    { telephone: '620100002', email: 'david.medecin@demo.test',   prenom: 'David',     nom: 'Camara' },
  technicien: { telephone: '620100003', email: 'tech.cece@demo.test',       prenom: 'Sékou',     nom: 'Cécé' },
  // Deuxieme laborantin : c'est lui qui valide, le role de biologiste ayant
  // ete supprime le 2026-09-30 (addendum, point 4).
  laborantin2: { telephone: '620100004', email: 'bio.cece@demo.test',      prenom: 'Aminata',   nom: 'Cécé' },
  pharmacien: { telephone: '620100005', email: 'pharma.pricemou@demo.test', prenom: 'Ousmane',   nom: 'Pricemou' },
  pharmacienHopital: { telephone: '620100012', email: 'pharma.donka@demo.test', prenom: 'Kadiatou', nom: 'Barry' },
  adminHopital: { telephone: '620100006', email: 'admin.donka@demo.test',   prenom: 'Mariama',   nom: 'Sow' },
  // **L'administration nationale n'avait aucun compte.** Les assureurs, leurs
  // regles de couverture et les polices ne se saisissent que depuis ce role :
  // sans lui, l'ecran /admin/assurance n'etait ouvrable par personne, et le
  // tiers payant ne se configurait qu'en ligne de commande.
  adminNational: { telephone: '620100007', email: 'admin.national@demo.test', prenom: 'Sory',      nom: 'Touré' },
  // **L'assureur se connecte lui-meme** (addendum, point 5.2). Son compte vit
  // dans une structure de type ASSURANCE qui lui est propre : sans elle, il
  // heriterait des droits d'un hopital ou d'une pharmacie, et donc d'un acces
  // aux dossiers medicaux.
  agentAssureur: { telephone: '620100008', email: 'agent.pfa@demo.test', prenom: 'Hadja', nom: 'Bangoura' },

  // **L'agent de sante communautaire n'avait aucun compte de demonstration.**
  // Son espace porte deux listes — ses consultations de terrain et sa
  // dotation — et aucune ne pouvait etre ouverte : le role existait, le
  // compte non.
  asc: { telephone: '620100011', email: 'asc.donka@demo.test', prenom: 'Mamadou', nom: 'Diallo' },
  livreur: { telephone: '620100016', email: 'livreur.donka@demo.test', prenom: 'Ibrahima', nom: 'Keïta' },

  // Le patient se connecte avec son telephone, sans OTP.
  patient: {
    telephone: '620100010',
    prenom: 'Maomou', nom: 'Condé',
    qrCode: 'DEMO-QR-MAOMOU-0001',
    dateNaissance: new Date('1992-03-17'),
    sexe: 'F',
    // Declaree pour que l'alerte de prescription (EF-05-05) se declenche sur
    // l'amoxicilline, et par famille ATC sur l'ampicilline.
    allergies: ['Amoxicilline'],
    maladiesChroniques: ['Asthme'],
  },

  // Les beneficiaires a rattacher a un contrat d'entreprise depuis l'espace
  // assureur (lot assurance). Leur identite est verifiee, sauf la derniere :
  // elle sert a montrer que le tiers payant exige une identite verifiee.
  employes: [
    { telephone: '620100013', prenom: 'Fanta', nom: 'Camara', sexe: 'F', dateNaissance: new Date('1988-06-02'), qrCode: 'DEMO-QR-FANTA-0002', identiteVerifiee: true },
    { telephone: '620100014', prenom: 'Ibrahima', nom: 'Sylla', sexe: 'M', dateNaissance: new Date('1979-11-23'), qrCode: 'DEMO-QR-IBRAHIMA-0003', identiteVerifiee: true },
    { telephone: '620100015', prenom: 'Aïssatou', nom: 'Bah', sexe: 'F', dateNaissance: new Date('1995-01-30'), qrCode: 'DEMO-QR-AISSATOU-0004', identiteVerifiee: false },
  ],

  medicaments: [
    { libelle: 'Doliprane Pricemou 500mg', dci: 'Paracétamol',  nomCommercial: 'Doliprane Pricemou', forme: 'comprimé', dosage: '500mg', prixUnitaireGnf: 1000, codeAtc: 'N02BE01' },
    { libelle: 'Clamoxyl Pricemou 500mg', dci: 'Amoxicilline', nomCommercial: 'Clamoxyl Pricemou',  forme: 'gélule',   dosage: '500mg', prixUnitaireGnf: 2500, codeAtc: 'J01CA04' },
    { libelle: 'Glucophage Pricemou 850mg', dci: 'Metformine',   nomCommercial: 'Glucophage Pricemou', forme: 'comprimé', dosage: '850mg', prixUnitaireGnf: 1800, codeAtc: 'A10BA02',
      contreIndications: ['Insuffisance rénale'] },
    { libelle: 'Morphine Pricemou 10mg', dci: 'Morphine',     nomCommercial: 'Morphine Pricemou',  forme: 'ampoule',  dosage: '10mg',  prixUnitaireGnf: 8000, codeAtc: 'N02AA01', estReglemente: true },
  ],

  // De quoi essayer le paiement mobile : au-dessus des 3 000 GNF que la
  // passerelle exige, et assez gros pour que le montant se lise.
  consultationAPayer: {
    motif: 'Consultation générale',
    ancienMotif: 'Consultation generale',
    tarifGnf: 25000,
  },

  // L'assureur de la demonstration (EF-09, addendum point 5).
  //
  // Un contrat a **100 %** avec le lait et les cosmetiques exclus : c'est la
  // phrase du chef de projet rendue demontrable — « un assure a 100 % paie
  // quand meme son lait infantile ».
  assureur: {
    nom: 'Pricemou & Frère Assurances',
    code: 'PFA',
    telephone: '620100099',
    numeroPolice: 'PFA-2026-00042',
    tauxBasePourcent: 100,
    exclusions: ['LAIT_INFANTILE', 'COSMETIQUE'] as const,
  },

  // Articles non medicamenteux (decision du 2026-10-01). Ni DCI, ni forme, ni
  // dosage : c'est precisement ce que l'ancien modele ne savait pas porter.
  // Ils ne se prescrivent pas ; ils se vendent au comptoir, et l'assurance
  // s'appuie sur leur categorie pour les exclure.
  articles: [
    { libelle: 'Lait infantile 1er âge 400g', ancienLibelle: 'Lait infantile 1er age 400g', categorie: 'LAIT_INFANTILE', prixUnitaireGnf: 45000 },
    { libelle: 'Crème hydratante 100ml',      ancienLibelle: 'Creme hydratante 100ml',      categorie: 'COSMETIQUE',     prixUnitaireGnf: 30000 },
    { libelle: 'Savon antiseptique',          ancienLibelle: 'Savon antiseptique',          categorie: 'HYGIENE',        prixUnitaireGnf: 12000 },
    { libelle: 'Thermomètre digital',         ancienLibelle: 'Thermometre digital',         categorie: 'DISPOSITIF_MEDICAL', prixUnitaireGnf: 85000 },
  ],

  // **La vie courante de la demonstration** (revue, point 4.8). Sans elle,
  // chaque espace s'ouvre sur une liste vide et le premier ecran ne montre
  // rien de ce qu'il sait faire : l'agenda du medecin, la caisse et son
  // tableau de bord, le contrat d'entreprise de l'assureur, les courses du
  // livreur.
  rendezVous: [
    // Demain a 10 h : l'agenda du medecin et l'espace de la patiente.
    { motif: 'Suivi de l’asthme', dansJours: 1, heure: 10, statut: 'PLANIFIE' },
    // Il y a dix jours, sans la patiente : l'historique sait dire « absent ».
    { motif: 'Bilan sanguin de contrôle', dansJours: -10, heure: 9, statut: 'ABSENT' },
  ],
  // Une demande en attente, que l'accueil oriente vers un medecin.
  demandeRendezVous: { motif: 'Douleurs abdominales depuis trois jours' },

  // Trois ventes en especes, puis une caisse fermee juste : le tableau de
  // bord a un chiffre, un panier moyen et des produits les plus vendus.
  fondDeCaisse: 50000,
  ventes: [
    [['Doliprane Pricemou 500mg', 2]],
    [['Savon antiseptique', 1], ['Lait infantile 1er âge 400g', 1]],
    [['Doliprane Pricemou 500mg', 1], ['Thermomètre digital', 1]],
  ],

  // Le contrat d'une entreprise, pour l'espace de l'assureur. Seule Fanta
  // Camara y adhere : Ibrahima et Aïssatou restent a rattacher pendant la
  // demonstration, et Aïssatou doit y etre refusee (identite non verifiee).
  entreprise: {
    raisonSociale: 'Kaloum Logistique SARL',
    identifiantLegal: 'DEMO-RCCM-0001',
    numeroContrat: 'PFA-COL-2026-001',
    nomRegime: 'Régime salariés',
    tauxBasePourcent: 80,
    plafondAnnuelGnf: 2_000_000,
    numeroAdherentFanta: 'PFA-ADH-0001',
  },

  // Une commande prete a livrer, pour que le livreur de Donka ait une course
  // a laquelle repondre.
  livraison: { motif: 'Renouvellement du traitement de fond' },
} as const;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function upsertStructure(
  s: { nom: string; ancienNom?: string; type: TypeStructure; telephone: string },
  estPartenaire: boolean
) {
  // Le nom actuel d'abord : si une base porte les deux, c'est lui qui compte.
  const existante =
    (await prisma.structureSante.findFirst({ where: { nom: s.nom } }))
    ?? (s.ancienNom ? await prisma.structureSante.findFirst({ where: { nom: s.ancienNom } }) : null);
  const donnees = {
    nom: s.nom,
    type: s.type,
    prefecture: PREFECTURE,
    commune: COMMUNE,
    // Sans quartier, l'appel aux pharmacies (P6) ne trouve personne.
    quartier: QUARTIER,
    telephone: s.telephone,
    estActive: true,
    estPartenaire,
    partenaireDepuis: estPartenaire ? new Date() : null,
  };
  if (existante) {
    return prisma.structureSante.update({ where: { id: existante.id }, data: donnees });
  }
  return prisma.structureSante.create({ data: donnees });
}

async function upsertUtilisateur(
  u: { telephone: string; email?: string; prenom: string; nom: string },
  role: Role,
  motDePasseHash: string,
  idStructure: string | null
) {
  return prisma.utilisateur.upsert({
    where: { telephone: u.telephone },
    // **Le nom et l'adresse reviennent aussi.** Ils ne l'etaient pas, et un
    // compte renomme depuis l'application cessait d'exister sous l'adresse que
    // la documentation annonce : trois essais perdus a chercher pourquoi
    // `accueil.donka@demo.test` ne repondait plus. Un seed de demonstration
    // qui ne ramene pas les comptes documentes ne fait pas son travail.
    update: {
      estActif: true, idStructure, motDePasseHash, role,
      doitChangerMotDePasse: false,
      prenom: u.prenom, nom: u.nom, email: u.email ?? null,
    },
    create: {
      telephone: u.telephone,
      email: u.email ?? null,
      motDePasseHash,
      prenom: u.prenom,
      nom: u.nom,
      role,
      idStructure,
      estActif: true,
      doitChangerMotDePasse: false,
    },
  });
}

/** Une identite verifiee sur piece, telle que l'accueil l'enregistre. */
function identiteVerifiee(numeroPiece: string) {
  return {
    niveauIdentite: 'VERIFIEE' as const,
    typePiece: 'CARTE_NATIONALE' as const,
    numeroPiece,
    identiteVerifieeLe: new Date('2026-01-15'),
    lieuNaissance: PREFECTURE,
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refus : ce script ne doit pas tourner en production.');
  }

  const motDePasseHash = await hashPassword(MOT_DE_PASSE);

  // ── 1. Les structures ───────────────────────────────────────────
  // La pharmacie est partenaire : c'est la condition pour etre sollicitee.
  const hopital = await upsertStructure(DEMO.hopital, false);
  const laboratoire = await upsertStructure(DEMO.laboratoire, true);
  const pharmacie = await upsertStructure(DEMO.pharmacie, true);
  const pharmacieHopital = await upsertStructure(DEMO.pharmacieHopital, true);
  await prisma.structureSante.update({
    where: { id: pharmacieHopital.id },
    data: { idStructureParente: hopital.id },
  });
  console.log('1. Structures : Hopital Donka et sa pharmacie, Laboratoire Cece, Pharmacie Pricemou (independante)');

  // ── 2. Les professionnels ───────────────────────────────────────
  const adminHopital = await upsertUtilisateur(DEMO.adminHopital, Role.ADMIN_STRUCTURE, motDePasseHash, hopital.id);
  await upsertUtilisateur(DEMO.adminNational, Role.ADMIN_NATIONAL, motDePasseHash, null);
  await upsertUtilisateur(DEMO.accueil, Role.AGENT_ACCUEIL, motDePasseHash, hopital.id);
  const medecin = await upsertUtilisateur(DEMO.medecin, Role.MEDECIN, motDePasseHash, hopital.id);
  await upsertUtilisateur(DEMO.technicien, Role.TECHNICIEN_LABO, motDePasseHash, laboratoire.id);
  await upsertUtilisateur(DEMO.laborantin2, Role.TECHNICIEN_LABO, motDePasseHash, laboratoire.id);
  // **Le profil officinal est requis pour encaisser.** Sans lui, le compte
  // ouvre l'espace pharmacien mais la caisse le refuse (« aucune fonction
  // officinale rattachee »). Titulaire : il gere aussi les conventions d'une
  // pharmacie independante.
  for (const [compte, structure] of [[DEMO.pharmacien, pharmacie], [DEMO.pharmacienHopital, pharmacieHopital]] as const) {
    const pharmacien = await upsertUtilisateur(compte, Role.PHARMACIEN, motDePasseHash, structure.id);
    await prisma.pharmacienProfile.upsert({
      where: { idUtilisateur: pharmacien.id },
      update: { roleOfficine: 'TITULAIRE', estResponsable: true, idStructure: structure.id },
      create: { idUtilisateur: pharmacien.id, roleOfficine: 'TITULAIRE', estResponsable: true, idStructure: structure.id },
    });
  }

  // Le profil medecin est requis pour que l'espace medecin s'ouvre.
  await prisma.medecinProfile.upsert({
    where: { idUtilisateur: medecin.id },
    update: { idStructure: hopital.id },
    // `idStructure` ici aussi : le profil le porte comme le compte, et un
    // profil detache rendait le medecin introuvable pour tout ce qui filtre
    // sur cette colonne.
    create: { idUtilisateur: medecin.id, specialite: 'Médecine générale', idStructure: hopital.id },
  });
  // Le profil ASC est requis pour que son espace s'ouvre, comme pour le medecin.
  const agentSante = await upsertUtilisateur(DEMO.asc, Role.ASC, motDePasseHash, hopital.id);
  await prisma.ascProfile.upsert({
    where: { idUtilisateur: agentSante.id },
    update: { idStructure: hopital.id },
    create: { idUtilisateur: agentSante.id, numeroCertification: 'ASC-DEMO-0001', idStructure: hopital.id },
  });
  const compteLivreur = await upsertUtilisateur(DEMO.livreur, Role.LIVREUR, motDePasseHash, null);
  await prisma.livreurProfile.upsert({
    where: { idUtilisateur: compteLivreur.id },
    // En service : c'est lui que la course de demonstration doit prevenir.
    update: { quartier: QUARTIER, commune: COMMUNE, prefecture: PREFECTURE, estActif: true, enService: true, enServiceDepuis: new Date() },
    create: {
      idUtilisateur: compteLivreur.id,
      quartier: QUARTIER,
      commune: COMMUNE,
      prefecture: PREFECTURE,
      enService: true,
      enServiceDepuis: new Date(),
    },
  });

  console.log('2. Professionnels : accueil, Dr David, deux laborantins, pharmacien, agent de sante,');
  console.log(`   admin de structure, admin national (${DEMO.adminNational.telephone})`);
  console.log(`   et l agent de l assureur (${DEMO.agentAssureur.telephone})`);
  console.log(`   et le livreur de Donka (${DEMO.livreur.telephone})`);

  // ── 3. Le patient ───────────────────────────────────────────────
  const utilisateurPatient = await upsertUtilisateur(DEMO.patient, Role.PATIENT, motDePasseHash, null);
  const donneesPatient = {
    dateNaissance: DEMO.patient.dateNaissance,
    sexe: DEMO.patient.sexe,
    prefecture: PREFECTURE,
    commune: COMMUNE,
    // Meme quartier que la pharmacie : sans cela, aucune ne serait sollicitee.
    quartier: QUARTIER,
    allergies: [...DEMO.patient.allergies],
    maladiesChroniques: [...DEMO.patient.maladiesChroniques],
    // Le tiers payant exige une identite verifiee (EF-01-10) : sans elle,
    // toute carte d'assurance de la patiente serait refusee au comptoir.
    ...identiteVerifiee('GN-DEMO-0001'),
    // Son etablissement de rattachement : la demande de rendez-vous le
    // propose d'office, marque « Mon établissement ».
    idStructurePreferee: hopital.id,
  };
  const patientProfile = await prisma.patientProfile.upsert({
    where: { idUtilisateur: utilisateurPatient.id },
    update: donneesPatient,
    create: { idUtilisateur: utilisateurPatient.id, qrCode: DEMO.patient.qrCode, ...donneesPatient },
  });
  console.log(`3. Patiente : Maomou Conde (${DEMO.patient.telephone}), allergique a l'amoxicilline`);

  for (const [i, e] of DEMO.employes.entries()) {
    const compte = await upsertUtilisateur(e, Role.PATIENT, motDePasseHash, null);
    const donnees = {
      dateNaissance: e.dateNaissance, sexe: e.sexe, prefecture: PREFECTURE, commune: COMMUNE, quartier: QUARTIER,
      ...(e.identiteVerifiee
        ? identiteVerifiee(`GN-DEMO-000${i + 2}`)
        : { niveauIdentite: 'PROVISOIRE' as const, typePiece: null, numeroPiece: null, identiteVerifieeLe: null }),
    };
    await prisma.patientProfile.upsert({
      where: { idUtilisateur: compte.id },
      update: donnees,
      create: { idUtilisateur: compte.id, qrCode: e.qrCode, ...donnees },
    });
  }
  console.log(`   Beneficiaires a rattacher : ${DEMO.employes.map((e) => `${e.prenom} ${e.nom} (${e.telephone})`).join(', ')}`);

  // ── 4. Le catalogue et le stock ─────────────────────────────────

  /**
   * Met un produit en stock dans l'officine, avec son lot. Une quantite sans
   * lot est indelivrable depuis le 2026-09-30 : la sortie se fait au plus
   * proche de la peremption.
   *
   * Semence rejouable : un lot unique, refait a chaque execution. Empiler un
   * lot de plus a chaque passage ferait quitter la quantite du stock.
   */
  async function mettreEnStock(idProduit: string, cleLot: string, quantite = 500) {
    for (const officine of [pharmacie, pharmacieHopital]) {
      await mettreEnStockDans(officine.id, idProduit, cleLot, quantite);
    }
  }

  async function mettreEnStockDans(idStructure: string, idProduit: string, cleLot: string, quantite: number) {
    const stock = await prisma.stock.upsert({
      where: { idStructure_idMedicament: { idStructure, idMedicament: idProduit } },
      update: {},
      create: { idStructure, idMedicament: idProduit, quantite, unite: 'boite', seuilAlerte: 10 },
    });

    // Un stock qui porte deja une entree enregistree par facture n'est plus un
    // stock de semence : le remettre a 500 et refaire ses lots effacerait
    // l'approvisionnement, et la facture se retrouverait sans ses lots. On le
    // laisse tel quel.
    const dejaApprovisionne = await prisma.lotStock.count({
      where: { idStock: stock.id, idApprovisionnement: { not: null } },
    });
    if (dejaApprovisionne > 0) return;

    // **Un stock qui a deja servi garde ses lots.** Une vente ou une
    // delivrance inscrit au registre des mouvements le lot d'ou elle est
    // sortie. Supprimer ce lot met ce champ a NULL, donc modifie une ligne
    // du registre, que la base refuse (registre en ajout seul) : rejouer la
    // semence apres une seule vente faisait echouer tout le script. Ce stock
    // a une histoire ; on la laisse.
    const dejaMouvemente = await prisma.mouvementStock.count({ where: { idStock: stock.id } });
    if (dejaMouvemente > 0) return;

    await prisma.stock.update({ where: { id: stock.id }, data: { quantite } });
    await prisma.lotStock.deleteMany({ where: { idStock: stock.id } });
    await prisma.lotStock.create({
      data: {
        idStock: stock.id,
        numeroLot: `DEMO-${cleLot.slice(0, 6).toUpperCase()}-1`,
        quantite,
        quantiteRecue: quantite,
        // Quatre mois : l'ecran des peremptions a quelque chose a montrer sans
        // qu'on ait a saisir une facture d'abord.
        datePeremption: new Date(Date.now() + 120 * 86_400_000),
      },
    });
  }

  for (const fiche of DEMO.medicaments) {
    // `as const` rend les listes immuables ; Prisma attend des tableaux.
    const m = { ...fiche, contreIndications: 'contreIndications' in fiche ? [...fiche.contreIndications] : undefined };
    const existant = await prisma.medicament.findFirst({ where: { nomCommercial: m.nomCommercial } });
    const medicament = existant
      ? await prisma.medicament.update({ where: { id: existant.id }, data: { ...m } })
      : await prisma.medicament.create({ data: { ...m, listeEssentielle: true } });

    await mettreEnStock(medicament.id, medicament.nomCommercial ?? 'LOT');
  }

  // Les articles se reperent par leur libelle : n'ayant pas de nom commercial,
  // ils n'ont pas d'autre cle stable. L'ancien libelle, sans accents,
  // retrouve l'article d'une base deja semee.
  for (const { ancienLibelle, ...a } of DEMO.articles) {
    const existant = await prisma.medicament.findFirst({ where: { libelle: { in: [a.libelle, ancienLibelle] } } });
    const article = existant
      ? await prisma.medicament.update({ where: { id: existant.id }, data: { ...a } })
      : await prisma.medicament.create({ data: { ...a } });
    // La cle du lot reste celle de l'ancien libelle : le numero de lot ne
    // change pas d'une version de la semence a l'autre.
    await mettreEnStock(article.id, ancienLibelle.replace(/\s/g, ''), 60);
  }

  console.log(
    `4. Catalogue : ${DEMO.medicaments.length} medicaments (dont un allergene et un reglemente) ` +
      `et ${DEMO.articles.length} articles non medicamenteux, en stock par lots`
  );

  // ── 4 bis. Une consultation a payer ─────────────────────────────
  //
  // Sans elle, l'ecran « Mes paiements » du patient n'a rien a montrer : rien
  // ne facture automatiquement, et la facture naît quand le paiement s'ouvre.
  const consultationAPayer = await prisma.consultation.findFirst({
    where: {
      idPatient: patientProfile.id,
      motifPrincipal: { in: [DEMO.consultationAPayer.motif, DEMO.consultationAPayer.ancienMotif] },
    },
    select: { id: true, motifPrincipal: true },
  });
  if (consultationAPayer && consultationAPayer.motifPrincipal !== DEMO.consultationAPayer.motif) {
    await prisma.consultation.update({
      where: { id: consultationAPayer.id },
      data: { motifPrincipal: DEMO.consultationAPayer.motif },
    });
  }
  if (!consultationAPayer) {
    await prisma.consultation.create({
      data: {
        idPatient: patientProfile.id,
        motifPrincipal: DEMO.consultationAPayer.motif,
        tarifGnf: DEMO.consultationAPayer.tarifGnf,
      },
    });
  }
  console.log(
    `4 bis. Une consultation a payer : ${DEMO.consultationAPayer.tarifGnf} GNF`
  );

  // ── 4 ter. Une ordonnance a servir ──────────────────────────────
  //
  // Sans elle, l'ecran « Commandes » du pharmacien n'a rien a montrer :
  // l'appel au quartier part d'une ordonnance signee, et rien n'en cree.
  const ordonnanceExistante = await prisma.ordonnance.findFirst({
    where: { consultation: { idPatient: patientProfile.id } },
    select: { id: true, idConsultation: true, commande: { select: { id: true } } },
  });

  if (!ordonnanceExistante) {
    const consultation = await prisma.consultation.findFirstOrThrow({
      where: { idPatient: patientProfile.id }, select: { id: true },
    });
    const produit = await prisma.medicament.findFirstOrThrow({
      where: { libelle: DEMO.medicaments[0].libelle }, select: { id: true },
    });
    const dansTroisMois = new Date();
    dansTroisMois.setMonth(dansTroisMois.getMonth() + 3);

    // `signeLe` fait foi : le statut reste EN_ATTENTE tant qu'elle n'est pas
    // servie — il n'y a pas de valeur « SIGNEE » dans l'enumeration.
    const ordonnance = await prisma.ordonnance.create({
      data: {
        numero: await prochainNumero('OR'),
        codeVerification: randomBytes(6).toString('hex').toUpperCase(),
        valideJusquau: dansTroisMois,
        idConsultation: consultation.id,
        signePar: medecin.id,
        signeLe: new Date(),
        lignes: {
          create: [{
            idMedicament: produit.id,
            posologie: '1 comprimé matin et soir',
            frequence: '2 fois par jour',
            dureeJours: 5,
            quantite: 2,
          }],
        },
      },
      select: { id: true, idConsultation: true },
    });
    // **Une ordonnance signee suppose une consultation terminee.** Le seed la
    // laissait EN_COURS, et le scan du comptoir n'accepte que les
    // consultations terminees : l'ecran « Ordonnances » du pharmacien
    // annoncait donc « toutes les ordonnances ont ete delivrees » sur un
    // patient qui en avait une a servir. Le parcours de delivrance n'avait
    // jamais rien a montrer.
    await prisma.consultation.update({
      where: { id: ordonnance.idConsultation },
      data: { statut: 'TERMINEE' },
    });
    await lancerRecherchePharmacie(ordonnance.id);
  } else if (!ordonnanceExistante.commande) {
    await prisma.consultation.update({
      where: { id: ordonnanceExistante.idConsultation },
      data: { statut: 'TERMINEE' },
    });
    await lancerRecherchePharmacie(ordonnanceExistante.id);
  } else {
    // **Le seed ramene la demonstration a son point de depart.** Sans cela,
    // une commande deja prise lors d'un parcours precedent laisse l'ecran du
    // pharmacien vide : il n'a plus rien a prendre, et le parcours ne se
    // rejoue pas.
    await prisma.reponsePharmacie.deleteMany({
      where: { idCommande: ordonnanceExistante.commande.id },
    });
    // **Tout ce que la chaine a pose doit repartir avec elle.** Le premier
    // jet ne remettait que le statut, la pharmacie et le mode : la commande
    // revenait « en recherche de pharmacie » en portant encore son panier
    // chiffre, sa date de cloture et une facture payee. Rejouer la
    // demonstration partait alors d'un etat qui n'existe nulle part dans la
    // vraie vie, et le premier ecran s'en trouvait incomprehensible.
    //
    // **Dans une seule transaction**, et ce n'est pas un detail : le
    // declencheur differe de la base verifie au commit que le total s'accorde
    // avec la somme des lignes. Supprimer les lignes puis remettre le total a
    // zero en deux appels laisse un ecart entre les deux, et la garde refuse
    // — elle a refuse ce seed-ci, ce qui est exactement son travail.
    await prisma.consultation.update({
      where: { id: ordonnanceExistante.idConsultation },
      data: { statut: 'TERMINEE' },
    });

    // **La delivrance repart a zero, elle aussi.** Les actes de comptoir d'un
    // parcours precedent restaient en base : la ligne se presentait entamee,
    // avec une seule unite a servir sur deux, et le parcours de delivrance
    // partielle ne pouvait plus etre rejoue. Le meme oubli que pour le panier
    // de la commande, trouve de la meme facon — en relancant le parcours.
    await prisma.acteDelivrance.deleteMany({
      where: { ligne: { idOrdonnance: ordonnanceExistante.id } },
    });
    await prisma.ligneOrdonnance.updateMany({
      where: { idOrdonnance: ordonnanceExistante.id },
      data: { statut: 'EN_ATTENTE' },
    });
    await prisma.ordonnance.update({
      where: { id: ordonnanceExistante.id },
      data: { statut: 'EN_ATTENTE' },
    });

    const idCommandeDemo = ordonnanceExistante.commande.id;
    await prisma.$transaction([
      prisma.ligneCommande.deleteMany({ where: { idCommande: idCommandeDemo } }),
      prisma.facture.deleteMany({ where: { idCommande: idCommandeDemo } }),
      prisma.commande.update({
        where: { id: idCommandeDemo },
        data: {
          statut: 'RECHERCHE_PHARMACIE',
          idPharmacie: null,
          priseEnChargeLe: null,
          modeRemise: null,
          montantTotalGnf: null,
          chiffreeLe: null,
          preteLe: null,
          remiseLe: null,
          clotureeLe: null,
          motifAnnulation: null,
        },
      }),
    ]);
  }
  console.log("4 ter. Une ordonnance signee, appelee aux pharmacies du quartier");

  // ── 5. L'assurance ──────────────────────────────────────────────
  const assureur = await prisma.assureur.upsert({
    where: { code: DEMO.assureur.code },
    update: { nom: DEMO.assureur.nom, telephone: DEMO.assureur.telephone, estActif: true },
    create: {
      nom: DEMO.assureur.nom,
      code: DEMO.assureur.code,
      telephone: DEMO.assureur.telephone,
    },
  });

  // Semence rejouable : on repart des exclusions declarees plutot que d'en
  // empiler une de plus a chaque execution. Les regles portant une date
  // d'effet, les empiler changerait le chiffrage sans que personne ne l'ait
  // demande.
  await prisma.regleCouverture.deleteMany({ where: { idAssureur: assureur.id } });
  for (const categorie of DEMO.assureur.exclusions) {
    await prisma.regleCouverture.create({
      data: { categorie, exclu: true, idAssureur: assureur.id, dateEffet: new Date('2026-01-01') },
    });
  }

  // La structure de la compagnie, et l'agent qui s'y connecte.
  const structureAssureur = await prisma.structureSante.upsert({
    where: { id: `str-${DEMO.assureur.code.toLowerCase()}` },
    update: { nom: DEMO.assureur.nom },
    create: {
      id: `str-${DEMO.assureur.code.toLowerCase()}`,
      nom: DEMO.assureur.nom,
      type: TypeStructure.ASSURANCE,
      prefecture: PREFECTURE,
    },
    select: { id: true },
  });
  await prisma.assureur.update({
    where: { id: assureur.id },
    data: { idStructure: structureAssureur.id },
  });
  await upsertUtilisateur(DEMO.agentAssureur, Role.ASSUREUR, motDePasseHash, structureAssureur.id);

  const contratExistant = await prisma.contratAssurance.findFirst({
    where: { idAssureur: assureur.id, numeroPolice: DEMO.assureur.numeroPolice },
    select: { id: true },
  });
  const donneesContrat = {
    tauxBasePourcent: DEMO.assureur.tauxBasePourcent,
    dateEffet: new Date('2026-01-01'),
    statut: 'ACTIF' as const,
  };
  if (contratExistant) {
    await prisma.contratAssurance.update({ where: { id: contratExistant.id }, data: donneesContrat });
  } else {
    await prisma.contratAssurance.create({
      data: {
        ...donneesContrat,
        numeroPolice: DEMO.assureur.numeroPolice,
        // Le jeton du QR de la carte : aleatoire, comme en production.
        jetonCarte: randomBytes(32).toString('base64url'),
        idAssureur: assureur.id,
        idPatient: patientProfile.id,
      },
    });
  }
  // Sans convention, la pharmacie refuserait le tiers payant de la demo.
  await prisma.structureAssureur.upsert({
    where: { idStructure_idAssureur: { idStructure: pharmacie.id, idAssureur: assureur.id } },
    create: { idStructure: pharmacie.id, idAssureur: assureur.id },
    update: {},
  });
  console.log(
    `5. Assurance : ${DEMO.assureur.nom} (${DEMO.assureur.code}), police ${DEMO.assureur.numeroPolice} ` +
      `a ${DEMO.assureur.tauxBasePourcent} %, ${DEMO.assureur.exclusions.length} categories exclues`
  );

  // ── 6. Le referentiel d'examens ─────────────────────────────────
  await seedExamens(prisma);
  console.log('6. Examens de laboratoire (codes LOINC)');

  // ── 7. Plateaux techniques et partenaires conseilles ────────────
  await seedPlateauxTechniques(hopital.id, laboratoire.id, adminHopital.id);

  // ── 8. La vie courante ─────────────────────────────────────────
  await seedVieCourante({
    idHopital: hopital.id,
    idPharmacie: pharmacie.id,
    idMedecin: medecin.id,
    idPatient: patientProfile.id,
    idAssureur: assureur.id,
  });

  await verifierInvariantDesLots();

  console.log('   Convention : Pharmacie Pricemou seulement. L hopital n en a aucune : sa pharmacie');
  console.log('   refuse donc le tiers payant tant que l admin de l hopital n a pas declare l assureur.');

  // Jamais affiche : les sorties de console finissent dans des journaux et des captures.
  console.log('\nMot de passe de tous les comptes : celui de SEED_DEMO_PASSWORD');
  console.log(`Quartier commun : ${QUARTIER} (${COMMUNE}, ${PREFECTURE})`);
  console.log('\nParcours a derouler : voir docs/PARCOURS-DEMO.md');
}

/**
 * Qui sait faire quoi, et qui l'hopital conseille.
 *
 * **Sans cela la demonstration ne montre rien.** Tant qu'aucune structure ne
 * declare son plateau, toutes sont reputees tout realiser : les trois groupes
 * du medecin s'affichent, mais chaque laboratoire annonce « 5 sur 5 » et le
 * mecanisme reste invisible. Il faut au moins un trou pour le voir.
 *
 * Les trois cas que le medecin doit rencontrer :
 *   - Hopital Donka, « chez nous » : pas de serologie, pas de culture. Celui
 *     qui prescrit une serologie VIH voit son propre laboratoire la refuser.
 *   - Laboratoire Cece, conseille par Donka : les serologies, pas les cultures.
 *   - Clinique de Kindia, hors prefecture et non conseillee : tout, mais elle
 *     n'apparait qu'apres « Chercher dans tout le pays ».
 */
async function seedPlateauxTechniques(idHopital: string, idLabo: string, idAdmin: string) {
  const examens = await prisma.examen.findMany({ select: { id: true, categorie: true } });
  if (examens.length === 0) throw new Error('Refus : referentiel d examens vide, le plateau serait vide.');

  // La clinique vit ailleurs : c'est ce qui rend l'elargissement visible.
  const nomClinique = 'Clinique de Kindia';
  const existante = await prisma.structureSante.findFirst({ where: { nom: nomClinique } });
  const donneesClinique = {
    type: TypeStructure.CLINIQUE,
    prefecture: 'Kindia',
    commune: 'Kindia Centre',
    quartier: 'Bamban',
    telephone: '+224620000500',
    estActive: true,
    estPartenaire: false,
  };
  const clinique = existante
    ? await prisma.structureSante.update({ where: { id: existante.id }, data: donneesClinique })
    : await prisma.structureSante.create({ data: { nom: nomClinique, ...donneesClinique } });

  /** Une declaration complete : toute categorie absente est declaree non realisee. */
  async function declarer(idStructure: string, categoriesRealisees: readonly string[], delaiHeures: number) {
    for (const e of examens) {
      const realise = categoriesRealisees.includes(e.categorie);
      await prisma.plateauTechnique.upsert({
        where: { idStructure_idExamen: { idStructure, idExamen: e.id } },
        // `actif: false` plutot qu'une absence de ligne : une ligne absente
        // vaudrait « non declare », donc « tout realisable ».
        update: { actif: realise, delaiHeures: realise ? delaiHeures : null },
        create: { idStructure, idExamen: e.id, actif: realise, delaiHeures: realise ? delaiHeures : null },
      });
    }
  }

  const SANS_SEROLOGIE_NI_CULTURE = ['HEMATOLOGIE', 'BIOCHIMIE', 'PARASITOLOGIE', 'URINE'] as const;
  const SANS_CULTURE = ['HEMATOLOGIE', 'BIOCHIMIE', 'PARASITOLOGIE', 'URINE', 'SEROLOGIE'] as const;
  const TOUT = ['HEMATOLOGIE', 'BIOCHIMIE', 'PARASITOLOGIE', 'URINE', 'SEROLOGIE', 'MICROBIOLOGIE'] as const;

  await declarer(idHopital, SANS_SEROLOGIE_NI_CULTURE, 24);
  await declarer(idLabo, SANS_CULTURE, 48);
  await declarer(clinique.id, TOUT, 72);

  // Donka conseille le Laboratoire Cece : ce n'est pas un contrat, Cece n'a
  // rien accepte. Cela le place en « Partenaires declares » chez ses medecins.
  await prisma.structureConseillee.upsert({
    where: {
      idStructure_idStructureConseillee: { idStructure: idHopital, idStructureConseillee: idLabo },
    },
    update: { declarePar: idAdmin },
    create: { idStructure: idHopital, idStructureConseillee: idLabo, declarePar: idAdmin },
  });

  const realises = await prisma.plateauTechnique.count({ where: { actif: true } });
  console.log(`7. Plateaux techniques : ${realises} lignes realisees sur 3 structures`);
  console.log('   Donka ne fait ni serologie ni culture ; Cece fait les serologies ;');
  console.log(`   ${nomClinique} fait tout mais vit hors prefecture (visible apres elargissement).`);
}

/**
 * Ce que chaque espace doit montrer en s'ouvrant (revue, point 4.8) :
 * l'agenda, la caisse, le contrat d'entreprise, la course du livreur.
 *
 * **Les ventes et la course passent par les services de l'application**, pas
 * par des insertions directes : une vente ecrite a la main ne sortirait pas
 * ses lots du stock et laisserait un registre faux. Ce sont les memes
 * fonctions que celles appelees par l'API.
 */
async function seedVieCourante(ids: {
  idHopital: string; idPharmacie: string; idMedecin: string; idPatient: string; idAssureur: string;
}) {
  const fanta = await prisma.patientProfile.findFirstOrThrow({
    where: { utilisateur: { telephone: DEMO.employes[0].telephone } },
    select: { id: true },
  });

  // ── Rendez-vous : refaits a chaque passage, pour que « demain » reste demain.
  const motifsRdv = DEMO.rendezVous.map((r) => r.motif);
  await prisma.rendezVous.deleteMany({
    where: { idPatient: ids.idPatient, motif: { in: motifsRdv }, idConsultation: null },
  });
  for (const r of DEMO.rendezVous) {
    const prevuLe = new Date();
    prevuLe.setDate(prevuLe.getDate() + r.dansJours);
    prevuLe.setHours(r.heure, 0, 0, 0);
    await prisma.rendezVous.create({
      data: { idPatient: ids.idPatient, idMedecin: ids.idMedecin, motif: r.motif, prevuLe, statut: r.statut },
    });
  }
  await prisma.demandeRendezVous.deleteMany({
    where: { idPatient: fanta.id, motif: DEMO.demandeRendezVous.motif, statut: 'EN_ATTENTE' },
  });
  await prisma.demandeRendezVous.create({
    data: { idPatient: fanta.id, idStructure: ids.idHopital, motif: DEMO.demandeRendezVous.motif },
  });
  console.log(`8. Rendez-vous : ${DEMO.rendezVous.length} pour Maomou, une demande de Fanta Camara a orienter`);

  // ── Caisse : une fois seulement. Les ventes restent dans l'historique, et
  // une session ouverte a la main n'est pas fermee a la place du pharmacien.
  const pharmacien = await prisma.utilisateur.findUniqueOrThrow({
    where: { telephone: DEMO.pharmacien.telephone }, select: { id: true },
  });
  const ventesExistantes = await prisma.venteComptoir.count({ where: { idStructure: ids.idPharmacie } });
  const sessionOuverte = await prisma.sessionCaisse.count({
    where: { idStructure: ids.idPharmacie, statut: 'OUVERTE' },
  });
  if (ventesExistantes === 0 && sessionOuverte === 0) {
    const jeton = { userId: pharmacien.id, role: Role.PHARMACIEN, sessionId: 'seed-demo' };
    const session = await ouvrirSession(jeton, { montantOuvertureGnf: DEMO.fondDeCaisse });
    let encaisse = 0;
    for (const panier of DEMO.ventes) {
      const lignes = [];
      for (const [libelle, quantite] of panier) {
        const produit = await prisma.medicament.findFirstOrThrow({ where: { libelle }, select: { id: true } });
        lignes.push({ idMedicament: produit.id, quantite });
      }
      const vente = await creerVente(jeton, { lignes, modePaiement: 'ESPECES' });
      encaisse += vente.montantNetGnf;
    }
    // Le compte tombe juste : une caisse de demonstration sans ecart.
    await cloturerSession(jeton, session.id, { montantCompteGnf: DEMO.fondDeCaisse + encaisse });
    console.log(`   Caisse : ${DEMO.ventes.length} ventes en especes (${encaisse} GNF), session close sans ecart`);
  } else {
    console.log('   Caisse : deja des ventes ou une session ouverte, rien d ajoute');
  }

  // ── Contrat d'entreprise et adhesion de Fanta Camara.
  const e = DEMO.entreprise;
  const entreprise = await prisma.entrepriseAssuree.upsert({
    where: { identifiantLegal: e.identifiantLegal },
    update: { raisonSociale: e.raisonSociale, estActive: true },
    create: { raisonSociale: e.raisonSociale, identifiantLegal: e.identifiantLegal },
  });
  const donneesCollectif = {
    nomRegime: e.nomRegime,
    tauxBasePourcent: e.tauxBasePourcent,
    plafondAnnuelGnf: e.plafondAnnuelGnf,
    dateEffet: new Date('2026-01-01'),
    statut: 'ACTIF' as const,
    idEntreprise: entreprise.id,
  };
  const collectif = await prisma.contratCollectifAssurance.upsert({
    where: { idAssureur_numeroContrat: { idAssureur: ids.idAssureur, numeroContrat: e.numeroContrat } },
    update: donneesCollectif,
    create: { ...donneesCollectif, numeroContrat: e.numeroContrat, idAssureur: ids.idAssureur },
  });
  await prisma.adhesionAssurance.upsert({
    where: { idContratCollectif_idPatient: { idContratCollectif: collectif.id, idPatient: fanta.id } },
    update: { statut: 'ACTIF' },
    create: {
      numeroAdherent: e.numeroAdherentFanta,
      jetonCarte: randomBytes(32).toString('base64url'),
      dateEffet: new Date('2026-01-01'),
      idContratCollectif: collectif.id,
      idPatient: fanta.id,
    },
  });
  console.log(`   Contrat collectif ${e.numeroContrat} (${e.raisonSociale}, ${e.tauxBasePourcent} %) : Fanta Camara adherente`);

  // ── Une commande prete a livrer, et sa course en appel d'offres.
  const ordonnanceALivrer = () => prisma.ordonnance.findFirst({
    where: { consultation: { idPatient: fanta.id, motifPrincipal: DEMO.livraison.motif }, commande: { isNot: null } },
    select: { commande: { select: { id: true } } },
  });
  let aLivrer = await ordonnanceALivrer();
  if (!aLivrer?.commande) {
    const consultation = await prisma.consultation.findFirst({
      where: { idPatient: fanta.id, motifPrincipal: DEMO.livraison.motif }, select: { id: true },
    });
    const produit = await prisma.medicament.findFirstOrThrow({
      where: { libelle: DEMO.medicaments[0].libelle }, select: { id: true, libelle: true, prixUnitaireGnf: true },
    });
    const dansTroisMois = new Date();
    dansTroisMois.setMonth(dansTroisMois.getMonth() + 3);
    const idConsultation = consultation?.id ?? (await prisma.consultation.create({
      data: { idPatient: fanta.id, motifPrincipal: DEMO.livraison.motif, statut: 'TERMINEE' },
      select: { id: true },
    })).id;
    const ordonnance = await prisma.ordonnance.create({
      data: {
        numero: await prochainNumero('OR'),
        codeVerification: randomBytes(6).toString('hex').toUpperCase(),
        valideJusquau: dansTroisMois,
        idConsultation,
        signePar: ids.idMedecin,
        signeLe: new Date(),
        lignes: {
          create: [{
            idMedicament: produit.id, posologie: '1 comprimé le soir', frequence: '1 fois par jour',
            dureeJours: 30, quantite: 3,
          }],
        },
      },
      select: { id: true, lignes: { select: { id: true, quantite: true } } },
    });
    const ligne = ordonnance.lignes[0];
    const maintenant = new Date();
    // Une seule ecriture : le total et ses lignes arrivent ensemble, comme la
    // garde de la base l'exige au commit.
    await prisma.commande.create({
      data: {
        numero: await prochainNumero('CM'),
        idOrdonnance: ordonnance.id,
        idPharmacie: ids.idPharmacie,
        statut: 'PRETE_POUR_LIVRAISON',
        modeRemise: 'LIVRAISON',
        quartierRecherche: QUARTIER,
        communeRecherche: COMMUNE,
        prefectureRecherche: PREFECTURE,
        priseEnChargeLe: maintenant,
        chiffreeLe: maintenant,
        preteLe: maintenant,
        montantTotalGnf: ligne.quantite * produit.prixUnitaireGnf,
        lignes: {
          create: [{
            libelle: produit.libelle, quantite: ligne.quantite, prixUnitaireGnf: produit.prixUnitaireGnf,
            montantGnf: ligne.quantite * produit.prixUnitaireGnf,
            idLigneOrdonnance: ligne.id, idMedicament: produit.id,
          }],
        },
      },
    });
    aLivrer = await ordonnanceALivrer();
  }
  const idCommande = aLivrer!.commande!.id;
  // Rejouee, la course repart en appel d'offres : les offres d'un passage
  // precedent partent avec elle.
  await prisma.course.deleteMany({ where: { idCommande } });
  await prisma.commande.update({
    where: { id: idCommande },
    // La zone est refixee : une commande creee avant la commune la recoit ici.
    data: {
      statut: 'PRETE_POUR_LIVRAISON', remiseLe: null, clotureeLe: null,
      quartierRecherche: QUARTIER, communeRecherche: COMMUNE, prefectureRecherche: PREFECTURE,
    },
  });
  // Le client de l'application, pas celui du script : c'est le type de
  // transaction qu'attend le service, avec le chiffrement des champs.
  const course = await prismaApplication.$transaction((tx) => ouvrirCourse(idCommande, tx));
  console.log(`   Course ${course.id} en appel d offres a ${COMMUNE}, pour le livreur ${DEMO.livreur.telephone}`);
}

/**
 * La quantite d'un stock est la somme de ses lots. Rien dans le schema ne
 * l'impose, et une semence qui l'oublie laisse une pharmacie incapable de
 * delivrer tout en affichant du stock. On echoue ici plutot qu'au milieu
 * d'une demonstration.
 */
async function verifierInvariantDesLots() {
  const stocks = await prisma.stock.findMany({ include: { lots: true } });
  const ecarts = stocks
    .map((s) => ({ id: s.id, quantite: s.quantite, lots: s.lots.reduce((t, l) => t + l.quantite, 0) }))
    .filter((e) => e.quantite !== e.lots);
  if (ecarts.length > 0) {
    throw new Error(
      'Stock sans lots ou lots incoherents : ' +
        ecarts.map((e) => `${e.id} (quantite=${e.quantite}, lots=${e.lots})`).join(', ')
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
