// Les fiches d'identite des personnes assurees (lot assurance, 2026-10-21).
//
// Quand une compagnie assure une entreprise, elle assure ses travailleurs :
// elle tient pour chacun une fiche qui reprend sa piece d'identite et sa
// photo. C'est cette fiche qui permet a la pharmacie de reconnaitre le
// beneficiaire au comptoir, et a la compagnie d'ouvrir le tiers payant sans
// passage a l'accueil d'un hopital.
//
// **La personne a toujours un compte patient.** S'il existe deja (meme
// telephone, meme nom), la fiche s'y rattache ; sinon il est cree, avec un
// mot de passe temporaire rendu une seule fois. Le travailleur retrouve ainsi
// sa carte dans l'application.
//
// **La photo ne va jamais sous `uploads/`**, qui est servi sans
// authentification : elle vit dans un dossier prive et ne sort que par les
// routes qui controlent qui la demande.
import { mkdirSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { JwtPayload } from '../types/auth.types';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/app-error';
import { hashPassword } from '../utils/password.utils';
import { personneAssureeSchema } from '../validators/api.schemas';
import {
  ADHESION_VIEW_INCLUDE,
  assureurDe,
  contratCollectifOuvert,
  creerContrat,
  nouveauJetonCarte,
  periodeAdhesion,
  photoDeLaCarte,
  versAdhesionView,
  versResumePersonne,
} from './assurance.service';
import { normaliser, normaliserTelephone } from './doublon.service';
import { getValeursParametres } from './parametres.service';
import { genererMotDePasseTemp } from './hopital.service';
import { initialiserConsentementsParDefaut } from './privacy.service';
import { analyserCsv } from './referentiel.service';
import type {
  AjouterTravailleurDto,
  AssurerPersonneDto,
  LigneImportTravailleurView,
  ModifierPersonneAssureeDto,
  PersonneAssureeDto,
  PersonneAssureeView,
  PersonneEnregistreeView,
  RapportImportTravailleursView,
} from '@baobaoheath/shared-types';

// ── La photo, dans un dossier prive ──────────────────────────────────

const DOSSIER_PHOTOS = path.join(process.cwd(), 'stockage-prive', 'assurance', 'photos');

/** Format d'une photo d'identite (4:5), assez grand pour reconnaitre un visage. */
const PHOTO = { largeur: 480, hauteur: 600 };

/** Le chemin d'une photo, sans jamais pouvoir sortir du dossier prive. */
export function cheminPhoto(nom: string): string {
  if (!/^[A-Za-z0-9_-]+\.webp$/.test(nom)) throw new NotFoundError('Photo introuvable');
  return path.join(DOSSIER_PHOTOS, nom);
}

async function lirePhoto(nom: string | null): Promise<Buffer> {
  if (!nom) throw new NotFoundError("Aucune photo sur la fiche de l'assure");
  try {
    return await fs.readFile(cheminPhoto(nom));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new NotFoundError('Photo introuvable');
  }
}

// ── Les vues ─────────────────────────────────────────────────────────

type Fiche = Prisma.PersonneAssureeGetPayload<object>;

export function versPersonneView(f: Fiche, date: Date): PersonneAssureeView {
  return {
    ...versResumePersonne(f, date),
    idPatient: f.idPatient,
    nom: f.nom,
    prenoms: f.prenoms,
    sexe: f.sexe === 'F' ? 'F' : 'M',
    dateNaissance: f.dateNaissance.toISOString(),
    lieuNaissance: f.lieuNaissance,
    nationalite: f.nationalite,
    dateDelivrancePiece: f.dateDelivrancePiece?.toISOString() ?? null,
    dateExpirationPiece: f.dateExpirationPiece?.toISOString() ?? null,
    telephone: f.telephone,
    adresse: f.adresse,
    creeLe: f.creeLe.toISOString(),
  };
}

// ── Le compte patient et la fiche ────────────────────────────────────

/** Ce que l'enregistrement d'une personne touche, dans une transaction. */
type ClientFiche = Pick<
  typeof prisma,
  'utilisateur' | 'patientProfile' | 'personneAssuree' | 'consentementPatient'
  | 'adhesionAssurance' | 'assureur' | 'contratAssurance'
>;

/** Un numero de piece se compare sans espaces ni casse : « gn 123 » = « GN123 ». */
function normaliserPiece(numero: string): string {
  return numero.replace(/\s+/g, '').toUpperCase();
}

/**
 * Le compte patient de la personne : celui qui existe deja pour ce telephone,
 * ou un nouveau.
 *
 * **Un numero deja pris par quelqu'un d'autre n'est pas detourne.** Si le
 * compte trouve porte un autre nom de famille, on refuse : sinon la carte et
 * la couverture iraient a une autre personne que celle qu'on assure.
 */
async function rattacherOuCreerPatient(
  tx: ClientFiche,
  dto: PersonneAssureeDto
): Promise<{ idPatient: string; compteCree: boolean; motDePasseTemporaire: string | null }> {
  // R14 : la longueur du numero national est celle du pays installe.
  const { pays: numerotation } = await getValeursParametres();
  const chiffres = normaliserTelephone(dto.telephone, numerotation);
  if (chiffres.length !== numerotation.longueurNumero) {
    throw new ValidationError(`Numero de telephone invalide : ${numerotation.longueurNumero} chiffres attendus`);
  }

  const comptes = await tx.utilisateur.findMany({
    where: { telephone: { endsWith: chiffres } },
    select: { id: true, prenom: true, nom: true, role: true, patientProfile: { select: { id: true } } },
    take: 2,
  });
  if (comptes.length > 1) {
    throw new ConflictError(`Plusieurs comptes portent le numero ${chiffres} : contactez l'administration`);
  }
  const compte = comptes[0];
  if (compte) {
    if (compte.role !== 'PATIENT' || !compte.patientProfile) {
      throw new ConflictError('Ce numero appartient a un compte professionnel : il ne peut pas etre assure avec ce telephone');
    }
    if (normaliser(compte.nom) !== normaliser(dto.nom)) {
      throw new ConflictError(
        `Le numero ${chiffres} appartient deja a ${compte.prenom} ${compte.nom}. Verifiez le telephone ou le nom saisi.`
      );
    }
    return { idPatient: compte.patientProfile.id, compteCree: false, motDePasseTemporaire: null };
  }

  // Mot de passe genere, jamais choisi par l'agent : il est remis une fois et
  // doit etre change a la premiere connexion, comme a l'accueil d'un hopital.
  const motDePasseTemporaire = genererMotDePasseTemp();
  const utilisateur = await tx.utilisateur.create({
    data: {
      telephone: chiffres,
      motDePasseHash: await hashPassword(motDePasseTemporaire),
      prenom: dto.prenoms.trim(),
      nom: dto.nom.trim(),
      role: 'PATIENT',
      doitChangerMotDePasse: true,
    },
    select: { id: true },
  });
  // Le niveau d'identite du dossier reste PROVISOIRE : il appartient aux
  // soignants. C'est la fiche de la compagnie qui ouvre le tiers payant.
  const patient = await tx.patientProfile.create({
    data: {
      idUtilisateur: utilisateur.id,
      dateNaissance: new Date(dto.dateNaissance),
      sexe: dto.sexe,
      prefecture: dto.prefecture.trim(),
      lieuNaissance: dto.lieuNaissance.trim(),
    },
    select: { id: true },
  });
  await initialiserConsentementsParDefaut(tx, patient.id, utilisateur.id);
  return { idPatient: patient.id, compteCree: true, motDePasseTemporaire };
}

/**
 * La fiche de la compagnie pour ce patient : celle qui existe deja (meme
 * piece), ou une nouvelle. Une meme piece ne peut pas designer deux personnes
 * dans une compagnie.
 */
async function enregistrerFiche(
  tx: ClientFiche,
  idAssureur: string,
  idPatient: string,
  dto: PersonneAssureeDto,
  idSaisiePar: string
): Promise<Fiche> {
  const numeroPiece = normaliserPiece(dto.numeroPiece);
  const existante = await tx.personneAssuree.findUnique({
    where: { idAssureur_idPatient: { idAssureur, idPatient } },
  });
  if (existante) {
    if (existante.typePiece !== dto.typePiece || existante.numeroPiece !== numeroPiece) {
      throw new ConflictError(
        `${existante.prenoms} ${existante.nom} a deja une fiche avec une autre piece (${existante.numeroPiece}) : `
        + 'mettez la fiche a jour avant de l assurer de nouveau'
      );
    }
    return existante;
  }

  const memePiece = await tx.personneAssuree.findUnique({
    where: { idAssureur_typePiece_numeroPiece: { idAssureur, typePiece: dto.typePiece, numeroPiece } },
    select: { prenoms: true, nom: true },
  });
  if (memePiece) {
    throw new ConflictError(`La piece ${numeroPiece} est deja enregistree pour ${memePiece.prenoms} ${memePiece.nom}`);
  }

  return tx.personneAssuree.create({
    data: {
      nom: dto.nom.trim(),
      prenoms: dto.prenoms.trim(),
      sexe: dto.sexe,
      dateNaissance: new Date(dto.dateNaissance),
      lieuNaissance: dto.lieuNaissance.trim(),
      nationalite: dto.nationalite.trim(),
      typePiece: dto.typePiece,
      numeroPiece,
      dateDelivrancePiece: dto.dateDelivrancePiece ? new Date(dto.dateDelivrancePiece) : null,
      dateExpirationPiece: dto.dateExpirationPiece ? new Date(dto.dateExpirationPiece) : null,
      telephone: normaliserTelephone(dto.telephone, (await getValeursParametres()).pays),
      adresse: dto.adresse?.trim() || null,
      idAssureur,
      idPatient,
      idSaisiePar,
    },
  });
}

// La creation d'un compte hache un mot de passe : la transaction depasse
// facilement les 5 secondes par defaut sur un poste modeste.
const OPTIONS_TRANSACTION = { timeout: 20_000 };

/**
 * Ajouter un travailleur a un contrat d'entreprise : sa fiche, son compte
 * patient si besoin, et son adhesion (donc sa carte), en une seule operation.
 */
export async function ajouterTravailleur(
  user: JwtPayload,
  idContrat: string,
  dto: AjouterTravailleurDto,
  maintenant = new Date()
): Promise<PersonneEnregistreeView> {
  const { id: idAssureur } = await assureurDe(user);
  const contrat = await contratCollectifOuvert(idAssureur, idContrat, maintenant);
  const { dateEffet, dateFin } = periodeAdhesion(contrat, dto, maintenant);
  const numeroAdherent = dto.numeroAdherent.trim();

  const resultat = await prisma.$transaction(async (tx) => {
    const compte = await rattacherOuCreerPatient(tx, dto.personne);
    const fiche = await enregistrerFiche(tx, idAssureur, compte.idPatient, dto.personne, user.userId);

    const doublon = await tx.adhesionAssurance.findFirst({
      where: { idContratCollectif: contrat.id, OR: [{ idPatient: compte.idPatient }, { numeroAdherent }] },
      select: { idPatient: true },
    });
    if (doublon) {
      throw new ConflictError(doublon.idPatient === compte.idPatient
        ? 'Cette personne est deja adherente de ce contrat'
        : `Le numero d'adherent ${numeroAdherent} est deja attribue dans ce contrat`);
    }

    const adhesion = await tx.adhesionAssurance.create({
      data: {
        idContratCollectif: contrat.id,
        idPatient: compte.idPatient,
        numeroAdherent,
        dateEffet,
        dateFin,
        jetonCarte: nouveauJetonCarte(),
      },
      include: ADHESION_VIEW_INCLUDE,
    });
    return { compte, fiche, adhesion };
  }, OPTIONS_TRANSACTION);

  logger.info('[ASSURANCE] travailleur ajoute', {
    idAssureur, idContrat: contrat.id, idPersonne: resultat.fiche.id,
    compteCree: resultat.compte.compteCree, parQui: user.userId,
  });
  return {
    personne: versPersonneView(resultat.fiche, maintenant),
    compteCree: resultat.compte.compteCree,
    motDePasseTemporaire: resultat.compte.motDePasseTemporaire,
    adhesion: versAdhesionView(resultat.adhesion, maintenant, versResumePersonne(resultat.fiche, maintenant)),
    contrat: null,
  };
}

/** Assurer une personne a titre individuel : sa fiche, son compte et sa police. */
export async function assurerPersonne(
  user: JwtPayload,
  dto: AssurerPersonneDto,
  maintenant = new Date()
): Promise<PersonneEnregistreeView> {
  const { id: idAssureur } = await assureurDe(user);
  const resultat = await prisma.$transaction(async (tx) => {
    const compte = await rattacherOuCreerPatient(tx, dto.personne);
    const fiche = await enregistrerFiche(tx, idAssureur, compte.idPatient, dto.personne, user.userId);
    const contrat = await creerContrat({ ...dto.police, idAssureur, idPatient: compte.idPatient }, tx);
    return { compte, fiche, contrat };
  }, OPTIONS_TRANSACTION);

  logger.info('[ASSURANCE] personne assuree individuellement', {
    idAssureur, idPersonne: resultat.fiche.id, compteCree: resultat.compte.compteCree, parQui: user.userId,
  });
  return {
    personne: versPersonneView(resultat.fiche, maintenant),
    compteCree: resultat.compte.compteCree,
    motDePasseTemporaire: resultat.compte.motDePasseTemporaire,
    adhesion: null,
    contrat: resultat.contrat,
  };
}

async function ficheDeLaCompagnie(user: JwtPayload, idPersonne: string): Promise<Fiche> {
  const { id: idAssureur } = await assureurDe(user);
  const fiche = await prisma.personneAssuree.findFirst({ where: { id: idPersonne, idAssureur } });
  if (!fiche) throw new NotFoundError('Fiche non trouvee dans votre compagnie');
  return fiche;
}

export async function obtenirPersonne(user: JwtPayload, idPersonne: string, maintenant = new Date()): Promise<PersonneAssureeView> {
  return versPersonneView(await ficheDeLaCompagnie(user, idPersonne), maintenant);
}

/**
 * Mettre a jour une fiche : piece renouvelee, faute de saisie. Le telephone
 * ne change pas ici, car c'est l'identifiant de connexion du patient.
 */
export async function modifierPersonne(
  user: JwtPayload,
  idPersonne: string,
  dto: ModifierPersonneAssureeDto,
  maintenant = new Date()
): Promise<PersonneAssureeView> {
  const fiche = await ficheDeLaCompagnie(user, idPersonne);
  const date = (v: string | Date | undefined) => (v === undefined ? undefined : new Date(v));
  const dateOuNull = (v: string | Date | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);

  const data: Prisma.PersonneAssureeUpdateInput = {
    nom: dto.nom?.trim(),
    prenoms: dto.prenoms?.trim(),
    sexe: dto.sexe,
    dateNaissance: date(dto.dateNaissance),
    lieuNaissance: dto.lieuNaissance?.trim(),
    nationalite: dto.nationalite?.trim(),
    typePiece: dto.typePiece,
    numeroPiece: dto.numeroPiece !== undefined ? normaliserPiece(dto.numeroPiece) : undefined,
    dateDelivrancePiece: dateOuNull(dto.dateDelivrancePiece),
    dateExpirationPiece: dateOuNull(dto.dateExpirationPiece),
    adresse: dto.adresse !== undefined ? dto.adresse.trim() || null : undefined,
  };

  const delivrance = data.dateDelivrancePiece !== undefined ? data.dateDelivrancePiece as Date | null : fiche.dateDelivrancePiece;
  const expiration = data.dateExpirationPiece !== undefined ? data.dateExpirationPiece as Date | null : fiche.dateExpirationPiece;
  if (delivrance && expiration && expiration <= delivrance) {
    throw new ValidationError("La date d'expiration de la piece doit suivre sa date de delivrance");
  }

  try {
    const maj = await prisma.personneAssuree.update({ where: { id: fiche.id }, data });
    logger.info('[ASSURANCE] fiche d assure modifiee', { idPersonne: fiche.id, parQui: user.userId });
    return versPersonneView(maj, maintenant);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictError('Cette piece est deja enregistree pour une autre personne de votre compagnie');
    }
    throw e;
  }
}

/** Enregistrer la photo d'une fiche : recadree au format identite, en WebP. */
export async function enregistrerPhoto(
  user: JwtPayload,
  idPersonne: string,
  image: Buffer,
  maintenant = new Date()
): Promise<PersonneAssureeView> {
  const fiche = await ficheDeLaCompagnie(user, idPersonne);
  mkdirSync(DOSSIER_PHOTOS, { recursive: true });
  const nom = `${fiche.id}-${Date.now()}.webp`;
  try {
    await sharp(image)
      .rotate() // respecte l'orientation des photos prises au telephone
      .resize(PHOTO.largeur, PHOTO.hauteur, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toFile(cheminPhoto(nom));
  } catch {
    throw new ValidationError('Image illisible ou corrompue');
  }

  const maj = await prisma.personneAssuree.update({ where: { id: fiche.id }, data: { photo: nom } });
  if (fiche.photo) await fs.unlink(cheminPhoto(fiche.photo)).catch(() => undefined);
  logger.info('[ASSURANCE] photo d assure enregistree', { idPersonne: fiche.id, parQui: user.userId });
  return versPersonneView(maj, maintenant);
}

/** La photo, pour la compagnie qui tient la fiche. */
export async function photoPourCompagnie(user: JwtPayload, idPersonne: string): Promise<Buffer> {
  const fiche = await ficheDeLaCompagnie(user, idPersonne);
  return lirePhoto(fiche.photo);
}

/**
 * La photo de la carte presentee au comptoir. La pharmacie ne la demande que
 * pour la carte qu'elle a sous les yeux : jamais une liste, et chaque
 * consultation est journalisee.
 */
export async function photoPourComptoir(user: JwtPayload, jetonCarte: string): Promise<Buffer> {
  const carte = await photoDeLaCarte(jetonCarte);
  if (!carte) throw new NotFoundError("Carte d'assurance inconnue ou remplacee");
  logger.info('[ASSURANCE] photo consultee au comptoir', { idPatient: carte.idPatient, parQui: user.userId });
  return lirePhoto(carte.photo);
}

/** La photo de sa propre carte, pour le patient. */
export async function photoPourPatient(userId: string, jetonCarte: string): Promise<Buffer> {
  const [patient, carte] = await Promise.all([
    prisma.patientProfile.findUnique({ where: { idUtilisateur: userId }, select: { id: true } }),
    photoDeLaCarte(jetonCarte),
  ]);
  // Une carte d'un autre patient se traite comme une carte inconnue : rien ne
  // doit confirmer qu'elle existe.
  if (!patient || !carte || carte.idPatient !== patient.id) throw new NotFoundError('Carte introuvable');
  return lirePhoto(carte.photo);
}

// ── L'import de la liste du personnel ────────────────────────────────

/** Les colonnes attendues, telles que le modele de fichier les nomme. */
export const COLONNES_IMPORT = [
  'nom', 'prenoms', 'sexe', 'date_naissance', 'lieu_naissance', 'nationalite',
  'type_piece', 'numero_piece', 'telephone', 'prefecture', 'numero_adherent',
] as const;
export const COLONNES_IMPORT_FACULTATIVES = ['date_delivrance', 'date_expiration', 'adresse', 'date_effet'] as const;

const LIGNES_IMPORT_MAX = 1000;

/** « 02/06/1988 » (Excel en francais) ou « 1988-06-02 ». Le reste est rendu tel quel et refuse. */
export function dateCsv(valeur: string | undefined): string | undefined {
  const v = (valeur ?? '').trim();
  if (!v) return undefined;
  const fr = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2]!.padStart(2, '0')}-${fr[1]!.padStart(2, '0')}`;
  return v;
}

/**
 * Importer la liste du personnel d'une entreprise (CSV, separateur `;` ou
 * `,`). Chaque ligne est traitee pour elle-meme : une ligne refusee n'empeche
 * pas les autres, et le rapport dit pourquoi, au rang exact du fichier.
 *
 * Les photos ne passent pas par le fichier : elles s'ajoutent ensuite, fiche
 * par fiche.
 */
export async function importerTravailleurs(
  user: JwtPayload,
  idContrat: string,
  contenu: string,
  maintenant = new Date()
): Promise<RapportImportTravailleursView> {
  const { id: idAssureur } = await assureurDe(user);
  await contratCollectifOuvert(idAssureur, idContrat, maintenant);

  const csv = analyserCsv(contenu);
  const manquantes = COLONNES_IMPORT.filter((c) => !csv.entetes.includes(c));
  if (manquantes.length > 0) {
    throw new ValidationError(`Colonnes manquantes : ${manquantes.join(', ')}`);
  }
  if (csv.lignes.length > LIGNES_IMPORT_MAX) {
    throw new ValidationError(`Le fichier depasse ${LIGNES_IMPORT_MAX} lignes : decoupez-le`);
  }

  const lignes: LigneImportTravailleurView[] = [];
  for (const { numero, champs: c } of csv.lignes) {
    const nom = [c['prenoms'], c['nom']].filter(Boolean).join(' ') || null;
    const brut: Record<string, string | undefined> = {
      nom: c['nom'],
      prenoms: c['prenoms'],
      sexe: c['sexe']?.toUpperCase(),
      dateNaissance: dateCsv(c['date_naissance']),
      lieuNaissance: c['lieu_naissance'],
      nationalite: c['nationalite'],
      typePiece: c['type_piece']?.toUpperCase().replace(/[\s-]+/g, '_'),
      numeroPiece: c['numero_piece'],
      dateDelivrancePiece: dateCsv(c['date_delivrance']),
      dateExpirationPiece: dateCsv(c['date_expiration']),
      telephone: c['telephone'],
      adresse: c['adresse'] || undefined,
      prefecture: c['prefecture'],
    };
    for (const cle of Object.keys(brut)) if (brut[cle] === undefined || brut[cle] === '') delete brut[cle];

    const personne = personneAssureeSchema.safeParse(brut);
    if (!personne.success) {
      const motif = personne.error.issues.map((i) => `${i.path.join('.') || 'ligne'} : ${i.message}`).join(' ; ');
      lignes.push({ numero, statut: 'REFUSE', nom, numeroAdherent: c['numero_adherent'] || null, motif });
      continue;
    }

    try {
      const r = await ajouterTravailleur(user, idContrat, {
        personne: personne.data,
        numeroAdherent: c['numero_adherent'] ?? '',
        ...(dateCsv(c['date_effet']) ? { dateEffet: dateCsv(c['date_effet']) } : {}),
      }, maintenant);
      lignes.push({
        numero,
        statut: r.compteCree ? 'CREE' : 'RATTACHE',
        nom,
        numeroAdherent: r.adhesion?.numeroAdherent ?? null,
        motDePasseTemporaire: r.motDePasseTemporaire ?? null,
      });
    } catch (e) {
      // Une erreur metier se rapporte a la ligne ; toute autre interrompt
      // l'import, car elle ne viendrait pas du fichier.
      if (!(e instanceof AppError)) throw e;
      lignes.push({ numero, statut: 'REFUSE', nom, numeroAdherent: c['numero_adherent'] || null, motif: e.message });
    }
  }

  logger.info('[ASSURANCE] import de travailleurs', {
    idAssureur, idContrat, lignes: lignes.length, parQui: user.userId,
  });
  return {
    lignes,
    crees: lignes.filter((l) => l.statut === 'CREE').length,
    rattaches: lignes.filter((l) => l.statut === 'RATTACHE').length,
    refuses: lignes.filter((l) => l.statut === 'REFUSE').length,
  };
}
