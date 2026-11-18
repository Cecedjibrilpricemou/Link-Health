// Jeu de donnees des tests end-to-end (apps/web/e2e). Idempotent : chaque
// entree est identifiee par une cle stable et peut etre rejouee sur une base
// deja peuplee. Reserve aux bases jetables (CI, docker local) — les comptes
// ont un mot de passe connu.
import 'dotenv/config';
import { PrismaClient, Role, TypeStructure } from '../src/config/generated/client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hashPassword } from '../src/utils/password.utils.js';
import { empreinteCatalogue } from '../src/utils/catalogue.js';
import { seedExamens } from './seed-examens.js';

export const E2E = {
  motDePasse: 'E2e-Password-123',
  prefecture: 'Kindia',
  centre: { nom: 'Centre de sante e2e', telephone: '+224600100001' },
  pharmacie: { nom: 'Pharmacie e2e', telephone: '+224600100002' },
  pharmacieAutre: { nom: 'Pharmacie e2e autre', telephone: '+224600100004' },
  laboratoire: { nom: 'Laboratoire e2e', telephone: '+224600100003' },
  asc: { email: 'asc.e2e@baobao.test', telephone: '690000001', prenom: 'Mamadou', nom: 'Bah' },
  medecin: { email: 'medecin.e2e@baobao.test', telephone: '690000002', prenom: 'Fatoumata', nom: 'Camara' },
  pharmacien: { email: 'pharma.e2e@baobao.test', telephone: '690000003', prenom: 'Ibrahima', nom: 'Sow' },
  titulaireAutre: { email: 'titulaire.autre.e2e@baobao.test', telephone: '690000007', prenom: 'Mariam', nom: 'Diallo' },
  adminStructure: { email: 'admin.centre.e2e@baobao.test', telephone: '690000004', prenom: 'Aissatou', nom: 'Barry' },
  accueil: { email: 'accueil.e2e@baobao.test', telephone: '690000005', prenom: 'Kadiatou', nom: 'Toure' },
  laborantin2: { email: 'biologiste.e2e@baobao.test', telephone: '690000006', prenom: 'Sekou', nom: 'Camara' },
  patient: { telephone: '690000010', prenom: 'Awa', nom: 'Diallo', qrCode: 'E2E-QR-AWA-0001' },
  medicament: { libelle: 'Doliprane e2e 500mg', dci: 'Paracetamol', nomCommercial: 'Doliprane e2e', forme: 'comprime', dosage: '500mg', prixUnitaireGnf: 1000, codeAtc: 'N02BE01' },
  // Molecule a laquelle la patiente se declare allergique : elle sert a
  // verifier que l'alerte de prescription (EF-05-05) arrive a l'ecran.
  allergene: { libelle: 'Clamoxyl e2e 500mg', dci: 'Amoxicilline', nomCommercial: 'Clamoxyl e2e', forme: 'gelule', dosage: '500mg', prixUnitaireGnf: 2500, codeAtc: 'J01CA04' },
  // Produit a circuit reglemente (EF-05-12) : ni renouvelable, validite
  // reduite, signature d'un medecin exigee.
  reglemente: { libelle: 'Morphine e2e 10mg', dci: 'Morphine', nomCommercial: 'Morphine e2e', forme: 'ampoule', dosage: '10mg', prixUnitaireGnf: 8000, codeAtc: 'N02AA01', estReglemente: true },
} as const;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function upsertStructure(
  nom: string,
  type: TypeStructure,
  telephone: string,
  estPartenaire?: boolean,
) {
  const existante = await prisma.structureSante.findFirst({ where: { nom } });
  if (existante) {
    if (estPartenaire === undefined) return existante;
    return prisma.structureSante.update({
      where: { id: existante.id },
      data: { estPartenaire },
    });
  }
  return prisma.structureSante.create({
    data: {
      nom, type, prefecture: E2E.prefecture, telephone, estActive: true,
      ...(estPartenaire === undefined ? {} : { estPartenaire }),
    },
  });
}

async function upsertUtilisateur(
  u: { email?: string; telephone: string; prenom: string; nom: string },
  role: Role,
  motDePasseHash: string,
  idStructure: string | null,
) {
  return prisma.utilisateur.upsert({
    where: { telephone: u.telephone },
    update: { estActif: true, idStructure, motDePasseHash },
    create: {
      telephone: u.telephone,
      email: u.email ?? null,
      motDePasseHash,
      prenom: u.prenom,
      nom: u.nom,
      role,
      idStructure,
    },
  });
}

async function main() {
  console.log('Seed e2e — structures, comptes ASC / medecin / pharmacien, patient, medicament, stock...');

  const motDePasseHash = await hashPassword(E2E.motDePasse);

  const centre = await upsertStructure(E2E.centre.nom, TypeStructure.CENTRE, E2E.centre.telephone);
  const pharmacie = await upsertStructure(
    E2E.pharmacie.nom, TypeStructure.PHARMACIE, E2E.pharmacie.telephone, true,
  );
  const pharmacieAutre = await upsertStructure(
    E2E.pharmacieAutre.nom,
    TypeStructure.PHARMACIE,
    E2E.pharmacieAutre.telephone,
    true,
  );
  const laboratoire = await upsertStructure(E2E.laboratoire.nom, TypeStructure.LABORATOIRE, E2E.laboratoire.telephone);
  await seedExamens(prisma);

  const asc = await upsertUtilisateur(E2E.asc, Role.ASC, motDePasseHash, centre.id);
  const ascProfile = await prisma.ascProfile.upsert({
    where: { idUtilisateur: asc.id },
    update: { idStructure: centre.id },
    create: { idUtilisateur: asc.id, idStructure: centre.id, numeroCertification: 'E2E-ASC-001' },
  });

  const medecin = await upsertUtilisateur(E2E.medecin, Role.MEDECIN, motDePasseHash, centre.id);
  await prisma.medecinProfile.upsert({
    where: { idUtilisateur: medecin.id },
    update: { idStructure: centre.id },
    create: { idUtilisateur: medecin.id, idStructure: centre.id, specialite: 'Medecine generale' },
  });

  // Administre le centre : voit ses agents (ASC + medecin) et ses statistiques.
  await upsertUtilisateur(E2E.adminStructure, Role.ADMIN_STRUCTURE, motDePasseHash, centre.id);

  // Accueil du centre : admission, episodes, demandes d'analyse (P1).
  await upsertUtilisateur(E2E.accueil, Role.AGENT_ACCUEIL, motDePasseHash, centre.id);
  // Second laborantin : prelevement, resultats, validation (P2). Le role de
  // biologiste a ete supprime le 2026-09-30 (addendum, point 4).
  await upsertUtilisateur(E2E.laborantin2, Role.TECHNICIEN_LABO, motDePasseHash, laboratoire.id);

  const pharmacien = await upsertUtilisateur(E2E.pharmacien, Role.PHARMACIEN, motDePasseHash, pharmacie.id);
  await prisma.pharmacienProfile.upsert({
    where: { idUtilisateur: pharmacien.id },
    update: { idStructure: pharmacie.id, estResponsable: true, roleOfficine: 'TITULAIRE' },
    create: { idUtilisateur: pharmacien.id, idStructure: pharmacie.id, estResponsable: true, roleOfficine: 'TITULAIRE' },
  });

  const titulaireAutre = await upsertUtilisateur(
    E2E.titulaireAutre,
    Role.PHARMACIEN,
    motDePasseHash,
    pharmacieAutre.id,
  );
  await prisma.pharmacienProfile.upsert({
    where: { idUtilisateur: titulaireAutre.id },
    update: { idStructure: pharmacieAutre.id, estResponsable: true, roleOfficine: 'TITULAIRE' },
    create: {
      idUtilisateur: titulaireAutre.id,
      idStructure: pharmacieAutre.id,
      estResponsable: true,
      roleOfficine: 'TITULAIRE',
    },
  });

  // Un ASC ne voit que ses patients (access-control.service) : Awa est sa
  // patiente attitree, rattachee au centre.
  const patientUser = await upsertUtilisateur(E2E.patient, Role.PATIENT, motDePasseHash, null);
  const rattachement = { idAscPrincipal: ascProfile.id, idStructurePreferee: centre.id };
  await prisma.patientProfile.upsert({
    where: { idUtilisateur: patientUser.id },
    update: {
      qrCode: E2E.patient.qrCode, prefecture: E2E.prefecture,
      allergies: [E2E.allergene.dci],
      ...rattachement,
    },
    create: {
      idUtilisateur: patientUser.id,
      qrCode: E2E.patient.qrCode,
      dateNaissance: new Date('1990-05-01'),
      sexe: 'F',
      prefecture: E2E.prefecture,
      allergies: [E2E.allergene.dci],
      maladiesChroniques: [],
      ...rattachement,
    },
  });

  let medicament = await prisma.medicament.findFirst({ where: { nomCommercial: E2E.medicament.nomCommercial } });
  if (!medicament) {
    medicament = await prisma.medicament.create({
      data: { ...E2E.medicament, listeEssentielle: true, rechercheTexte: empreinteCatalogue(E2E.medicament) },
    });
  }

  const allergene = await prisma.medicament.findFirst({ where: { nomCommercial: E2E.allergene.nomCommercial } });
  if (!allergene) {
    await prisma.medicament.create({
      data: { ...E2E.allergene, listeEssentielle: false, rechercheTexte: empreinteCatalogue(E2E.allergene) },
    });
  }

  const reglemente = await prisma.medicament.findFirst({ where: { nomCommercial: E2E.reglemente.nomCommercial } });
  if (!reglemente) {
    await prisma.medicament.create({
      data: { ...E2E.reglemente, listeEssentielle: false, rechercheTexte: empreinteCatalogue(E2E.reglemente) },
    });
  }

  // La pharmacie doit avoir du stock pour delivrer ; l'ASC n'en a pas encore
  // (le test d'ajout de stock le cree).
  //
  // Le stock seul ne suffit plus depuis le 2026-09-30 : la sortie se fait par
  // lots, au plus proche de la peremption. Une quantite sans lot est
  // indelivrable — et c'est ainsi que la delivrance e2e a casse.
  const stockPharmacie = await prisma.stock.upsert({
    where: { idStructure_idMedicament: { idStructure: pharmacie.id, idMedicament: medicament.id } },
    update: { quantite: 500 },
    create: { idStructure: pharmacie.id, idMedicament: medicament.id, quantite: 500, unite: 'boite', seuilAlerte: 10 },
  });

  // Semence rejouable : on repart d'un lot unique plutot que d'en empiler un
  // de plus a chaque execution, sinon la somme des lots quitte la quantite.
  await prisma.lotStock.deleteMany({ where: { idStock: stockPharmacie.id } });
  await prisma.lotStock.create({
    data: {
      idStock: stockPharmacie.id,
      numeroLot: 'E2E-LOT-001',
      quantite: 500,
      quantiteRecue: 500,
      datePeremption: new Date(Date.now() + 540 * 86_400_000),
    },
  });

  await verifierInvariantDesLots();

  console.log('Seed e2e termine.');
}

/**
 * La quantite d'un stock est la somme de ses lots. Rien dans le schema ne
 * l'impose, et une semence qui l'oublie laisse une pharmacie incapable de
 * delivrer tout en affichant du stock. On echoue ici plutot qu'au milieu
 * d'un parcours.
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
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
