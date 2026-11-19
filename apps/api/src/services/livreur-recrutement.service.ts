import { Role, StatutCourse } from '../config/generated/client/client';
import type {
  CreationLivreurView,
  CreerLivreurDto,
  LivreurAdminView,
} from '@baobaoheath/shared-types';
import { prisma } from '../config/prisma';
import type { JwtPayload } from '../types/auth.types';
import { ConflictError, NotFoundError } from '../utils/app-error';
import { creerAvecDossier, exigerRoleRecrutement, type FichierRecu } from './candidature-livreur.service';

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

/**
 * Creer un livreur, **avec ses six pieces**.
 *
 * Cette porte creait un compte sur un nom et un telephone : on ne pouvait pas
 * dire, ensuite, sur quelles pieces le livreur avait ete admis - lui qui
 * entre chez les patients avec leurs medicaments. Elle depose desormais le
 * meme dossier que le motard qui candidate, enregistre d'emblee comme valide.
 */
export async function creerLivreur(
  auteur: JwtPayload,
  dto: CreerLivreurDto,
  fichiers: readonly FichierRecu[],
): Promise<CreationLivreurView> {
  // Le role est verifie ici aussi, et pas seulement plus bas : cette porte
  // ne doit pas dependre de ce que fait la suivante pour rester fermee.
  exigerRoleRecrutement(auteur);
  const cree = await creerAvecDossier(auteur, dto, fichiers);
  const livreur = await prisma.utilisateur.findUnique({
    where: { id: cree.idUtilisateur },
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
  return {
    livreur: versLivreurAdminView(livreur),
    numeroDossier: cree.numero,
    motDePasseTemporaire: cree.motDePasseTemporaire,
  };
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
