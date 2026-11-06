import { Prisma, Role, StatutCourse } from '../config/generated/client/client';
import type {
  CreationLivreurView,
  CreerLivreurDto,
  LivreurAdminView,
} from '@baobaoheath/shared-types';
import { prisma } from '../config/prisma';
import type { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/app-error';
import { hashPassword } from '../utils/password.utils';
import { genererMotDePasseTemp } from './admin-structure.service';

const ROLES_RECRUTEMENT: readonly Role[] = [
  Role.ADMIN_REGIONAL,
  Role.ADMIN_NATIONAL,
  Role.SUPER_ADMIN,
];

function exigerRoleRecrutement(user: JwtPayload): void {
  if (!ROLES_RECRUTEMENT.includes(user.role)) {
    throw new ForbiddenError('Le recrutement des livreurs est reserve a l administration regionale ou nationale');
  }
}

function versLivreurAdminView(livreur: {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  creeLe: Date;
  livreurProfile: {
    quartier: string;
    prefecture: string;
    commune: string | null;
    estActif: boolean;
  } | null;
}): LivreurAdminView {
  if (!livreur.livreurProfile) {
    throw new NotFoundError('Le profil livreur est introuvable');
  }
  return {
    id: livreur.id,
    prenom: livreur.prenom,
    nom: livreur.nom,
    telephone: livreur.telephone,
    quartier: livreur.livreurProfile.quartier,
    prefecture: livreur.livreurProfile.prefecture,
    commune: livreur.livreurProfile.commune,
    estActif: livreur.livreurProfile.estActif,
    creeLe: livreur.creeLe.toISOString(),
  };
}

export async function creerLivreur(
  auteur: JwtPayload,
  dto: CreerLivreurDto,
): Promise<CreationLivreurView> {
  exigerRoleRecrutement(auteur);

  const existant = await prisma.utilisateur.findUnique({
    where: { telephone: dto.telephone },
    select: { id: true },
  });
  if (existant) throw new ConflictError('Ce numero de telephone est deja utilise');

  const motDePasseTemporaire = genererMotDePasseTemp();
  const motDePasseHash = await hashPassword(motDePasseTemporaire);

  try {
    const livreur = await prisma.$transaction(async (tx) => {
      const utilisateur = await tx.utilisateur.create({
        data: {
          telephone: dto.telephone,
          motDePasseHash,
          prenom: dto.prenom,
          nom: dto.nom,
          role: Role.LIVREUR,
          idStructure: null,
          doitChangerMotDePasse: true,
        },
        select: { id: true, prenom: true, nom: true, telephone: true, creeLe: true },
      });
      await tx.livreurProfile.create({
        data: {
          idUtilisateur: utilisateur.id,
          quartier: dto.quartier,
          prefecture: dto.prefecture,
          commune: dto.commune?.trim() || null,
        },
      });
      return {
        ...utilisateur,
        livreurProfile: {
          quartier: dto.quartier,
          prefecture: dto.prefecture,
          commune: dto.commune?.trim() || null,
          estActif: true,
        },
      };
    });
    return {
      livreur: versLivreurAdminView(livreur),
      motDePasseTemporaire,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('Ce numero de telephone est deja utilise');
    }
    throw error;
  }
}

export async function listerLivreurs(auteur: JwtPayload): Promise<LivreurAdminView[]> {
  exigerRoleRecrutement(auteur);
  const livreurs = await prisma.utilisateur.findMany({
    where: { role: Role.LIVREUR, livreurProfile: { isNot: null } },
    select: {
      id: true,
      prenom: true,
      nom: true,
      telephone: true,
      creeLe: true,
      livreurProfile: { select: { quartier: true, prefecture: true, commune: true, estActif: true } },
    },
    orderBy: { creeLe: 'desc' },
  });
  return livreurs.map(versLivreurAdminView);
}

export async function definirActiviteLivreur(
  auteur: JwtPayload,
  idUtilisateur: string,
  estActif: boolean,
): Promise<LivreurAdminView> {
  exigerRoleRecrutement(auteur);
  const profile = await prisma.livreurProfile.findUnique({
    where: { idUtilisateur },
    select: { id: true, estActif: true },
  });
  if (!profile) throw new NotFoundError('Livreur introuvable');

  if (!estActif) {
    const courseEnCours = await prisma.course.count({
      where: {
        idLivreur: profile.id,
        statut: { in: [StatutCourse.ATTRIBUEE, StatutCourse.EN_COURS] },
      },
    });
    if (courseEnCours > 0) {
      throw new ConflictError('Ce livreur a une course attribuee ou en cours et ne peut pas etre desactive');
    }
  }

  await prisma.livreurProfile.update({
    where: { id: profile.id },
    data: { estActif },
  });
  const livreur = await prisma.utilisateur.findUnique({
    where: { id: idUtilisateur },
    select: {
      id: true,
      prenom: true,
      nom: true,
      telephone: true,
      creeLe: true,
      livreurProfile: { select: { quartier: true, prefecture: true, commune: true, estActif: true } },
    },
  });
  if (!livreur) throw new NotFoundError('Livreur introuvable');
  return versLivreurAdminView(livreur);
}
