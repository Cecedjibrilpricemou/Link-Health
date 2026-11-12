import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { peremptionLaPlusProche } from './approvisionnement.service';
import { consommerLots } from './approvisionnement.service';
import { enregistrerMouvementStock } from './mouvement-stock.service';
import { Role, StatutOrdonnance, TypeActeDelivrance, TypeStructure } from '../config/generated/client/client';
import { notifierSansBloquer } from './notification.service';
import { hashPassword } from '../utils/password.utils';
import { assertMotDePasseConforme } from '../utils/politique-mot-de-passe';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { estStructureOfficinale, filtreStructuresOfficinales } from '../utils/officine.util';
import { empreinteCatalogue } from '../utils/catalogue';
import { getValeursParametres } from './parametres.service';
import {
  contientProduitReglemente,
  estExpiree,
  motifDeRefus,
  recalculerStatut,
  renouvelerOrdonnance,
  renouvellementsRestants,
} from './ordonnance.service';
import type {
  StockPharmacieView,
  MedicamentTarifeView,
  ProduitResumeView,
  OrdonnanceDelivranceView,
  OrdonnanceEnAttenteView,
  VerificationOrdonnanceView,
  CreateProduitOfficineDto,
  UpdateProduitOfficineDto,
} from '@baobaoheath/shared-types';

type CreateAgentPharmacieDto = {
  telephone: string;
  email?: string;
  prenom: string;
  nom: string;
  motDePasse?: string;
  roleOfficine?: 'ADJOINT' | 'PREPARATEUR' | 'CAISSIER';
};

function genererMotDePasseTemp(): string {
  return `BaoBao@${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

async function getPharmacienAvecStructure(pharmacienId: string) {
  const pharmacien = await prisma.utilisateur.findUnique({
    where: { id: pharmacienId },
    include: {
      structure: true,
      pharmacienProfile: true,
    },
  });

  if (!pharmacien?.idStructure || !pharmacien.structure) {
    throw new ForbiddenError('Pharmacien sans structure assignee');
  }
  if (!estStructureOfficinale(pharmacien.structure.type)) {
    throw new ValidationError('La structure assignee n est pas une pharmacie');
  }

  // Les gardes ci-dessus garantissent la structure ; le type le dit aussi.
  return { ...pharmacien, structure: pharmacien.structure };
}

type OrdonnanceAvecLignes = {
  id: string;
  numero: string;
  statut: StatutOrdonnance;
  valideJusquau: Date;
  signeLe: Date | null;
  creeLe: Date;
  renouvellementsAutorises: number;
  renouvellementsUtilises: number;
  signataire: { prenom: string; nom: string } | null;
  lignes: {
    id: string;
    posologie: string;
    frequence: string;
    dureeJours: number;
    quantite: number;
    statut: StatutOrdonnance;
    instructions: string | null;
    medicament: ProduitResumeView & { prixUnitaireGnf: number; estReglemente: boolean };
    /// Les actes de comptoir deja poses sur cette ligne (P6-b).
    actes?: { quantite: number }[];
  }[];
};

/**
 * Assemble la vue comptoir d'une ordonnance. `totalGnf` ne compte que les
 * lignes restant a delivrer : afficher le total prescrit ferait payer deux
 * fois un traitement deja entame dans une autre officine.
 */
function vueDelivrance(
  o: OrdonnanceAvecLignes,
  allergies: string[],
  agentDefaut: { prenom: string; nom: string } | null
): OrdonnanceDelivranceView {
  const signataire = o.signataire ?? agentDefaut;
  const lignes = o.lignes.map((l) => {
    const noms = [l.medicament.dci, l.medicament.nomCommercial].filter((n): n is string => !!n);
    const alerteAllergie = allergies.some((a) => noms.some((n) => a.toLowerCase() === n.toLowerCase()));
    // Substitutions comprises : une substitution sert bien la ligne.
    const quantiteServie = (l.actes ?? []).reduce((t, acte) => t + acte.quantite, 0);
    const resteAServir = Math.max(0, l.quantite - quantiteServie);
    return {
      id: l.id,
      posologie: l.posologie,
      frequence: l.frequence,
      dureeJours: l.dureeJours,
      quantite: l.quantite,
      statut: l.statut as OrdonnanceDelivranceView['statut'],
      instructions: l.instructions,
      medicament: l.medicament,
      estReglemente: l.medicament.estReglemente,
      quantiteServie,
      resteAServir,
      // **Le reste, pas le prescrit.** Une ligne entamee ailleurs se
      // facturait en entier : trois boites sur dix deja remises, et le
      // comptoir annoncait le prix des dix.
      prixTotalGnf: resteAServir * l.medicament.prixUnitaireGnf,
      alerteAllergie,
    };
  });

  return {
    id: o.id,
    numero: o.numero,
    statut: o.statut as OrdonnanceDelivranceView['statut'],
    valideJusquau: o.valideJusquau.toISOString(),
    expiree: estExpiree(o),
    signeLe: o.signeLe ? o.signeLe.toISOString() : null,
    medecinNom: signataire ? `${signataire.prenom} ${signataire.nom}` : 'Inconnu',
    lignes,
    totalGnf: lignes
      .filter((l) => l.statut !== StatutOrdonnance.DELIVREE)
      .reduce((somme, l) => somme + l.prixTotalGnf, 0),
    renouvellementsRestants: renouvellementsRestants(o),
    contientProduitReglemente: lignes.some((l) => l.estReglemente),
  };
}

export async function scanPatient(qrCode: string, pharmacienId: string) {
  await getPharmacienAvecStructure(pharmacienId);

  const patient = await prisma.patientProfile.findUnique({
    where: { qrCode },
    include: {
      utilisateur: { select: { id: true, prenom: true, nom: true, telephone: true } },
      consultations: {
        where: { statut: 'TERMINEE' },
        include: {
          asc: { include: { utilisateur: { select: { prenom: true, nom: true } } } },
          ordonnances: {
            // Une ordonnance partiellement servie reste a servir : la limiter
            // a EN_ATTENTE ferait disparaitre du comptoir le reste d'un
            // traitement deja entame ailleurs.
            where: {
              statut: {
                in: [StatutOrdonnance.EN_ATTENTE, StatutOrdonnance.PARTIELLEMENT_SERVIE],
              },
            },
            include: {
              // P6-b : les actes disent ce qui a deja ete servi, donc ce
              // qu'il reste a remettre et ce qu'il reste a payer.
              lignes: { include: { medicament: true, actes: { select: { quantite: true } } } },
              signataire: { select: { prenom: true, nom: true } },
            },
          },
        },
        orderBy: { consulteeLE: 'desc' },
        take: 5,
      },
    },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');

  const ordonnances = patient.consultations.flatMap((c) =>
    c.ordonnances.map((o) =>
      vueDelivrance(o, patient.allergies, c.asc?.utilisateur ?? null)
    )
  );

  return {
    patient: {
      id: patient.id,
      prenom: patient.utilisateur.prenom,
      nom: patient.utilisateur.nom,
      dateNaissance: patient.dateNaissance.toISOString(),
      sexe: patient.sexe,
      groupeSanguin: patient.groupeSanguin ?? undefined,
      allergiesCritiques: patient.allergies,
    },
    ordonnances,
    totalOrdonnances: ordonnances.length,
  };
}

/**
 * Delivrance d'un medicament de l'ordonnance. L'unite est la ligne, pas le
 * document : une officine peut n'avoir qu'une partie du traitement (EF-07-07).
 * Le document est controle avant toute sortie de stock — non signe, expire ou
 * annule, rien ne sort.
 */
// ════════════════════════════════════════════════════════════════════
// La delivrance au comptoir (EF-07-03/04/05/07)
// ════════════════════════════════════════════════════════════════════
//
// **Trois gestes, et un seul chemin.** Delivrer, substituer, refuser : les
// trois ecrivent un `ActeDelivrance` nominatif et recalculent l'etat de la
// ligne depuis la somme de ses actes. Un quatrieme geste qui oublierait de
// sommer delivrerait deux fois la meme ordonnance — c'est pourquoi la base
// porte aussi la garde, par un declencheur differe.

/** Ce que l'officine a deja servi sur une ligne, substitutions comprises. */
async function dejaServi(idLigne: string, client: ClientLecture = prisma): Promise<number> {
  const somme = await client.acteDelivrance.aggregate({
    where: { idLigneOrdonnance: idLigne },
    _sum: { quantite: true },
  });
  return somme._sum.quantite ?? 0;
}

type ClientLecture = Pick<typeof prisma, 'acteDelivrance'>;

/**
 * L'etat d'une ligne, deduit de ses actes.
 *
 * **Jamais pose a la main.** La version precedente ecrivait `DELIVREE` des le
 * premier geste, quelle que soit la quantite : une officine qui n'avait que
 * trois boites sur dix fermait la ligne, et les sept autres ne pouvaient plus
 * etre servies — ni la, ni ailleurs.
 */
function etatDeLaLigne(prescrit: number, servi: number): StatutOrdonnance {
  if (servi <= 0) return StatutOrdonnance.EN_ATTENTE;
  if (servi >= prescrit) return StatutOrdonnance.DELIVREE;
  return StatutOrdonnance.PARTIELLEMENT_SERVIE;
}

/**
 * Ce qu'il reste a servir sur une ligne, ou un refus net.
 *
 * **Deux gardes, et la seconde n'est pas une redondance.** La somme des actes
 * dit ce qui a ete remis depuis que cette table existe ; le statut de la
 * ligne couvre ce qui l'a ete **avant**. Les lignes marquees `DELIVREE` par
 * l'ancien code n'ont aucun acte : s'en remettre a la seule somme les
 * rendrait delivrables une seconde fois.
 *
 * On ne fabrique pas d'acte de rattrapage pour elles : il faudrait inventer
 * un pharmacien, une date et une quantite. Une trace nominative inventee vaut
 * moins que pas de trace — elle se lirait comme une signature.
 */
async function resteAServir(ligne: { id: string; quantite: number; statut: StatutOrdonnance }) {
  if (
    ligne.statut === StatutOrdonnance.DELIVREE
    || ligne.statut === StatutOrdonnance.SERVIE
    || ligne.statut === StatutOrdonnance.ANNULEE
    || ligne.statut === StatutOrdonnance.EXPIREE
  ) {
    throw new ValidationError('Ce medicament a deja ete delivre');
  }

  const servi = await dejaServi(ligne.id);
  const restant = ligne.quantite - servi;
  if (restant <= 0) {
    throw new ValidationError('Cette ligne a deja ete entierement servie');
  }
  return restant;
}

/** La ligne, son officine, et le refus eventuel du document. */
async function contexteDeDelivrance(ligneId: string, pharmacienId: string) {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);

  const ligne = await prisma.ligneOrdonnance.findUnique({
    where: { id: ligneId },
    include: { medicament: true, ordonnance: true },
  });
  if (!ligne) throw new NotFoundError('Ligne d ordonnance non trouvee');

  // EF-05-07/08 : le controle porte sur le document, pas sur la ligne. Le
  // caractere reglemente se juge sur l'ordonnance entiere : une autre ligne
  // peut porter le stupefiant.
  const { prescription } = await getValeursParametres();
  const refus = motifDeRefus(
    {
      ...ligne.ordonnance,
      contientProduitReglemente: await contientProduitReglemente(ligne.idOrdonnance),
      renouvellementsRestants: renouvellementsRestants(ligne.ordonnance),
    },
    prescription.signatureObligatoire
  );
  if (refus) throw new ValidationError(refus);

  return { pharmacien, ligne };
}

/**
 * Delivrer tout ou partie d'une ligne (EF-07-03, EF-07-07).
 *
 * **La quantite remise est enregistree.** Elle etait acceptee en parametre,
 * renvoyee a l'appelant, et jetee : la delivrance partielle existait dans le
 * contrat et nulle part en base.
 *
 * **L'acte est nominatif.** C'est une personne qui engage sa responsabilite
 * en remettant un medicament, et c'est elle qu'on cherche quand quelque chose
 * a mal tourne.
 */
export async function delivrerLigneOrdonnance(
  ligneId: string,
  pharmacienId: string,
  dto: { modePaiement?: string; quantiteDelivree?: number }
) {
  const { pharmacien, ligne } = await contexteDeDelivrance(ligneId, pharmacienId);

  const restant = await resteAServir(ligne);
  const quantiteDelivree = dto.quantiteDelivree ?? restant;
  if (quantiteDelivree <= 0) {
    throw new ValidationError('La quantite delivree doit etre au moins de 1');
  }
  if (quantiteDelivree > restant) {
    throw new ValidationError(
      `Il ne reste que ${restant} unite(s) a servir sur cette ligne, sur ${ligne.quantite} prescrite(s).`
    );
  }

  return ecrireActe({
    type: TypeActeDelivrance.DELIVRE,
    ligne,
    pharmacien,
    pharmacienId,
    quantite: quantiteDelivree,
    idMedicamentDelivre: ligne.idMedicament,
  });
}

/**
 * Substituer un produit, avec son motif (EF-07-04).
 *
 * **Le prescripteur et le patient sont prevenus.** Une substitution muette
 * est une modification de traitement decidee par quelqu'un qui n'a pas vu le
 * patient : le medecin doit pouvoir la contester, et le patient doit savoir
 * que la boite qu'il rapporte chez lui ne porte pas le nom qu'il attendait.
 */
export async function substituerLigneOrdonnance(
  ligneId: string,
  pharmacienId: string,
  dto: { idMedicamentDelivre: string; quantiteDelivree?: number; motif: string }
) {
  const { pharmacien, ligne } = await contexteDeDelivrance(ligneId, pharmacienId);

  if (dto.idMedicamentDelivre === ligne.idMedicament) {
    throw new ValidationError(
      "Ce produit est celui qui a ete prescrit : utilisez la delivrance, pas la substitution."
    );
  }
  const motif = dto.motif.trim();
  if (motif.length < 5) {
    throw new ValidationError('Dites en quelques mots pourquoi le produit prescrit est remplace.');
  }

  const restant = await resteAServir(ligne);
  const quantite = dto.quantiteDelivree ?? restant;
  if (quantite <= 0 || quantite > restant) {
    throw new ValidationError(`Il ne reste que ${restant} unite(s) a servir sur cette ligne.`);
  }

  const resultat = await ecrireActe({
    type: TypeActeDelivrance.SUBSTITUE,
    ligne,
    pharmacien,
    pharmacienId,
    quantite,
    idMedicamentDelivre: dto.idMedicamentDelivre,
    motif,
  });

  await notifierSubstitution(ligne.idOrdonnance, {
    prescrit: ligne.medicament.libelle,
    remis: resultat.medicament.libelle,
    officine: pharmacien.structure.nom,
    motif,
  });
  return resultat;
}

/**
 * Refuser une ligne, avec son motif (EF-07-05).
 *
 * **Rien ne sort du stock**, et le patient apprend pourquoi : sans motif il
 * repart sans savoir s'il doit revenir, aller ailleurs, ou rappeler son
 * medecin.
 */
export async function refuserLigneOrdonnance(
  ligneId: string,
  pharmacienId: string,
  dto: { motif: string }
) {
  const { pharmacien, ligne } = await contexteDeDelivrance(ligneId, pharmacienId);

  const motif = dto.motif.trim();
  if (motif.length < 5) {
    throw new ValidationError('Dites en quelques mots pourquoi cette ligne est refusee.');
  }

  const acte = await prisma.$transaction(async (tx) => {
    const cree = await tx.acteDelivrance.create({
      data: {
        type: TypeActeDelivrance.REFUSE,
        quantite: 0,
        prixUnitaireGnf: 0,
        montantGnf: 0,
        motif,
        idLigneOrdonnance: ligneId,
        idStructure: pharmacien.idStructure!,
        idPharmacien: pharmacienId,
        idMedicamentDelivre: ligne.idMedicament,
      },
      include: { medicamentDelivre: true },
    });
    // Un refus ne change pas l'etat de la ligne : elle reste a servir, ici ou
    // ailleurs. Il dit seulement que cette officine ne l'a pas servie.
    return cree;
  });

  await notifierRefusDeLigne(ligne.idOrdonnance, {
    produit: ligne.medicament.libelle,
    officine: pharmacien.structure.nom,
    motif,
  });

  return {
    ...acte,
    medicament: acte.medicamentDelivre,
    numeroOrdonnance: null,
    statutOrdonnance: null,
    quantiteDelivree: 0,
    montantGnf: 0,
  };
}

/**
 * Ecrire l'acte, sortir le stock, et recalculer les etats.
 *
 * Le decrement du total, la consommation des lots, l'acte et les deux statuts
 * tombent dans **une seule transaction** : si l'un echoue, le stock et la
 * trace ne peuvent pas diverger. Le declencheur differe de la base verifie au
 * commit qu'on n'a pas depasse le prescrit.
 */
async function ecrireActe(args: {
  type: TypeActeDelivrance;
  ligne: { id: string; quantite: number; idOrdonnance: string; idMedicament: string };
  pharmacien: { idStructure: string | null; structure: { nom: string } };
  pharmacienId: string;
  quantite: number;
  idMedicamentDelivre: string;
  motif?: string;
}) {
  const stock = await prisma.stock.findFirst({
    where: { idMedicament: args.idMedicamentDelivre, idStructure: args.pharmacien.idStructure },
    include: { medicament: { select: { prixUnitaireGnf: true } } },
  });
  if (!stock) throw new ValidationError('Stock insuffisant pour delivrer ce medicament');

  // La meme regle de prix que le comptoir et que le panier d'une commande :
  // prix national de reference plus la marge de l'officine.
  const prixUnitaireGnf = stock.medicament.prixUnitaireGnf + stock.margeGnf;

  const acte = await prisma.$transaction(async (tx) => {
    // Decrement conditionnel : echoue si le stock est passe sous le seuil
    // depuis la lecture ci-dessus.
    const decremente = await tx.stock.updateMany({
      where: { id: stock.id, quantite: { gte: args.quantite } },
      data: { quantite: { decrement: args.quantite } },
    });
    if (decremente.count === 0) {
      throw new ValidationError('Stock insuffisant pour delivrer ce medicament');
    }

    // Sortie au plus proche de la peremption, et jamais un lot perime
    // (addendum du 2026-09-28, point 1.3).
    const lotsConsommes = await consommerLots(tx, stock.id, args.quantite);

    const cree = await tx.acteDelivrance.create({
      data: {
        type: args.type,
        quantite: args.quantite,
        prixUnitaireGnf,
        montantGnf: prixUnitaireGnf * args.quantite,
        ...(args.motif ? { motif: args.motif } : {}),
        idLigneOrdonnance: args.ligne.id,
        idStructure: args.pharmacien.idStructure!,
        idPharmacien: args.pharmacienId,
        idMedicamentDelivre: args.idMedicamentDelivre,
      },
      include: { medicamentDelivre: true },
    });
    for (const lot of lotsConsommes) {
      await enregistrerMouvementStock(tx, {
        type: 'SORTIE',
        quantite: -lot.quantite,
        reference: cree.id,
        motif: `Delivrance ordonnance ${args.ligne.idOrdonnance}`,
        idStructure: args.pharmacien.idStructure!,
        idMedicament: args.idMedicamentDelivre,
        idStock: stock.id,
        idLot: lot.idLot,
        idUtilisateur: args.pharmacienId,
      });
    }

    // L'etat de la ligne se deduit de la somme de ses actes, jamais d'une
    // decision prise au vol.
    const servi = await dejaServi(args.ligne.id, tx);
    await tx.ligneOrdonnance.update({
      where: { id: args.ligne.id },
      data: { statut: etatDeLaLigne(args.ligne.quantite, servi) },
    });

    // Le statut du document suit ses lignes.
    await recalculerStatut(args.ligne.idOrdonnance, tx);
    return cree;
  });

  const ordonnance = await prisma.ordonnance.findUnique({
    where: { id: args.ligne.idOrdonnance },
    select: { numero: true, statut: true },
  });

  return {
    ...acte,
    medicament: acte.medicamentDelivre,
    numeroOrdonnance: ordonnance?.numero ?? null,
    statutOrdonnance: ordonnance?.statut ?? null,
    quantiteDelivree: args.quantite,
    montantGnf: acte.montantGnf,
  };
}

/** Le prescripteur **et** le patient : c'est leur traitement qui change. */
async function destinatairesDeLOrdonnance(idOrdonnance: string) {
  const o = await prisma.ordonnance.findUnique({
    where: { id: idOrdonnance },
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
  });
  if (!o) return null;
  const utilisateurs = [
    o.consultation?.patient.idUtilisateur,
    o.signePar ?? o.consultation?.idMedecinValideur,
  ].filter((v): v is string => Boolean(v));
  return { utilisateurs: [...new Set(utilisateurs)], numero: o.numero };
}

async function notifierSubstitution(
  idOrdonnance: string,
  quoi: { prescrit: string; remis: string; officine: string; motif: string }
) {
  const d = await destinatairesDeLOrdonnance(idOrdonnance);
  if (!d) return;
  for (const idUtilisateur of d.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'ORDONNANCE_SUBSTITUTION',
      titre: 'Un produit a ete remplace',
      contenu: `${quoi.officine} a remis « ${quoi.remis} » a la place de « ${quoi.prescrit} »`
        + ` sur l'ordonnance ${d.numero} : ${quoi.motif}`,
      lienAction: '/patient/ordonnances',
      metadonnees: { idOrdonnance },
    });
  }
}

async function notifierRefusDeLigne(
  idOrdonnance: string,
  quoi: { produit: string; officine: string; motif: string }
) {
  const d = await destinatairesDeLOrdonnance(idOrdonnance);
  if (!d) return;
  for (const idUtilisateur of d.utilisateurs) {
    await notifierSansBloquer({
      idUtilisateur,
      type: 'ORDONNANCE_LIGNE_REFUSEE',
      titre: 'Un produit n a pas pu etre remis',
      contenu: `${quoi.officine} n'a pas remis « ${quoi.produit} » de l'ordonnance ${d.numero} :`
        + ` ${quoi.motif}. L'ordonnance reste valable ailleurs.`,
      lienAction: '/patient/ordonnances',
      metadonnees: { idOrdonnance },
    });
  }
}

/**
 * EF-07-01 : controle d'une ordonnance presentee au comptoir sans QR patient.
 * Le numero seul ne suffit pas — il est sequentiel, donc devinable ; le code
 * de verification prouve que le porteur a bien l'ordonnance.
 */
export async function verifierOrdonnance(
  pharmacienId: string,
  dto: { numero: string; codeVerification: string }
): Promise<VerificationOrdonnanceView> {
  await getPharmacienAvecStructure(pharmacienId);

  const ordonnance = await prisma.ordonnance.findUnique({
    where: { numero: dto.numero.trim().toUpperCase() },
    include: {
      lignes: { include: { medicament: true, actes: { select: { quantite: true } } } },
      signataire: { select: { prenom: true, nom: true } },
      consultation: {
        include: {
          asc: { include: { utilisateur: { select: { prenom: true, nom: true } } } },
          patient: { include: { utilisateur: { select: { prenom: true, nom: true } } } },
        },
      },
    },
  });

  // Numero inconnu et code faux donnent la meme reponse : distinguer les deux
  // permettrait d'enumerer les numeros valides.
  const codeAttendu = ordonnance?.codeVerification ?? '';
  const codeFourni = dto.codeVerification.trim().toUpperCase();
  if (!ordonnance || codeAttendu !== codeFourni) {
    return { valide: false, motif: 'Numero ou code de verification incorrect' };
  }

  const { prescription } = await getValeursParametres();
  const refus = motifDeRefus(
    {
      ...ordonnance,
      contientProduitReglemente: ordonnance.lignes.some((l) => l.medicament.estReglemente),
      renouvellementsRestants: renouvellementsRestants(ordonnance),
    },
    prescription.signatureObligatoire
  );
  const patient = ordonnance.consultation.patient;
  const vue = vueDelivrance(ordonnance, patient.allergies, ordonnance.consultation.asc?.utilisateur ?? null);

  return {
    valide: refus === null,
    motif: refus ?? undefined,
    ordonnance: vue,
    patient: {
      id: patient.id,
      prenom: patient.utilisateur.prenom,
      nom: patient.utilisateur.nom,
      dateNaissance: patient.dateNaissance.toISOString(),
      sexe: patient.sexe,
      groupeSanguin: patient.groupeSanguin ?? undefined,
      allergiesCritiques: patient.allergies,
    },
  };
}

/**
 * EF-05-09 : ouvrir le cycle suivant d'une ordonnance renouvelable.
 *
 * C'est la pharmacie qui declenche, parce que c'est elle qui a le patient et
 * son papier devant elle. Les regles metier (produit reglemente, cycles
 * restants, expiration) sont portees par ordonnance.service : le comptoir ne
 * fait que demander.
 */
export async function renouvelerAuComptoir(pharmacienId: string, idOrdonnance: string) {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);

  const ordonnance = await prisma.ordonnance.findUnique({
    where: { id: idOrdonnance },
    select: { id: true, consultation: { select: { patient: { select: { prefecture: true } } } } },
  });
  if (!ordonnance) throw new NotFoundError('Ordonnance non trouvee');

  // Meme perimetre que la file du comptoir : une officine ne renouvelle pas
  // l'ordonnance d'un patient d'une autre prefecture.
  if (ordonnance.consultation.patient.prefecture !== pharmacien.structure.prefecture) {
    throw new ForbiddenError('Cette ordonnance ne releve pas de votre prefecture');
  }

  const maj = await renouvelerOrdonnance(idOrdonnance);
  return {
    id: maj.id,
    numero: maj.numero,
    statut: maj.statut,
    renouvellementsRestants: renouvellementsRestants(maj),
  };
}

export async function getStocksPharmacie(pharmacienId: string): Promise<StockPharmacieView[]> {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);

  const stocks = await prisma.stock.findMany({
    where: { idStructure: pharmacien.idStructure, medicament: { estActif: true } },
    include: {
      medicament: true,
      // La peremption appartient aux lots depuis le 2026-09-30.
      lots: { select: { quantite: true, datePeremption: true } },
    },
    orderBy: { quantite: 'asc' },
  });

  return stocks.map(({ lots, ...s }) => ({
    ...s,
    peremptionLaPlusProche: peremptionLaPlusProche(lots),
  }));
}

// Une ordonnance n'est rattachee a aucune pharmacie avant sa delivrance : on
// restreint donc la liste a la prefecture de la pharmacie, plutot que
// d'exposer toutes les ordonnances du pays avec le nom des patients.
export async function getOrdonnances(pharmacienId: string): Promise<OrdonnanceEnAttenteView[]> {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);

  const { prescription } = await getValeursParametres();

  const ordonnances = await prisma.ordonnance.findMany({
    where: {
      statut: {
        in: [StatutOrdonnance.EN_ATTENTE, StatutOrdonnance.PARTIELLEMENT_SERVIE],
      },
      // La file ne montre que ce qui est reellement delivrable : si la
      // signature est imposee (decision D2), une ordonnance non signee n'a
      // rien a y faire.
      ...(prescription.signatureObligatoire ? { signeLe: { not: null } } : {}),
      consultation: { patient: { prefecture: pharmacien.structure.prefecture } },
    },
    select: {
      id: true,
      numero: true,
      statut: true,
      valideJusquau: true,
      creeLe: true,
      signeLe: true,
      lignes: {
        where: { statut: StatutOrdonnance.EN_ATTENTE },
        select: {
          medicament: { select: { id: true, libelle: true, categorie: true, dci: true, nomCommercial: true, forme: true, dosage: true } },
        },
      },
      consultation: {
        select: {
          patient: {
            select: { qrCode: true, utilisateur: { select: { prenom: true, nom: true } } },
          },
        },
      },
    },
    orderBy: { creeLe: 'desc' },
    take: 50,
  });

  return ordonnances.map(({ consultation, lignes, ...o }) => ({
    ...o,
    expiree: estExpiree(o),
    medicaments: lignes.map((l) => l.medicament),
    patient: {
      prenom: consultation.patient.utilisateur.prenom,
      nom: consultation.patient.utilisateur.nom,
      qrCode: consultation.patient.qrCode,
    },
  }));
}

export async function reapprovisionnerStock(pharmacienId: string, dto: {
  idMedicament: string;
  quantiteAjoutee: number;
  datePeremption?: string;
  margeGnf?: number;
  unite?: string;
}) {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (dto.quantiteAjoutee <= 0) throw new ValidationError('La quantite doit etre superieure a 0');

  const medicament = await prisma.medicament.findUnique({
    where: { id: dto.idMedicament },
    select: { id: true, idStructure: true, estActif: true, prixUnitaireGnf: true },
  });
  if (!medicament) throw new NotFoundError('Medicament non trouve');
  if (!medicament.estActif) throw new ValidationError('Ce produit est desactive');
  if (medicament.idStructure !== null && medicament.idStructure !== pharmacien.idStructure) {
    throw new NotFoundError('Produit introuvable dans cette officine');
  }
  const margeGnf = medicament.idStructure === pharmacien.idStructure ? 0 : dto.margeGnf;

  const stockExistant = await prisma.stock.findFirst({
    where: {
      idMedicament: dto.idMedicament,
      idStructure: pharmacien.idStructure,
    },
  });

  // Depuis le 2026-09-30, chaque entree cree son lot : la date de peremption
  // appartient au lot, pas au stock (addendum, point 1.3). Une entree rapide
  // reste possible ici ; la saisie par facture passe par
  // `approvisionnement.service`, qui garde en plus le fournisseur et la piece.
  if (stockExistant) {
    return prisma.$transaction(async (tx) => {
      const maj = await tx.stock.update({
        where: { id: stockExistant.id },
        data: {
          quantite: { increment: dto.quantiteAjoutee },
          ...(dto.unite && { unite: dto.unite }),
          ...(margeGnf !== undefined && { margeGnf }),
        },
        include: { medicament: true },
      });
      const lot = await tx.lotStock.create({
        data: {
          idStock: stockExistant.id,
          quantite: dto.quantiteAjoutee,
          quantiteRecue: dto.quantiteAjoutee,
          datePeremption: dto.datePeremption ? new Date(dto.datePeremption) : null,
        },
      });
      await enregistrerMouvementStock(tx, {
        type: 'ENTREE',
        quantite: dto.quantiteAjoutee,
        motif: 'Reapprovisionnement rapide',
        idStructure: pharmacien.idStructure!,
        idMedicament: dto.idMedicament,
        idStock: stockExistant.id,
        idLot: lot.id,
        idUtilisateur: pharmacienId,
      });
      return maj;
    });
  }

  // Sans marge saisie, on applique la marge par defaut de la plateforme
  // (Parametres > Facturation) au prix national de reference du medicament.
  const { facturation } = await getValeursParametres();
  const margeParDefautGnf = Math.round(medicament.prixUnitaireGnf * facturation.margePct / 100);

  return prisma.$transaction(async (tx) => {
    const cree = await tx.stock.create({
      data: {
        idMedicament: dto.idMedicament,
        idStructure: pharmacien.idStructure,
        quantite: dto.quantiteAjoutee,
        seuilAlerte: 10,
        unite: dto.unite ?? 'unite',
        margeGnf: margeGnf ?? margeParDefautGnf,
      },
      include: { medicament: true },
    });
    const lot = await tx.lotStock.create({
      data: {
        idStock: cree.id,
        quantite: dto.quantiteAjoutee,
        quantiteRecue: dto.quantiteAjoutee,
        datePeremption: dto.datePeremption ? new Date(dto.datePeremption) : null,
      },
    });
    await enregistrerMouvementStock(tx, {
      type: 'ENTREE',
      quantite: dto.quantiteAjoutee,
      motif: 'Reapprovisionnement rapide',
      idStructure: pharmacien.idStructure!,
      idMedicament: dto.idMedicament,
      idStock: cree.id,
      idLot: lot.id,
      idUtilisateur: pharmacienId,
    });
    return cree;
  });
}

const CHAMPS_CATALOGUE = {
  id: true, libelle: true, categorie: true, dci: true, nomCommercial: true,
  forme: true, dosage: true, classeTherapeutique: true, prixUnitaireGnf: true,
  estReglemente: true,
} as const;

/**
 * Le catalogue de l'officine, a plat. Depuis le 2026-10-01 il contient aussi
 * des articles non medicamenteux, dont la DCI est nulle : le tri se fait donc
 * sur le libelle, le seul champ toujours renseigne.
 *
 * C'est le catalogue du comptoir : une pharmacie vend aussi du lait et du
 * savon. Pour prescrire, voir `getMedicamentsPrescriptibles`.
 */
export async function getMedicaments(pharmacienId: string): Promise<MedicamentTarifeView[]> {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  const produits = await prisma.medicament.findMany({
    where: {
      estActif: true,
      OR: [{ idStructure: null }, { idStructure: pharmacien.idStructure }],
    },
    orderBy: [{ categorie: 'asc' }, { libelle: 'asc' }],
    select: { ...CHAMPS_CATALOGUE, idStructure: true },
  });
  return produits.map(({ idStructure, ...produit }) => ({
    ...produit,
    estPropreOfficine: idStructure === pharmacien.idStructure,
  }));
}

/**
 * Ce qui se prescrit, et rien d'autre.
 *
 * Servir le catalogue entier a l'ecran de prescription proposerait du lait
 * infantile a un medecin ; `analyserPrescription` le refuserait, mais
 * seulement apres que le prescripteur l'ait choisi. On ne le propose pas.
 */
export async function getMedicamentsPrescriptibles(): Promise<MedicamentTarifeView[]> {
  return prisma.medicament.findMany({
    where: { estActif: true, idStructure: null, categorie: 'MEDICAMENT' },
    orderBy: { libelle: 'asc' },
    select: CHAMPS_CATALOGUE,
  });
}

/** Le titulaire administre uniquement les articles non medicamenteux locaux. */
export async function creerProduitOfficine(
  pharmacienId: string,
  dto: CreateProduitOfficineDto,
): Promise<MedicamentTarifeView> {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (pharmacien.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le titulaire peut gerer les produits de son officine');
  }
  const produit = await prisma.$transaction(async (tx) => {
    const cree = await tx.medicament.create({
      data: {
        libelle: dto.libelle.trim(),
        // A1 : sans cette empreinte, l'article de l'officine serait absent de
        // la recherche publique des qu'on l'ecrit sans ses accents.
        rechercheTexte: empreinteCatalogue({ libelle: dto.libelle }),
        categorie: dto.categorie,
        prixUnitaireGnf: dto.prixUnitaireGnf,
        estActif: true,
        estReglemente: false,
        idStructure: pharmacien.idStructure,
      },
      select: CHAMPS_CATALOGUE,
    });
    await tx.stock.create({
      data: {
        idStructure: pharmacien.idStructure,
        idMedicament: cree.id,
        quantite: 0,
        seuilAlerte: dto.seuilAlerte ?? 10,
        unite: dto.unite?.trim() || 'unite',
        margeGnf: 0,
      },
    });
    return cree;
  });
  return { ...produit, estPropreOfficine: true };
}

export async function modifierProduitOfficine(
  pharmacienId: string,
  idMedicament: string,
  dto: UpdateProduitOfficineDto,
): Promise<MedicamentTarifeView> {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (pharmacien.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le titulaire peut gerer les produits de son officine');
  }
  const maj = await prisma.$transaction(async (tx) => {
    const produit = await tx.medicament.updateMany({
      where: { id: idMedicament, idStructure: pharmacien.idStructure, estActif: true },
      data: {
        ...(dto.libelle !== undefined
          ? {
              libelle: dto.libelle.trim(),
              rechercheTexte: empreinteCatalogue({ libelle: dto.libelle }),
            }
          : {}),
        ...(dto.categorie !== undefined ? { categorie: dto.categorie } : {}),
        ...(dto.prixUnitaireGnf !== undefined ? { prixUnitaireGnf: dto.prixUnitaireGnf } : {}),
      },
    });
    if (produit.count === 0) throw new NotFoundError('Produit actif introuvable dans cette officine');
    if (dto.seuilAlerte !== undefined || dto.unite !== undefined) {
      await tx.stock.updateMany({
        where: { idStructure: pharmacien.idStructure, idMedicament },
        data: {
          ...(dto.seuilAlerte !== undefined ? { seuilAlerte: dto.seuilAlerte } : {}),
          ...(dto.unite !== undefined ? { unite: dto.unite.trim() } : {}),
        },
      });
    }
    return tx.medicament.findUniqueOrThrow({
      where: { id: idMedicament },
      select: CHAMPS_CATALOGUE,
    });
  });
  return { ...maj, estPropreOfficine: true };
}

export async function desactiverProduitOfficine(pharmacienId: string, idMedicament: string): Promise<void> {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (pharmacien.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le titulaire peut gerer les produits de son officine');
  }
  const produit = await prisma.medicament.findFirst({
    where: { id: idMedicament, idStructure: pharmacien.idStructure, estActif: true },
    select: { id: true, stocks: { select: { quantite: true } } },
  });
  if (!produit) throw new NotFoundError('Produit actif introuvable dans cette officine');
  if (produit.stocks.some((stock) => stock.quantite > 0)) {
    throw new ValidationError('Le produit doit etre en rupture avant sa desactivation');
  }
  const resultat = await prisma.medicament.updateMany({
    where: { id: idMedicament, idStructure: pharmacien.idStructure, estActif: true },
    data: { estActif: false },
  });
  if (resultat.count === 0) throw new NotFoundError('Produit introuvable dans cette officine');
}

export async function getAgentsPharmacie(pharmacienId: string) {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (pharmacien.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le titulaire peut consulter les agents de son officine');
  }

  const agents = await prisma.utilisateur.findMany({
    where: {
      idStructure: pharmacien.idStructure,
      role: Role.PHARMACIEN,
    },
    select: {
      id: true,
      telephone: true,
      email: true,
      prenom: true,
      nom: true,
      role: true,
      estActif: true,
      creeLe: true,
      derniereConnexion: true,
      pharmacienProfile: {
        select: {
          estResponsable: true,
          roleOfficine: true,
          roleOfficineTemporaire: true,
          roleOfficineExpireLe: true,
        },
      },
    },
    orderBy: { creeLe: 'desc' },
  });
  return agents.filter((agent) =>
    agent.pharmacienProfile && agent.pharmacienProfile.roleOfficine !== 'TITULAIRE'
  );
}

export async function creerAgentPharmacie(pharmacienId: string, dto: CreateAgentPharmacieDto) {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (pharmacien.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le pharmacien responsable peut creer des agents');
  }

  const existingTel = await prisma.utilisateur.findUnique({ where: { telephone: dto.telephone } });
  if (existingTel) throw new ConflictError('Ce numero de telephone est deja utilise');

  if (dto.email) {
    const existingEmail = await prisma.utilisateur.findUnique({ where: { email: dto.email } });
    if (existingEmail) throw new ConflictError('Cette adresse email est deja utilisee');
  }

  if (dto.motDePasse) assertMotDePasseConforme(dto.motDePasse, 'PHARMACIEN');
  const motDePasseTemp = dto.motDePasse || genererMotDePasseTemp();
  const motDePasseHash = await hashPassword(motDePasseTemp);
  const isTemporaire = !dto.motDePasse;

  const agent = await prisma.$transaction(async (tx) => {
    const user = await tx.utilisateur.create({
      data: {
        telephone: dto.telephone,
        email: dto.email ?? null,
        motDePasseHash,
        prenom: dto.prenom,
        nom: dto.nom,
        role: Role.PHARMACIEN,
        idStructure: pharmacien.idStructure,
        doitChangerMotDePasse: isTemporaire,
      },
    });

    await tx.pharmacienProfile.create({
      data: {
        idUtilisateur: user.id,
        idStructure: pharmacien.idStructure,
        estResponsable: false,
        roleOfficine: dto.roleOfficine ?? 'ADJOINT',
      },
    });

    return user;
  });

  return {
    agent: {
      id: agent.id,
      telephone: agent.telephone,
      email: agent.email,
      prenom: agent.prenom,
      nom: agent.nom,
      role: agent.role,
      roleOfficine: dto.roleOfficine ?? 'ADJOINT',
    },
    motDePasseTemporaire: isTemporaire ? motDePasseTemp : undefined,
  };
}

async function trouverAgentDuTitulaire(pharmacienId: string, agentId: string) {
  const titulaire = await getPharmacienAvecStructure(pharmacienId);
  if (titulaire.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le titulaire peut gerer les agents de son officine');
  }
  if (agentId === pharmacienId) throw new ValidationError('Le titulaire ne peut pas modifier son propre compte agent');
  const agent = await prisma.utilisateur.findFirst({
    where: {
      id: agentId,
      idStructure: titulaire.idStructure,
      role: Role.PHARMACIEN,
    },
    include: { pharmacienProfile: true },
  });
  if (!agent?.pharmacienProfile || agent.pharmacienProfile.roleOfficine === 'TITULAIRE') {
    throw new NotFoundError('Agent de cette officine introuvable');
  }
  return { titulaire, agent };
}

export async function definirPermissionTemporaire(
  pharmacienId: string,
  agentId: string,
  dto: { roleOfficine: 'ADJOINT' | 'PREPARATEUR' | 'CAISSIER'; expireLe: string },
) {
  const { agent } = await trouverAgentDuTitulaire(pharmacienId, agentId);
  const expireLe = new Date(dto.expireLe);
  if (!Number.isFinite(expireLe.getTime()) || expireLe <= new Date()) {
    throw new ValidationError("L'expiration de la permission doit etre une date future");
  }
  return prisma.pharmacienProfile.update({
    where: { idUtilisateur: agent.id },
    data: {
      roleOfficineTemporaire: dto.roleOfficine,
      roleOfficineExpireLe: expireLe,
    },
    select: { roleOfficine: true, roleOfficineTemporaire: true, roleOfficineExpireLe: true },
  });
}

export async function revoquerPermissionTemporaire(pharmacienId: string, agentId: string) {
  const { agent } = await trouverAgentDuTitulaire(pharmacienId, agentId);
  return prisma.pharmacienProfile.update({
    where: { idUtilisateur: agent.id },
    data: { roleOfficineTemporaire: null, roleOfficineExpireLe: null },
    select: { roleOfficine: true, roleOfficineTemporaire: true, roleOfficineExpireLe: true },
  });
}

export async function mettreAJourEtatAgent(
  pharmacienId: string,
  agentId: string,
  estActif: boolean,
) {
  const { agent } = await trouverAgentDuTitulaire(pharmacienId, agentId);
  return prisma.utilisateur.update({
    where: { id: agent.id },
    data: { estActif },
    select: { id: true, estActif: true },
  });
}

export async function changerRoleAgent(
  pharmacienId: string,
  agentId: string,
  roleOfficine: 'ADJOINT' | 'PREPARATEUR' | 'CAISSIER',
) {
  const { agent } = await trouverAgentDuTitulaire(pharmacienId, agentId);
  return prisma.pharmacienProfile.update({
    where: { idUtilisateur: agent.id },
    data: {
      roleOfficine,
      roleOfficineTemporaire: null,
      roleOfficineExpireLe: null,
      estResponsable: false,
    },
    select: { roleOfficine: true },
  });
}

export async function getJournalConnexions(pharmacienId: string, page = 1, limit = 25) {
  const pharmacien = await getPharmacienAvecStructure(pharmacienId);
  if (pharmacien.pharmacienProfile?.roleOfficine !== 'TITULAIRE') {
    throw new ForbiddenError('Seul le titulaire peut consulter les connexions de son officine');
  }
  const taille = Math.min(Math.max(Math.trunc(limit) || 25, 1), 100);
  const numeroPage = Math.min(Math.max(Math.trunc(page) || 1, 1), 1_000_000);
  const where = { idStructure: pharmacien.idStructure };
  const [items, total] = await Promise.all([
    prisma.evenementConnexion.findMany({
      where,
      select: {
        id: true,
        type: true,
        ipAdresse: true,
        userAgent: true,
        creeLe: true,
        utilisateur: {
          select: {
            id: true,
            prenom: true,
            nom: true,
            email: true,
            pharmacienProfile: { select: { roleOfficine: true } },
          },
        },
      },
      orderBy: { creeLe: 'desc' },
      skip: (numeroPage - 1) * taille,
      take: taille,
    }),
    prisma.evenementConnexion.count({ where }),
  ]);
  return {
    items,
    total,
    page: numeroPage,
    limit: taille,
    totalPages: Math.ceil(total / taille),
  };
}

export async function trouverPharmaciesProches(prefecture: string) {
  return prisma.structureSante.findMany({
    where: { ...filtreStructuresOfficinales(), prefecture, estActive: true },
    select: { id: true, nom: true, adresse: true, telephone: true, latitude: true, longitude: true },
  });
}
