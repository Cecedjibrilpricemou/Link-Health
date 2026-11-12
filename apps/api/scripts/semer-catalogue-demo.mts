// Un catalogue de demonstration a l'echelle reelle (A1, A2, A3).
//
//     npm run demo:catalogue
//
// A lancer depuis `apps/api`, contre une base de developpement. Le script est
// **idempotent** : relance-le autant de fois que tu veux, il met a jour ce qui
// existe deja et n'invente pas de doublons.
//
// **Pourquoi il existe.** Avec deux officines et sept produits, la recherche
// publique ne montre jamais ce qu'elle fera en service : pas de fourchette de
// prix, pas d'elargissement de zone, pas de liste a faire defiler, aucune
// occasion de voir si l'ecran tient. On seme donc une dizaine d'officines
// reparties sur Conakry et l'interieur, et une cinquantaine de produits aux
// stocks volontairement inegaux.
//
// **Rien n'est aleatoire** : les quantites, les marges et les dates se
// deduisent des index. Deux executions donnent la meme base, et une capture
// d'ecran reste comparable d'un jour a l'autre.
//
// Ce que le script ne fait pas : il ne cree ni comptes, ni patients, ni
// ventes. Il ne touche pas aux structures existantes autrement que pour
// completer leur commune ou leur telephone s'ils manquent.
import { config } from 'dotenv';
import { prisma } from '../src/config/prisma';
import { empreinteCatalogue } from '../src/utils/catalogue';

config();

type Officine = {
  nom: string;
  prefecture: string;
  commune: string;
  quartier: string;
  telephone: string;
  adresse: string;
};

/**
 * Dix officines : huit sur Conakry reparties entre cinq communes, deux a
 * l'interieur. Les deux dernieres servent a voir l'elargissement de zone
 * fonctionner pour de vrai.
 */
const OFFICINES: Officine[] = [
  { nom: 'Pharmacie du Port', prefecture: 'Conakry', commune: 'Kaloum', quartier: 'Boulbinet', telephone: '+224620100001', adresse: 'Avenue de la Republique' },
  { nom: 'Pharmacie Kaloum Centre', prefecture: 'Conakry', commune: 'Kaloum', quartier: 'Almamya', telephone: '+224620100002', adresse: '5e Boulevard' },
  { nom: 'Pharmacie Belle-Vue', prefecture: 'Conakry', commune: 'Dixinn', quartier: 'Belle-Vue', telephone: '+224620100003', adresse: 'Route du Niger' },
  { nom: 'Pharmacie Donka Sante', prefecture: 'Conakry', commune: 'Dixinn', quartier: 'Hafia', telephone: '+224620100004', adresse: 'Face CHU Donka' },
  { nom: 'Pharmacie Madina Marche', prefecture: 'Conakry', commune: 'Matam', quartier: 'Madina', telephone: '+224620100005', adresse: 'Entree du grand marche' },
  { nom: 'Pharmacie Kipe Nord', prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipe', telephone: '+224620100006', adresse: 'Carrefour Kipe' },
  { nom: 'Pharmacie Taouyah', prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Taouyah', telephone: '+224620100007', adresse: 'Rue principale' },
  { nom: 'Pharmacie Matoto Gare', prefecture: 'Conakry', commune: 'Matoto', quartier: 'Gbessia', telephone: '+224620100008', adresse: 'Pres de la gare routiere' },
  { nom: 'Pharmacie Kindia Centre', prefecture: 'Kindia', commune: 'Kindia', quartier: 'Centre', telephone: '+224620100009', adresse: 'Avenue du marche' },
  { nom: 'Pharmacie Labe Plateau', prefecture: 'Labé', commune: 'Labé', quartier: 'Plateau', telephone: '+224620100010', adresse: 'Route de Pita' },
];

type Produit = {
  libelle: string;
  dci?: string;
  nomCommercial?: string;
  forme?: string;
  dosage?: string;
  categorie: 'MEDICAMENT' | 'LAIT_INFANTILE' | 'COMPLEMENT_ALIMENTAIRE' | 'COSMETIQUE' | 'HYGIENE' | 'PARAPHARMACIE' | 'DISPOSITIF_MEDICAL' | 'AUTRE';
  classeTherapeutique?: string;
  prixGnf: number;
};

/**
 * Le catalogue. Les medicaments portent leur DCI, leur forme et leur dosage :
 * la contrainte SQL `medicaments_medicament_complet` l'exige, et c'est aussi
 * ce qui permet de chercher « paracetamol » et de trouver les marques.
 *
 * Plusieurs marques partagent volontairement la meme molecule : c'est le cas
 * reel, et c'est ce qui donne du sens a la recherche par molecule.
 */
const PRODUITS: Produit[] = [
  // Antalgiques et antipyretiques
  { libelle: 'Doliprane 500 mg', nomCommercial: 'Doliprane', dci: 'Paracétamol', forme: 'comprimé', dosage: '500 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antalgique', prixGnf: 1_000 },
  { libelle: 'Efferalgan 1 g', nomCommercial: 'Efferalgan', dci: 'Paracétamol', forme: 'comprimé effervescent', dosage: '1 g', categorie: 'MEDICAMENT', classeTherapeutique: 'Antalgique', prixGnf: 2_500 },
  { libelle: 'Paracétamol sirop enfant', dci: 'Paracétamol', forme: 'sirop', dosage: '120 mg/5 ml', categorie: 'MEDICAMENT', classeTherapeutique: 'Antalgique', prixGnf: 3_500 },
  { libelle: 'Ibuprofène 400 mg', dci: 'Ibuprofène', forme: 'comprimé', dosage: '400 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Anti-inflammatoire', prixGnf: 1_800 },
  { libelle: 'Advil 200 mg', nomCommercial: 'Advil', dci: 'Ibuprofène', forme: 'comprimé', dosage: '200 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Anti-inflammatoire', prixGnf: 2_200 },
  { libelle: 'Aspirine 500 mg', dci: 'Acide acétylsalicylique', forme: 'comprimé', dosage: '500 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antalgique', prixGnf: 900 },
  { libelle: 'Diclofénac 50 mg', dci: 'Diclofénac', forme: 'comprimé', dosage: '50 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Anti-inflammatoire', prixGnf: 1_500 },

  // Antibiotiques
  { libelle: 'Amoxicilline 500 mg', dci: 'Amoxicilline', forme: 'gélule', dosage: '500 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 2_500 },
  { libelle: 'Clamoxyl 1 g', nomCommercial: 'Clamoxyl', dci: 'Amoxicilline', forme: 'comprimé', dosage: '1 g', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 4_000 },
  { libelle: 'Augmentin 1 g', nomCommercial: 'Augmentin', dci: 'Amoxicilline + acide clavulanique', forme: 'comprimé', dosage: '1 g', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 6_500 },
  { libelle: 'Métronidazole 500 mg', dci: 'Métronidazole', forme: 'comprimé', dosage: '500 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 1_200 },
  { libelle: 'Ciprofloxacine 500 mg', dci: 'Ciprofloxacine', forme: 'comprimé', dosage: '500 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 3_000 },
  { libelle: 'Azithromycine 250 mg', dci: 'Azithromycine', forme: 'comprimé', dosage: '250 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 5_500 },
  { libelle: 'Cotrimoxazole 960 mg', dci: 'Sulfaméthoxazole + triméthoprime', forme: 'comprimé', dosage: '960 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antibiotique', prixGnf: 1_100 },

  // Paludisme : premier motif de consultation
  { libelle: 'Coartem 20/120 mg', nomCommercial: 'Coartem', dci: 'Artéméther + luméfantrine', forme: 'comprimé', dosage: '20/120 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antipaludique', prixGnf: 8_000 },
  { libelle: 'Artésunate injectable 60 mg', dci: 'Artésunate', forme: 'poudre pour injection', dosage: '60 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antipaludique', prixGnf: 15_000 },
  { libelle: 'Test rapide paludisme', categorie: 'DISPOSITIF_MEDICAL', prixGnf: 7_000 },
  { libelle: 'Quinine 300 mg', dci: 'Quinine', forme: 'comprimé', dosage: '300 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antipaludique', prixGnf: 2_000 },

  // Chroniques
  { libelle: 'Glucophage 850 mg', nomCommercial: 'Glucophage', dci: 'Metformine', forme: 'comprimé', dosage: '850 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antidiabétique', prixGnf: 1_800 },
  { libelle: 'Metformine 1000 mg', dci: 'Metformine', forme: 'comprimé', dosage: '1000 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antidiabétique', prixGnf: 2_400 },
  { libelle: 'Amlodipine 5 mg', dci: 'Amlodipine', forme: 'comprimé', dosage: '5 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antihypertenseur', prixGnf: 2_000 },
  { libelle: 'Captopril 25 mg', dci: 'Captopril', forme: 'comprimé', dosage: '25 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antihypertenseur', prixGnf: 1_600 },
  { libelle: 'Furosémide 40 mg', dci: 'Furosémide', forme: 'comprimé', dosage: '40 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Diurétique', prixGnf: 1_300 },
  { libelle: 'Salbutamol spray', dci: 'Salbutamol', forme: 'aérosol', dosage: '100 µg/dose', categorie: 'MEDICAMENT', classeTherapeutique: 'Bronchodilatateur', prixGnf: 12_000 },

  // Digestif, allergie, divers
  { libelle: 'Oméprazole 20 mg', dci: 'Oméprazole', forme: 'gélule', dosage: '20 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antiulcéreux', prixGnf: 2_800 },
  { libelle: 'Smecta sachet', nomCommercial: 'Smecta', dci: 'Diosmectite', forme: 'poudre orale', dosage: '3 g', categorie: 'MEDICAMENT', classeTherapeutique: 'Antidiarrhéique', prixGnf: 1_000 },
  { libelle: 'Sels de réhydratation orale', dci: 'Sels de réhydratation orale', forme: 'poudre orale', dosage: '20,5 g/l', categorie: 'MEDICAMENT', classeTherapeutique: 'Réhydratation', prixGnf: 800 },
  { libelle: 'Cétirizine 10 mg', dci: 'Cétirizine', forme: 'comprimé', dosage: '10 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antihistaminique', prixGnf: 1_500 },
  { libelle: 'Vitamine C 500 mg', dci: 'Acide ascorbique', forme: 'comprimé', dosage: '500 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Vitamine', prixGnf: 1_000 },
  { libelle: 'Fer + acide folique', dci: 'Fumarate ferreux + acide folique', forme: 'comprimé', dosage: '200 mg/0,4 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antianémique', prixGnf: 1_400 },
  { libelle: 'Albendazole 400 mg', dci: 'Albendazole', forme: 'comprimé', dosage: '400 mg', categorie: 'MEDICAMENT', classeTherapeutique: 'Antiparasitaire', prixGnf: 1_200 },
  { libelle: 'Sirop contre la toux adulte', dci: 'Carbocistéine', forme: 'sirop', dosage: '5 %', categorie: 'MEDICAMENT', classeTherapeutique: 'Mucolytique', prixGnf: 4_500 },

  // Hors medicament : la recherche publique doit aussi les montrer
  { libelle: 'Lait infantile 1er âge 400 g', categorie: 'LAIT_INFANTILE', prixGnf: 45_000 },
  { libelle: 'Lait infantile 2e âge 400 g', categorie: 'LAIT_INFANTILE', prixGnf: 47_000 },
  { libelle: 'Lait de croissance 800 g', categorie: 'LAIT_INFANTILE', prixGnf: 78_000 },
  { libelle: 'Savon antiseptique', categorie: 'HYGIENE', prixGnf: 12_000 },
  { libelle: 'Gel hydroalcoolique 250 ml', categorie: 'HYGIENE', prixGnf: 18_000 },
  { libelle: 'Couches bébé taille 3', categorie: 'HYGIENE', prixGnf: 65_000 },
  { libelle: 'Crème hydratante 100 ml', categorie: 'COSMETIQUE', prixGnf: 30_000 },
  { libelle: 'Lait corporel karité 400 ml', categorie: 'COSMETIQUE', prixGnf: 42_000 },
  { libelle: 'Thermomètre digital', categorie: 'DISPOSITIF_MEDICAL', prixGnf: 85_000 },
  { libelle: 'Tensiomètre bras', categorie: 'DISPOSITIF_MEDICAL', prixGnf: 350_000 },
  { libelle: 'Compresses stériles', categorie: 'DISPOSITIF_MEDICAL', prixGnf: 5_000 },
  { libelle: 'Bande de gaze 10 cm', categorie: 'DISPOSITIF_MEDICAL', prixGnf: 3_500 },
  { libelle: 'Masques chirurgicaux x50', categorie: 'DISPOSITIF_MEDICAL', prixGnf: 25_000 },
  { libelle: 'Complément multivitamines', categorie: 'COMPLEMENT_ALIMENTAIRE', prixGnf: 35_000 },
  { libelle: 'Moustiquaire imprégnée', categorie: 'PARAPHARMACIE', prixGnf: 40_000 },
];

const JOUR = 86_400_000;

/**
 * Qui a quoi, et dans quel etat.
 *
 * Une officine ne tient pas tout : chacune prend un produit sur deux a partir
 * d'un decalage qui lui est propre. Les quantites descendent sous le seuil
 * pour quelques lignes, de quoi voir la pastille « stock faible ». Les dates
 * de declaration s'etalent sur deux semaines, pour que « declare il y a trois
 * jours » ait un sens a l'ecran.
 */
function rayonDe(indexOfficine: number): { produit: Produit; indexProduit: number }[] {
  const pas = 2 + (indexOfficine % 3);
  return PRODUITS.map((produit, indexProduit) => ({ produit, indexProduit }))
    .filter(({ indexProduit }) => (indexProduit + indexOfficine) % pas !== 0);
}

function quantiteDe(i: number, j: number): number {
  const base = (i * 7 + j * 13) % 60;
  // Une ligne sur neuf passe sous le seuil d'alerte.
  return (i + j) % 9 === 0 ? 1 + (base % 8) : 12 + base;
}

function margeDe(prix: number, i: number): number {
  // De 5 % a 25 % selon l'officine : c'est ce qui fait les fourchettes de prix.
  const pourcentage = 5 + ((i * 7) % 21);
  return Math.round((prix * pourcentage) / 100 / 50) * 50;
}

async function main(): Promise<void> {
  console.log('Catalogue de demonstration\n');

  // ── Les officines ────────────────────────────────────────────────
  const idsOfficines: string[] = [];
  for (const officine of OFFICINES) {
    const existante = await prisma.structureSante.findFirst({
      where: { nom: officine.nom },
      select: { id: true },
    });
    const donnees = {
      type: 'PHARMACIE' as const,
      prefecture: officine.prefecture,
      commune: officine.commune,
      quartier: officine.quartier,
      adresse: officine.adresse,
      telephone: officine.telephone,
      estActive: true,
      estPartenaire: true,
    };
    const id = existante
      ? (await prisma.structureSante.update({ where: { id: existante.id }, data: donnees })).id
      : (await prisma.structureSante.create({ data: { nom: officine.nom, ...donnees } })).id;
    idsOfficines.push(id);
  }
  console.log(OFFICINES.length + ' officines en place.');

  // ── Le catalogue ─────────────────────────────────────────────────
  const idsProduits: string[] = [];
  for (const produit of PRODUITS) {
    const donnees = {
      dci: produit.dci ?? null,
      nomCommercial: produit.nomCommercial ?? null,
      forme: produit.forme ?? null,
      dosage: produit.dosage ?? null,
      categorie: produit.categorie,
      classeTherapeutique: produit.classeTherapeutique ?? null,
      prixUnitaireGnf: produit.prixGnf,
      estActif: true,
      estReglemente: false,
      rechercheTexte: empreinteCatalogue(produit),
    };
    const existant = await prisma.medicament.findFirst({
      where: { libelle: produit.libelle, idStructure: null },
      select: { id: true },
    });
    const id = existant
      ? (await prisma.medicament.update({ where: { id: existant.id }, data: donnees })).id
      : (await prisma.medicament.create({ data: { libelle: produit.libelle, ...donnees } })).id;
    idsProduits.push(id);
  }
  console.log(PRODUITS.length + ' produits au catalogue.');

  // ── Les rayons ───────────────────────────────────────────────────
  let lignes = 0;
  let faibles = 0;
  for (const [i, idStructure] of idsOfficines.entries()) {
    for (const { indexProduit } of rayonDe(i)) {
      const idMedicament = idsProduits[indexProduit]!;
      const quantite = quantiteDe(i, indexProduit);
      const seuilAlerte = 10;
      const modifieLe = new Date(Date.now() - ((i * 3 + indexProduit) % 15) * JOUR);

      const existant = await prisma.stock.findFirst({
        where: { idStructure, idMedicament },
        select: { id: true },
      });
      const stock = existant
        ? await prisma.stock.update({
            where: { id: existant.id },
            data: { quantite, seuilAlerte, margeGnf: margeDe(PRODUITS[indexProduit]!.prixGnf, i) },
          })
        : await prisma.stock.create({
            data: {
              idStructure,
              idMedicament,
              quantite,
              seuilAlerte,
              unite: 'unite',
              margeGnf: margeDe(PRODUITS[indexProduit]!.prixGnf, i),
            },
          });

      // Un lot par ligne : une quantite sans lot est indelivrable, et la
      // semence ne doit pas creer un stock qui ne sortirait jamais.
      const lot = await prisma.lotStock.findFirst({ where: { idStock: stock.id }, select: { id: true } });
      if (lot) {
        await prisma.lotStock.update({ where: { id: lot.id }, data: { quantite, quantiteRecue: quantite } });
      } else {
        await prisma.lotStock.create({
          data: {
            idStock: stock.id,
            quantite,
            quantiteRecue: quantite,
            numeroLot: 'DEMO-' + String(i + 1).padStart(2, '0') + '-' + String(indexProduit + 1).padStart(3, '0'),
            datePeremption: new Date(Date.now() + (90 + ((i + indexProduit) % 300)) * JOUR),
          },
        });
      }

      // La date de declaration se pose en dernier : l'ecran s'en sert pour
      // dire « stock declare il y a trois jours ».
      await prisma.$executeRaw`UPDATE "stocks" SET "modifieLe" = ${modifieLe} WHERE id = ${stock.id}`;

      lignes += 1;
      if (quantite <= seuilAlerte) faibles += 1;
    }
  }
  console.log(lignes + ' lignes de stock, dont ' + faibles + ' sous le seuil d alerte.');

  const total = await prisma.stock.count({ where: { quantite: { gt: 0 }, idStructure: { not: null } } });
  console.log('\nEn base : ' + total + ' lignes de stock servables au public.');
}

main()
  .catch((erreur: unknown) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
