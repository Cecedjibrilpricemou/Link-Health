import {
  ModeRemise,
  Prisma,
  Role,
  StatutCommande,
  StatutCourse,
} from '../config/generated/client/client';
import type {
  CourseLivreurView,
  CourseView,
  MesCoursesLivreurView,
  OffreCourseView,
  ProposerOffreCourseDto,
} from '@baobaoheath/shared-types';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import type { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { estStructureOfficinale } from '../utils/officine.util';
import { assertTransition as assertCommandeTransition } from './commande.transitions';
import { notifierSansBloquer } from './notification.service';
import { prochainNumero } from './numero.service';
import { voisinsDe } from './geographie.service';
import { dansLesZones, filtrePrefecture, filtreZone, filtreZones, memePrefecture, zonesDuLivreur } from '../utils/zone';

export type CourseTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const TRANSITIONS: Readonly<Record<StatutCourse, readonly StatutCourse[]>> = {
  APPEL_OFFRES: [StatutCourse.ATTRIBUEE, StatutCourse.SANS_MOTARD, StatutCourse.ANNULEE],
  ATTRIBUEE: [StatutCourse.EN_COURS, StatutCourse.APPEL_OFFRES, StatutCourse.ANNULEE],
  EN_COURS: [StatutCourse.LIVREE],
  SANS_MOTARD: [StatutCourse.APPEL_OFFRES, StatutCourse.ANNULEE],
  LIVREE: [],
  ANNULEE: [],
};

const LIBELLES: Readonly<Record<StatutCourse, string>> = {
  APPEL_OFFRES: "en appel d'offres",
  ATTRIBUEE: 'attribuee',
  EN_COURS: 'en cours',
  LIVREE: 'livree',
  SANS_MOTARD: 'sans motard',
  ANNULEE: 'annulee',
};

export function transitionCoursePermise(de: StatutCourse, vers: StatutCourse): boolean {
  return TRANSITIONS[de].includes(vers);
}

export function assertTransitionCourse(de: StatutCourse, vers: StatutCourse): void {
  if (transitionCoursePermise(de, vers)) return;
  throw new ConflictError(
    TRANSITIONS[de].length === 0
      ? `Cette course est ${LIBELLES[de]} : rien ne peut plus la faire changer.`
      : `Une course ${LIBELLES[de]} ne peut pas passer a « ${LIBELLES[vers]} ».`,
  );
}

const COURSE_VIEW_SELECT = {
  id: true,
  numero: true,
  statut: true,
  quartier: true,
  prefecture: true,
  prixGnf: true,
  delaiAnnonceMinutes: true,
  creeeLe: true,
  attribueeLe: true,
  remiseLe: true,
  livreeLe: true,
  annuleeLe: true,
  motifAnnulation: true,
  commande: {
    select: {
      pharmacie: { select: { id: true, nom: true } },
    },
  },
} as const;

type CourseViewPayload = Prisma.CourseGetPayload<{ select: typeof COURSE_VIEW_SELECT }>;

function versCourseView(course: CourseViewPayload): CourseView {
  return {
    id: course.id,
    numero: course.numero,
    statut: course.statut,
    quartier: course.quartier,
    prefecture: course.prefecture,
    prixGnf: course.prixGnf,
    delaiAnnonceMinutes: course.delaiAnnonceMinutes,
    creeeLe: course.creeeLe.toISOString(),
    attribueeLe: course.attribueeLe?.toISOString() ?? null,
    remiseLe: course.remiseLe?.toISOString() ?? null,
    livreeLe: course.livreeLe?.toISOString() ?? null,
    annuleeLe: course.annuleeLe?.toISOString() ?? null,
    motifAnnulation: course.motifAnnulation,
    pharmacie: course.commande.pharmacie,
  };
}

const COURSE_LIVREUR_OPEN_SELECT = {
  id: true,
  numero: true,
  statut: true,
  quartier: true,
  prefecture: true,
  prixGnf: true,
  delaiAnnonceMinutes: true,
  creeeLe: true,
  attribueeLe: true,
  remiseLe: true,
  livreeLe: true,
  commande: {
    select: {
      pharmacie: { select: { id: true, nom: true } },
    },
  },
} as const;

const COURSE_LIVREUR_ASSIGNED_SELECT = {
  ...COURSE_LIVREUR_OPEN_SELECT,
  idLivreur: true,
  commande: {
    select: {
      pharmacie: { select: { id: true, nom: true } },
      ordonnance: {
        select: {
          consultation: {
            select: {
              patient: {
                select: {
                  utilisateur: { select: { prenom: true, nom: true, telephone: true } },
                  // M3 : ou livrer. Rendu seulement pendant la course (voir plus bas).
                  commune: true, quartier: true, pointRepere: true, latitude: true, longitude: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

type CourseLivreurAssignedPayload = Prisma.CourseGetPayload<{ select: typeof COURSE_LIVREUR_ASSIGNED_SELECT }>;

/**
 * M3 : l'adresse du patient n'est utile au motard que le temps de livrer. Avant
 * l'attribution, il n'a pas la course ; apres la livraison ou l'annulation, il
 * n'a plus a savoir ou habite le patient.
 */
const STATUTS_ADRESSE_VISIBLE: StatutCourse[] = [StatutCourse.ATTRIBUEE, StatutCourse.EN_COURS];

function versCourseLivreurView(course: CourseLivreurAssignedPayload): CourseLivreurView {
  const dossier = course.commande.ordonnance.consultation?.patient;
  const patient = dossier?.utilisateur;
  const adresseVisible = !!course.idLivreur && !!dossier && STATUTS_ADRESSE_VISIBLE.includes(course.statut);
  return {
    id: course.id,
    numero: course.numero,
    statut: course.statut,
    quartier: course.quartier,
    prefecture: course.prefecture,
    prixGnf: course.prixGnf,
    delaiAnnonceMinutes: course.delaiAnnonceMinutes,
    creeeLe: course.creeeLe.toISOString(),
    attribueeLe: course.attribueeLe?.toISOString() ?? null,
    remiseLe: course.remiseLe?.toISOString() ?? null,
    livreeLe: course.livreeLe?.toISOString() ?? null,
    pharmacie: course.commande.pharmacie,
    ...(course.idLivreur && patient
      ? { patient: { prenom: patient.prenom, nom: patient.nom, telephone: patient.telephone } }
      : {}),
    ...(adresseVisible && dossier
      ? {
          adresseLivraison: {
            commune: dossier.commune ?? null,
            quartier: dossier.quartier ?? null,
            pointRepere: dossier.pointRepere ?? null,
            latitude: dossier.latitude ?? null,
            longitude: dossier.longitude ?? null,
          },
        }
      : {}),
  };
}

const COMMANDE_PATIENT_SELECT = {
  id: true,
  statut: true,
  modeRemise: true,
  idPharmacie: true,
  quartierRecherche: true,
  ordonnance: {
    select: {
      consultation: {
        select: {
          patient: {
            select: {
              idUtilisateur: true,
              prefecture: true,
            },
          },
        },
      },
    },
  },
} as const;

type CommandePatientPayload = Prisma.CommandeGetPayload<{ select: typeof COMMANDE_PATIENT_SELECT }>;

function exigerRole(user: JwtPayload, role: Role): void {
  if (user.role !== role) throw new ForbiddenError('Ce geste ne correspond pas a votre role');
}

async function profilLivreur(userId: string, actifObligatoire: boolean) {
  const profile = await prisma.livreurProfile.findUnique({
    where: { idUtilisateur: userId },
    select: {
      id: true,
      qrCode: true,
      quartier: true,
      prefecture: true,
      commune: true,
      communesDesservies: true,
      enService: true,
      estActif: true,
      utilisateur: { select: { role: true } },
    },
  });
  if (!profile || profile.utilisateur.role !== Role.LIVREUR) {
    throw new ForbiddenError('Aucun profil livreur n est rattache a ce compte');
  }
  if (actifObligatoire && !profile.estActif) {
    throw new ForbiddenError('Votre profil livreur est inactif');
  }
  return profile;
}

async function commandeDuPatient(
  client: CourseTransactionClient,
  user: JwtPayload,
  idCommande: string,
): Promise<CommandePatientPayload> {
  const commande = await client.commande.findUnique({
    where: { id: idCommande },
    select: COMMANDE_PATIENT_SELECT,
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  if (commande.ordonnance.consultation?.patient.idUtilisateur !== user.userId) {
    throw new ForbiddenError('Cette commande ne vous appartient pas');
  }
  return commande;
}

async function obtenirCourseView(
  client: CourseTransactionClient,
  idCourse: string,
): Promise<CourseView> {
  const course = await client.course.findUnique({
    where: { id: idCourse },
    select: COURSE_VIEW_SELECT,
  });
  if (!course) throw new NotFoundError('Course non trouvee');
  return versCourseView(course);
}

/**
 * Les motards de la zone d'une course, en filtre Prisma : sa propre commune
 * (ou son quartier pour un compte ancien), ou une commune qu'il dessert dans
 * la meme prefecture.
 */
function livreursDeLaZone(course: { prefecture: string; commune: string | null; quartier: string }) {
  return [
    filtreZone(course),
    ...(course.commune?.trim()
      ? [{ AND: [
          { prefecture: { equals: course.prefecture.trim(), mode: 'insensitive' as const } },
          { communesDesservies: { has: course.commune.trim() } },
        ] }]
      : []),
  ];
}

/** Le nom d'un lieu tel qu'on le compare : sans casse ni espaces autour. */
const cleLieu = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('fr');

/**
 * M1-C : les motards des communes voisines, dans la prefecture de la course —
 * qu'ils y habitent ou qu'ils les desservent. Les noms comparent sans casse.
 */
function livreursDesVoisines(prefecture: string, voisines: string[]) {
  const dansPrefecture = { prefecture: { equals: prefecture.trim(), mode: 'insensitive' as const } };
  const variantes = [...new Set([...voisines, ...voisines.map(cleLieu)])];
  return [
    { ...dansPrefecture, commune: { in: voisines, mode: 'insensitive' as const } },
    { ...dansPrefecture, communesDesservies: { hasSome: variantes } },
  ];
}

/** Les communes d'un motard, telles que comparees aux voisines figees sur une course. */
function communesDuLivreur(profile: { commune: string | null; communesDesservies: string[] }): string[] {
  return [profile.commune, ...profile.communesDesservies].map(cleLieu).filter((c) => !!c);
}

async function notifierElargissement(
  destinataires: { utilisateur: { id: string } }[],
  course: { numero: string; commune: string | null; quartier: string },
  idCourse: string,
  aQui: string,
) {
  await Promise.all(destinataires.map(({ utilisateur }) => notifierSansBloquer({
    idUtilisateur: utilisateur.id,
    type: 'COURSE_OUVERTE',
    titre: 'Course sans motard dans sa commune',
    contenu: `La course ${course.numero} a ${course.commune ?? course.quartier} n'a recu aucune offre : elle est ouverte ${aQui}.`,
    lienAction: '/livreur/courses',
    metadonnees: { idCourse, numero: course.numero, quartier: course.quartier, elargie: true },
  })));
}

/**
 * La course passe a l'etape suivante, et seuls les motards en service qui
 * n'avaient pas ete prevenus le sont. Renvoie leur nombre.
 *
 * 1. **Les communes voisines** (M1-C), sautee si la commune n'a pas de
 *    voisine connue ou si personne de plus n'y est en service.
 * 2. **Toute la prefecture** (M5).
 *
 * Chaque ecriture est conditionnelle (`voisinesLe: null`, `elargieLe: null`) :
 * deux passages du job ne previennent pas deux fois les memes motards.
 */
export async function elargirCourse(idCourse: string): Promise<number> {
  const course = await prisma.course.findUnique({
    where: { id: idCourse },
    select: {
      id: true, numero: true, statut: true, elargieLe: true, voisinesLe: true, communesVoisines: true,
      prefecture: true, commune: true, quartier: true,
    },
  });
  if (!course || course.statut !== StatutCourse.APPEL_OFFRES || course.elargieLe) return 0;
  if (!course.prefecture.trim()) return 0;

  const enService = { estActif: true, enService: true, utilisateur: { role: Role.LIVREUR, estActif: true } };
  // Ceux de la zone ont ete prevenus a l'ouverture ; ceux des voisines, a la premiere etape.
  const dejaPrevenus = [
    ...livreursDeLaZone(course),
    ...(course.voisinesLe ? livreursDesVoisines(course.prefecture, course.communesVoisines) : []),
  ];

  if (!course.voisinesLe) {
    const voisines = await voisinsDe(course.prefecture, course.commune);
    if (voisines.length > 0) {
      const nouveaux = await prisma.livreurProfile.findMany({
        where: { ...enService, OR: livreursDesVoisines(course.prefecture, voisines), NOT: { OR: dejaPrevenus } },
        select: { utilisateur: { select: { id: true } } },
      });
      if (nouveaux.length > 0) {
        const marque = await prisma.course.updateMany({
          where: { id: idCourse, statut: StatutCourse.APPEL_OFFRES, voisinesLe: null, elargieLe: null },
          data: { voisinesLe: new Date(), communesVoisines: voisines.map(cleLieu) },
        });
        if (marque.count !== 1) return 0;
        await notifierElargissement(nouveaux, course, idCourse, 'aux communes voisines');
        return nouveaux.length;
      }
    }
  }

  const marque = await prisma.course.updateMany({
    where: { id: idCourse, statut: StatutCourse.APPEL_OFFRES, elargieLe: null },
    data: { elargieLe: new Date() },
  });
  if (marque.count !== 1) return 0;

  const nouveaux = await prisma.livreurProfile.findMany({
    where: {
      ...enService,
      ...filtrePrefecture(course.prefecture),
      NOT: { OR: dejaPrevenus },
    },
    select: { utilisateur: { select: { id: true } } },
  });
  await notifierElargissement(nouveaux, course, idCourse, 'a toute la prefecture');
  return nouveaux.length;
}

/** Le job : les courses restees sans aucune offre au-dela du delai s'elargissent. */
export async function elargirCoursesEnAttente(
  delaiMinutes: number,
  maintenant = new Date(),
): Promise<{ elargies: number }> {
  const limite = new Date(maintenant.getTime() - delaiMinutes * 60_000);
  const enAttente = await prisma.course.findMany({
    where: {
      statut: StatutCourse.APPEL_OFFRES,
      elargieLe: null,
      // Chaque etape a son propre delai : depuis l'ouverture tant que la
      // course est dans sa commune, depuis l'ouverture aux voisines ensuite.
      // R1 : l'ouverture de l'appel en cours, remise a l'heure par une relance.
      OR: [
        { voisinesLe: null, ouverteLe: { lte: limite } },
        { voisinesLe: { lte: limite } },
      ],
      // Des offres attendent le choix du patient : elargir n'apporterait rien.
      offres: { none: {} },
    },
    select: { id: true },
    orderBy: { ouverteLe: 'asc' },
    take: 100,
  });
  // Ne compte que les courses effectivement portees a de nouveaux motards.
  let elargies = 0;
  for (const { id } of enAttente) {
    if ((await elargirCourse(id)) > 0) elargies++;
  }
  return { elargies };
}

/**
 * R1 : une course restee sans aucune offre au-dela du delai final passe
 * « sans motard ». La commande reste prete pour la livraison : c'est le
 * patient qui choisit de relancer la recherche ou d'aller la chercher.
 * Une course qui a recu des offres attend son choix, elle n'expire pas.
 * Conditionnel : une offre arrivee a la meme seconde garde la course ouverte.
 */
export async function conclureCoursesExpirees(
  delaiFinalMinutes: number,
  maintenant = new Date(),
): Promise<{ conclues: number }> {
  const limite = new Date(maintenant.getTime() - delaiFinalMinutes * 60_000);
  const sansOffre = { statut: StatutCourse.APPEL_OFFRES, offres: { none: {} } };
  const expirees = await prisma.course.findMany({
    where: { ...sansOffre, ouverteLe: { lte: limite } },
    select: { id: true },
    orderBy: { ouverteLe: 'asc' },
    take: 100,
  });
  let conclues = 0;
  for (const { id } of expirees) {
    const conclue = await prisma.course.updateMany({
      where: { id, ...sansOffre },
      data: { statut: StatutCourse.SANS_MOTARD },
    });
    if (conclue.count !== 1) continue;
    conclues++;
    await avertirSansMotard(id);
  }
  return { conclues };
}

/** Le patient choisit la suite ; l'officine sait que personne ne viendra pour l'instant. */
async function avertirSansMotard(idCourse: string): Promise<void> {
  try {
    const course = await prisma.course.findUnique({
      where: { id: idCourse },
      select: {
        numero: true,
        commande: {
          select: {
            idPharmacie: true,
            ordonnance: { select: { consultation: { select: { patient: { select: { idUtilisateur: true } } } } } },
          },
        },
      },
    });
    if (!course) throw new NotFoundError('Course introuvable pour la notification');
    const idPatient = course.commande.ordonnance.consultation?.patient.idUtilisateur;
    if (idPatient) {
      await notifierSansBloquer({
        idUtilisateur: idPatient,
        type: 'COURSE_SANS_MOTARD',
        titre: 'Aucun livreur disponible pour le moment',
        contenu: `Aucun livreur n'a propose la course ${course.numero}. Vous pouvez relancer la recherche ou aller chercher votre commande a la pharmacie.`,
        lienAction: '/patient/commandes',
        metadonnees: { idCourse, numero: course.numero },
      });
    }
    const idPharmacie = course.commande.idPharmacie;
    if (!idPharmacie) return;
    const pharmaciens = await prisma.utilisateur.findMany({
      where: { idStructure: idPharmacie, role: Role.PHARMACIEN, estActif: true },
      select: { id: true },
    });
    await Promise.all(pharmaciens.map(({ id }) => notifierSansBloquer({
      idUtilisateur: id,
      type: 'COURSE_SANS_MOTARD',
      titre: 'Course sans livreur',
      contenu: `Aucun livreur n'a propose la course ${course.numero}. Le patient choisit de relancer ou de venir la chercher.`,
      lienAction: '/pharmacien/commandes',
      metadonnees: { idCourse, numero: course.numero },
    })));
  } catch (error: unknown) {
    logger.warn('[COURSE] notification sans motard impossible', {
      idCourse,
      erreur: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Notifie les destinataires sans faire echouer l'action metier. */
export async function notifierLivreursCourse(idCourse: string): Promise<void> {
  try {
    const course = await prisma.course.findUnique({
      where: { id: idCourse },
      select: { numero: true, quartier: true, prefecture: true, commune: true },
    });
    if (!course) throw new NotFoundError('Course non trouvee pour la notification');
    const destinataires = await prisma.livreurProfile.findMany({
      where: {
        estActif: true,
        // Seul un motard en service est prevenu : celui qui ne travaille pas
        // aujourd'hui laisserait l'appel sans reponse (voir livreur-zone).
        enService: true,
        // La commune de la course, pas tout le pays : un motard de Coyah ne
        // vient pas livrer a Ratoma (voir utils/zone.ts). Sa propre commune,
        // ou une commune qu'il dessert dans la meme prefecture.
        OR: livreursDeLaZone(course),
        utilisateur: { role: Role.LIVREUR, estActif: true },
      },
      select: { utilisateur: { select: { id: true } } },
    });
    await Promise.all(destinataires.map(({ utilisateur }) => notifierSansBloquer({
      idUtilisateur: utilisateur.id,
      type: 'COURSE_OUVERTE',
      titre: 'Nouvelle course dans votre zone',
      contenu: `La course ${course.numero} est ouverte a ${course.commune ?? course.quartier}.`,
      lienAction: '/livreur/courses',
      metadonnees: { idCourse, numero: course.numero, quartier: course.quartier },
    })));
  } catch (error: unknown) {
    logger.warn('[COURSE] notification d ouverture impossible', {
      idCourse,
      erreur: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Notifie le patient proprietaire de l'arrivee ou de la mise a jour d'une offre. */
async function notifierPatientNouvelleOffre(
  idCourse: string,
  offre: OffreCourseView,
): Promise<void> {
  try {
    const course = await prisma.course.findUnique({
      where: { id: idCourse },
      select: {
        numero: true,
        commande: {
          select: {
            ordonnance: {
              select: {
                consultation: {
                  select: { patient: { select: { idUtilisateur: true } } },
                },
              },
            },
          },
        },
      },
    });
    const idPatient = course?.commande.ordonnance.consultation?.patient.idUtilisateur;
    if (!course || !idPatient) throw new NotFoundError('Patient de la course introuvable pour la notification');
    await notifierSansBloquer({
      idUtilisateur: idPatient,
      type: 'OFFRE_COURSE',
      titre: 'Nouvelle offre de livraison',
      contenu: `Un livreur propose la course ${course.numero} pour ${offre.prixGnf} GNF en ${offre.delaiMinutes} minutes.`,
      lienAction: '/patient/commandes',
      metadonnees: { idCourse, numero: course.numero },
    });
  } catch (error: unknown) {
    logger.warn('[COURSE] notification patient d offre impossible', {
      idCourse,
      erreur: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Notifie les pharmaciens de l'officine choisie, sans faire circuler de details medicaux. */
async function notifierPharmacieCourseAttribuee(idCourse: string): Promise<void> {
  try {
    const course = await prisma.course.findUnique({
      where: { id: idCourse },
      select: {
        numero: true,
        prixGnf: true,
        delaiAnnonceMinutes: true,
        commande: { select: { idPharmacie: true } },
      },
    });
    const idPharmacie = course?.commande.idPharmacie;
    if (!course || !idPharmacie || course.prixGnf === null || course.delaiAnnonceMinutes === null) {
      throw new ValidationError('Attribution incomplete pour notifier la pharmacie');
    }
    const destinataires = await prisma.utilisateur.findMany({
      where: { idStructure: idPharmacie, role: Role.PHARMACIEN, estActif: true },
      select: { id: true },
    });
    await Promise.all(destinataires.map(({ id }) => notifierSansBloquer({
      idUtilisateur: id,
      type: 'COURSE_ATTRIBUEE',
      titre: 'Un livreur a ete choisi',
      contenu: `Le livreur de la course ${course.numero} a ete choisi : ${course.prixGnf} GNF, ${course.delaiAnnonceMinutes} minutes annoncees.`,
      lienAction: '/pharmacien/commandes',
      metadonnees: { idCourse, numero: course.numero },
    })));
  } catch (error: unknown) {
    logger.warn('[COURSE] notification pharmacie d attribution impossible', {
      idCourse,
      erreur: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cree la course dans la transaction qui rend la commande prete. La
 * prefecture est lue depuis le profil patient au moment de l'ouverture, puis
 * copiee dans la course : toute modification ulterieure du profil est sans
 * effet sur sa zone.
 */
export async function ouvrirCourse(
  idCommande: string,
  tx: CourseTransactionClient,
): Promise<{ id: string; statut: StatutCourse }> {
  const commande = await tx.commande.findUnique({
    where: { id: idCommande },
    select: {
      id: true,
      statut: true,
      modeRemise: true,
      quartierRecherche: true,
      communeRecherche: true,
      ordonnance: {
        select: {
          consultation: {
            select: { patient: { select: { prefecture: true, commune: true } } },
          },
        },
      },
    },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  if (commande.statut !== StatutCommande.PRETE_POUR_LIVRAISON || commande.modeRemise !== ModeRemise.LIVRAISON) {
    throw new ConflictError('La commande doit etre prete pour livraison avant d ouvrir une course');
  }

  const existante = await tx.course.findFirst({
    where: { idCommande, statut: { notIn: [StatutCourse.LIVREE, StatutCourse.ANNULEE] } },
    select: { id: true, statut: true },
  });
  if (existante) return existante;

  const quartier = commande.quartierRecherche?.trim();
  const prefecture = commande.ordonnance.consultation?.patient.prefecture.trim();
  if (!quartier || !prefecture) {
    throw new ValidationError('Le quartier et la prefecture du patient sont requis pour ouvrir la course');
  }

  // La commune figee sur la commande ; a defaut, celle du patient.
  const commune = (commande.communeRecherche ?? commande.ordonnance.consultation?.patient.commune ?? '').trim() || null;

  const course = await tx.course.create({
    data: {
      numero: await prochainNumero('LV', tx),
      idCommande,
      quartier,
      prefecture,
      commune,
    },
    select: { id: true, statut: true },
  });
  return course;
}

/** Courses ouvertes uniquement dans la zone declaree par le livreur actif. */
export async function coursesOuvertesPour(user: JwtPayload): Promise<CourseLivreurView[]> {
  exigerRole(user, Role.LIVREUR);
  const profile = await profilLivreur(user.userId, true);
  const courses = await prisma.course.findMany({
    where: {
      statut: StatutCourse.APPEL_OFFRES,
      OR: [
        // Sa commune et celles qu'il dessert.
        ...(filtreZones(zonesDuLivreur(profile)).OR as Record<string, unknown>[]),
        // Et les courses elargies a toute sa prefecture (M5).
        { elargieLe: { not: null }, ...filtrePrefecture(profile.prefecture) },
        // Et celles ouvertes a ses communes en tant que voisines (M1-C).
        {
          voisinesLe: { not: null },
          communesVoisines: { hasSome: communesDuLivreur(profile) },
          ...filtrePrefecture(profile.prefecture),
        },
      ],
    },
    select: COURSE_LIVREUR_OPEN_SELECT,
    orderBy: { creeeLe: 'asc' },
  });
  return courses.map((course) => ({
    id: course.id,
    numero: course.numero,
    statut: course.statut,
    quartier: course.quartier,
    prefecture: course.prefecture,
    prixGnf: course.prixGnf,
    delaiAnnonceMinutes: course.delaiAnnonceMinutes,
    creeeLe: course.creeeLe.toISOString(),
    attribueeLe: course.attribueeLe?.toISOString() ?? null,
    remiseLe: course.remiseLe?.toISOString() ?? null,
    livreeLe: course.livreeLe?.toISOString() ?? null,
    pharmacie: course.commande.pharmacie,
  }));
}

/** Historique du livreur ; les coordonnees du patient n'apparaissent qu'apres attribution. */
export async function coursesDuLivreur(user: JwtPayload): Promise<MesCoursesLivreurView> {
  exigerRole(user, Role.LIVREUR);
  const profile = await profilLivreur(user.userId, false);
  const courses = await prisma.course.findMany({
    where: { idLivreur: profile.id },
    select: COURSE_LIVREUR_ASSIGNED_SELECT,
    orderBy: { creeeLe: 'desc' },
  });
  return { qrCode: profile.qrCode, courses: courses.map(versCourseLivreurView) };
}

/** Enregistre ou remplace l'unique offre du livreur pour cette course. */
export async function proposer(
  user: JwtPayload,
  idCourse: string,
  offre: ProposerOffreCourseDto,
): Promise<OffreCourseView> {
  exigerRole(user, Role.LIVREUR);
  const profile = await profilLivreur(user.userId, true);
  // Une offre engage a venir : hors service, on ne s'engage a rien.
  if (!profile.enService) {
    throw new ForbiddenError('Passez en service pour proposer une offre');
  }
  if (!Number.isInteger(offre.prixGnf) || offre.prixGnf <= 0) {
    throw new ValidationError('Le prix doit etre un entier positif');
  }
  if (!Number.isInteger(offre.delaiMinutes) || offre.delaiMinutes <= 0) {
    throw new ValidationError('Le delai doit etre un entier positif');
  }

  const resultat = await prisma.$transaction(async (tx) => {
    // Lock the open row so an attribution cannot race past the status check.
    const verrou = await tx.course.updateMany({
      where: { id: idCourse, statut: StatutCourse.APPEL_OFFRES },
      data: { statut: StatutCourse.APPEL_OFFRES },
    });
    if (verrou.count !== 1) {
      const course = await tx.course.findUnique({ where: { id: idCourse }, select: { id: true } });
      if (!course) throw new NotFoundError('Course non trouvee');
      throw new ConflictError('Cette course n accepte plus de proposition');
    }

    const course = await tx.course.findUnique({
      where: { id: idCourse },
      select: { quartier: true, prefecture: true, commune: true, elargieLe: true, voisinesLe: true, communesVoisines: true },
    });
    if (!course) throw new NotFoundError('Course non trouvee');
    const ouverteAuxVoisines = !!course.voisinesLe
      && communesDuLivreur(profile).some((c) => course.communesVoisines.includes(c));
    const dansSaZone = dansLesZones(course, zonesDuLivreur(profile))
      || (memePrefecture(course, profile) && (!!course.elargieLe || ouverteAuxVoisines));
    if (!dansSaZone) {
      throw new ForbiddenError('Cette course est hors de votre zone');
    }

    const result = await tx.offreCourse.upsert({
      where: { idCourse_idLivreur: { idCourse, idLivreur: profile.id } },
      create: {
        idCourse,
        idLivreur: profile.id,
        prixGnf: offre.prixGnf,
        delaiMinutes: offre.delaiMinutes,
      },
      update: { prixGnf: offre.prixGnf, delaiMinutes: offre.delaiMinutes },
      select: { id: true, prixGnf: true, delaiMinutes: true, creeeLe: true },
    });
    return {
      id: result.id,
      prixGnf: result.prixGnf,
      delaiMinutes: result.delaiMinutes,
      creeeLe: result.creeeLe.toISOString(),
    };
  });
  await notifierPatientNouvelleOffre(idCourse, resultat);
  return resultat;
}

/** Offres classees par prix puis delai, apres verification de propriete patient. */
export async function offresDeMaCommande(
  user: JwtPayload,
  idCommande: string,
): Promise<OffreCourseView[]> {
  exigerRole(user, Role.PATIENT);
  const commande = await prisma.commande.findUnique({
    where: { id: idCommande },
    select: {
      id: true,
      ordonnance: {
        select: {
          consultation: { select: { patient: { select: { idUtilisateur: true } } } },
        },
      },
    },
  });
  if (!commande) throw new NotFoundError('Commande non trouvee');
  if (commande.ordonnance.consultation?.patient.idUtilisateur !== user.userId) {
    throw new ForbiddenError('Cette commande ne vous appartient pas');
  }
  const course = await prisma.course.findFirst({
    where: { idCommande, statut: StatutCourse.APPEL_OFFRES },
    select: { id: true },
    orderBy: { creeeLe: 'desc' },
  });
  if (!course) return [];

  const offres = await prisma.offreCourse.findMany({
    where: { idCourse: course.id },
    select: { id: true, prixGnf: true, delaiMinutes: true, creeeLe: true },
    orderBy: [{ prixGnf: 'asc' }, { delaiMinutes: 'asc' }],
  });
  return offres.map((offre) => ({
    id: offre.id,
    prixGnf: offre.prixGnf,
    delaiMinutes: offre.delaiMinutes,
    creeeLe: offre.creeeLe.toISOString(),
  }));
}

/** Le patient choisit une offre ; le prix accepte est copie dans la course. */
export async function choisirOffre(
  user: JwtPayload,
  idCommande: string,
  idOffre: string,
): Promise<CourseView> {
  exigerRole(user, Role.PATIENT);
  const result = await prisma.$transaction(async (tx) => {
    await commandeDuPatient(tx, user, idCommande);
    const offre = await tx.offreCourse.findFirst({
      where: { id: idOffre, course: { idCommande } },
      select: {
        idCourse: true,
        idLivreur: true,
        prixGnf: true,
        delaiMinutes: true,
        course: { select: { statut: true } },
      },
    });
    if (!offre) throw new NotFoundError('Offre non trouvee pour cette commande');
    assertTransitionCourse(offre.course.statut, StatutCourse.ATTRIBUEE);

    const maintenant = new Date();
    const result = await tx.course.updateMany({
      where: { id: offre.idCourse, statut: StatutCourse.APPEL_OFFRES },
      data: {
        statut: StatutCourse.ATTRIBUEE,
        idLivreur: offre.idLivreur,
        prixGnf: offre.prixGnf,
        delaiAnnonceMinutes: offre.delaiMinutes,
        attribueeLe: maintenant,
      },
    });
    if (result.count !== 1) throw new ConflictError('Une autre attribution a deja eu lieu');
    return obtenirCourseView(tx, offre.idCourse);
  });
  await notifierPharmacieCourseAttribuee(
    // The course's unique id is carried by the view returned by the transaction.
    result.id,
  );
  return result;
}

/** Le QR doit correspondre au motard attribue avant toute mutation. */
export async function remettreAuMotard(
  user: JwtPayload,
  idCourse: string,
  qrCodeScanne: string,
): Promise<CourseView> {
  exigerRole(user, Role.PHARMACIEN);
  return prisma.$transaction(async (tx) => {
    const coursier = await tx.utilisateur.findUnique({
      where: { id: user.userId },
      select: { idStructure: true, structure: { select: { type: true, estPartenaire: true } } },
    });
    if (!coursier?.structure || !estStructureOfficinale(coursier.structure.type)) {
      throw new ForbiddenError('Compte sans structure pharmaceutique');
    }
    if (!coursier.structure.estPartenaire) {
      throw new ForbiddenError('Votre pharmacie n est pas partenaire de la plateforme');
    }

    const course = await tx.course.findUnique({
      where: { id: idCourse },
      select: {
        id: true,
        statut: true,
        idLivreur: true,
        livreur: { select: { qrCode: true } },
        commande: { select: { id: true, idPharmacie: true } },
      },
    });
    if (!course) throw new NotFoundError('Course non trouvee');
    if (!coursier.idStructure || course.commande.idPharmacie !== coursier.idStructure) {
      throw new ForbiddenError('Cette course ne concerne pas votre pharmacie');
    }
    if (!course.livreur || course.livreur.qrCode !== qrCodeScanne) {
      throw new ValidationError('Le QR scanne ne correspond pas au motard attribue ; aucun changement n a ete effectue');
    }
    assertTransitionCourse(course.statut, StatutCourse.EN_COURS);

    const maintenant = new Date();
    const majCourse = await tx.course.updateMany({
      where: { id: idCourse, statut: StatutCourse.ATTRIBUEE, idLivreur: course.idLivreur },
      data: { statut: StatutCourse.EN_COURS, remiseLe: maintenant },
    });
    if (majCourse.count !== 1) throw new ConflictError('La course a change avant la remise');
    const majCommande = await tx.commande.updateMany({
      where: { id: course.commande.id, statut: StatutCommande.PRETE_POUR_LIVRAISON },
      data: { statut: StatutCommande.RETIREE, remiseLe: maintenant },
    });
    if (majCommande.count !== 1) throw new ConflictError('La commande ne peut pas etre remise au motard dans son etat actuel');
    return obtenirCourseView(tx, idCourse);
  });
}

/** Seul le patient proprietaire peut confirmer la reception et clore le dossier. */
export async function declarerRecu(user: JwtPayload, idCourse: string): Promise<CourseView> {
  exigerRole(user, Role.PATIENT);
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: idCourse },
      select: { id: true, statut: true, idCommande: true },
    });
    if (!course) throw new NotFoundError('Course non trouvee');
    await commandeDuPatient(tx, user, course.idCommande);
    assertTransitionCourse(course.statut, StatutCourse.LIVREE);

    const maintenant = new Date();
    const majCourse = await tx.course.updateMany({
      where: { id: idCourse, statut: StatutCourse.EN_COURS },
      data: { statut: StatutCourse.LIVREE, livreeLe: maintenant },
    });
    if (majCourse.count !== 1) throw new ConflictError('La course a change avant la confirmation');
    const majCommande = await tx.commande.updateMany({
      where: { id: course.idCommande, statut: StatutCommande.RETIREE },
      data: { statut: StatutCommande.CLOTUREE, clotureeLe: maintenant },
    });
    if (majCommande.count !== 1) throw new ConflictError('La commande ne peut pas etre cloturee dans son etat actuel');
    return obtenirCourseView(tx, idCourse);
  });
}

/**
 * R1 : apres le delai final, le patient relance la recherche d'un livreur.
 * L'appel repart de zero : sa commune d'abord, puis les elargissements, avec
 * des delais comptes depuis la relance.
 */
export async function relancerCourse(user: JwtPayload, idCourse: string): Promise<CourseView> {
  exigerRole(user, Role.PATIENT);
  const vue = await prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: idCourse },
      select: { id: true, statut: true, idCommande: true },
    });
    if (!course) throw new NotFoundError('Course non trouvee');
    const commande = await commandeDuPatient(tx, user, course.idCommande);
    if (course.statut !== StatutCourse.SANS_MOTARD) {
      throw new ConflictError('Seule une course sans livreur peut etre relancee');
    }
    // Repassee au retrait, la commande n'attend plus de livreur.
    if (commande.statut !== StatutCommande.PRETE_POUR_LIVRAISON) {
      throw new ConflictError("La commande n'attend plus de livraison");
    }
    assertTransitionCourse(course.statut, StatutCourse.APPEL_OFFRES);

    const relancee = await tx.course.updateMany({
      where: { id: idCourse, statut: StatutCourse.SANS_MOTARD },
      data: {
        statut: StatutCourse.APPEL_OFFRES,
        ouverteLe: new Date(),
        voisinesLe: null,
        communesVoisines: [],
        elargieLe: null,
      },
    });
    if (relancee.count !== 1) throw new ConflictError('La course a change avant la relance');
    return obtenirCourseView(tx, idCourse);
  });
  // Hors transaction : un echec d'envoi ne doit pas annuler la relance.
  await notifierLivreursCourse(idCourse);
  return vue;
}

/** Le patient peut repasser au retrait tant que les produits ne sont pas partis. */
export async function renoncerALaLivraison(
  user: JwtPayload,
  idCourse: string,
  motif: string,
): Promise<CourseView> {
  exigerRole(user, Role.PATIENT);
  if (motif.trim().length < 5) throw new ValidationError('Le motif doit contenir au moins cinq caracteres');

  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: idCourse },
      select: { id: true, statut: true, idCommande: true },
    });
    if (!course) throw new NotFoundError('Course non trouvee');
    const commande = await commandeDuPatient(tx, user, course.idCommande);
    let statutFinal: StatutCourse;

    if (course.statut === StatutCourse.SANS_MOTARD && commande.statut === StatutCommande.PRETE_POUR_RETRAIT) {
      return obtenirCourseView(tx, idCourse);
    }
    if (course.statut === StatutCourse.APPEL_OFFRES) {
      statutFinal = StatutCourse.SANS_MOTARD;
    } else if (course.statut === StatutCourse.SANS_MOTARD) {
      statutFinal = StatutCourse.SANS_MOTARD;
    } else if (course.statut === StatutCourse.ATTRIBUEE) {
      statutFinal = StatutCourse.ANNULEE;
    } else {
      throw new ConflictError('La livraison ne peut plus etre abandonnee apres le depart des produits');
    }
    if (course.statut !== statutFinal) assertTransitionCourse(course.statut, statutFinal);
    if (commande.statut === StatutCommande.PRETE_POUR_LIVRAISON) {
      assertCommandeTransition(commande.statut, StatutCommande.PRETE_POUR_RETRAIT);
    } else {
      throw new ConflictError('La commande ne peut pas repasser au retrait dans son etat actuel');
    }

    const maintenant = new Date();
    const majCourse = await tx.course.updateMany({
      where: { id: idCourse, statut: course.statut },
      data: {
        statut: statutFinal,
        ...(statutFinal === StatutCourse.ANNULEE
          ? { motifAnnulation: motif.trim(), annuleeLe: maintenant }
          : {}),
      },
    });
    if (majCourse.count !== 1) throw new ConflictError('La course a change avant votre renoncement');

    const majCommande = await tx.commande.updateMany({
      where: { id: course.idCommande, statut: StatutCommande.PRETE_POUR_LIVRAISON },
      data: { statut: StatutCommande.PRETE_POUR_RETRAIT, modeRemise: ModeRemise.RETRAIT_PHARMACIE },
    });
    if (majCommande.count !== 1) throw new ConflictError('La commande ne peut pas repasser au retrait dans son etat actuel');
    return obtenirCourseView(tx, idCourse);
  });
}
