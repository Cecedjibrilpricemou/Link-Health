// Les couleurs de l'interface, par structure.
//
// **Une structure, une palette.** Tout son personnel la voit : medecins,
// accueil, laboratoire, comptoir. Le patient et l'administration nationale
// gardent la palette par defaut - ils n'appartiennent a aucune structure.
//
// **Seul le responsable choisit** : l'administrateur de la structure, le
// titulaire de l'officine, l'assureur. Un caissier ou un medecin repeindrait
// sinon l'ecran de tous ses collegues.
//
// **Une liste fermee.** Chaque palette est construite et verifiee pour la
// lisibilite (contraste WCAG AA, en clair et en sombre). Le serveur refuse
// tout nom qu'il ne connait pas : une couleur libre finirait tot ou tard en
// texte gris clair sur fond blanc.
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PALETTES_STRUCTURE, PALETTE_PAR_DEFAUT } from '@baobaoheath/shared-types';
import type { ApparenceStructureView, PaletteStructure, StructureEspaceView } from '@baobaoheath/shared-types';
import { LOGOS_STRUCTURES_DIR, LOGOS_STRUCTURES_PUBLIC_PATH } from '../middlewares/upload.middleware';
import { RoleOfficine } from '../config/generated/client/client';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import type { JwtPayload } from '../types/auth.types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';

/** Un nom de palette connu, sinon la palette par defaut. */
export function paletteConnue(nom: string | null | undefined): PaletteStructure {
  return (PALETTES_STRUCTURE as readonly string[]).includes(nom ?? '') ? (nom as PaletteStructure) : PALETTE_PAR_DEFAUT;
}

const MEMBRE_SELECT = {
  role: true,
  idStructure: true,
  ascProfile: { select: { idStructure: true } },
  medecinProfile: { select: { idStructure: true } },
  pharmacienProfile: {
    select: { idStructure: true, roleOfficine: true, roleOfficineTemporaire: true, roleOfficineExpireLe: true },
  },
  patientProfile: { select: { idStructurePreferee: true } },
} as const;

type Membre = {
  role: string;
  idStructure: string | null;
  ascProfile: { idStructure: string | null } | null;
  medecinProfile: { idStructure: string | null } | null;
  pharmacienProfile: {
    idStructure: string | null;
    roleOfficine: RoleOfficine;
    roleOfficineTemporaire: RoleOfficine | null;
    roleOfficineExpireLe: Date | null;
  } | null;
  patientProfile?: { idStructurePreferee: string | null } | null;
};

/** La structure d'un utilisateur, par son compte ou par son profil metier. */
export function structureDuMembre(m: Membre): string | null {
  return m.idStructure
    ?? m.medecinProfile?.idStructure
    ?? m.pharmacienProfile?.idStructure
    ?? m.ascProfile?.idStructure
    ?? null;
}

/**
 * Le responsable de la structure : lui seul choisit ses couleurs. Pour une
 * officine, c'est le role effectif qui compte - un adjoint qui remplace le
 * titulaire pendant son absence le remplace aussi ici.
 */
export function estResponsable(m: Membre, maintenant = new Date()): boolean {
  if (m.role === 'ADMIN_STRUCTURE' || m.role === 'ASSUREUR') return true;
  if (m.role !== 'PHARMACIEN' || !m.pharmacienProfile) return false;
  const p = m.pharmacienProfile;
  const effectif = p.roleOfficineTemporaire && p.roleOfficineExpireLe && p.roleOfficineExpireLe > maintenant
    ? p.roleOfficineTemporaire
    : p.roleOfficine;
  return effectif === RoleOfficine.TITULAIRE;
}

async function membre(userId: string): Promise<Membre> {
  const m = await prisma.utilisateur.findUnique({ where: { id: userId }, select: MEMBRE_SELECT });
  if (!m) throw new NotFoundError('Utilisateur non trouve');
  return m;
}

/** L'administration de la plateforme : elle n'appartient a aucune structure. */
const ROLES_PLATEFORME = new Set(['SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_REGIONAL']);

/**
 * Ce que l'interface d'un utilisateur affiche en tete, pour `/auth/me` : sa
 * structure (nom et logo, a la place de la plateforme) et ses couleurs.
 *
 * - le personnel : sa structure, et la palette choisie par son responsable ;
 * - le patient : sa structure par defaut, celle ou partent ses demandes de
 *   rendez-vous - pour la lui rappeler. Il garde les couleurs d'origine :
 *   la palette est celle d'une equipe ;
 * - l'administration de la plateforme, le livreur : aucune structure.
 */
export async function espaceDeLUtilisateur(userId: string): Promise<{
  palette: PaletteStructure | null;
  structure: StructureEspaceView | null;
}> {
  const m = await prisma.utilisateur.findUnique({ where: { id: userId }, select: MEMBRE_SELECT });
  if (!m || ROLES_PLATEFORME.has(m.role)) return { palette: null, structure: null };
  const estPatient = m.role === 'PATIENT';
  const idStructure = estPatient ? m.patientProfile?.idStructurePreferee ?? null : structureDuMembre(m);
  if (!idStructure) return { palette: null, structure: null };
  const s = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: { id: true, nom: true, type: true, palette: true, photoUrl: true },
  });
  if (!s) return { palette: null, structure: null };
  const palette = paletteConnue(s.palette);
  return {
    palette: estPatient || palette === PALETTE_PAR_DEFAUT ? null : palette,
    structure: { id: s.id, nom: s.nom, type: s.type, logoUrl: s.photoUrl ?? '' },
  };
}

/** La palette seule (compatibilite). */
export async function paletteDeLUtilisateur(userId: string): Promise<PaletteStructure | null> {
  return (await espaceDeLUtilisateur(userId)).palette;
}

async function structureDe(user: JwtPayload) {
  const m = await membre(user.userId);
  const idStructure = structureDuMembre(m);
  if (!idStructure) throw new NotFoundError("Ce compte n'est rattache a aucune structure.");
  const s = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: { id: true, nom: true, type: true, palette: true, photoUrl: true },
  });
  if (!s) throw new NotFoundError('Structure introuvable');
  return { m, s };
}

function vue(s: { nom: string; type: ApparenceStructureView['typeStructure']; palette: string | null; photoUrl: string | null }, peutModifier: boolean): ApparenceStructureView {
  return { palette: paletteConnue(s.palette), logoUrl: s.photoUrl ?? '', nomStructure: s.nom, typeStructure: s.type, peutModifier };
}

/** L'apparence de sa structure : la palette, et s'il peut la changer. */
export async function apparence(user: JwtPayload): Promise<ApparenceStructureView> {
  const { m, s } = await structureDe(user);
  return vue(s, estResponsable(m));
}

/** Changer la palette : le responsable seul, et une palette connue. */
export async function changerPalette(user: JwtPayload, palette: string): Promise<ApparenceStructureView> {
  if (!(PALETTES_STRUCTURE as readonly string[]).includes(palette)) {
    throw new ValidationError('Palette inconnue.');
  }
  const { m, s } = await structureDe(user);
  if (!estResponsable(m)) {
    throw new ForbiddenError('Seul le responsable de la structure choisit ses couleurs.');
  }
  // La palette par defaut s'enregistre comme une absence de choix.
  await prisma.structureSante.update({
    where: { id: s.id },
    data: { palette: palette === PALETTE_PAR_DEFAUT ? null : palette },
  });
  logger.info('[APPARENCE] palette changee', { idStructure: s.id, palette, parQui: user.userId });
  return vue({ ...s, palette }, true);
}

// ── Le logo de la structure ──────────────────────────────────────────
//
// Il remplace celui de la plateforme dans l'interface de toute l'equipe, et
// en tete des documents qu'elle imprime. Reduit a 512 px, en PNG : une
// image matricielle ne porte pas de code, et /uploads est public.

const TAILLE_LOGO_PX = 512;
/** En dessous, le logo serait flou dans la barre laterale et sur les documents. */
export const LOGO_MINIMUM_PX = 96;
/** L'ancien logo reste servi le temps que les pages ouvertes l'oublient. */
const DELAI_CONSERVATION_MS = 10 * 60 * 1000;

async function responsableEtStructure(user: JwtPayload) {
  const { m, s } = await structureDe(user);
  if (!estResponsable(m)) throw new ForbiddenError('Seul le responsable de la structure choisit son logo.');
  return s;
}

/** Les anciens logos de cette structure, passe le delai de conservation. */
async function nettoyerAnciensLogos(idStructure: string, garder: string | null): Promise<void> {
  const prefixe = `structure-${idStructure}-`;
  const garde = garder ? path.basename(garder) : null;
  let noms: string[];
  try {
    noms = await fs.readdir(LOGOS_STRUCTURES_DIR);
  } catch {
    return;
  }
  for (const nom of noms) {
    if (!nom.startsWith(prefixe) || nom === garde) continue;
    const chemin = path.join(LOGOS_STRUCTURES_DIR, nom);
    try {
      const { mtimeMs } = await fs.stat(chemin);
      if (Date.now() - mtimeMs >= DELAI_CONSERVATION_MS) await fs.rm(chemin, { force: true });
    } catch {
      // Deja supprime : rien a faire.
    }
  }
}

/** Televerser le logo de sa structure : le responsable seul. */
export async function changerLogo(user: JwtPayload, contenu: Buffer): Promise<ApparenceStructureView> {
  const s = await responsableEtStructure(user);
  let largeur = 0;
  let hauteur = 0;
  try {
    const meta = await sharp(contenu).metadata();
    largeur = meta.width ?? 0;
    hauteur = meta.height ?? 0;
  } catch {
    throw new ValidationError('Image illisible ou corrompue.');
  }
  if (Math.min(largeur, hauteur) < LOGO_MINIMUM_PX) {
    throw new ValidationError(`Logo trop petit : il faut au moins ${LOGO_MINIMUM_PX} px de côté pour qu'il reste net.`);
  }
  const nom = `structure-${s.id}-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  try {
    await sharp(contenu)
      .rotate()
      .resize({ width: TAILLE_LOGO_PX, height: TAILLE_LOGO_PX, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(path.join(LOGOS_STRUCTURES_DIR, nom));
  } catch {
    throw new ValidationError('Image illisible ou corrompue.');
  }
  const photoUrl = `${LOGOS_STRUCTURES_PUBLIC_PATH}/${nom}`;
  await prisma.structureSante.update({ where: { id: s.id }, data: { photoUrl } });
  await nettoyerAnciensLogos(s.id, photoUrl);
  logger.info('[APPARENCE] logo change', { idStructure: s.id, parQui: user.userId });
  return vue({ ...s, photoUrl }, true);
}

/** Retirer le logo : l'interface revient au monogramme. */
export async function retirerLogo(user: JwtPayload): Promise<ApparenceStructureView> {
  const s = await responsableEtStructure(user);
  await prisma.structureSante.update({ where: { id: s.id }, data: { photoUrl: null } });
  await nettoyerAnciensLogos(s.id, null);
  logger.info('[APPARENCE] logo retire', { idStructure: s.id, parQui: user.userId });
  return vue({ ...s, photoUrl: null }, true);
}
