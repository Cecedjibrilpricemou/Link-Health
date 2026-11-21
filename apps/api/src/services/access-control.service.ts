import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { ForbiddenError } from '../utils/app-error';
import { estPraticien } from '../utils/praticien.util';

type PatientWhere = Prisma.PatientProfileWhereInput;
type ConsultationWhere = Prisma.ConsultationWhereInput;

const ADMIN_ROLES = new Set(['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN']);

/**
 * Un refus explicite de partager le dossier (EF-02-03).
 *
 * **Defaut permissif, et c'est un choix de deploiement.** Pas de ligne de
 * consentement = acces autorise ; seul un `actif: false` coupe. Exiger un
 * accord positif aujourd'hui rendrait 11 dossiers sur 13 invisibles a tous les
 * soignants — mesure le 2026-10-07 — et treize bris de glace par jour ne sont
 * pas une issue de secours, c'est la porte principale.
 *
 * Ce qui change quand meme : **un retrait coupe reellement**, tout de suite.
 */
const REFUS_DE_PARTAGE: PatientWhere = {
  consentements: { some: { scope: 'DOSSIER_MEDICAL', actif: false } },
};

export async function buildPatientWhereForUser(user: JwtPayload): Promise<PatientWhere> {
  if (ADMIN_ROLES.has(user.role)) return {};

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: user.userId },
    select: {
      role: true,
      idStructure: true,
      patientProfile: { select: { id: true } },
      ascProfile: { select: { id: true, idStructure: true } },
      medecinProfile: { select: { idStructure: true } },
      pharmacienProfile: { select: { idStructure: true } },
    },
  });

  if (!utilisateur) return { id: '__forbidden__' };

  // Son propre dossier, toujours. Un patient ne se refuse pas a lui-meme.
  if (utilisateur.patientProfile) return { id: utilisateur.patientProfile.id };

  const parSoin = await relationDeSoin(user, utilisateur);
  if (!parSoin) return { id: '__forbidden__' };

  // **Le consentement et le bris de glace, au seul endroit ou tous les roles
  // passent.** Les mettre dans chaque branche laisserait un role dehors tot ou
  // tard — et un role dehors, ici, c'est un dossier lu sans droit.
  return {
    OR: [
      { AND: [parSoin, { NOT: REFUS_DE_PARTAGE }] },
      // L'acces d'urgence passe outre le refus : c'est sa raison d'etre
      // (EF-02-06). Il est declare, date, notifie au patient et relu.
      {
        brisDeGlace: {
          some: { idAuteur: user.userId, refermeLe: null, expireLe: { gt: new Date() } },
        },
      },
    ],
  };
}

type Profils = NonNullable<Awaited<ReturnType<typeof chargerProfils>>>;
async function chargerProfils(id: string) {
  return prisma.utilisateur.findUnique({
    where: { id },
    select: {
      role: true, idStructure: true,
      patientProfile: { select: { id: true } },
      ascProfile: { select: { id: true, idStructure: true } },
      medecinProfile: { select: { idStructure: true } },
      pharmacienProfile: { select: { idStructure: true } },
    },
  });
}

/** La relation de soin seule. `null` : aucun lien, donc aucun acces. */
async function relationDeSoin(user: JwtPayload, utilisateur: Profils): Promise<PatientWhere | null> {
  const idStructure =
    utilisateur.idStructure ??
    utilisateur.ascProfile?.idStructure ??
    utilisateur.medecinProfile?.idStructure ??
    utilisateur.pharmacienProfile?.idStructure;

  if (utilisateur.ascProfile) {
    return {
      OR: [
        { idAscPrincipal: utilisateur.ascProfile.id },
        { consultations: { some: { idAsc: utilisateur.ascProfile.id } } },
        ...(idStructure ? [{ idStructurePreferee: idStructure }] : []),
      ],
    };
  }

  // Un episode de soins ouvert dans la structure donne acces au dossier
  // (CDC ch. 8 : « les patients de son etablissement ayant un episode en cours »).
  const parEpisode: PatientWhere[] = idStructure
    ? [{ episodes: { some: { idStructure, statut: { in: ['OUVERT', 'EN_COURS'] } } } }]
    : [];

  if (estPraticien(user.role)) {
    return {
      OR: [
        {
          consultations: {
            some: {
              OR: [
                { idMedecinValideur: user.userId },
                ...(idStructure ? [{ asc: { idStructure } }] : []),
                ...(idStructure ? [{ referencement: { idStructureCible: idStructure } }] : []),
              ],
            },
          },
        },
        ...parEpisode,
        { episodes: { some: { idResponsable: user.userId } } },
      ],
    };
  }

  // L'infirmier soigne les patients en visite dans sa structure, et eux seuls.
  if (user.role === 'INFIRMIER' && idStructure) {
    return { OR: parEpisode };
  }

  if (user.role === 'AGENT_ACCUEIL' && idStructure) {
    return {
      OR: [
        ...parEpisode,
        // **Le patient qu'il vient d'enregistrer, avant tout episode.**
        // `creerPatientAuComptoir` pose `idStructurePreferee` sur la structure
        // de l'agent : c'est le rattachement cree au guichet. Sans cette
        // branche, la verification d'identite -- qui se fait justement a
        // l'inscription, avant qu'un episode existe -- ne trouverait pas le
        // dossier qu'on vient d'ouvrir devant soi.
        { idStructurePreferee: idStructure },
      ],
    };
  }

  // Le laboratoire ne voit que les patients dont une demande lui est adressee (EF-04).
  if (user.role === 'TECHNICIEN_LABO' && idStructure) {
    return { demandesAnalyse: { some: { idLaboratoire: idStructure } } };
  }

  if (user.role === 'ADMIN_STRUCTURE' && idStructure) {
    return {
      OR: [
        { idStructurePreferee: idStructure },
        { consultations: { some: { asc: { idStructure } } } },
        { consultations: { some: { referencement: { idStructureCible: idStructure } } } },
        ...parEpisode,
      ],
    };
  }

  if (user.role === 'PHARMACIEN' && idStructure) {
    // **`idStructure` etait teste puis jamais utilise.** Le filtre ne retenait
    // que « une ordonnance en attente, quelque part » : tout pharmacien du
    // pays atteignait tout patient en attente de delivrance, sans qu'aucun
    // lien ne les relie.
    //
    // Le lien reel est la commande : soit elle lui est attribuee, soit l'appel
    // de P6 l'a diffusee a son quartier -- c'est la maille de cet appel, et
    // c'est a ce titre qu'il peut la prendre. Un patient d'une autre ville,
    // qu'aucune commande ne lui adresse, sort du perimetre.
    const officine = await prisma.structureSante.findUnique({
      where: { id: idStructure },
      select: { quartier: true },
    });

    const parCommande: Prisma.CommandeWhereInput[] = [
      { idPharmacie: idStructure },
      ...(officine?.quartier ? [{ quartierRecherche: officine.quartier }] : []),
    ];

    return {
      consultations: {
        some: {
          ordonnances: {
            some: {
              statut: 'EN_ATTENTE',
              // Une ordonnance peut avoir sa commande d'origine et un
              // reliquat, servis par deux officines differentes.
              commandes: { some: { OR: parCommande } },
            },
          },
        },
      },
    };
  }

  return null;
}

export async function buildConsultationWhereForUser(user: JwtPayload): Promise<ConsultationWhere> {
  if (ADMIN_ROLES.has(user.role)) return {};

  const patientWhere = await buildPatientWhereForUser(user);

  if (user.role === 'ASC' || user.role === 'ASC_SUPERVISOR') {
    const asc = await prisma.ascProfile.findUnique({
      where: { idUtilisateur: user.userId },
      select: { id: true, idStructure: true },
    });

    if (!asc) return { id: '__forbidden__' };

    return {
      OR: [
        { idAsc: asc.id },
        { patient: patientWhere },
      ],
    };
  }

  if (estPraticien(user.role)) {
    const medecin = await prisma.medecinProfile.findUnique({
      where: { idUtilisateur: user.userId },
      select: { idStructure: true },
    });

    return {
      OR: [
        { idMedecinValideur: user.userId },
        // **La consultation qu'il mene lui-meme.** Les trois autres branches
        // supposent un tiers : un ASC qui l'a ouverte, un referencement qui
        // la lui adresse, ou sa propre signature deja posee. Une consultation
        // ouverte sur une visite de son hopital n'a aucun des trois : le
        // medecin la creait, puis recevait 403 sur les constantes, le
        // diagnostic, l'ordonnance et jusqu'a sa propre validation.
        ...(medecin?.idStructure ? [{ episode: { idStructure: medecin.idStructure } }] : []),
        ...(medecin?.idStructure ? [{ asc: { idStructure: medecin.idStructure } }] : []),
        ...(medecin?.idStructure ? [{ referencement: { idStructureCible: medecin.idStructure } }] : []),
      ],
    };
  }

  if (user.role === 'ADMIN_STRUCTURE') {
    const utilisateur = await prisma.utilisateur.findUnique({
      where: { id: user.userId },
      select: { idStructure: true },
    });

    if (!utilisateur?.idStructure) return { id: '__forbidden__' };

    return {
      OR: [
        // `ACTE_MEDICAL` ouvre la consultation d'une visite a l'administrateur
        // de structure autant qu'au medecin : sa porte d'acces doit suivre.
        { episode: { idStructure: utilisateur.idStructure } },
        { asc: { idStructure: utilisateur.idStructure } },
        { referencement: { idStructureCible: utilisateur.idStructure } },
      ],
    };
  }

  if (user.role === 'PATIENT') return { patient: patientWhere };

  return { id: '__forbidden__' };
}

export async function assertCanAccessPatient(user: JwtPayload, idPatient: string): Promise<void> {
  const patient = await prisma.patientProfile.findFirst({
    where: { AND: [{ id: idPatient }, await buildPatientWhereForUser(user)] },
    select: { id: true },
  });

  if (!patient) throw new ForbiddenError('Acces refuse au dossier patient');
}

export async function assertCanAccessConsultation(user: JwtPayload, idConsultation: string): Promise<void> {
  const consultation = await prisma.consultation.findFirst({
    where: { AND: [{ id: idConsultation }, await buildConsultationWhereForUser(user)] },
    select: { id: true },
  });

  if (!consultation) throw new ForbiddenError('Acces refuse a cette consultation');
}
