// Les demandes d'agrement : la porte par laquelle un etablissement demande
// son rattachement a la plateforme.
//
// **Ce que cette porte change.** Jusqu'ici, une structure n'entrait que par
// `POST /admin-structure/structures`, reservee a l'administration : un
// pharmacien devait trouver quelqu'un au ministere pour exister sur la
// plateforme. Ici il depose lui-meme son dossier, sans compte, et attend une
// decision.
//
// **Pourquoi aucun compte n'est cree au depot.** Un compte ouvert sur un
// dossier que personne n'a lu offrirait la plateforme a quiconque sait
// remplir un formulaire. Le compte nait de la validation.
//
// Ce service ne verifie pas qu'un agrement est authentique : personne ne peut
// le faire depuis une application. Il verifie que les pieces existent, sont
// lisibles, sont de vrais PDF, et que les references obligatoires du type
// demande sont presentes. Le reste est le travail de l'administration, et
// c'est precisement pour cela que l'ecran d'examen existe.
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { ConflictError, NotFoundError, ValidationError } from '../utils/app-error';
import { hashPassword } from '../utils/password.utils';
import { genererMotDePasseTemp } from './admin-structure.service';
import {
  envoyerAccuseDemandeAgrement,
  envoyerEmailAdminStructure,
  envoyerRefusDemandeAgrement,
} from './email.service';
import {
  ecrireFichiers,
  estStructurePublique,
  libellePiece,
  PIECES_REQUISES,
  piecesRequisesPour,
  SOUS_AUTORISATION_DU_PARENT,
  supprimerFichiers,
  validerIdentifiants,
  validerPieces,
  type FichierRecu,
} from './piece-agrement.service';
import { estStructureOfficinale, roleDuResponsable } from '../utils/officine.util';
import type { JwtPayload } from '../types/auth.types';
import {
  Role,
  RoleOfficine,
  StatutDemandeAgrement,
  TypePieceAgrement,
  TypeStructure,
} from '../config/generated/client/client';

/**
 * Les types qu'une demande peut porter.
 *
 * `POSTE` et `CENTRE` n'y sont pas : ce sont des structures publiques creees
 * par l'administration, qui n'ont personne a qui adresser une demande. Un
 * `ASSURANCE` non plus : il releve de la Banque Centrale, pas du ministere de
 * la Sante, et son circuit n'est pas celui-ci.
 */
export const TYPES_DEMANDE: readonly TypeStructure[] = [
  TypeStructure.PHARMACIE,
  TypeStructure.CLINIQUE,
  TypeStructure.LABORATOIRE,
  TypeStructure.HOPITAL_PREF,
  TypeStructure.HOPITAL_REG,
  TypeStructure.CHU,
];

/**
 * Vrai pour les trois hopitaux publics - les seuls types publics qui se
 * demandent ici, un poste ou un centre etant cree par l'administration
 * elle-meme.
 *
 * La regle de fond - ni registre du commerce ni arrete d'exploitation pour
 * une structure nee d'un acte de l'Etat - vit dans le service des pieces, qui
 * la tient pour les trois portes de creation. La garder en double ici, c'etait
 * la laisser diverger au premier changement.
 */
export function estHopitalPublic(type: TypeStructure | string): boolean {
  return estStructurePublique(type);
}

/**
 * Ce que le formulaire doit reclamer pour ce type.
 *
 * **La liste vient de la table partagee**, celle qu'appliquent aussi les
 * portes de creation administrative : une demande et une creation par
 * l'administration exigent desormais les memes pieces. Deux listes qui ne
 * disent pas la meme chose finissent par servir de contournement l'une a
 * l'autre - on depose la ou l'on exige le moins.
 */
export function piecesDemandeesPour(type: TypeStructure | string): readonly TypePieceAgrement[] {
  return piecesRequisesPour(type);
}

/** Reexportes pour l'ecran : le libelle et le caractere public viennent du serveur. */
export { estStructurePublique, libellePiece };

/**
 * Tous les types qui produisent un dossier, dans l'ordre de la table.
 *
 * Sert la route des pieces attendues, que lisent **les deux ecrans** : le
 * formulaire public et la creation par l'administration. Celle-ci cree aussi
 * des postes et des centres, absents des types demandables.
 */
export const TYPES_AVEC_DOSSIER = Object.keys(PIECES_REQUISES) as TypeStructure[];

/** Ce que le candidat envoie. Les champs vides sont deja ecartes par zod. */
export interface DemandeRecue {
  type: string;
  nom: string;
  prefecture: string;
  commune?: string | undefined;
  quartier?: string | undefined;
  adresse?: string | undefined;
  telephone: string;
  rccm?: string | undefined;
  numeroAgrementCreation?: string | undefined;
  numeroAgrementExploitation?: string | undefined;
  lieuAutorise?: string | undefined;
  responsable: {
    prenom: string;
    nom: string;
    telephone: string;
    email: string;
  };
}

/**
 * Le prochain numero de l'annee, de la forme `DA-2026-0001`.
 *
 * Le tri par ordre alphabetique donne bien le dernier numero parce que les
 * compteurs sont completes a quatre chiffres : `DA-2026-0009` precede
 * `DA-2026-0010`, et au-dela de neuf mille neuf cent quatre-vingt-dix-neuf,
 * `DA-2026-09999` precede encore `DA-2026-10000`.
 *
 * Deux depots simultanes peuvent viser le meme numero : l'unicite en base
 * refuse le second, et l'appelant recommence. Compter dans une transaction
 * serialisable aurait coute un verrou a chaque depot pour un cas qui se
 * produit quelques fois par an.
 */
async function prochainNumero(annee: number): Promise<string> {
  const prefixe = `DA-${annee}-`;
  const dernier = await prisma.demandeAgrement.findFirst({
    where: { numero: { startsWith: prefixe } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  const rang = dernier ? Number(dernier.numero.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(rang).padStart(4, '0')}`;
}

/** Vrai quand Prisma refuse une ecriture pour cause de doublon. */
function estCollision(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * Deposer une demande.
 *
 * L'ordre des controles n'est pas indifferent : **tout ce qui peut refuser le
 * dossier passe avant la premiere ecriture.** Un dossier incomplet ne doit
 * laisser derriere lui ni fichier sur le disque, ni ligne en base, ni numero
 * consomme.
 */
export async function deposer(
  dto: DemandeRecue,
  fichiers: readonly FichierRecu[],
  libelles: Readonly<Record<string, string | undefined>> = {},
) {
  if (!TYPES_DEMANDE.includes(dto.type as TypeStructure)) {
    throw new ValidationError("Ce type d'établissement ne se demande pas ici.");
  }
  const type = dto.type as TypeStructure;

  // `validerIdentifiants` applique seule la regle des structures publiques :
  // elle efface le RCCM et l'arrete d'exploitation d'un hopital, et exige la
  // reference de l'acte qui le cree. La repeter ici l'aurait laissee diverger.
  const identifiants = validerIdentifiants(type, dto);

  // Une piece complementaire n'a pas sa place dans une demande, et ce n'est
  // pas un choix de confort : `corpsJsonMultipart` remplace le corps de la
  // requete par le contenu du champ `donnees`, si bien que les champs texte
  // qui portaient les libelles ont disparu avant d'arriver ici. Une piece
  // `AUTRE` echouerait donc sur un message parlant de libelle manquant, que
  // le candidat ne pourrait pas corriger. On le dit franchement, et avant
  // tout le reste : une demande recoit les pieces exigees, qui sont toutes
  // obligatoires, et rien d'autre.
  if (fichiers.some((f) => f.fieldname === TypePieceAgrement.AUTRE)) {
    throw new ValidationError(
      'Une demande ne reçoit que les pièces exigées pour son type : les pièces complémentaires ne sont pas acceptées ici.',
    );
  }

  // `SOUS_AUTORISATION_DU_PARENT` n'exige aucune piece : on garde de
  // `validerPieces` la verification des octets, des noms de champ et des
  // doublons, et on nomme nous-memes ce qui manque - avec les libelles que le
  // candidat reconnait.
  const validees = validerPieces(SOUS_AUTORISATION_DU_PARENT, fichiers, libelles);
  const presentes = new Set(validees.map((p) => p.type));
  const manquantes = piecesDemandeesPour(type).filter((p) => !presentes.has(p));
  if (manquantes.length > 0) {
    throw new ValidationError(
      `Dossier incomplet : il manque ${manquantes.map((p) => libellePiece(type, p)).join(', ')}.`,
    );
  }

  // Un meme etablissement qui redepose pendant l'examen ferait deux dossiers
  // a instruire pour une seule officine. Son numero de telephone est ce qui
  // l'identifie le plus surement avant qu'il n'existe en base.
  const enCours = await prisma.demandeAgrement.findFirst({
    where: {
      telephone: dto.telephone,
      statut: { in: [StatutDemandeAgrement.RECUE, StatutDemandeAgrement.EN_ANALYSE] },
    },
    select: { numero: true },
  });
  if (enCours) {
    throw new ConflictError(
      `Une demande est déjà en cours d'examen pour ce numéro de téléphone (dossier ${enCours.numero}).`,
    );
  }

  // Le compte du responsable naitra de la validation. Verifier des maintenant
  // que son telephone est libre evite de refuser le dossier au moment de la
  // decision, quand le candidat a deja tout fourni. La verification sera
  // refaite a la validation : des mois peuvent passer.
  const telPris = await prisma.utilisateur.findUnique({
    where: { telephone: dto.responsable.telephone },
    select: { id: true },
  });
  if (telPris) {
    throw new ConflictError('Ce numéro de téléphone du responsable est déjà utilisé par un compte.');
  }
  const emailPris = await prisma.utilisateur.findUnique({
    where: { email: dto.responsable.email },
    select: { id: true },
  });
  if (emailPris) {
    throw new ConflictError('Cette adresse email du responsable est déjà utilisée par un compte.');
  }

  const fichiersEcrits = await ecrireFichiers(validees);

  const donnees = {
    type,
    nom: dto.nom.trim(),
    prefecture: dto.prefecture.trim(),
    commune: dto.commune?.trim() || null,
    quartier: dto.quartier?.trim() || null,
    adresse: dto.adresse?.trim() || null,
    telephone: dto.telephone,
    ...identifiants,
    responsablePrenom: dto.responsable.prenom.trim(),
    responsableNom: dto.responsable.nom.trim(),
    responsableTelephone: dto.responsable.telephone,
    responsableEmail: dto.responsable.email.trim().toLowerCase(),
  };

  let demande: { id: string; numero: string; deposeLe: Date } | null = null;
  try {
    // Trois tentatives : une collision de numero suppose deux depots dans la
    // meme fraction de seconde, trois de suite releveraient d'autre chose.
    for (let essai = 0; essai < 3 && !demande; essai += 1) {
      const numero = await prochainNumero(new Date().getFullYear());
      try {
        demande = await prisma.demandeAgrement.create({
          data: {
            ...donnees,
            numero,
            pieces: {
              create: fichiersEcrits.map((p) => ({
                type: p.type,
                fichier: p.fichier,
                taille: p.taille,
                libelle: p.libelle,
              })),
            },
          },
          select: { id: true, numero: true, deposeLe: true },
        });
      } catch (e) {
        if (!estCollision(e) || essai === 2) throw e;
        logger.warn('[AGREMENT] numero de dossier deja pris, nouvelle tentative', { numero });
      }
    }
  } catch (e) {
    // La demande n'existe pas : ses fichiers ne doivent pas survivre.
    await supprimerFichiers(fichiersEcrits.map((p) => p.fichier));
    throw e;
  }

  logger.info('[AGREMENT] demande deposee', {
    numero: demande!.numero,
    type,
    pieces: fichiersEcrits.length,
  });

  // L'accuse part apres l'enregistrement, et son echec ne le defait pas : le
  // dossier est recu, meme si le courriel ne part pas. Le candidat verra son
  // numero a l'ecran de toute facon.
  try {
    await envoyerAccuseDemandeAgrement({
      destinataire: donnees.responsableEmail,
      prenomNom: `${donnees.responsablePrenom} ${donnees.responsableNom}`,
      nomStructure: donnees.nom,
      numero: demande!.numero,
    });
  } catch (e) {
    logger.error("[AGREMENT] accuse de reception non envoye", {
      numero: demande!.numero,
      erreur: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    numero: demande!.numero,
    statut: StatutDemandeAgrement.RECUE,
    deposeLe: demande!.deposeLe.toISOString(),
  };
}

// ── L'examen, cote administration ────────────────────────────────

/** Ce que la liste affiche : de quoi trier, pas de quoi instruire. */
export async function lister(statut?: string) {
  const demandes = await prisma.demandeAgrement.findMany({
    ...(statut && statut !== 'TOUTES'
      ? { where: { statut: statut as StatutDemandeAgrement } }
      : {}),
    orderBy: { deposeLe: 'desc' },
    select: {
      id: true, numero: true, statut: true, type: true, nom: true,
      prefecture: true, commune: true, quartier: true, telephone: true,
      deposeLe: true,
      responsablePrenom: true, responsableNom: true,
      _count: { select: { pieces: true } },
    },
  });

  return demandes.map((d) => ({
    id: d.id,
    numero: d.numero,
    statut: d.statut,
    type: d.type,
    nom: d.nom,
    prefecture: d.prefecture,
    commune: d.commune,
    quartier: d.quartier,
    telephone: d.telephone,
    deposeLe: d.deposeLe.toISOString(),
    responsable: `${d.responsablePrenom} ${d.responsableNom}`,
    nombrePieces: d._count.pieces,
  }));
}

/**
 * Le dossier complet, tel que l'agent doit le voir pour decider.
 *
 * `manquantes` est recalculee a la lecture et non figee au depot : si la liste
 * des pieces exigees change, un dossier ancien doit se montrer incomplet
 * plutot que de paraitre conforme a une regle disparue.
 */
export async function detail(id: string) {
  const d = await prisma.demandeAgrement.findUnique({
    where: { id },
    select: {
      id: true, numero: true, statut: true, type: true, nom: true,
      prefecture: true, commune: true, quartier: true, adresse: true,
      telephone: true, rccm: true,
      numeroAgrementCreation: true, numeroAgrementExploitation: true,
      lieuAutorise: true,
      responsablePrenom: true, responsableNom: true,
      responsableTelephone: true, responsableEmail: true,
      motifRefus: true, examineLe: true, idStructureCreee: true,
      deposeLe: true,
      examinePar: { select: { prenom: true, nom: true } },
      pieces: {
        select: { id: true, type: true, taille: true, libelle: true, deposeLe: true },
        orderBy: { deposeLe: 'asc' },
      },
    },
  });
  if (!d) throw new NotFoundError('Demande introuvable');

  const presentes = new Set(d.pieces.map((p) => p.type));
  const manquantes = piecesDemandeesPour(d.type).filter((p) => !presentes.has(p));

  return {
    id: d.id,
    numero: d.numero,
    statut: d.statut,
    type: d.type,
    nom: d.nom,
    prefecture: d.prefecture,
    commune: d.commune,
    quartier: d.quartier,
    adresse: d.adresse,
    telephone: d.telephone,
    rccm: d.rccm,
    numeroAgrementCreation: d.numeroAgrementCreation,
    numeroAgrementExploitation: d.numeroAgrementExploitation,
    lieuAutorise: d.lieuAutorise,
    estHopitalPublic: estHopitalPublic(d.type),
    responsable: {
      prenom: d.responsablePrenom,
      nom: d.responsableNom,
      telephone: d.responsableTelephone,
      email: d.responsableEmail,
    },
    pieces: d.pieces.map((p) => ({
      id: p.id,
      type: p.type,
      libelle: p.libelle ?? libellePiece(d.type, p.type),
      taille: p.taille,
      deposeLe: p.deposeLe.toISOString(),
    })),
    manquantes: manquantes.map((p) => ({ type: p, libelle: libellePiece(d.type, p) })),
    complet: manquantes.length === 0,
    motifRefus: d.motifRefus,
    examineLe: d.examineLe?.toISOString() ?? null,
    examinePar: d.examinePar ? `${d.examinePar.prenom} ${d.examinePar.nom}` : null,
    idStructureCreee: d.idStructureCreee,
    deposeLe: d.deposeLe.toISOString(),
  };
}

/**
 * La demande, si elle peut encore etre decidee.
 *
 * **Une decision ne se reprend pas.** Revalider une demande refusee creerait
 * une structure sans que le candidat ait rien redepose ; refuser une demande
 * validee laisserait une structure vivante rattachee a un dossier refuse.
 * Dans les deux cas, l'etat visible mentirait sur la realite.
 */
async function demandeOuverte(id: string) {
  const d = await prisma.demandeAgrement.findUnique({
    where: { id },
    select: { id: true, numero: true, statut: true, type: true, nom: true },
  });
  if (!d) throw new NotFoundError('Demande introuvable');
  if (d.statut === StatutDemandeAgrement.VALIDEE) {
    throw new ConflictError(`Le dossier ${d.numero} a déjà été validé.`);
  }
  if (d.statut === StatutDemandeAgrement.REFUSEE) {
    throw new ConflictError(`Le dossier ${d.numero} a déjà été refusé.`);
  }
  return d;
}

/** Marquer un dossier comme instruit, pour que deux agents ne doublonnent pas. */
export async function mettreEnAnalyse(user: JwtPayload, id: string) {
  const d = await demandeOuverte(id);
  if (d.statut === StatutDemandeAgrement.EN_ANALYSE) return detail(id);

  await prisma.demandeAgrement.update({
    where: { id },
    data: {
      statut: StatutDemandeAgrement.EN_ANALYSE,
      idExaminePar: user.userId,
    },
  });
  logger.info('[AGREMENT] dossier mis en analyse', { numero: d.numero, parQui: user.userId });
  return detail(id);
}

/**
 * Valider : faire naitre la structure et le compte de son responsable.
 *
 * Trois ecritures qui doivent tenir ensemble - la structure, le rattachement
 * des pieces, le compte - donc une transaction. Les pieces ne sont pas
 * recopiees : elles recoivent l'identifiant de la structure et gardent celui
 * de la demande, si bien qu'aucun fichier ne bouge sur le disque et que
 * l'origine du dossier reste lisible.
 *
 * Le mot de passe temporaire ne sort **ni dans la reponse, ni dans les
 * journaux** : il part par courriel au responsable, et lui seul le voit. Il
 * est a changer des la premiere connexion.
 */
export async function valider(user: JwtPayload, id: string) {
  const ouverte = await demandeOuverte(id);
  const d = await prisma.demandeAgrement.findUniqueOrThrow({
    where: { id },
    select: {
      numero: true, type: true, nom: true, prefecture: true, commune: true,
      quartier: true, adresse: true, telephone: true, rccm: true,
      numeroAgrementCreation: true, numeroAgrementExploitation: true,
      lieuAutorise: true,
      responsablePrenom: true, responsableNom: true,
      responsableTelephone: true, responsableEmail: true,
    },
  });

  // Le dossier doit encore etre complet : la liste des pieces exigees peut
  // avoir change depuis le depot.
  const pieces = await prisma.pieceAgrement.findMany({
    where: { idDemande: id },
    select: { type: true },
  });
  const presentes = new Set(pieces.map((p) => p.type));
  const manquantes = piecesDemandeesPour(d.type).filter((p) => !presentes.has(p));
  if (manquantes.length > 0) {
    throw new ValidationError(
      `Dossier incomplet : il manque ${manquantes.map((p) => libellePiece(d.type, p)).join(', ')}.`,
    );
  }

  // Refait au moment de decider : des mois ont pu passer depuis le depot, et
  // le telephone du responsable a pu servir entretemps.
  const telPris = await prisma.utilisateur.findUnique({
    where: { telephone: d.responsableTelephone },
    select: { id: true },
  });
  if (telPris) {
    throw new ConflictError(
      'Le numéro de téléphone du responsable est désormais utilisé par un autre compte : la demande ne peut pas être validée en l’état.',
    );
  }
  const emailPris = await prisma.utilisateur.findUnique({
    where: { email: d.responsableEmail },
    select: { id: true },
  });
  if (emailPris) {
    throw new ConflictError(
      'L’adresse email du responsable est désormais utilisée par un autre compte : la demande ne peut pas être validée en l’état.',
    );
  }

  const motDePasseTemp = genererMotDePasseTemp();
  const motDePasseHash = await hashPassword(motDePasseTemp);

  const resultat = await prisma.$transaction(async (tx) => {
    const structure = await tx.structureSante.create({
      data: {
        nom: d.nom,
        type: d.type,
        prefecture: d.prefecture,
        commune: d.commune,
        quartier: d.quartier,
        adresse: d.adresse,
        telephone: d.telephone,
        rccm: d.rccm,
        numeroAgrementCreation: d.numeroAgrementCreation,
        numeroAgrementExploitation: d.numeroAgrementExploitation,
        lieuAutorise: d.lieuAutorise,
        estActive: true,
        // **Partenaire des la validation.** Une officine qui a produit son
        // agrement, son diplome et son inscription a l'ordre, et dont le
        // dossier a ete examine, a franchi une barriere autrement plus haute
        // qu'une convention commerciale. La laisser hors du circuit des
        // commandes - sans qu'aucun ecran ne puisse l'y faire entrer - revenait
        // a valider un dossier pour rien.
        estPartenaire: true,
        partenaireDepuis: new Date(),
      },
      select: { id: true },
    });

    await tx.pieceAgrement.updateMany({
      where: { idDemande: id },
      data: { idStructure: structure.id },
    });

    /**
     * **Le role depend du type, et c'est tout l'enjeu de ce bloc.**
     *
     * Une officine validee donnait un `ADMIN_STRUCTURE`, comme les autres.
     * Son titulaire arrivait alors sur un tableau de bord qui compte des
     * consultations et des patients rattaches - qu'une pharmacie n'a pas -,
     * et l'espace officine lui etait ferme : ni stock, ni commande, ni
     * caisse, ni ordonnance recue. Il ne pouvait litteralement rien faire.
     *
     * La creation par l'administration, elle, faisait deja un `PHARMACIEN`
     * titulaire. Deux portes, deux resultats pour le meme metier : c'est la
     * porte la plus recente qui avait tort.
     */
    // La correspondance entre le type de structure et le role de son
    // responsable n'est ecrite qu'a un seul endroit : les portes de creation
    // la lisent, elles ne la redecident pas.
    const officine = estStructureOfficinale(d.type);

    const compte = await tx.utilisateur.create({
      data: {
        telephone: d.responsableTelephone,
        email: d.responsableEmail,
        motDePasseHash,
        prenom: d.responsablePrenom,
        nom: d.responsableNom,
        role: roleDuResponsable(d.type),
        idStructure: structure.id,
        doitChangerMotDePasse: true,
      },
      select: { id: true },
    });

    // Le profil d'officine porte ce que le role ne dit pas : **titulaire**, et
    // responsable. C'est lui qui distingue le patron de son caissier, qui
    // porte pourtant le meme role.
    if (officine) {
      await tx.pharmacienProfile.create({
        data: {
          idUtilisateur: compte.id,
          idStructure: structure.id,
          estResponsable: true,
          roleOfficine: RoleOfficine.TITULAIRE,
        },
      });
    }

    await tx.demandeAgrement.update({
      where: { id },
      data: {
        statut: StatutDemandeAgrement.VALIDEE,
        idStructureCreee: structure.id,
        idExaminePar: user.userId,
        examineLe: new Date(),
        motifRefus: null,
      },
    });

    return structure;
  });

  logger.info('[AGREMENT] demande validee', {
    numero: ouverte.numero,
    type: d.type,
    idStructure: resultat.id,
    parQui: user.userId,
  });

  // Le courriel part apres le commit : la structure existe, le compte aussi.
  // Son echec n'annule rien - mais il laisse le responsable sans ses
  // identifiants, donc il est journalise comme une erreur et non comme un
  // simple avertissement.
  try {
    await envoyerEmailAdminStructure({
      destinataire: d.responsableEmail,
      prenomNom: `${d.responsablePrenom} ${d.responsableNom}`,
      nomStructure: d.nom,
      telephone: d.responsableTelephone,
      motDePasseTemporaire: motDePasseTemp,
    });
  } catch (e) {
    logger.error('[AGREMENT] identifiants non envoyes apres validation', {
      numero: ouverte.numero,
      erreur: e instanceof Error ? e.message : String(e),
    });
  }

  return detail(id);
}

/**
 * Refuser, avec un motif.
 *
 * Le motif est **obligatoire ici et non dans le schema** : une base ne sait
 * pas conditionner une colonne a la valeur d'une autre. Sans motif, le
 * candidat redepose un dossier identique et l'administration reexamine la
 * meme chose.
 *
 * Les pieces ne sont pas detruites : elles sont la preuve de ce sur quoi la
 * decision a porte.
 */
export async function refuser(user: JwtPayload, id: string, motif: string) {
  const d = await demandeOuverte(id);
  const motifNet = motif.trim();
  if (motifNet.length < 10) {
    throw new ValidationError(
      'Le motif du refus doit être explicite : au moins dix caractères, pour que le candidat sache quoi corriger.',
    );
  }

  await prisma.demandeAgrement.update({
    where: { id },
    data: {
      statut: StatutDemandeAgrement.REFUSEE,
      motifRefus: motifNet,
      idExaminePar: user.userId,
      examineLe: new Date(),
    },
  });

  logger.info('[AGREMENT] demande refusee', {
    numero: d.numero,
    type: d.type,
    parQui: user.userId,
  });

  const complet = await prisma.demandeAgrement.findUniqueOrThrow({
    where: { id },
    select: {
      numero: true, nom: true,
      responsablePrenom: true, responsableNom: true, responsableEmail: true,
    },
  });

  try {
    await envoyerRefusDemandeAgrement({
      destinataire: complet.responsableEmail,
      prenomNom: `${complet.responsablePrenom} ${complet.responsableNom}`,
      nomStructure: complet.nom,
      numero: complet.numero,
      motif: motifNet,
    });
  } catch (e) {
    logger.error('[AGREMENT] refus non notifie', {
      numero: complet.numero,
      erreur: e instanceof Error ? e.message : String(e),
    });
  }

  return detail(id);
}
