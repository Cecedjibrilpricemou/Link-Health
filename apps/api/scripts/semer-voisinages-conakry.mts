// Les voisinages des communes historiques de Conakry (M5).
//
//     npm run demo:voisinages
//
// A lancer depuis `apps/api`. Le script est **idempotent** : il declare la
// meme liste a chaque execution.
//
// **Pourquoi il existe.** La recherche publique s'elargit par etapes :
// commune -> communes voisines -> prefecture -> pays. L'etape du milieu lit
// le champ `voisins` du referentiel geographique. Tant qu'aucune commune n'a
// de voisine declaree, cette etape est purement et simplement sautee : le
// code tourne, personne ne s'en apercoit, et un visiteur de Dixinn ne se voit
// jamais proposer une officine de Ratoma avant qu'on elargisse a toute la
// prefecture. Ce script remplit ce champ.
//
// **D'ou vient chaque voisinage.** Rien ici n'est devine, et la provenance
// est notee a cote de chaque ligne :
//
//   - la presqu'ile historique (Kaloum, Dixinn, Matam, Ratoma, Matoto) suit
//     son enchainement connu : Kaloum a la pointe, Dixinn ensuite, Matam et
//     Ratoma se partageant la largeur, Matoto fermant vers l'est ;
//   - le redecoupage de 2023 a scinde Ratoma et Matoto. Une commune detachee
//     d'une autre la touche forcement : Lambanyi et Sonfonia tiennent a
//     Ratoma, Gbessia et Tombolia a Matoto ;
//   - les trois dernieres viennent du terrain, declarees par le responsable
//     du projet, qui vit a Conakry.
//
// **Kassa n'a aucune voisine, volontairement.** C'est une ile, dans les iles
// de Loos. Proposer une officine qu'il faut atteindre en bateau au titre de
// la commune voisine n'aurait aucun sens.
//
// Une voisine manquante fait seulement elargir un peu plus large. Une voisine
// fausse envoie quelqu'un se promener : dans le doute, on n'ecrit pas.
//
// Le service tient le lien dans les deux sens : declarer A voisine de B pose
// aussi B voisine de A. Chaque commune porte donc ici sa liste complete —
// l'ecriture remplace la precedente, et une liste partielle retirerait les
// voisines posees par une autre ligne.
import { config } from 'dotenv';
import { prisma } from '../src/config/prisma';
import { modifierLieu } from '../src/services/geographie.service';

config();

/** Qui touche qui. Les noms sont ceux du referentiel. */
const VOISINAGES: Record<string, string[]> = {
  // La presqu'ile historique.
  Kaloum: ['Dixinn'],
  Dixinn: ['Kaloum', 'Matam', 'Ratoma'],
  Matam: ['Dixinn', 'Ratoma', 'Matoto'],
  Ratoma: ['Dixinn', 'Matam', 'Matoto', 'Lambanyi', 'Sonfonia'],
  Matoto: ['Matam', 'Ratoma', 'Gbessia', 'Tombolia', 'Sanoyah'],
  // Detachees de Ratoma au redecoupage.
  Lambanyi: ['Ratoma'],
  Sonfonia: ['Ratoma', 'Kagbelen'],
  // Detachees de Matoto au redecoupage.
  Gbessia: ['Matoto'],
  Tombolia: ['Matoto'],
  // Declarees depuis le terrain.
  Kagbelen: ['Sonfonia'],
  Sanoyah: ['Matoto', 'Maneah'],
  Maneah: ['Sanoyah'],
  // Kassa : une ile, aucune voisine terrestre. Voir l'entete.
};

/** Les communes dont l'absence de voisine est un choix, pas un oubli. */
const SANS_VOISINE = ['Kassa'];

async function main(): Promise<void> {
  console.log('Voisinages des communes de Conakry\n');

  const communes = await prisma.lieuGeo.findMany({
    where: { niveau: 'commune' },
    select: { id: true, nom: true, voisins: true },
    orderBy: { nom: 'asc' },
  });
  const parNom = new Map(communes.map((c) => [c.nom, c]));

  const absentes = Object.keys(VOISINAGES).filter((nom) => !parNom.has(nom));
  if (absentes.length > 0) {
    console.error('Communes absentes du referentiel : ' + absentes.join(', '));
    console.error('Charge d abord le jeu de depart geographique.');
    process.exitCode = 1;
    return;
  }

  for (const [nom, voisines] of Object.entries(VOISINAGES)) {
    const lieu = parNom.get(nom)!;
    const ids = voisines.map((v) => parNom.get(v)!.id);
    await modifierLieu(lieu.id, { voisins: ids });
    console.log('  ' + nom.padEnd(10) + ' -> ' + voisines.join(', '));
  }

  const apres = await prisma.lieuGeo.findMany({
    where: { niveau: 'commune' },
    select: { nom: true, voisins: true },
    orderBy: { nom: 'asc' },
  });
  const sans = apres.filter((c) => c.voisins.length === 0).map((c) => c.nom);
  const voulues = sans.filter((nom) => SANS_VOISINE.includes(nom));
  const oubliees = sans.filter((nom) => !SANS_VOISINE.includes(nom));
  console.log('\n' + (apres.length - sans.length) + ' communes sur ' + apres.length + ' ont au moins une voisine.');
  if (voulues.length > 0) {
    console.log('Sans voisine a dessein (voir l entete) : ' + voulues.join(', '));
  }
  if (oubliees.length > 0) {
    console.log('A saisir a la main dans Administration > Geographie : ' + oubliees.join(', '));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
