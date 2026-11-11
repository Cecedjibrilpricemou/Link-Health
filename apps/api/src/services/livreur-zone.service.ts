// Disponibilite et zone de travail du motard, reglees par lui-meme (M4).
//
// **Seul un motard en service est prevenu des courses.** Un motard qui ne
// travaille pas aujourd'hui ne doit pas recevoir d'appels qu'il laissera
// sans reponse : le patient attendrait pour rien.
//
// **Ses communes desservies** s'ajoutent a la sienne, dans sa prefecture :
// un motard de Ratoma qui livre aussi a Dixinn. Cinq au plus, pour que la
// zone reste celle d'un motard et pas celle d'une ville entiere.
import type { LivreurZoneView } from '@baobaoheath/shared-types';
import { Role } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import type { JwtPayload } from '../types/auth.types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';

export const MAX_COMMUNES_DESSERVIES = 5;

const PROFIL_ZONE_SELECT = {
  id: true, prefecture: true, commune: true, quartier: true,
  communesDesservies: true, enService: true, enServiceDepuis: true, estActif: true,
} as const;

type ProfilZone = {
  id: string; prefecture: string; commune: string | null; quartier: string;
  communesDesservies: string[]; enService: boolean; enServiceDepuis: Date | null; estActif: boolean;
};

function versVue(p: ProfilZone): LivreurZoneView {
  return {
    prefecture: p.prefecture,
    commune: p.commune,
    quartier: p.quartier,
    communesDesservies: p.communesDesservies,
    enService: p.enService,
    enServiceDepuis: p.enServiceDepuis ? p.enServiceDepuis.toISOString() : null,
    estActif: p.estActif,
  };
}

async function monProfil(user: JwtPayload): Promise<ProfilZone> {
  if (user.role !== Role.LIVREUR) throw new ForbiddenError('Ce geste ne correspond pas a votre role');
  const profil = await prisma.livreurProfile.findUnique({
    where: { idUtilisateur: user.userId },
    select: PROFIL_ZONE_SELECT,
  });
  if (!profil) throw new NotFoundError('Profil livreur non trouve');
  return profil;
}

/** Ce que le motard voit de sa disponibilite et de sa zone. */
export async function monProfilLivreur(user: JwtPayload): Promise<LivreurZoneView> {
  return versVue(await monProfil(user));
}

/**
 * Entrer en service ou en sortir. Un compte suspendu par l'administration ne
 * peut pas entrer en service, mais peut toujours en sortir.
 */
export async function definirEnService(user: JwtPayload, enService: boolean): Promise<LivreurZoneView> {
  const profil = await monProfil(user);
  if (enService && !profil.estActif) {
    throw new ForbiddenError('Votre compte livreur est suspendu par l administration');
  }
  const misAJour = await prisma.livreurProfile.update({
    where: { id: profil.id },
    data: { enService, enServiceDepuis: enService ? new Date() : null },
    select: PROFIL_ZONE_SELECT,
  });
  return versVue(misAJour);
}

/**
 * Les communes desservies, nettoyees : sans vide, sans doublon (la casse ne
 * compte pas), sans la commune du motard, qui est deja la sienne.
 */
export async function definirCommunesDesservies(user: JwtPayload, communes: string[]): Promise<LivreurZoneView> {
  const profil = await monProfil(user);
  const propre = (profil.commune ?? '').trim().toLowerCase();
  const vues = new Set<string>();
  const nettoyees: string[] = [];
  for (const brute of communes) {
    const c = brute.trim();
    const cle = c.toLowerCase();
    if (!c || cle === propre || vues.has(cle)) continue;
    vues.add(cle);
    nettoyees.push(c);
  }
  if (nettoyees.length > MAX_COMMUNES_DESSERVIES) {
    throw new ValidationError('5 communes au plus, en plus de la votre');
  }
  const misAJour = await prisma.livreurProfile.update({
    where: { id: profil.id },
    data: { communesDesservies: nettoyees },
    select: PROFIL_ZONE_SELECT,
  });
  return versVue(misAJour);
}
