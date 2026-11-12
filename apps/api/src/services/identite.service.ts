import { NiveauIdentite, TypePieceIdentite } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { JwtPayload } from '../types/auth.types';
import { assertCanAccessPatient, buildPatientWhereForUser } from './access-control.service';
import type {
  ChampCorrigeable, CorrectionIdentiteView, CorrigerIdentiteDto, IdentitePatientView, VerifierIdentiteDto,
} from '@baobaoheath/shared-types';

/**
 * Verifier l'identite d'un patient (EF-01-04/10).
 *
 * **Ce que verifier veut dire ici.** Un agent d'accueil declare avoir vu une
 * piece, et enregistre laquelle. Ce n'est pas une authentification
 * informatique : c'est une personne qui engage sa responsabilite. D'ou
 * l'exigence du numero de piece — une verification qui ne peut pas nommer le
 * document sur lequel elle se fonde n'est ni verifiable ni contestable.
 *
 * **Ce que cela ouvre, et rien de plus** : le tiers payant, et plus tard la
 * delivrance de produits reglementes. Les soins, eux, ne dependent pas du
 * niveau d'identite — un patient provisoire est consulte, suivi et prescrit
 * normalement.
 *
 * **Ce que cela ne doit pas devenir** : un filtre a l'entree. Un ASC qui
 * enregistre quelqu'un en brousse n'a pas de piece a verifier, et lui refuser
 * l'ouverture d'un dossier reviendrait a lui refuser les soins.
 */

/** En deca, un numero de piece ne designe rien. La contrainte SQL l'exige aussi. */
const NUMERO_MIN = 3;
const LIEU_MIN = 2;

type Ligne = {
  id: string;
  dateNaissance: Date;
  sexe: string;
  prefecture: string;
  lieuNaissance: string | null;
  nomMere: string | null;
  niveauIdentite: NiveauIdentite;
  typePiece: TypePieceIdentite | null;
  numeroPiece: string | null;
  identiteVerifieeLe: Date | null;
  utilisateur: { prenom: string; nom: string; telephone: string };
  verifiePar: { prenom: string; nom: string } | null;
};

/**
 * Le numero de piece, masque.
 *
 * Il sert a prouver qu'une piece a ete vue, pas a etre recopie. L'afficher en
 * entier sur un ecran de comptoir, devant la file d'attente, serait une fuite
 * gratuite. Les quatre derniers caracteres suffisent a reconnaitre la piece
 * qu'on tient en main.
 */
export function masquerNumero(numero: string | null): string | null {
  if (!numero) return null;
  const propre = numero.trim();
  if (propre.length <= 4) return '•'.repeat(propre.length);
  return '•'.repeat(propre.length - 4) + propre.slice(-4);
}

function enVue(l: Ligne): IdentitePatientView {
  return {
    id: l.id,
    nomComplet: `${l.utilisateur.prenom} ${l.utilisateur.nom}`,
    prenom: l.utilisateur.prenom,
    nom: l.utilisateur.nom,
    telephone: l.utilisateur.telephone,
    dateNaissance: l.dateNaissance.toISOString(),
    sexe: l.sexe,
    prefecture: l.prefecture,
    lieuNaissance: l.lieuNaissance,
    nomMere: l.nomMere,
    niveauIdentite: l.niveauIdentite,
    typePiece: l.typePiece,
    numeroPieceMasque: masquerNumero(l.numeroPiece),
    verifieeLe: l.identiteVerifieeLe?.toISOString() ?? null,
    verifieePar: l.verifiePar ? `${l.verifiePar.prenom} ${l.verifiePar.nom}` : null,
    // Ce qui manque pour pouvoir verifier. L'ecran s'en sert pour dire a
    // l'agent ce qu'il doit demander au patient, plutot que de refuser
    // apres coup.
    traitsManquants: [
      ...(l.lieuNaissance ? [] : ['lieuNaissance']),
      ...(l.nomMere ? [] : ['nomMere']),
    ],
  };
}

const SELECTION = {
  id: true, dateNaissance: true, sexe: true, prefecture: true,
  lieuNaissance: true, nomMere: true, niveauIdentite: true,
  typePiece: true, numeroPiece: true, identiteVerifieeLe: true,
  utilisateur: { select: { prenom: true, nom: true, telephone: true } },
  verifiePar: { select: { prenom: true, nom: true } },
};

/**
 * Les patients de **sa** structure, et leur identite.
 *
 * **Cette liste n'etait filtree par rien.** Le service recevait les criteres de
 * recherche sans l'utilisateur, donc sans moyen de savoir pour qui il
 * repondait : une clinique nouvellement creee ouvrait l'ecran « Identites » et
 * voyait **tous les patients du pays**, avec leur nom, leur telephone et leur
 * code QR. Defaut signale par l'utilisateur le 2026-10-24.
 *
 * `buildPatientWhereForUser` porte deja la bonne regle, et depuis le debut :
 * l'accueil voit les patients ayant un episode ouvert chez lui, l'administrateur
 * de structure y ajoute ceux qui l'ont pour etablissement prefere et ceux qui
 * lui sont adresses. Ce domaine ne l'appelait simplement jamais.
 */
export async function rechercher(
  user: JwtPayload,
  filtres: { q?: string; niveau?: NiveauIdentite }
): Promise<IdentitePatientView[]> {
  const where: Record<string, unknown> = {};
  // Les dossiers absorbes par une fusion sortent de la liste de travail
  // (EF-01-06). Ils ne sont pas supprimes — on les retrouve par leur code QR,
  // qui renvoie au dossier survivant — mais ils n'ont plus rien a y faire.
  where['idFusionneDans'] = null;
  if (filtres.niveau) where['niveauIdentite'] = filtres.niveau;

  const terme = filtres.q?.trim();
  if (terme) {
    const mots = terme.split(/\s+/).filter(Boolean);
    where['OR'] = [
      { qrCode: terme },
      { utilisateur: { telephone: { contains: terme.replace(/\s/g, '') } } },
      // Chaque mot doit apparaitre dans le nom ou le prenom, comme la
      // recherche de l'accueil : « Diallo Ma » trouve Mamadou Diallo.
      {
        AND: mots.map((m) => ({
          utilisateur: {
            OR: [
              { nom: { contains: m, mode: 'insensitive' } },
              { prenom: { contains: m, mode: 'insensitive' } },
            ],
          },
        })),
      },
    ];
  }

  // **Le perimetre est cumule avec les criteres, jamais fusionne a plat.**
  // `where` porte deja une cle `OR` pour le terme de recherche, et le filtre
  // d'acces en porte une autre : les melanger a plat en ecraserait une, et un
  // `OR` entre les deux rouvrirait la fuite par la porte d'a cote.
  const perimetre = await buildPatientWhereForUser(user);

  const lignes = await prisma.patientProfile.findMany({
    where: { AND: [perimetre, where] },
    select: SELECTION,
    // Les provisoires d'abord : ce sont eux qu'un agent a a traiter.
    orderBy: [{ niveauIdentite: 'asc' }, { utilisateur: { nom: 'asc' } }],
    take: 50,
  });
  return (lignes as Ligne[]).map(enVue);
}

export async function verifier(
  user: JwtPayload,
  idPatient: string,
  dto: VerifierIdentiteDto,
  maintenant = new Date()
): Promise<IdentitePatientView> {
  const numero = dto.numeroPiece.trim();
  const lieu = dto.lieuNaissance.trim();

  if (numero.length < NUMERO_MIN) {
    throw new ValidationError(
      "Le numero de la piece est exige : une verification qui ne peut pas nommer le document sur lequel elle se fonde n'est pas contestable"
    );
  }
  if (lieu.length < LIEU_MIN) {
    throw new ValidationError('Le lieu de naissance est exige : il figure sur la piece que vous avez en main');
  }

  // L'utilisateur ne servait que la trace d'audit : n'importe quel agent
  // pouvait declarer avoir vu la piece d'un patient d'un autre etablissement.
  await assertCanAccessPatient(user, idPatient);

  const patient = await prisma.patientProfile.findUnique({
    where: { id: idPatient },
    select: { id: true, niveauIdentite: true },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');

  // Reverifier une identite deja verifiee n'est pas une erreur en soi — une
  // piece peut avoir ete renouvelee. Mais cela doit etre un geste conscient,
  // pas un double clic.
  if (patient.niveauIdentite === NiveauIdentite.VERIFIEE && !dto.remplacerPiece) {
    throw new ForbiddenError(
      "Cette identite est deja verifiee. Pour enregistrer une nouvelle piece, confirmez le remplacement."
    );
  }

  const maj = await prisma.patientProfile.update({
    where: { id: idPatient },
    data: {
      niveauIdentite: NiveauIdentite.VERIFIEE,
      typePiece: dto.typePiece,
      numeroPiece: numero,
      lieuNaissance: lieu,
      // Le nom de la mere ne figure pas sur un passeport : on ne l'ecrase pas
      // s'il etait deja connu et que l'agent ne le ressaisit pas.
      ...(dto.nomMere?.trim() ? { nomMere: dto.nomMere.trim() } : {}),
      identiteVerifieeLe: maintenant,
      idVerifiePar: user.userId,
    },
    select: SELECTION,
  });
  return enVue(maj as Ligne);
}

/**
 * Noter un trait distinctif sans verifier l'identite.
 *
 * Un agent peut recueillir le lieu de naissance et le nom de la mere sans
 * avoir de piece sous les yeux — au telephone, ou sur declaration. Ces traits
 * servent a la detection de doublons (EF-01-05), qui n'attend pas une
 * verification pour etre utile.
 */
export async function noterTraits(
  user: JwtPayload,
  idPatient: string,
  traits: { lieuNaissance?: string; nomMere?: string }
): Promise<IdentitePatientView> {
  // **Une ecriture sur le dossier, sans aucun controle.** La fonction ne
  // recevait pas l'utilisateur : tout agent d'accueil pouvait reecrire le lieu
  // de naissance et le nom de la mere de n'importe quel patient du pays.
  await assertCanAccessPatient(user, idPatient);

  const lieu = traits.lieuNaissance?.trim();
  const mere = traits.nomMere?.trim();
  if (!lieu && !mere) throw new ValidationError('Aucun trait a enregistrer');

  // Un trait lu sur une piece ne se reecrit pas sur simple declaration : il
  // fondait la verification. Completer un trait absent reste possible.
  const actuel = await prisma.patientProfile.findUnique({
    where: { id: idPatient },
    select: { niveauIdentite: true, lieuNaissance: true, nomMere: true },
  });
  if (!actuel) throw new NotFoundError('Patient non trouve');
  if (actuel.niveauIdentite === NiveauIdentite.VERIFIEE) {
    const ecrase = (nouveau: string | undefined, ancien: string | null) => !!nouveau && !!ancien && nouveau !== ancien;
    if (ecrase(lieu, actuel.lieuNaissance) || ecrase(mere, actuel.nomMere)) {
      throw new ForbiddenError(
        "Ces traits ont ete verifies sur piece : pour les changer, refaites la verification avec la piece en main"
      );
    }
  }

  const maj = await prisma.patientProfile.update({
    where: { id: idPatient },
    data: {
      ...(lieu ? { lieuNaissance: lieu } : {}),
      ...(mere ? { nomMere: mere } : {}),
    },
    select: SELECTION,
  });

  return enVue(maj as Ligne);
}

// ── Correction de l'identite (R15) ──────────────────────────────────

/** Le meme minimum que la fusion, et que la contrainte SQL. */
const MOTIF_MIN = 10;
const NAISSANCE_PLANCHER = new Date('1900-01-01T00:00:00.000Z');

/** Une date de naissance sans heure : celle qu'on lit sur une piece. */
export function jourDe(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Une date de naissance saisie (AAAA-MM-JJ), verifiee : une date qui existe
 * (pas un 30 fevrier), ni future, ni avant 1900. La meme regle pour la
 * correction par l'accueil et pour la demande du patient.
 */
export function lireDateNaissance(texte: string, maintenant: Date): Date {
  const date = new Date(`${texte}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte) || Number.isNaN(date.getTime()) || jourDe(date) !== texte) {
    throw new ValidationError('Date de naissance invalide (AAAA-MM-JJ)');
  }
  if (date > maintenant || date < NAISSANCE_PLANCHER) {
    throw new ValidationError('Date de naissance hors des limites plausibles');
  }
  return date;
}

/**
 * Corriger le sexe, la date de naissance, le prenom ou le nom d'un patient.
 *
 * **Personne ne pouvait le faire.** Une erreur de saisie a l'admission
 * restait pour toujours : un enfant enregistre ne en 2002 au lieu de 2020
 * recevait des doses d'adulte, une femme enregistree « M » des normes
 * biologiques d'homme. Le figer etait voulu (identito-vigilance) ; ne laisser
 * aucune issue ne l'etait pas.
 *
 * L'issue est etroite : l'accueil ou l'administration, sur un patient de son
 * perimetre, avec un motif, et chaque trait corrige laisse une ligne avec son
 * ancienne valeur. Le niveau d'identite ne change pas : l'agent corrige, il
 * ne verifie pas — la verification reste le geste avec la piece.
 */
export async function corrigerIdentite(
  user: JwtPayload,
  idPatient: string,
  dto: CorrigerIdentiteDto,
  maintenant = new Date()
): Promise<IdentitePatientView> {
  const motif = dto.motif.trim();
  if (motif.length < MOTIF_MIN) {
    throw new ValidationError("Le motif est exige, dix caracteres au moins : une correction sans motif n'est pas contestable");
  }
  await assertCanAccessPatient(user, idPatient);

  const patient = await prisma.patientProfile.findUnique({
    where: { id: idPatient },
    select: {
      id: true, sexe: true, dateNaissance: true, idFusionneDans: true, idUtilisateur: true,
      utilisateur: { select: { prenom: true, nom: true } },
    },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');
  // Le dossier absorbe n'est plus lu : le corriger ne changerait rien de visible.
  if (patient.idFusionneDans) {
    throw new ValidationError('Ce dossier a ete fusionne dans un autre : corrigez le dossier principal');
  }

  const changements: { champ: ChampCorrigeable; ancienneValeur: string; nouvelleValeur: string }[] = [];
  const prenom = dto.prenom?.trim();
  if (prenom && prenom !== patient.utilisateur.prenom) {
    changements.push({ champ: 'prenom', ancienneValeur: patient.utilisateur.prenom, nouvelleValeur: prenom });
  }
  const nom = dto.nom?.trim();
  if (nom && nom !== patient.utilisateur.nom) {
    changements.push({ champ: 'nom', ancienneValeur: patient.utilisateur.nom, nouvelleValeur: nom });
  }
  if (dto.sexe && dto.sexe !== patient.sexe) {
    changements.push({ champ: 'sexe', ancienneValeur: patient.sexe, nouvelleValeur: dto.sexe });
  }
  let naissance: Date | undefined;
  if (dto.dateNaissance) {
    naissance = lireDateNaissance(dto.dateNaissance, maintenant);
    if (jourDe(naissance) !== jourDe(patient.dateNaissance)) {
      changements.push({
        champ: 'dateNaissance', ancienneValeur: jourDe(patient.dateNaissance), nouvelleValeur: jourDe(naissance),
      });
    } else {
      naissance = undefined;
    }
  }
  if (changements.length === 0) {
    throw new ValidationError('Aucun changement : les valeurs saisies sont deja celles du dossier');
  }

  const corrige = (champ: ChampCorrigeable) => changements.find((c) => c.champ === champ)?.nouvelleValeur;
  const maj = await prisma.$transaction(async (tx) => {
    if (corrige('prenom') || corrige('nom')) {
      await tx.utilisateur.update({
        where: { id: patient.idUtilisateur },
        data: {
          ...(corrige('prenom') ? { prenom: corrige('prenom') } : {}),
          ...(corrige('nom') ? { nom: corrige('nom') } : {}),
        },
      });
    }
    await tx.correctionIdentite.createMany({
      data: changements.map((c) => ({ ...c, motif, idPatient, idAuteur: user.userId, creeLe: maintenant })),
    });
    return tx.patientProfile.update({
      where: { id: idPatient },
      data: {
        ...(corrige('sexe') ? { sexe: corrige('sexe') } : {}),
        ...(naissance ? { dateNaissance: naissance } : {}),
      },
      select: SELECTION,
    });
  });
  return enVue(maj as Ligne);
}

/** L'historique des corrections d'un patient, la plus recente d'abord. */
export async function historiqueCorrections(user: JwtPayload, idPatient: string): Promise<CorrectionIdentiteView[]> {
  await assertCanAccessPatient(user, idPatient);
  const lignes = await prisma.correctionIdentite.findMany({
    where: { idPatient },
    orderBy: { creeLe: 'desc' },
    take: 100,
    select: {
      id: true, champ: true, ancienneValeur: true, nouvelleValeur: true, motif: true, creeLe: true,
      auteur: { select: { prenom: true, nom: true } },
    },
  });
  return lignes.map((l) => ({
    id: l.id,
    champ: l.champ as ChampCorrigeable,
    ancienneValeur: l.ancienneValeur,
    nouvelleValeur: l.nouvelleValeur,
    motif: l.motif,
    creeLe: l.creeLe.toISOString(),
    auteur: l.auteur ? `${l.auteur.prenom} ${l.auteur.nom}` : null,
  }));
}
