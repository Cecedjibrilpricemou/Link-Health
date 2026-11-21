// Les services d'un etablissement : Urgences, Maternite, Pediatrie...
//
// **Declares par l'administrateur, qui y rattache ses medecins.** L'accueil
// oriente un patient vers un service et se voit proposer ses medecins, au lieu
// de taper un nom de service que personne n'ecrit pareil deux fois.
//
// **Un service ne se supprime pas, il se ferme.** Il n'est plus propose a
// l'accueil ; ses medecins gardent leur rattachement pour le jour ou il
// rouvre. Les episodes, eux, gardent le nom du service au moment de
// l'orientation : rien de ce qui a ete fait n'est reecrit.
import type { ServiceHospitalierView } from '@baobaoheath/shared-types';
import { Prisma, Role, TypeStructure } from '../config/generated/client/client';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';

/** Les structures qui ont des services : celles qui recoivent et soignent. */
export const TYPES_AVEC_SERVICES: readonly TypeStructure[] = [
  TypeStructure.CENTRE, TypeStructure.HOPITAL_PREF, TypeStructure.HOPITAL_REG, TypeStructure.CHU, TypeStructure.CLINIQUE,
];

export const NOM_SERVICE_MAX = 80;

/** Un nom de service propre : espaces resserres, majuscule initiale. */
export function nomServiceNet(nom: string): string {
  const n = nom.replace(/\s+/g, ' ').trim();
  if (n.length < 2) throw new ValidationError('Donnez un nom au service (deux lettres au moins).');
  if (n.length > NOM_SERVICE_MAX) throw new ValidationError(`Un nom de service tient en ${NOM_SERVICE_MAX} caractères.`);
  return n.charAt(0).toLocaleUpperCase('fr') + n.slice(1);
}

/** La structure de l'administrateur, si elle a des services. */
async function structureAvecServices(adminId: string): Promise<string> {
  const admin = await prisma.utilisateur.findUnique({
    where: { id: adminId },
    select: { role: true, idStructure: true, structure: { select: { type: true } } },
  });
  if (!admin?.idStructure || admin.role !== Role.ADMIN_STRUCTURE) throw new ForbiddenError('Aucune structure assignée');
  if (!admin.structure || !TYPES_AVEC_SERVICES.includes(admin.structure.type)) {
    throw new ForbiddenError("Ce type de structure n'a pas de services.");
  }
  return admin.idStructure;
}

function vue(s: { id: string; nom: string; actif: boolean; _count: { medecins: number } }): ServiceHospitalierView {
  return { id: s.id, nom: s.nom, actif: s.actif, nbMedecins: s._count.medecins };
}

const SELECT = { id: true, nom: true, actif: true, _count: { select: { medecins: true } } } as const;

/** Les services de sa structure, ouverts d'abord, avec le nombre de medecins. */
export async function listerServices(adminId: string): Promise<ServiceHospitalierView[]> {
  const idStructure = await structureAvecServices(adminId);
  const services = await prisma.serviceHospitalier.findMany({
    where: { idStructure },
    select: SELECT,
    orderBy: [{ actif: 'desc' }, { nom: 'asc' }],
  });
  return services.map(vue);
}

/**
 * Un service du meme nom, a la casse pres : « PÉDIATRIE » et « Pédiatrie »
 * sont le meme service. L'index unique de la base, lui, distingue la casse.
 */
async function exigerNomLibre(idStructure: string, nom: string, sauf?: string): Promise<void> {
  const existe = await prisma.serviceHospitalier.findFirst({
    where: { idStructure, nom: { equals: nom, mode: 'insensitive' }, ...(sauf ? { NOT: { id: sauf } } : {}) },
    select: { id: true },
  });
  if (existe) throw new ConflictError(`Le service « ${nom} » existe déjà.`);
}

function doublon(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export async function creerService(adminId: string, nom: string): Promise<ServiceHospitalierView> {
  const idStructure = await structureAvecServices(adminId);
  const net = nomServiceNet(nom);
  await exigerNomLibre(idStructure, net);
  try {
    const s = await prisma.serviceHospitalier.create({ data: { idStructure, nom: net }, select: SELECT });
    logger.info('[SERVICES] service cree', { idStructure, parQui: adminId });
    return vue(s);
  } catch (e) {
    if (doublon(e)) throw new ConflictError(`Le service « ${net} » existe déjà.`);
    throw e;
  }
}

/** Renommer, fermer ou rouvrir un service de sa structure. */
export async function modifierService(adminId: string, idService: string, dto: { nom?: string; actif?: boolean }): Promise<ServiceHospitalierView> {
  const idStructure = await structureAvecServices(adminId);
  const existant = await prisma.serviceHospitalier.findFirst({ where: { id: idService, idStructure }, select: { id: true } });
  if (!existant) throw new NotFoundError('Service introuvable');
  const data: { nom?: string; actif?: boolean } = {};
  if (dto.nom !== undefined) {
    data.nom = nomServiceNet(dto.nom);
    await exigerNomLibre(idStructure, data.nom, idService);
  }
  if (dto.actif !== undefined) data.actif = dto.actif;
  try {
    const s = await prisma.serviceHospitalier.update({ where: { id: idService }, data, select: SELECT });
    logger.info('[SERVICES] service modifie', { idService, parQui: adminId });
    return vue(s);
  } catch (e) {
    if (doublon(e)) throw new ConflictError(`Le service « ${data.nom} » existe déjà.`);
    throw e;
  }
}

/**
 * Un service ouvert de cette structure, ou un refus : on ne rattache pas un
 * medecin a un service ferme, ni a celui d'un autre etablissement.
 */
export async function exigerServiceOuvert(idStructure: string, idService: string): Promise<void> {
  const s = await prisma.serviceHospitalier.findFirst({ where: { id: idService, idStructure, actif: true }, select: { id: true } });
  if (!s) throw new ValidationError("Ce service n'existe pas dans votre structure, ou il est fermé.");
}

/** Pour l'accueil : les services ouverts, par ordre alphabetique. */
export async function servicesOuverts(idStructure: string): Promise<ServiceHospitalierView[]> {
  const services = await prisma.serviceHospitalier.findMany({
    where: { idStructure, actif: true },
    select: SELECT,
    orderBy: { nom: 'asc' },
  });
  return services.map(vue);
}
