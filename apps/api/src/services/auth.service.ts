import { randomBytes, randomInt, randomUUID, createHash, createHmac } from 'crypto';
import { Role, TypeEvenementConnexion } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { ForgotPasswordDto, LoginDto, LoginResult, RegisterDto, ResetPasswordDto, TokenPair, VerifyLoginOtpDto } from '../types/auth.types';
import { generateTokenPair, verifyRefreshToken } from '../utils/jwt.utils';
import { hashPassword, verifyPassword } from '../utils/password.utils';
import { peutRenvoyerOtpEnClair } from '../utils/otp-developpement';
import { assertMotDePasseConforme } from '../utils/politique-mot-de-passe';
import { envoyerEmailResetMotDePasse, envoyerOtpConnexion } from './email.service';
import { initialiserConsentementsParDefaut } from './privacy.service';
import { assertNomModifiableParLePatient } from './patient.service';
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../utils/app-error';
import { logger } from '../config/logger';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

export interface ContexteConnexion {
  ipAdresse?: string | null;
  userAgent?: string | null;
}

type UtilisateurConnexion = { id: string; idStructure?: string | null };

async function enregistrerEvenementConnexion(
  type: TypeEvenementConnexion,
  contexte: ContexteConnexion,
  utilisateur?: UtilisateurConnexion,
  identifiant?: string,
): Promise<void> {
  await prisma.evenementConnexion.create({
    data: {
      type,
      ipAdresse: contexte.ipAdresse?.slice(0, 100) ?? null,
      userAgent: contexte.userAgent?.slice(0, 1000) ?? null,
      identifiantHash: !utilisateur && identifiant
        ? createHmac('sha256', env.JWT_SECRET)
          .update('connection-identifier-v1:')
          .update(identifiant.trim().toLowerCase())
          .digest('hex')
        : null,
      idUtilisateur: utilisateur?.id ?? null,
      idStructure: utilisateur?.idStructure ?? null,
    },
  });
}

function canUseDevOtpFallback(): boolean {
  return peutRenvoyerOtpEnClair();
}

async function createSessionTokens(
  utilisateur: { id: string; role: Role; idStructure?: string | null },
  contexte: ContexteConnexion = {},
): Promise<TokenPair> {
  const sessionId = randomUUID();
  const tokenPair = generateTokenPair({ userId: utilisateur.id, role: utilisateur.role, sessionId });

  await prisma.$transaction(async (tx) => {
    await tx.session.create({
      data: {
        id: sessionId,
        refreshToken: tokenPair.refreshToken,
        expireLe: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        idUtilisateur: utilisateur.id,
        ipAdresse: contexte.ipAdresse ?? null,
        userAgent: contexte.userAgent?.slice(0, 1000) ?? null,
      },
    });

    await tx.utilisateur.update({
      where: { id: utilisateur.id },
      data: { derniereConnexion: new Date() },
    });

    if (utilisateur.idStructure) {
      await tx.evenementConnexion.create({
        data: {
          type: TypeEvenementConnexion.CONNEXION_REUSSIE,
          ipAdresse: contexte.ipAdresse?.slice(0, 100) ?? null,
          userAgent: contexte.userAgent?.slice(0, 1000) ?? null,
          idUtilisateur: utilisateur.id,
          idStructure: utilisateur.idStructure,
        },
      });
    }
  });

  return tokenPair;
}

function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function register(dto: RegisterDto): Promise<TokenPair> {
  const existingTel = await prisma.utilisateur.findUnique({ where: { telephone: dto.telephone } });
  if (existingTel) throw new ConflictError('Ce numero de telephone est deja utilise');

  if (dto.email) {
    const existingEmail = await prisma.utilisateur.findUnique({ where: { email: dto.email } });
    if (existingEmail) throw new ConflictError('Cette adresse email est deja utilisee');
  }

  const motDePasseHash = await hashPassword(dto.motDePasse);

  const utilisateur = await prisma.$transaction(async (tx) => {
    const user = await tx.utilisateur.create({
      data: {
        telephone: dto.telephone,
        email: dto.email ?? null,
        motDePasseHash,
        prenom: dto.prenom,
        nom: dto.nom,
        role: Role.PATIENT,
      },
    });

    const patient = await tx.patientProfile.create({
      data: {
        idUtilisateur: user.id,
        dateNaissance: new Date('2000-01-01'),
        sexe: 'M',
        prefecture: 'Conakry',
      },
    });

    await initialiserConsentementsParDefaut(tx, patient.id, user.id);

    return user;
  });

  return createSessionTokens(utilisateur);
}

export async function login(dto: LoginDto, contexte: ContexteConnexion = {}): Promise<LoginResult> {
  const identifiant = dto.identifiant.trim();
  const isEmail = identifiant.includes('@');

  const utilisateur = await prisma.utilisateur.findUnique({
    where: isEmail ? { email: identifiant.toLowerCase() } : { telephone: identifiant },
  });

  if (!utilisateur || !utilisateur.estActif) {
    await enregistrerEvenementConnexion(
      TypeEvenementConnexion.ECHEC_AUTHENTIFICATION,
      contexte,
      utilisateur ?? undefined,
      identifiant,
    );
    throw new UnauthorizedError('Identifiants invalides');
  }

  const valid = await verifyPassword(dto.motDePasse, utilisateur.motDePasseHash);
  if (!valid) {
    await enregistrerEvenementConnexion(
      TypeEvenementConnexion.ECHEC_AUTHENTIFICATION,
      contexte,
      utilisateur,
      identifiant,
    );
    throw new UnauthorizedError('Identifiants invalides');
  }

  // Les livreurs de Conakry n'ont pas toujours d'adresse professionnelle :
  // leur telephone + mot de passe suffit, comme pour les patients. Le mot de
  // passe temporaire doit etre change a la premiere connexion, leur compte
  // peut etre desactive par l'administration et la limitation des tentatives
  // reste active. Cette exception n'ajoute pas de second facteur.
  if (utilisateur.role === Role.PATIENT || utilisateur.role === Role.LIVREUR) {
    return createSessionTokens(utilisateur, contexte);
  }

  if (!isEmail) {
    await enregistrerEvenementConnexion(
      TypeEvenementConnexion.ECHEC_AUTHENTIFICATION,
      contexte,
      utilisateur,
      identifiant,
    );
    throw new ValidationError('Les utilisateurs du systeme doivent se connecter avec leur email professionnel');
  }

  if (!utilisateur.email) {
    await enregistrerEvenementConnexion(
      TypeEvenementConnexion.ECHEC_AUTHENTIFICATION,
      contexte,
      utilisateur,
      identifiant,
    );
    throw new ValidationError('Aucune adresse email n est associee a ce compte. Contactez un administrateur');
  }

  const code = generateOtpCode();
  const codeHash = await hashPassword(code);
  const expireLe = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.authOtp.deleteMany({
    where: {
      idUtilisateur: utilisateur.id,
      OR: [
        { utiliseLe: { not: null } },
        { expireLe: { lt: new Date() } },
      ],
    },
  });

  const otp = await prisma.authOtp.create({
    data: {
      idUtilisateur: utilisateur.id,
      codeHash,
      expireLe,
      maxTentatives: OTP_MAX_ATTEMPTS,
    },
  });

  let devOtp: string | undefined;

  try {
    await envoyerOtpConnexion({
      destinataire: utilisateur.email,
      prenomNom: `${utilisateur.prenom} ${utilisateur.nom}`,
      code,
      expireDansMinutes: OTP_TTL_MINUTES,
    });
  } catch (error: unknown) {
    logger.error('[AUTH OTP] Envoi email echoue', {
      email: utilisateur.email,
      error: error instanceof Error ? error.message : error,
    });

    if (!canUseDevOtpFallback()) {
      await prisma.authOtp.deleteMany({ where: { id: otp.id } });
      throw new AppError("Mot de passe correct, mais l'envoi du code OTP a echoue. Verifiez l'email du compte ou reessayez", 503);
    }

    devOtp = code;
    logger.debug(`[AUTH OTP DEV] Code OTP pour ${utilisateur.email}: ${code}`);
  }

  return {
    requiresOtp: true,
    email: utilisateur.email,
    expiresInMinutes: OTP_TTL_MINUTES,
    message: devOtp
      ? "L'envoi email OTP a echoue. Mode developpement actif: utilisez le code affiche dans la console backend"
      : 'Un code OTP de 6 chiffres a ete envoye a votre adresse email',
    ...(devOtp ? { devOtp } : {}),
  };
}

export async function verifyLoginOtp(
  dto: VerifyLoginOtpDto,
  contexte: ContexteConnexion = {},
): Promise<TokenPair> {
  const email = dto.email.trim().toLowerCase();
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { email },
  });

  if (!utilisateur || !utilisateur.estActif) {
    await enregistrerEvenementConnexion(
      TypeEvenementConnexion.ECHEC_CODE,
      contexte,
      utilisateur ?? undefined,
      email,
    );
    throw new NotFoundError('Compte introuvable ou desactive');
  }

  if (utilisateur.role === Role.PATIENT) {
    throw new ValidationError('La verification OTP n est pas requise pour les patients');
  }

  const otp = await prisma.authOtp.findFirst({
    where: {
      idUtilisateur: utilisateur.id,
      utiliseLe: null,
    },
    orderBy: { creeLe: 'desc' },
  });

  if (!otp) {
    throw new ValidationError('Aucun code OTP actif. Veuillez relancer la connexion');
  }

  if (otp.expireLe < new Date()) {
    await prisma.authOtp.update({ where: { id: otp.id }, data: { utiliseLe: new Date() } });
    throw new ValidationError('Code OTP expire. Veuillez relancer la connexion');
  }

  if (otp.tentatives >= otp.maxTentatives) {
    throw new ValidationError('Nombre maximum de tentatives atteint. Veuillez relancer la connexion');
  }

  const isValid = await verifyPassword(dto.code, otp.codeHash);
  if (!isValid) {
    await enregistrerEvenementConnexion(
      TypeEvenementConnexion.ECHEC_CODE,
      contexte,
      utilisateur,
      email,
    );
    const nextAttempts = otp.tentatives + 1;
    await prisma.authOtp.update({
      where: { id: otp.id },
      data: {
        tentatives: nextAttempts,
        ...(nextAttempts >= otp.maxTentatives ? { utiliseLe: new Date() } : {}),
      },
    });

    const remaining = otp.maxTentatives - nextAttempts;
    if (remaining <= 0) {
      throw new ValidationError('Code OTP incorrect. Nombre maximum de tentatives atteint. Veuillez relancer la connexion');
    }

    throw new ValidationError(`Code OTP incorrect. Il vous reste ${remaining} tentative(s)`);
  }

  await prisma.authOtp.update({
    where: { id: otp.id },
    data: { utiliseLe: new Date() },
  });

  return createSessionTokens(utilisateur, contexte);
}

export async function logout(
  sessionId: string,
  userId?: string,
  contexte: ContexteConnexion = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      include: { utilisateur: { select: { id: true, idStructure: true } } },
    });
    if (session && (!userId || session.idUtilisateur === userId) && session.utilisateur.idStructure) {
      await tx.evenementConnexion.create({
        data: {
          type: TypeEvenementConnexion.DECONNEXION,
          ipAdresse: contexte.ipAdresse?.slice(0, 100) ?? null,
          userAgent: contexte.userAgent?.slice(0, 1000) ?? null,
          idUtilisateur: session.utilisateur.id,
          idStructure: session.utilisateur.idStructure,
        },
      });
    }
    await tx.session.deleteMany({ where: { id: sessionId } });
  });
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  // Signature et type d'abord : la recherche en base seule ne prouvait pas
  // que le jeton soumis etait un jeton de rafraichissement.
  verifyRefreshToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { refreshToken },
    include: { utilisateur: true },
  });
  if (!session || session.expireLe < new Date()) throw new UnauthorizedError('Session expiree ou invalide');
  if (!session.utilisateur.estActif) throw new UnauthorizedError('Utilisateur desactive');

  const sessionId = randomUUID();
  const tokenPair = generateTokenPair({
    userId: session.utilisateur.id,
    role: session.utilisateur.role,
    sessionId,
  });

  await prisma.session.delete({ where: { id: session.id } });
  await prisma.session.create({
    data: {
      id: sessionId,
      refreshToken: tokenPair.refreshToken,
      expireLe: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      idUtilisateur: session.utilisateur.id,
      ipAdresse: session.ipAdresse,
      userAgent: session.userAgent,
    },
  });

  return tokenPair;
}

export async function getMe(userId: string) {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: {
      id: true,
      telephone: true,
      email: true,
      prenom: true,
      nom: true,
      role: true,
      pharmacienProfile: { select: { roleOfficine: true } },
      langue: true,
      photoUrl: true,
      estActif: true,
      doitChangerMotDePasse: true,
      creeLe: true,
      modifieLe: true,
    },
  });
  if (!utilisateur) throw new NotFoundError('Utilisateur non trouve');
  const { pharmacienProfile, ...profil } = utilisateur;
  return {
    ...profil,
    roleOfficine: pharmacienProfile?.roleOfficine ?? null,
  };
}

export async function changerMotDePasse(userId: string, dto: {
  ancienMotDePasse?: string;
  nouveauMotDePasse: string;
}): Promise<void> {
  const utilisateur = await prisma.utilisateur.findUnique({ where: { id: userId } });
  if (!utilisateur) throw new NotFoundError('Utilisateur non trouve');

  if (!utilisateur.doitChangerMotDePasse) {
    if (!dto.ancienMotDePasse) throw new ValidationError("L'ancien mot de passe est obligatoire");
    const valid = await verifyPassword(dto.ancienMotDePasse, utilisateur.motDePasseHash);
    if (!valid) throw new UnauthorizedError('Ancien mot de passe incorrect');
  }

  assertMotDePasseConforme(dto.nouveauMotDePasse, utilisateur.role);

  const motDePasseHash = await hashPassword(dto.nouveauMotDePasse);
  await prisma.utilisateur.update({
    where: { id: userId },
    data: { motDePasseHash, doitChangerMotDePasse: false },
  });
}

const RESET_TOKEN_TTL_MINUTES = 60;

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function demanderResetMotDePasse(dto: ForgotPasswordDto): Promise<void> {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { email: dto.email.toLowerCase() },
  });

  // Ne jamais révéler si l'email existe — retourner silencieusement
  if (!utilisateur || !utilisateur.estActif || !utilisateur.email) return;

  // Supprimer les anciens tokens de reset pour cet utilisateur
  await prisma.motDePasseReset.deleteMany({ where: { idUtilisateur: utilisateur.id } });

  const token     = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);
  const expireLe  = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await prisma.motDePasseReset.create({
    data: { idUtilisateur: utilisateur.id, tokenHash, expireLe },
  });

  const lienReset = `${env.FRONTEND_URL}/auth/reset-password?token=${token}`;

  try {
    await envoyerEmailResetMotDePasse({
      destinataire:       utilisateur.email,
      prenomNom:          `${utilisateur.prenom} ${utilisateur.nom}`,
      lienReset,
      expireDansMinutes:  RESET_TOKEN_TTL_MINUTES,
    });
  } catch (error: unknown) {
    logger.error('[RESET PWD] Envoi email echoue', {
      email: utilisateur.email,
      error: error instanceof Error ? error.message : error,
    });
    // On ne re-throw pas — on ne veut pas révéler l'échec à l'appelant
  }
}

export async function reinitialiserMotDePasse(dto: ResetPasswordDto): Promise<void> {
  const tokenHash = hashResetToken(dto.token);

  const resetRecord = await prisma.motDePasseReset.findUnique({ where: { tokenHash } });

  if (!resetRecord || resetRecord.utiliseLe !== null) {
    throw new ValidationError('Lien de réinitialisation invalide ou déjà utilisé');
  }

  if (resetRecord.expireLe < new Date()) {
    throw new ValidationError('Lien de réinitialisation expiré. Veuillez en faire un nouveau.');
  }

  // La regle depend du compte : le lien ne dit pas a qui il appartient.
  const titulaire = await prisma.utilisateur.findUnique({
    where: { id: resetRecord.idUtilisateur },
    select: { role: true },
  });
  if (!titulaire) throw new ValidationError('Lien de réinitialisation invalide ou déjà utilisé');
  assertMotDePasseConforme(dto.nouveauMotDePasse, titulaire.role);

  const motDePasseHash = await hashPassword(dto.nouveauMotDePasse);

  await prisma.$transaction(async (tx) => {
    await tx.utilisateur.update({
      where: { id: resetRecord.idUtilisateur },
      data: { motDePasseHash, doitChangerMotDePasse: false },
    });

    await tx.motDePasseReset.update({
      where: { id: resetRecord.id },
      data: { utiliseLe: new Date() },
    });

    // Invalider toutes les sessions actives (forcer re-connexion)
    await tx.session.deleteMany({ where: { idUtilisateur: resetRecord.idUtilisateur } });
  });
}

export async function updateProfil(userId: string, dto: {
  prenom?: string;
  nom?: string;
  email?: string;
  telephone?: string;
  photoUrl?: string;
}): Promise<void> {
  // La fenetre « Mon profil » est commune a tous les roles : pour un patient,
  // elle tient la meme regle que son espace (nom fige une fois verifie, R15).
  await assertNomModifiableParLePatient(userId, { prenom: dto.prenom, nom: dto.nom });
  if (dto.email) {
    const existing = await prisma.utilisateur.findFirst({
      where: { email: dto.email, NOT: { id: userId } },
    });
    if (existing) throw new ConflictError('Cette adresse email est deja utilisee');
  }
  if (dto.telephone) {
    const existing = await prisma.utilisateur.findFirst({
      where: { telephone: dto.telephone, NOT: { id: userId } },
    });
    if (existing) throw new ConflictError('Ce numero de telephone est deja utilise');
  }

  await prisma.utilisateur.update({ where: { id: userId }, data: dto });
}
