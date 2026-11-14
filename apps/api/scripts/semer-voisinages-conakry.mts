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
// **Ce qu'il declare, et ce qu'il ne declare pas.** Uniquement les cinq
// communes historiques de la presqu'ile — Kaloum, Dixinn, Matam, Ratoma,
// Matoto — dont l'enchainement est etabli : Kaloum occupe la pointe, Dixinn
// la suit, Matam et Ratoma se partagent la largeur de la presqu'ile, Matoto
// ferme vers l'est. Les huit communes creees depuis (Gbessia, Kagbelen,
// Kassa, Lambanyi, Maneah, Sanoyah, Sonfonia, Tombolia) ne sont pas
// declarees : leurs limites demandent une connaissance du terrain, et une
// voisine inventee enverrait de vraies commandes au mauvais endroit. Elles se
// saisissent a la main dans Administration > Geographie.
//
// Le service tient le lien dans les deux sens : declarer A voisine de B pose
// aussi B voisine de A.
import { config } from 'dotenv';
import { prisma } from '../src/config/prisma';
import { modifierLieu } from '../src/services/geographie.service';

config();

/** Qui touche qui, sur la presqu'ile. Les noms sont ceux du referentiel. */
const VOISINAGES: Record<string, string[]> = {
  Kaloum: ['Dixinn'],
  Dixinn: ['Kaloum', 'Matam', 'Ratoma'],
  Matam: ['Dixinn', 'Ratoma', 'Matoto'],
  Ratoma: ['Dixinn', 'Matam', 'Matoto'],
  Matoto: ['Matam', 'Ratoma'],
};

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
  console.log('\n' + (apres.length - sans.length) + ' communes sur ' + apres.length + ' ont au moins une voisine.');
  if (sans.length > 0) {
    console.log('A saisir a la main dans Administration > Geographie : ' + sans.join(', '));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
