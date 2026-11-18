// Changer de numero de telephone.
//
// **Le numero est la cle du compte.** On s'y connecte, on y recoit les codes,
// on ouvre son dossier par USSD avec lui. Jusqu'ici, la fenetre « Mon profil »
// le changeait sans rien demander : une session laissee ouverte, ou volee,
// suffisait a detourner le compte vers un autre telephone, et le titulaire ne
// pouvait plus rien recuperer.
//
// Desormais, deux preuves :
// 1. le **mot de passe actuel** - c'est bien le titulaire ;
// 2. un **code envoye au nouveau numero** - il detient bien ce telephone, et
//    une faute de frappe ne l'enferme pas dehors.
// L'ancien numero est averti du changement, et les autres sessions sont
// fermees : si ce n'etait pas lui, il le sait, et l'intrus est deconnecte.
import { randomInt } from 'crypto';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/app-error';
import { hashPassword, verifyPassword } from '../utils/password.utils';
import { peutRenvoyerOtpEnClair } from '../utils/otp-developpement';
import { envoyerSms, envoyerSmsSimule } from './notification.service';

export const CODE_VALIDE_MINUTES = 10;
const TENTATIVES_MAX = 5;
/** Trois demandes par heure : assez pour une faute de frappe, trop peu pour bombarder un numero de SMS. */
export const DEMANDES_PAR_HEURE = 3;

/** Les deux derniers chiffres suffisent a reconnaitre son numero, pas a le recopier. */
export function masquerTelephone(telephone: string): string {
  const t = telephone.trim();
  return t.length <= 2 ? '••' : '•'.repeat(t.length - 2) + t.slice(-2);
}

export interface DemandeChangementTelephoneView {
  telephoneMasque: string;
  expireDansMinutes: number;
  /** Developpement seulement (EMAIL_OTP_DEV_FALLBACK=true, jamais en production). */
  codeDeveloppement?: string;
}

export async function demanderChangementTelephone(
  userId: string,
  dto: { nouveauTelephone: string; motDePasse: string },
  maintenant = new Date(),
): Promise<DemandeChangementTelephoneView> {
  const nouveau = dto.nouveauTelephone.trim();
  const utilisateur = await prisma.utilisateur.findUnique({ where: { id: userId } });
  if (!utilisateur || !utilisateur.estActif) throw new NotFoundError('Utilisateur non trouve');

  const valide = await verifyPassword(dto.motDePasse, utilisateur.motDePasseHash);
  if (!valide) throw new UnauthorizedError('Mot de passe incorrect');

  if (nouveau === utilisateur.telephone) {
    throw new ValidationError("C'est deja le numero de votre compte");
  }
  const pris = await prisma.utilisateur.findFirst({ where: { telephone: nouveau, NOT: { id: userId } }, select: { id: true } });
  if (pris) throw new ConflictError('Ce numero de telephone est deja utilise');

  const depuisUneHeure = new Date(maintenant.getTime() - 60 * 60_000);
  const recentes = await prisma.changementTelephone.count({
    where: { idUtilisateur: userId, creeLe: { gte: depuisUneHeure } },
  });
  if (recentes >= DEMANDES_PAR_HEURE) {
    throw new AppError('Trop de demandes de code. Reessayez dans une heure', 429);
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  // Une seule demande vivante : un nouveau code annule le precedent.
  await prisma.changementTelephone.updateMany({
    where: { idUtilisateur: userId, utiliseLe: null },
    data: { utiliseLe: maintenant },
  });
  const demande = await prisma.changementTelephone.create({
    data: {
      idUtilisateur: userId,
      nouveauTelephone: nouveau,
      codeHash: await hashPassword(code),
      expireLe: new Date(maintenant.getTime() + CODE_VALIDE_MINUTES * 60_000),
      maxTentatives: TENTATIVES_MAX,
      creeLe: maintenant,
    },
  });

  try {
    await envoyerSms({
      telephone: nouveau,
      message: `Votre code de changement de numero : ${code}. Valable ${CODE_VALIDE_MINUTES} minutes. Ne le communiquez a personne.`,
    });
  } catch (error: unknown) {
    // Un code qu'on n'a pas pu envoyer ne doit pas rester valable.
    await prisma.changementTelephone.update({ where: { id: demande.id }, data: { utiliseLe: maintenant } });
    logger.error('[TELEPHONE] envoi du code echoue', { userId, erreur: error instanceof Error ? error.message : String(error) });
    throw new AppError("Le code n'a pas pu etre envoye a ce numero. Verifiez-le et reessayez", 503);
  }

  return {
    telephoneMasque: masquerTelephone(nouveau),
    expireDansMinutes: CODE_VALIDE_MINUTES,
    ...(peutRenvoyerOtpEnClair() ? { codeDeveloppement: code } : {}),
  };
}

export async function confirmerChangementTelephone(
  userId: string,
  sessionId: string,
  dto: { code: string },
  maintenant = new Date(),
): Promise<{ telephone: string }> {
  const demande = await prisma.changementTelephone.findFirst({
    where: { idUtilisateur: userId, utiliseLe: null },
    orderBy: { creeLe: 'desc' },
  });
  if (!demande) throw new ValidationError('Aucune demande en cours. Demandez un nouveau code');

  if (demande.expireLe < maintenant) {
    await prisma.changementTelephone.update({ where: { id: demande.id }, data: { utiliseLe: maintenant } });
    throw new ValidationError('Code expire. Demandez un nouveau code');
  }

  const bon = await verifyPassword(dto.code.trim(), demande.codeHash);
  if (!bon) {
    const tentatives = demande.tentatives + 1;
    await prisma.changementTelephone.update({
      where: { id: demande.id },
      data: { tentatives, ...(tentatives >= demande.maxTentatives ? { utiliseLe: maintenant } : {}) },
    });
    const restantes = demande.maxTentatives - tentatives;
    if (restantes <= 0) throw new ValidationError('Code incorrect. Nombre maximum de tentatives atteint. Demandez un nouveau code');
    throw new ValidationError(`Code incorrect. Il vous reste ${restantes} tentative(s)`);
  }

  const avant = await prisma.utilisateur.findUnique({ where: { id: userId }, select: { telephone: true } });
  if (!avant) throw new NotFoundError('Utilisateur non trouve');

  try {
    await prisma.$transaction(async (tx) => {
      // Conditionnelle : un double envoi du meme code ne change rien deux fois.
      const consommee = await tx.changementTelephone.updateMany({
        where: { id: demande.id, utiliseLe: null },
        data: { utiliseLe: maintenant },
      });
      if (consommee.count !== 1) throw new ValidationError('Ce code a deja ete utilise. Demandez un nouveau code');
      await tx.utilisateur.update({ where: { id: userId }, data: { telephone: demande.nouveauTelephone } });
      // Si ce n'etait pas le titulaire, l'intrus perd ses autres sessions.
      await tx.session.deleteMany({ where: { idUtilisateur: userId, NOT: { id: sessionId } } });
    });
  } catch (error: unknown) {
    // Le numero a ete pris entre la demande et la confirmation (unicite en base).
    if ((error as { code?: string })?.code === 'P2002') throw new ConflictError('Ce numero de telephone est deja utilise');
    throw error;
  }

  // Hors transaction, et sans faire echouer le changement : l'ancien numero
  // est prevenu. Si ce n'etait pas lui, il sait qu'il doit reagir.
  await envoyerSmsSimule(
    avant.telephone,
    `Le numero de votre compte vient d'etre remplace par ${masquerTelephone(demande.nouveauTelephone)}. ` +
      "Si ce n'est pas vous, contactez votre structure de sante.",
  );
  return { telephone: demande.nouveauTelephone };
}
