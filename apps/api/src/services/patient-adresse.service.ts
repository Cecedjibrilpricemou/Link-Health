// L'adresse du patient, saisie par lui-meme (M3).
//
// **La commune et le quartier decident a qui part son ordonnance** (voir
// utils/zone.ts). Jusqu'ici, un patient ne pouvait pas les renseigner : seuls
// la semence et l'ASC les remplissaient, et un patient inscrit seul voyait ses
// ordonnances conclues « sans pharmacie » faute de zone.
//
// **Le point de repere** remplace l'adresse postale, la ou les rues n'ont
// souvent pas de nom : « derriere la mosquee de Kipe ».
//
// **La position GPS n'est enregistree qu'avec l'accord du patient** : il la
// donne d'un geste (« Utiliser ma position »), la voit, et peut l'effacer.
// Elle n'est montree qu'au motard qui a sa course en main.
import type { AdressePatientView, DefinirAdresseDto } from '@baobaoheath/shared-types';
import { prisma } from '../config/prisma';
import { NotFoundError } from '../utils/app-error';
import { lirePosition, positionEnTexte, verifierCoordonnees } from '../utils/coordonnees';

// R4 : point de repere et position sont chiffres en base (voir
// config/prisma-encryption.extension.ts) ; ils arrivent ici dechiffres.
const ADRESSE_SELECT = {
  id: true, prefecture: true, commune: true, quartier: true, pointRepere: true,
  position: true, positionLe: true,
} as const;

type Adresse = {
  prefecture: string; commune: string | null; quartier: string | null; pointRepere: string | null;
  position: string | null; positionLe: Date | null;
};

function versVue(a: Adresse): AdressePatientView {
  const gps = lirePosition(a.position);
  return {
    prefecture: a.prefecture,
    commune: a.commune,
    quartier: a.quartier,
    pointRepere: a.pointRepere,
    latitude: gps?.latitude ?? null,
    longitude: gps?.longitude ?? null,
    positionLe: gps ? a.positionLe?.toISOString() ?? null : null,
  };
}

/**
 * Le dossier qui porte l'adresse. **Suit le lien de fusion** (EF-01-06) :
 * les consultations, donc les ordonnances, vivent sur le dossier principal,
 * et c'est son adresse que lit l'appel aux pharmacies.
 */
async function idDossier(userId: string): Promise<string> {
  const sien = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: userId },
    select: { id: true, idFusionneDans: true },
  });
  if (!sien) throw new NotFoundError('Profil patient non trouve');
  return sien.idFusionneDans ?? sien.id;
}

export async function monAdresse(userId: string): Promise<AdressePatientView> {
  const adresse = await prisma.patientProfile.findUnique({
    where: { id: await idDossier(userId) },
    select: ADRESSE_SELECT,
  });
  if (!adresse) throw new NotFoundError('Profil patient non trouve');
  return versVue(adresse);
}

export async function definirAdresse(userId: string, dto: DefinirAdresseDto): Promise<AdressePatientView> {
  verifierCoordonnees(dto.latitude, dto.longitude);
  const id = await idDossier(userId);

  // Une position envoyee remplace l'ancienne ; « effacer » la retire. Sans
  // l'une ni l'autre, la position deja donnee est gardee telle quelle : changer
  // de point de repere ne doit pas effacer le GPS en silence.
  const position = dto.effacerPosition
    ? { position: null, positionLe: null }
    : dto.latitude !== undefined && dto.longitude !== undefined
      ? { position: positionEnTexte(dto.latitude, dto.longitude), positionLe: new Date() }
      : {};

  const adresse = await prisma.patientProfile.update({
    where: { id },
    data: {
      commune: dto.commune,
      quartier: dto.quartier,
      pointRepere: dto.pointRepere?.trim() || null,
      ...position,
    },
    select: ADRESSE_SELECT,
  });
  return versVue(adresse);
}
