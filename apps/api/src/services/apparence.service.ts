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
import { PALETTES_STRUCTURE, PALETTE_PAR_DEFAUT } from '@baobaoheath/shared-types';
import type { ApparenceStructureView, PaletteStructure } from '@baobaoheath/shared-types';
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

/**
 * La palette de la structure d'un utilisateur, pour `/auth/me`. `null` hors
 * structure, ou quand la structure garde la palette par defaut : l'interface
 * n'a alors rien a changer.
 */
export async function paletteDeLUtilisateur(userId: string): Promise<PaletteStructure | null> {
  const m = await prisma.utilisateur.findUnique({ where: { id: userId }, select: MEMBRE_SELECT });
  const idStructure = m ? structureDuMembre(m) : null;
  if (!idStructure) return null;
  const s = await prisma.structureSante.findUnique({ where: { id: idStructure }, select: { palette: true } });
  const palette = paletteConnue(s?.palette);
  return palette === PALETTE_PAR_DEFAUT ? null : palette;
}

async function structureDe(user: JwtPayload) {
  const m = await membre(user.userId);
  const idStructure = structureDuMembre(m);
  if (!idStructure) throw new NotFoundError("Ce compte n'est rattache a aucune structure.");
  const s = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: { id: true, nom: true, type: true, palette: true },
  });
  if (!s) throw new NotFoundError('Structure introuvable');
  return { m, s };
}

/** L'apparence de sa structure : la palette, et s'il peut la changer. */
export async function apparence(user: JwtPayload): Promise<ApparenceStructureView> {
  const { m, s } = await structureDe(user);
  return { palette: paletteConnue(s.palette), nomStructure: s.nom, typeStructure: s.type, peutModifier: estResponsable(m) };
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
  return { palette: palette as PaletteStructure, nomStructure: s.nom, typeStructure: s.type, peutModifier: true };
}
