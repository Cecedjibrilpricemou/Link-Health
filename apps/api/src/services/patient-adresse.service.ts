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
import { NotFoundError, ValidationError } from '../utils/app-error';
import { lirePosition, positionEnTexte, verifierCoordonnees } from '../utils/coordonnees';
import { zoneElargissementConnue } from './geographie.service';

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

const cle = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('fr');

/**
 * R8 : un demenagement dans une autre prefecture. Le patient la change
 * lui-meme : c'est une adresse, pas une identite. Rend la prefecture a
 * enregistrer (nom du referentiel), ou `null` si elle ne change pas.
 */
async function nouvellePrefecture(id: string, demandee: string | undefined): Promise<{ avant: string; apres: string } | null> {
  if (demandee === undefined) return null;
  const actuelle = await prisma.patientProfile.findUnique({ where: { id }, select: { prefecture: true } });
  if (!actuelle) throw new NotFoundError('Profil patient non trouve');
  const connue = await zoneElargissementConnue(demandee);
  if (!connue) {
    throw new ValidationError(`« ${demandee.trim()} » ne figure pas au referentiel : choisissez-la dans la liste proposee`);
  }
  return cle(connue) === cle(actuelle.prefecture) ? null : { avant: actuelle.prefecture, apres: connue };
}

export async function definirAdresse(
  userId: string,
  dto: DefinirAdresseDto,
  maintenant = new Date(),
): Promise<AdressePatientView> {
  verifierCoordonnees(dto.latitude, dto.longitude);
  const id = await idDossier(userId);
  const demenagement = await nouvellePrefecture(id, dto.prefecture);

  // Une position envoyee remplace l'ancienne ; « effacer » la retire. Sans
  // l'une ni l'autre, la position deja donnee est gardee telle quelle : changer
  // de point de repere ne doit pas effacer le GPS en silence.
  // R8 : sauf en changeant de prefecture - c'etait celle de l'ancien domicile,
  // et un motard irait la chercher.
  const nouvellePosition = dto.latitude !== undefined && dto.longitude !== undefined;
  const position = nouvellePosition
    ? { position: positionEnTexte(dto.latitude!, dto.longitude!), positionLe: maintenant }
    : dto.effacerPosition || demenagement
      ? { position: null, positionLe: null }
      : {};

  const data = {
    ...(demenagement ? { prefecture: demenagement.apres } : {}),
    commune: dto.commune,
    quartier: dto.quartier,
    pointRepere: dto.pointRepere?.trim() || null,
    ...position,
  };

  if (!demenagement) {
    const adresse = await prisma.patientProfile.update({ where: { id }, data, select: ADRESSE_SELECT });
    return versVue(adresse);
  }

  // Les commandes deja lancees gardent leur zone ; les suivantes partent vers
  // la nouvelle. Le changement est journalise : il deplace aussi le patient
  // dans les comptes epidemiologiques de sa prefecture.
  const adresse = await prisma.$transaction(async (tx) => {
    const a = await tx.patientProfile.update({ where: { id }, data, select: ADRESSE_SELECT });
    await tx.journalAudit.create({
      data: {
        action: 'CHANGEMENT_PREFECTURE',
        ressource: 'patients',
        idRessource: id,
        idUtilisateur: userId,
        creeLe: maintenant,
        metadonnees: { avant: demenagement.avant, apres: demenagement.apres },
      },
    });
    return a;
  });
  return versVue(adresse);
}
