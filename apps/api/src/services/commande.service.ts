// src/services/commande.service.ts
// P6 / EF-07 — appel aux pharmacies du quartier et attribution de la commande.
// Processus complet : docs/PARCOURS-COMMANDE-LIVRAISON.md
//
// Le principe retenu avec le porteur du projet : dès l'ordonnance prête, les
// pharmacies **partenaires du quartier du patient** sont interrogées sur un
// point unique — détenez-vous la totalité des produits ? La première qui
// répond oui prend la commande, et les autres perdent la main.
//
// « La première » impose une attribution atomique : deux pharmacies qui
// répondent à la même seconde ne doivent pas croire toutes deux avoir gagné.
// Le verrou est porté par `Commande.idPharmacie` et pris par un `updateMany`
// conditionnel — celui qui obtient `count === 1` a la commande, les autres
// obtiennent 0 et l'apprennent immédiatement.
import {
  ModeRemise,
  Prisma,
  Role,
  StatutCommande,
  StatutCourse,
  StatutOrdonnance,
} from '../config/generated/client/client';
import type { CommandeView, LivreurAttribueView } from '@baobaoheath/shared-types';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { estStructureOfficinale, filtreStructuresOfficinales } from '../utils/officine.util';
import { prochainNumero } from './numero.service';
import {
  CHAMPS_RECHERCHE, filtrePrefecture, filtreZone, memePrefecture, memeZone, zoneDe, zoneDeLaCommande, type Lieu,
} from '../utils/zone';
import { notifierSansBloquer } from './notification.service';
import { assertTransition, transitionPermise } from './commande.transitions';
import { voisinsDe } from './geographie.service';
export { assertTransition, transitionPermise } from './commande.transitions';
import { notifierLivreursCourse, ouvrirCourse } from './course.service';

/**
 * Ce qu'une commande montre, et ou s'arrete le partage.
 *
 * **La pharmacie voit le nom du patient et les produits.** Elle va les lui
 * delivrer : elle a besoin des deux. Rien d'autre du dossier ne sort — ni
 * diagnostic, ni motif de consultation, ni antecedent. Un pharmacien n'a pas
 * a savoir pourquoi on soigne quelqu'un pour lui remettre une boite.
 *
 * Jusqu'ici l'API rendait l'objet Prisma complet : ordonnance, consultation
 * et patient imbriques, avec tout ce qu'ils portent.
 */
export function versCommandeView(
  c: CommandeAvecInclude,
  idPharmacieLectrice?: string,
): CommandeView {
  const patient = c.ordonnance.consultation?.patient;
  return {
    id: c.id,
    idCourse: c.courses?.[0]?.id ?? null,
    statutCourse: c.courses?.[0]?.statut ?? null,
    statut: c.statut,
    quartierRecherche: c.quartierRecherche,
    modeRemise: c.modeRemise,
    creeLe: c.creeLe.toISOString(),
    numeroOrdonnance: c.ordonnance.numero,
    patient: {
      id: patient?.utilisateur.id ?? '',
      prenom: patient?.utilisateur.prenom ?? '',
      nom: patient?.utilisateur.nom ?? '',
    },
    // **Le panier chiffre des qu'il existe, la prescription avant.**
    // Avant le chiffrage il n'y a pas de prix : en inventer un depuis le
    // catalogue national serait annoncer un montant que personne ne tiendra.
    lignes: c.lignes.length > 0
      ? c.lignes.map((l) => {
          const prescrite = c.ordonnance.lignes.find((o) => o.id === l.idLigneOrdonnance);
          return {
            id: l.id,
            libelle: l.libelle,
            dosage: prescrite?.medicament.dosage ?? null,
            forme: prescrite?.medicament.forme ?? null,
            quantite: l.quantite,
            posologie: prescrite?.posologie ?? null,
            prixUnitaireGnf: l.prixUnitaireGnf,
            montantGnf: l.montantGnf,
          };
        })
      : c.ordonnance.lignes.map((l) => ({
          id: l.id,
          libelle: l.medicament.libelle,
          dosage: l.medicament.dosage,
          forme: l.medicament.forme,
          quantite: l.quantite,
          posologie: l.posologie,
        })),
    pharmacie: c.pharmacie
      ? { id: c.pharmacie.id, nom: c.pharmacie.nom, quartier: c.pharmacie.quartier }
      : null,
    reponses: c.reponses.map((r) => ({
      idStructure: r.idStructure,
      nom: r.structure.nom,
      aTousLesProduits: r.aTousLesProduits,
      repondueLe: r.repondueLe.toISOString(),
    })),
    montantTotalGnf: c.montantTotalGnf,
    chiffreeLe: c.chiffreeLe?.toISOString() ?? null,
    preteLe: c.preteLe?.toISOString() ?? null,
    remiseLe: c.remiseLe?.toISOString() ?? null,
    clotureeLe: c.clotureeLe?.toISOString() ?? null,
    motifAnnulation: c.motifAnnulation,
    ...(idPharmacieLectrice ? { estLaMienne: c.idPharmacie === idPharmacieLectrice } : {}),
    ...livreurPourLaPharmacie(c, idPharmacieLectrice),
  };
}

const STATUTS_LIVREUR_VISIBLE: StatutCourse[] = [StatutCourse.ATTRIBUEE, StatutCourse.EN_COURS];

/**
 * Le motard qui vient chercher le colis, montre a la pharmacie qui le lui
 * remet : elle verifie que la personne au comptoir est bien celle que le
 * patient a choisie, avant de scanner son QR.
 *
 * Seulement a **cette** pharmacie, et seulement une fois le motard choisi et
 * jusqu'a la livraison. Une officine qui a simplement vu passer l'appel n'a
 * pas a connaitre le visage ni le numero de quelqu'un qui ne viendra pas.
 */
function livreurPourLaPharmacie(
  c: CommandeAvecInclude,
  idPharmacieLectrice?: string,
): { livreur?: LivreurAttribueView } {
  const course = c.courses?.[0];
  const utilisateur = course?.livreur?.utilisateur;
  if (!idPharmacieLectrice || c.idPharmacie !== idPharmacieLectrice) return {};
  if (!course || !STATUTS_LIVREUR_VISIBLE.includes(course.statut) || !utilisateur) return {};
  return {
    livreur: {
      prenom: utilisateur.prenom,
      nom: utilisateur.nom,
      telephone: utilisateur.telephone,
      photoUrl: utilisateur.photoUrl,
    },
  };
}

/** Qui voit tout : la surveillance de la plateforme, pas le soin. */
const ROLES_ADMIN = new Set(['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN']);

const STATUTS_COURSE_TERMINAUX: StatutCourse[] = [StatutCourse.LIVREE, StatutCourse.ANNULEE];

const COMMANDE_INCLUDE = {
  ordonnance: {
    include: {
      lignes: { include: { medicament: true } },
      consultation: {
        include: {
          patient: { include: { utilisateur: { select: { id: true, prenom: true, nom: true } } } },
        },
      },
    },
  },
  lignes: { orderBy: { creeLe: 'asc' } },
  pharmacie: { select: { id: true, nom: true, prefecture: true, commune: true, quartier: true } },
  courses: {
    where: { statut: { notIn: STATUTS_COURSE_TERMINAUX } },
    select: {
      id: true,
      statut: true,
      livreur: {
        select: { utilisateur: { select: { prenom: true, nom: true, telephone: true, photoUrl: true } } },
      },
    },
    take: 1,
  },
  reponses: {
    include: { structure: { select: { id: true, nom: true } } },
    orderBy: { repondueLe: 'asc' },
  },
} as const;

type CommandeAvecInclude = Prisma.CommandeGetPayload<{ include: typeof COMMANDE_INCLUDE }>;

/**
 * Les pharmacies partenaires du quartier du patient.
 *
 * Si le patient n'a pas de quartier renseigné, on ne cherche pas ailleurs :
 * élargir le périmètre est une question ouverte (voir le document de
 * parcours), et deviner reviendrait à solliciter des pharmacies qui n'ont
 * aucune raison d'être concernées.
 */
export async function pharmaciesDeLaZone(lieu: Lieu) {
  // Commande anterieure a la prefecture de recherche : comparee par le seul
  // quartier, comme elle l'a ete a sa creation.
  const ancienne = !(lieu.prefecture ?? '').trim() && (lieu.quartier ?? '').trim();
  if (!ancienne && !zoneDe(lieu)) return [];
  return prisma.structureSante.findMany({
    where: {
      ...filtreStructuresOfficinales(),
      estActive: true,
      estPartenaire: true,
      ...(ancienne
        ? { quartier: { equals: String(lieu.quartier).trim(), mode: 'insensitive' as const } }
        : filtreZone(lieu)),
    },
    select: { id: true, nom: true },
  });
}

/**
 * Lance la recherche d'une pharmacie pour une ordonnance signée.
 *
 * Une ordonnance non signée n'a pas à circuler : elle n'est pas opposable, et
 * aucune pharmacie ne pourrait la servir.
 */
export async function lancerRecherchePharmacie(idOrdonnance: string) {
  const ordonnance = await prisma.ordonnance.findUnique({
    where: { id: idOrdonnance },
    include: {
      commande: { select: { id: true } },
      lignes: { select: { id: true } },
      consultation: {
        select: {
          patient: {
            select: { prefecture: true, commune: true, quartier: true, utilisateur: { select: { id: true } } },
          },
          idMedecinValideur: true,
        },
      },
    },
  });
  if (!ordonnance) throw new NotFoundError('Ordonnance non trouvee');
  if (ordonnance.commande) throw new ConflictError('Une commande existe deja pour cette ordonnance');
  if (!ordonnance.signeLe) throw new ValidationError('Ordonnance non signee : elle ne peut pas circuler');
  if (ordonnance.lignes.length === 0) {
    throw new ValidationError('Ordonnance sans medicament');
  }

  const { prefecture, commune, quartier } = ordonnance.consultation.patient;
  let pharmacies = await pharmaciesDeLaZone({ prefecture, commune, quartier });
  // M1-C puis M5 : aucune partenaire dans la commune, l'appel part d'emblee
  // vers les communes voisines, a defaut vers toute la prefecture, plutot
  // que de renvoyer le patient les mains vides.
  let voisinesLe: Date | null = null;
  let communesVoisines: string[] = [];
  let elargieLe: Date | null = null;
  if (pharmacies.length === 0) {
    const voisines = await voisinsDe(prefecture, commune);
    const chezLesVoisines = await pharmaciesDesCommunes(prefecture, voisines);
    if (chezLesVoisines.length > 0) {
      pharmacies = chezLesVoisines;
      voisinesLe = new Date();
      communesVoisines = voisines.map(cleLieu);
    } else {
      const dansLaPrefecture = await pharmaciesDeLaPrefecture(prefecture);
      if (dansLaPrefecture.length > 0) {
        pharmacies = dansLaPrefecture;
        elargieLe = new Date();
      }
    }
  }

  const commande = await prisma.commande.create({
    data: {
      numero: await prochainNumero('CM'),
      idOrdonnance,
      quartierRecherche: quartier,
      prefectureRecherche: prefecture,
      communeRecherche: commune,
      voisinesLe,
      communesVoisines,
      elargieLe,
      // Aucune pharmacie partenaire dans le quartier : il n'y a personne a
      // interroger. Le resultat est le meme que si nul n'avait repondu — le
      // patient repart avec son ordonnance.
      statut: pharmacies.length === 0 ? StatutCommande.SANS_PHARMACIE : StatutCommande.RECHERCHE_PHARMACIE,
    },
  });

  if (pharmacies.length === 0) {
    await avertirIndisponibilite(commande.id, 'refus');
    return getCommande(commande.id);
  }

  await appelerPharmacies(pharmacies.map((p) => p.id), ordonnance.numero, commande, voisinesLe !== null || elargieLe !== null);
  return getCommande(commande.id);
}

/**
 * Previent les pharmaciens des structures appelees.
 *
 * **On notifie les pharmaciens, pas les pharmacies.** `idUtilisateur`
 * recevait jusqu'ici l'identifiant de la **structure** : la cle etrangere
 * refusait, `notifierSansBloquer` avalait l'erreur, et aucune officine n'a
 * jamais ete prevenue d'un appel. Le defaut ne se voyait pas parce que
 * l'ecran du comptoir finit par montrer l'appel de toute facon — encore
 * faut-il que quelqu'un pense a le regarder.
 */
async function appelerPharmacies(
  idsStructures: string[],
  numeroOrdonnance: string,
  commande: { id: string; numero: string },
  elargi: boolean,
) {
  if (idsStructures.length === 0) return;
  const pharmaciens = await prisma.utilisateur.findMany({
    where: {
      role: Role.PHARMACIEN,
      estActif: true,
      idStructure: { in: idsStructures },
    },
    select: { id: true },
  });

  await Promise.all(
    pharmaciens.map((u) =>
      notifierSansBloquer({
        idUtilisateur: u.id,
        type: 'COMMANDE_A_SERVIR',
        titre: 'Nouvelle ordonnance a servir',
        contenu: elargi
          ? `Ordonnance ${numeroOrdonnance} — aucune pharmacie de sa commune ne l'a servie : disposez-vous de tous les produits ?`
          : `Ordonnance ${numeroOrdonnance} — disposez-vous de tous les produits ?`,
        lienAction: '/pharmacien/commandes',
        metadonnees: { idCommande: commande.id, numero: commande.numero },
      })
    )
  );
}

/** Les partenaires actives de toute une prefecture (appel elargi, M5). */
export async function pharmaciesDeLaPrefecture(prefecture: string | null | undefined) {
  if (!(prefecture ?? '').trim()) return [];
  return prisma.structureSante.findMany({
    where: {
      ...filtreStructuresOfficinales(),
      estActive: true,
      estPartenaire: true,
      ...filtrePrefecture(prefecture),
    },
    select: { id: true, nom: true },
  });
}

/**
 * M1-C : les partenaires actives de communes nommees, dans une prefecture.
 * La comparaison ignore la casse : les communes des pharmacies sont du texte
 * saisi, les voisines viennent du referentiel.
 */
export async function pharmaciesDesCommunes(prefecture: string | null | undefined, communes: string[]) {
  if (!(prefecture ?? '').trim() || communes.length === 0) return [];
  return prisma.structureSante.findMany({
    where: {
      ...filtreStructuresOfficinales(),
      estActive: true,
      estPartenaire: true,
      ...filtrePrefecture(prefecture),
      commune: { in: communes, mode: 'insensitive' },
    },
    select: { id: true, nom: true },
  });
}

/** Le nom d'un lieu tel qu'on le compare : sans casse ni espaces autour. */
const cleLieu = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('fr');

type ZoneDeCommande = {
  prefectureRecherche?: string | null; communeRecherche?: string | null;
  quartierRecherche?: string | null; elargieLe?: Date | null;
  voisinesLe?: Date | null; communesVoisines?: string[];
};

/**
 * Les pharmacies a qui l'appel s'adresse : sa zone ; plus les communes
 * voisines une fois la premiere etape franchie (M1-C) ; toute la prefecture
 * une fois elargi (M5).
 */
async function pharmaciesSollicitees(c: ZoneDeCommande) {
  if (c.elargieLe) return pharmaciesDeLaPrefecture(c.prefectureRecherche);
  const zone = await pharmaciesDeLaZone(zoneDeLaCommande(c));
  if (!c.voisinesLe) return zone;
  const voisines = await pharmaciesDesCommunes(c.prefectureRecherche, c.communesVoisines ?? []);
  return [...new Map([...zone, ...voisines].map((p) => [p.id, p])).values()];
}

/** Une officine est-elle appelee pour cette commande ? Meme regle que ci-dessus. */
function pharmacieAppelee(structure: Lieu, c: ZoneDeCommande): boolean {
  const lieu = zoneDeLaCommande(c);
  if (memeZone(structure, lieu)) return true;
  if (!memePrefecture(structure, lieu)) return false;
  if (c.elargieLe) return true;
  return !!c.voisinesLe && (c.communesVoisines ?? []).includes(cleLieu(structure.commune));
}

/**
 * L'appel passe a l'etape suivante, et seules les pharmacies qui n'avaient
 * pas ete appelees sont prevenues. Renvoie leur nombre : 0 si la commande
 * n'est plus a elargir ou si l'etape n'apporte personne de plus ; **-1 si un
 * autre passage vient d'elargir au meme moment** (R3) — l'appel continue
 * alors, et l'appelant ne doit pas le conclure.
 *
 * 1. **Les communes voisines** (M1-C), declarees au referentiel. Etape
 *    sautee si la commune n'a pas de voisine connue, ou si elles n'ont
 *    aucune partenaire de plus : attendre n'y servirait a rien.
 * 2. **Toute la prefecture** (M5).
 *
 * Chaque ecriture est conditionnelle (`voisinesLe: null`, `elargieLe: null`) :
 * deux passages simultanes du job n'envoient pas deux fois les memes
 * notifications.
 */
export async function elargirCommande(idCommande: string): Promise<number> {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: {
      id: true, numero: true, statut: true, elargieLe: true, voisinesLe: true, communesVoisines: true,
      prefectureRecherche: true, communeRecherche: true, quartierRecherche: true,
      ordonnance: { select: { numero: true } },
    },
  });
  if (!commande || commande.statut !== StatutCommande.RECHERCHE_PHARMACIE) return 0;
  if (commande.elargieLe || !(commande.prefectureRecherche ?? '').trim()) return 0;

  const dejaAppelees = new Set((await pharmaciesSollicitees(commande)).map((p) => p.id));

  if (!commande.voisinesLe) {
    const voisines = await voisinsDe(commande.prefectureRecherche, commande.communeRecherche);
    const nouvelles = (await pharmaciesDesCommunes(commande.prefectureRecherche, voisines))
      .filter((p) => !dejaAppelees.has(p.id));
    if (nouvelles.length > 0) {
      const marque = await prisma.commande.updateMany({
        where: { id: idCommande, statut: StatutCommande.RECHERCHE_PHARMACIE, voisinesLe: null, elargieLe: null },
        data: { voisinesLe: new Date(), communesVoisines: voisines.map(cleLieu) },
      });
      if (marque.count !== 1) return -1;
      await appelerPharmacies(nouvelles.map((p) => p.id), commande.ordonnance.numero, commande, true);
      return nouvelles.length;
    }
  }

  const marque = await prisma.commande.updateMany({
    where: { id: idCommande, statut: StatutCommande.RECHERCHE_PHARMACIE, elargieLe: null },
    data: { elargieLe: new Date() },
  });
  if (marque.count !== 1) return -1;

  const nouvelles = (await pharmaciesDeLaPrefecture(commande.prefectureRecherche))
    .filter((p) => !dejaAppelees.has(p.id));
  await appelerPharmacies(nouvelles.map((p) => p.id), commande.ordonnance.numero, commande, true);
  return nouvelles.length;
}

/** Le job : les appels restes sans preneur au-dela du delai s'elargissent. */
export async function elargirCommandesEnAttente(
  delaiMinutes: number,
  maintenant = new Date(),
): Promise<{ elargies: number }> {
  const limite = new Date(maintenant.getTime() - delaiMinutes * 60_000);
  const enAttente = await prisma.commande.findMany({
    where: {
      statut: StatutCommande.RECHERCHE_PHARMACIE,
      elargieLe: null,
      prefectureRecherche: { not: null },
      // Chaque etape a son propre delai : depuis la creation tant que l'appel
      // est dans sa commune, depuis l'ouverture aux voisines ensuite.
      OR: [
        { voisinesLe: null, creeLe: { lte: limite } },
        { voisinesLe: { lte: limite } },
      ],
    },
    select: { id: true },
    orderBy: { creeLe: 'asc' },
    take: 100,
  });
  // Ne compte que les appels effectivement portes a de nouvelles pharmacies.
  let elargies = 0;
  for (const { id } of enAttente) {
    if ((await elargirCommande(id)) > 0) elargies++;
  }
  return { elargies };
}

/**
 * Réponse d'une pharmacie à l'appel.
 *
 * Répondre « oui » tente de prendre la commande. La prise est atomique : le
 * `updateMany` ne touche la ligne que si `idPharmacie` est encore nul. Deux
 * pharmacies simultanées donnent donc un gagnant et un perdant, jamais deux
 * gagnants.
 */
export async function repondreDisponibilite(
  user: JwtPayload,
  idCommande: string,
  aTousLesProduits: boolean
) {
  const pharmacie = await pharmacieDuPharmacien(user.userId);

  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: {
      id: true, statut: true, idPharmacie: true, numero: true,
      prefectureRecherche: true, communeRecherche: true, quartierRecherche: true, elargieLe: true,
      voisinesLe: true, communesVoisines: true,
    },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');

  // Une pharmacie hors de la zone n'a pas ete sollicitee — sauf si l'appel
  // s'est elargi a toute sa prefecture (M5).
  if ((commande.quartierRecherche || commande.communeRecherche) && !pharmacieAppelee(pharmacie, commande)) {
    throw new ForbiddenError("Cette commande ne releve pas de votre zone");
  }
  if (commande.statut === StatutCommande.ANNULEE) {
    throw new ValidationError('Commande annulee');
  }
  if (commande.idPharmacie && commande.idPharmacie !== pharmacie.id) {
    throw new ConflictError('Une autre pharmacie a deja pris cette commande');
  }

  await prisma.reponsePharmacie.upsert({
    where: { idCommande_idStructure: { idCommande, idStructure: pharmacie.id } },
    update: { aTousLesProduits, repondueLe: new Date() },
    create: { idCommande, idStructure: pharmacie.id, aTousLesProduits },
  });

  if (!aTousLesProduits) {
    await verifierEpuisementDesReponses(idCommande);
    return getCommande(idCommande, pharmacie.id);
  }

  // ── Prise atomique ────────────────────────────────────────────────
  const prise = await prisma.commande.updateMany({
    where: { id: idCommande, idPharmacie: null, statut: StatutCommande.RECHERCHE_PHARMACIE },
    data: {
      idPharmacie: pharmacie.id,
      statut: StatutCommande.PRISE_EN_CHARGE,
      priseEnChargeLe: new Date(),
    },
  });
  if (prise.count === 0) {
    throw new ConflictError('Une autre pharmacie a ete plus rapide');
  }

  await notifierPriseEnCharge(idCommande, pharmacie.nom);
  return getCommande(idCommande, pharmacie.id);
}

/**
 * Une pharmacie se rétracte après avoir pris la commande : elle n'avait pas
 * tout, finalement. Le verrou se rouvre et les autres retrouvent la main.
 */
export async function retirerPriseEnCharge(user: JwtPayload, idCommande: string, motif: string) {
  const pharmacie = await pharmacieDuPharmacien(user.userId);

  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: { id: true, idPharmacie: true, statut: true },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  if (commande.idPharmacie !== pharmacie.id) {
    throw new ForbiddenError("Cette commande n'est pas la votre");
  }
  // La meme table que tout le reste : une officine qui a deja chiffre ne rend
  // pas la commande au quartier, elle l'annule avec son motif.
  assertTransition(commande.statut, StatutCommande.RECHERCHE_PHARMACIE);

  await prisma.$transaction([
    prisma.reponsePharmacie.update({
      where: { idCommande_idStructure: { idCommande, idStructure: pharmacie.id } },
      data: { aTousLesProduits: false, retracteeLe: new Date() },
    }),
    prisma.commande.update({
      where: { id: idCommande },
      data: {
        idPharmacie: null,
        priseEnChargeLe: null,
        statut: StatutCommande.RECHERCHE_PHARMACIE,
      },
    }),
  ]);

  await journaliserRetractation(idCommande, pharmacie.nom, motif);
  await verifierEpuisementDesReponses(idCommande);
  return getCommande(idCommande, pharmacie.id);
}

/** Le patient choisit comment il récupère ses produits. */
export async function choisirModeRemise(user: JwtPayload, idCommande: string, mode: ModeRemise) {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    include: { ordonnance: { select: { consultation: { select: { patient: { select: { idUtilisateur: true } } } } } } },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  if (commande.ordonnance.consultation.patient.idUtilisateur !== user.userId) {
    throw new ForbiddenError('Cette commande ne vous appartient pas');
  }
  if (commande.statut !== StatutCommande.PRISE_EN_CHARGE) {
    throw new ValidationError('Aucune pharmacie n a encore pris cette commande');
  }

  await prisma.commande.update({ where: { id: idCommande }, data: { modeRemise: mode } });
  return getCommande(idCommande);
}

/**
 * Toutes les ecritures repassent par ici : convertir une seule fois suffit a
 * ce que les quatre routes rendent la meme forme.
 *
 * `idPharmacieLectrice` permet de dire a une officine si la commande est la
 * sienne, sans qu'elle ait a le deduire.
 */
export async function getCommande(
  idCommande: string,
  idPharmacieLectrice?: string,
): Promise<CommandeView> {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    include: COMMANDE_INCLUDE,
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  return versCommandeView(commande, idPharmacieLectrice);
}

/** La file du comptoir : ce que cette pharmacie doit traiter ou a pris. */
export async function commandesDeLaPharmacie(user: JwtPayload): Promise<CommandeView[]> {
  const pharmacie = await pharmacieDuPharmacien(user.userId);
  const commandes = await prisma.commande.findMany({
    where: {
      OR: [
        // Les appels en cours de son quartier, qu'elle n'a pas encore refuses.
        {
          statut: StatutCommande.RECHERCHE_PHARMACIE,
          ...filtreZone(pharmacie, CHAMPS_RECHERCHE, { prefectureFacultative: true }),
          reponses: { none: { idStructure: pharmacie.id, aTousLesProduits: false } },
        },
        // Les appels elargis a toute sa prefecture (M5).
        {
          statut: StatutCommande.RECHERCHE_PHARMACIE,
          elargieLe: { not: null },
          ...filtrePrefecture(pharmacie.prefecture, 'prefectureRecherche'),
          reponses: { none: { idStructure: pharmacie.id, aTousLesProduits: false } },
        },
        // Les appels ouverts a sa commune en tant que voisine (M1-C).
        {
          statut: StatutCommande.RECHERCHE_PHARMACIE,
          voisinesLe: { not: null },
          communesVoisines: { has: cleLieu(pharmacie.commune) || '__aucune_commune__' },
          ...filtrePrefecture(pharmacie.prefecture, 'prefectureRecherche'),
          reponses: { none: { idStructure: pharmacie.id, aTousLesProduits: false } },
        },
        // Et celles qu'elle a prises.
        { idPharmacie: pharmacie.id },
      ],
    },
    include: COMMANDE_INCLUDE,
    orderBy: { creeLe: 'desc' },
    take: 50,
  });
  return commandes.map((c) => versCommandeView(c, pharmacie.id));
}

// ── Interne ─────────────────────────────────────────────────────────

async function pharmacieDuPharmacien(userId: string) {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: userId },
    include: { structure: true },
  });
  if (!utilisateur?.structure) throw new ForbiddenError('Compte sans structure assignee');
  if (!estStructureOfficinale(utilisateur.structure.type)) {
    throw new ValidationError("La structure assignee n est pas une pharmacie");
  }
  if (!utilisateur.structure.estPartenaire) {
    throw new ForbiddenError('Votre pharmacie n est pas partenaire de la plateforme');
  }
  return utilisateur.structure;
}

/**
 * R5 : chaque pharmacie sollicitee a-t-elle dit non ? Comparaison par
 * identifiant. Sans sollicitee, rien n'est epuise : il n'y avait personne a
 * attendre, et c'est au lancement d'en conclure.
 */
export function toutesOntRefuse(
  sollicitees: { id: string }[],
  reponses: { idStructure: string; aTousLesProduits: boolean }[],
): boolean {
  if (sollicitees.length === 0) return false;
  const refusees = new Set(reponses.filter((r) => !r.aTousLesProduits).map((r) => r.idStructure));
  return sollicitees.every((p) => refusees.has(p.id));
}

/**
 * Toutes les pharmacies sollicitées ont répondu « non » : il n'y a plus rien à
 * attendre. Le patient et le médecin sont avertis, et le patient reprend son
 * ordonnance.
 */
async function verifierEpuisementDesReponses(idCommande: string) {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: {
      prefectureRecherche: true, communeRecherche: true, quartierRecherche: true, elargieLe: true,
      voisinesLe: true, communesVoisines: true,
      statut: true, reponses: { select: { idStructure: true, aTousLesProduits: true } },
    },
  });
  if (!commande || commande.statut !== StatutCommande.RECHERCHE_PHARMACIE) return;

  // R5 : on regarde **qui** a refuse, pas combien. Une pharmacie qui a refuse
  // puis quitte l'appel (desactivee, plus partenaire, commune changee) garde
  // sa reponse en base : compter les refus la ferait passer pour une
  // sollicitee, et la commande serait conclue alors qu'une autre n'a jamais
  // repondu.
  const sollicitees = await pharmaciesSollicitees(commande);
  if (!toutesOntRefuse(sollicitees, commande.reponses)) return;

  // M5 : toute la zone a dit non. Avant de renvoyer le patient, on tente
  // l'etape suivante, sans attendre le delai du job.
  // R3 : -1 signifie qu'un autre passage (le job) vient d'elargir au meme
  // moment et a prevenu de nouvelles pharmacies : l'appel n'est pas epuise.
  if (!commande.elargieLe && (await elargirCommande(idCommande)) !== 0) return;

  // R2 : conditionnel, comme l'attribution. Une pharmacie qui prend la
  // commande a la meme seconde ne doit pas voir sa prise en charge effacee.
  const conclue = await prisma.commande.updateMany({
    where: { id: idCommande, statut: StatutCommande.RECHERCHE_PHARMACIE },
    data: { statut: StatutCommande.SANS_PHARMACIE },
  });
  if (conclue.count !== 1) return;
  await avertirIndisponibilite(idCommande, 'refus');
}

/**
 * R1 : le job arrete les appels restes sans preneur au-dela du delai final,
 * compte depuis la creation. Sans cela, une commande dont une pharmacie ne
 * repond jamais attendrait indefiniment, et le patient avec elle.
 * Conditionnel, comme la conclusion sur refus (R2) : une pharmacie qui prend
 * la commande a la meme seconde la garde.
 */
export async function conclureCommandesExpirees(
  delaiFinalMinutes: number,
  maintenant = new Date(),
): Promise<{ conclues: number }> {
  const limite = new Date(maintenant.getTime() - delaiFinalMinutes * 60_000);
  const expirees = await prisma.commande.findMany({
    where: { statut: StatutCommande.RECHERCHE_PHARMACIE, creeLe: { lte: limite } },
    select: { id: true },
    orderBy: { creeLe: 'asc' },
    take: 100,
  });
  let conclues = 0;
  for (const { id } of expirees) {
    const conclue = await prisma.commande.updateMany({
      where: { id, statut: StatutCommande.RECHERCHE_PHARMACIE },
      data: { statut: StatutCommande.SANS_PHARMACIE },
    });
    if (conclue.count !== 1) continue;
    conclues++;
    await avertirIndisponibilite(id, 'delai');
  }
  return { conclues };
}

/** Patient et médecin avertis : aucune pharmacie n'a la totalité. */
async function avertirIndisponibilite(idCommande: string, cause: 'refus' | 'delai') {
  const destinataires = await destinatairesDeLaCommande(idCommande);
  if (!destinataires) return;

  // Apres le delai, certaines n'ont simplement pas repondu : on ne pretend
  // pas qu'elles ont toutes dit non.
  const constat = cause === 'refus'
    ? 'aucune pharmacie partenaire de la zone ne detient la totalite.'
    : "aucune pharmacie partenaire de la zone n'a confirme la totalite dans le delai.";
  for (const idUtilisateur of destinataires.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_SANS_PHARMACIE',
      titre: 'Aucune pharmacie ne dispose de tous les produits',
      contenu:
        `Ordonnance ${destinataires.numeroOrdonnance} : ${constat} ` +
        `L'ordonnance reste valable et peut etre presentee ailleurs.`,
      lienAction: '/patient/ordonnances',
      metadonnees: { idCommande },
    });
  }
}

async function notifierPriseEnCharge(idCommande: string, nomPharmacie: string) {
  const destinataires = await destinatairesDeLaCommande(idCommande);
  if (!destinataires) return;

  for (const idUtilisateur of destinataires.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_PRISE_EN_CHARGE',
      titre: 'Votre commande est prise en charge',
      contenu: `${nomPharmacie} dispose de tous les produits de l'ordonnance ${destinataires.numeroOrdonnance}.`,
      lienAction: '/patient/ordonnances',
      metadonnees: { idCommande },
    });
  }
}

/**
 * Le patient **et** le médecin prescripteur : le cahier des charges veut que
 * le prescripteur sache ce qu'il advient de son ordonnance.
 */
async function destinatairesDeLaCommande(idCommande: string) {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: {
      ordonnance: {
        select: {
          numero: true,
          signePar: true,
          consultation: {
            select: {
              idMedecinValideur: true,
              patient: { select: { idUtilisateur: true } },
            },
          },
        },
      },
    },
  });
  if (!commande) return null;

  const o = commande.ordonnance;
  const utilisateurs = [
    o.consultation.patient.idUtilisateur,
    o.signePar ?? o.consultation.idMedecinValideur,
  ].filter((v): v is string => Boolean(v));

  return { utilisateurs: [...new Set(utilisateurs)], numeroOrdonnance: o.numero };
}

async function journaliserRetractation(idCommande: string, nomPharmacie: string, motif: string) {
  const destinataires = await destinatairesDeLaCommande(idCommande);
  if (!destinataires) return;

  for (const idUtilisateur of destinataires.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_A_SERVIR',
      titre: 'La pharmacie a rendu la commande',
      contenu: `${nomPharmacie} ne peut finalement pas servir l'ordonnance ${destinataires.numeroOrdonnance} : ${motif}`,
      lienAction: '/patient/ordonnances',
      metadonnees: { idCommande },
    });
  }
}

/** Réexporté pour les écrans : le statut d'une ordonnance côté commande. */
/**
 * Les commandes du patient connecte.
 *
 * Il n'avait aucun moyen de les voir : l'appel partait, une pharmacie
 * prenait, et rien ne le lui disait — alors que c'est **lui** qui doit
 * choisir entre retrait et livraison.
 */
export async function mesCommandes(user: JwtPayload): Promise<CommandeView[]> {
  const commandes = await prisma.commande.findMany({
    where: {
      ordonnance: { consultation: { patient: { idUtilisateur: user.userId } } },
      statut: { not: StatutCommande.ANNULEE },
    },
    include: COMMANDE_INCLUDE,
    orderBy: { creeLe: 'desc' },
    take: 20,
  });
  return commandes.map((c) => versCommandeView(c));
}

/**
 * Qui peut lire une commande.
 *
 * **`GET /commandes/:id` n'avait aucun controle** — ni role, ni propriete :
 * n'importe quel compte connecte pouvait lire la commande d'un inconnu, avec
 * son nom et ses medicaments. Le defaut datait de la mise en place de la
 * route, le 2026-09-26.
 *
 * Quatre lectures sont legitimes : le patient concerne, la pharmacie qui l'a
 * prise ou qui est sollicitee dans son quartier, le prescripteur, et
 * l'administration.
 */
export async function assertPeutLireCommande(user: JwtPayload, idCommande: string): Promise<void> {
  if (ROLES_ADMIN.has(user.role)) return;

  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: {
      idPharmacie: true,
      prefectureRecherche: true,
      communeRecherche: true,
      quartierRecherche: true,
      elargieLe: true,
      voisinesLe: true,
      communesVoisines: true,
      statut: true,
      ordonnance: {
        select: {
          signePar: true,
          consultation: {
            select: { idMedecinValideur: true, patient: { select: { idUtilisateur: true } } },
          },
        },
      },
    },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');

  const o = commande.ordonnance;
  if (o.consultation.patient.idUtilisateur === user.userId) return;
  if (o.signePar === user.userId || o.consultation.idMedecinValideur === user.userId) return;

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: user.userId },
    select: {
      idStructure: true,
      structure: { select: { type: true, prefecture: true, commune: true, quartier: true, estPartenaire: true } },
    },
  });
  const structure = utilisateur?.structure;
  if (structure && estStructureOfficinale(structure.type)) {
    // Celle qui l'a prise, ou une partenaire du quartier encore sollicitee :
    // elle doit pouvoir lire ce qu'on lui demande de servir.
    if (utilisateur?.idStructure === commande.idPharmacie) return;
    if (
      structure.estPartenaire
      && commande.statut === StatutCommande.RECHERCHE_PHARMACIE
      && pharmacieAppelee(structure, commande)
    ) return;
  }

  throw new ForbiddenError("Cette commande ne vous concerne pas");
}

export async function commandeDeLOrdonnance(idOrdonnance: string) {
  return prisma.commande.findUnique({
    where: { idOrdonnance },
    include: COMMANDE_INCLUDE,
  });
}


// ════════════════════════════════════════════════════════════════════════
/** La commande d'une officine, ou un refus net. */
async function commandeDeMonOfficine(user: JwtPayload, idCommande: string) {
  const pharmacie = await pharmacieDuPharmacien(user.userId);
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: { id: true, statut: true, idPharmacie: true, modeRemise: true, numero: true },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  if (commande.idPharmacie !== pharmacie.id) {
    throw new ForbiddenError("Cette commande n'est pas la votre");
  }
  return { commande, pharmacie };
}

/**
 * Chiffrer le panier, ligne par ligne, aux prix de cette officine (EF-07-02).
 *
 * **Les prix sont figés ici, pas lus du catalogue à l'affichage.** Le
 * catalogue national évolue et les marges d'une officine aussi : ce que le
 * patient accepte de payer ce jour-là ne doit pas bouger derrière lui.
 *
 * La règle de prix est **celle du comptoir**, à l'identique : prix national
 * de référence plus la marge de l'officine. Deux règles divergeraient en
 * silence, et c'est de l'argent.
 *
 * **Un produit absent du stock fait refuser le chiffrage, en le nommant.**
 * L'officine a déclaré tout détenir ; si ce n'est plus vrai, il vaut mieux le
 * dire que chiffrer un produit qu'on ne pourra pas remettre. Les quantités,
 * elles, ne sont pas encore vérifiées : c'est EF-07-06, et il arrive avec la
 * délivrance partielle.
 */
export async function chiffrerCommande(user: JwtPayload, idCommande: string): Promise<CommandeView> {
  const { commande, pharmacie } = await commandeDeMonOfficine(user, idCommande);
  assertTransition(commande.statut, StatutCommande.A_PAYER);

  const complete = await prisma.commande.findUniqueOrThrow({
    where: { id: idCommande },
    select: {
      ordonnance: {
        select: {
          lignes: {
            select: {
              id: true,
              quantite: true,
              idMedicament: true,
              medicament: { select: { libelle: true, prixUnitaireGnf: true } },
            },
          },
        },
      },
    },
  });

  const stocks = await prisma.stock.findMany({
    where: {
      idStructure: pharmacie.id,
      idMedicament: { in: complete.ordonnance.lignes.map((l) => l.idMedicament) },
    },
    select: { idMedicament: true, margeGnf: true },
  });
  const margeParProduit = new Map(stocks.map((s) => [s.idMedicament, s.margeGnf]));

  const absents = complete.ordonnance.lignes
    .filter((l) => !margeParProduit.has(l.idMedicament))
    .map((l) => l.medicament.libelle);
  if (absents.length > 0) {
    throw new ValidationError(
      `Ces produits ne sont pas a votre catalogue : ${absents.join(', ')}. `
      + `Rendez la commande au quartier plutot que de chiffrer ce que vous ne pourrez pas remettre.`,
    );
  }

  const lignes = complete.ordonnance.lignes.map((l) => {
    const prixUnitaireGnf = l.medicament.prixUnitaireGnf + (margeParProduit.get(l.idMedicament) ?? 0);
    return {
      idCommande,
      idLigneOrdonnance: l.id,
      idMedicament: l.idMedicament,
      libelle: l.medicament.libelle,
      quantite: l.quantite,
      prixUnitaireGnf,
      montantGnf: prixUnitaireGnf * l.quantite,
    };
  });
  const montantTotalGnf = lignes.reduce((t, l) => t + l.montantGnf, 0);

  // Les lignes et le total dans la même transaction : le déclencheur différé
  // côté base vérifie leur accord au commit, et refuse l'écart.
  await prisma.$transaction([
    prisma.ligneCommande.deleteMany({ where: { idCommande } }),
    prisma.ligneCommande.createMany({ data: lignes }),
    prisma.commande.update({
      where: { id: idCommande },
      data: { statut: StatutCommande.A_PAYER, montantTotalGnf, chiffreeLe: new Date() },
    }),
  ]);

  await notifierPanierChiffre(idCommande, pharmacie.nom, montantTotalGnf);
  return getCommande(idCommande, pharmacie.id);
}

/**
 * Avancer la commande quand sa facture devient payée.
 *
 * Appelée depuis `appliquerStatutPasserelle`, qui est le point unique où un
 * paiement est acquis. Elle ne lève pas : un rappel de passerelle qui
 * échouerait ici serait rejoué indéfiniment, alors que l'argent, lui, est
 * bien arrivé.
 */
export async function avancerApresPaiement(idCommande: string): Promise<void> {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: { id: true, statut: true, numero: true },
  });
  if (!commande) return;
  if (!transitionPermise(commande.statut, StatutCommande.PAYEE)) {
    // Déjà payée, ou annulée entre-temps : il n'y a rien à faire, et surtout
    // rien à défaire.
    return;
  }
  await prisma.commande.update({
    where: { id: idCommande },
    data: { statut: StatutCommande.PAYEE },
  });
  await notifierCommandePayee(idCommande);
}

/** L'officine commence à préparer le sachet. */
export async function marquerEnPreparation(user: JwtPayload, idCommande: string): Promise<CommandeView> {
  const { commande, pharmacie } = await commandeDeMonOfficine(user, idCommande);
  assertTransition(commande.statut, StatutCommande.EN_PREPARATION);
  await prisma.commande.update({
    where: { id: idCommande },
    data: { statut: StatutCommande.EN_PREPARATION },
  });
  return getCommande(idCommande, pharmacie.id);
}

/**
 * Le sachet est prêt. **C'est le mode de remise qui décide de la suite.**
 *
 * Tant que le patient n'a pas choisi, on ne peut pas savoir s'il faut
 * l'attendre au comptoir ou appeler un motard : le refus le dit plutôt que de
 * choisir à sa place.
 */
export async function marquerPrete(user: JwtPayload, idCommande: string): Promise<CommandeView> {
  const { commande, pharmacie } = await commandeDeMonOfficine(user, idCommande);
  if (!commande.modeRemise) {
    throw new ValidationError(
      "Le patient n'a pas encore choisi entre le retrait et la livraison : on ne peut pas savoir si on l'attend ou si on appelle un motard.",
    );
  }
  const vers = commande.modeRemise === ModeRemise.RETRAIT_PHARMACIE
    ? StatutCommande.PRETE_POUR_RETRAIT
    : StatutCommande.PRETE_POUR_LIVRAISON;
  assertTransition(commande.statut, vers);

  const course = await prisma.$transaction(async (tx) => {
    const maj = await tx.commande.updateMany({
      where: { id: idCommande, statut: commande.statut },
      data: { statut: vers, preteLe: new Date() },
    });
    if (maj.count !== 1) throw new ConflictError('La commande a change avant sa mise a disposition');
    return vers === StatutCommande.PRETE_POUR_LIVRAISON
      ? ouvrirCourse(idCommande, tx)
      : null;
  });
  if (course) await notifierLivreursCourse(course.id);
  await notifierCommandePrete(idCommande, commande.modeRemise);
  return getCommande(idCommande, pharmacie.id);
}

/**
 * L'officine remet les produits.
 *
 * Au patient s'il vient les chercher — et la commande est alors close, il est
 * là, il n'y a personne d'autre à attendre. Au motard pour une livraison, et
 * c'est le patient qui clôturera à la réception, en P8.
 */
export async function confirmerRemise(user: JwtPayload, idCommande: string): Promise<CommandeView> {
  const { commande, pharmacie } = await commandeDeMonOfficine(user, idCommande);
  if (commande.modeRemise === ModeRemise.LIVRAISON) {
    throw new ValidationError('Cette commande part en livraison : scannez le QR du motard.');
  }
  const maintenant = new Date();

  if (commande.statut === StatutCommande.PRETE_POUR_RETRAIT) {
    assertTransition(commande.statut, StatutCommande.CLOTUREE);
    await prisma.commande.update({
      where: { id: idCommande },
      data: { statut: StatutCommande.CLOTUREE, remiseLe: maintenant, clotureeLe: maintenant },
    });
  } else {
    assertTransition(commande.statut, StatutCommande.RETIREE);
    await prisma.commande.update({
      where: { id: idCommande },
      data: { statut: StatutCommande.RETIREE, remiseLe: maintenant },
    });
  }

  await notifierRemise(idCommande);
  return getCommande(idCommande, pharmacie.id);
}

/**
 * Annuler, avec un motif.
 *
 * Ouvert au patient comme à l'officine : l'un renonce, l'autre découvre une
 * rupture. Le motif est exigé par la base autant que par ici — une
 * annulation sans motif ne s'explique pas trois semaines plus tard, et c'est
 * toujours à ce moment qu'on la cherche.
 *
 * **Le remboursement d'une commande déjà payée ne passe pas par ici.** Il se
 * fait au comptoir, et la plateforme ne prétend pas le contraire.
 */
export async function annulerCommande(
  user: JwtPayload,
  idCommande: string,
  motif: string,
): Promise<CommandeView> {
  const propre = motif.trim();
  if (propre.length < 5) {
    throw new ValidationError('Dites en quelques mots pourquoi la commande est annulee.');
  }

  await assertPeutLireCommande(user, idCommande);
  const commande = await prisma.commande.findUniqueOrThrow({
    where: { id: idCommande },
    select: { id: true, statut: true, idPharmacie: true },
  });
  assertTransition(commande.statut, StatutCommande.ANNULEE);

  await prisma.commande.update({
    where: { id: idCommande },
    data: { statut: StatutCommande.ANNULEE, motifAnnulation: propre },
  });
  await notifierAnnulation(idCommande, propre);
  return getCommande(idCommande, commande.idPharmacie ?? undefined);
}


// ── Ce que chacun apprend, et quand ──────────────────────────────────
//
// Le patient et le medecin prescripteur, par `destinatairesDeLaCommande` :
// le cahier des charges veut que le prescripteur sache ce qu'il advient de
// son ordonnance.
//
// **Aucun contenu medical dans une notification** (P9) : le numero
// d'ordonnance et un montant, jamais un nom de produit. Une notification
// s'affiche sur un ecran verrouille.

async function notifierPanierChiffre(idCommande: string, nomPharmacie: string, montantGnf: number) {
  const d = await destinatairesDeLaCommande(idCommande);
  if (!d) return;
  const montant = montantGnf.toLocaleString('fr-FR');
  for (const idUtilisateur of d.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_A_PAYER',
      titre: 'Votre commande est chiffree',
      contenu: `${nomPharmacie} a chiffre l'ordonnance ${d.numeroOrdonnance} : ${montant} GNF.`,
      lienAction: '/patient/commandes',
      metadonnees: { idCommande, montantGnf },
    });
  }
}

async function notifierCommandePayee(idCommande: string) {
  const d = await destinatairesDeLaCommande(idCommande);
  if (!d) return;
  // La pharmacie aussi : c'est elle qui prepare, et elle attend ce signal.
  for (const idUtilisateur of await avecLaPharmacie(idCommande, d.utilisateurs)) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_PAYEE',
      titre: 'Commande payee',
      contenu: `L'ordonnance ${d.numeroOrdonnance} est reglee : la preparation peut commencer.`,
      lienAction: '/pharmacien/commandes',
      metadonnees: { idCommande },
    });
  }
}

async function notifierCommandePrete(idCommande: string, mode: ModeRemise) {
  const d = await destinatairesDeLaCommande(idCommande);
  if (!d) return;
  const suite = mode === ModeRemise.RETRAIT_PHARMACIE
    ? 'Vous pouvez venir la retirer.'
    : 'Un livreur va etre appele.';
  for (const idUtilisateur of d.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_PRETE',
      titre: 'Votre commande est prete',
      contenu: `L'ordonnance ${d.numeroOrdonnance} est prete. ${suite}`,
      lienAction: '/patient/commandes',
      metadonnees: { idCommande, modeRemise: mode },
    });
  }
}

async function notifierRemise(idCommande: string) {
  const d = await destinatairesDeLaCommande(idCommande);
  if (!d) return;
  for (const idUtilisateur of d.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_REMISE',
      titre: 'Commande remise',
      contenu: `Les produits de l'ordonnance ${d.numeroOrdonnance} ont ete remis.`,
      lienAction: '/patient/commandes',
      metadonnees: { idCommande },
    });
  }
}

async function notifierAnnulation(idCommande: string, motif: string) {
  const d = await destinatairesDeLaCommande(idCommande);
  if (!d) return;
  for (const idUtilisateur of await avecLaPharmacie(idCommande, d.utilisateurs)) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'COMMANDE_ANNULEE',
      titre: 'Commande annulee',
      contenu: `L'ordonnance ${d.numeroOrdonnance} ne sera pas servie : ${motif}`,
      lienAction: '/patient/commandes',
      metadonnees: { idCommande },
    });
  }
}

/**
 * Les destinataires, plus les pharmaciens de l'officine qui tient la commande.
 *
 * **C'est l'identifiant des utilisateurs qu'il faut, pas celui de la
 * structure.** Le defaut du 09/10 etait exactement la : la cle etrangere
 * refusait, l'erreur etait avalee, et aucune pharmacie n'etait jamais
 * prevenue — sans que rien ne le montre, puisque l'ecran finit par afficher
 * la commande si on pense a le regarder.
 */
async function avecLaPharmacie(idCommande: string, utilisateurs: string[]): Promise<string[]> {
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: { idPharmacie: true },
  });
  if (!commande?.idPharmacie) return utilisateurs;

  const pharmaciens = await prisma.utilisateur.findMany({
    where: { role: Role.PHARMACIEN, estActif: true, idStructure: commande.idPharmacie },
    select: { id: true },
  });
  return [...new Set([...utilisateurs, ...pharmaciens.map((p) => p.id)])];
}

export { StatutCommande, ModeRemise, StatutOrdonnance };
