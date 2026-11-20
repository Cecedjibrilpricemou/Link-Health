// Les couleurs de l'interface, par structure.
//
// Une structure, une palette, choisie par son responsable seul, dans une
// liste fermee. Ces tests disent qui choisit, ce qui est refuse, et ce que
// l'interface recoit a la connexion.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  apparence,
  changerLogo,
  changerPalette,
  espaceDeLUtilisateur,
  retirerLogo,
  estResponsable,
  paletteConnue,
  paletteDeLUtilisateur,
  structureDuMembre,
} from '../src/services/apparence.service';
import { JwtPayload } from '../src/types/auth.types';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/middlewares/upload.middleware', () => {
  const os = jest.requireActual('os') as typeof import('os');
  const fsr = jest.requireActual('fs') as typeof import('fs');
  const p = jest.requireActual('path') as typeof import('path');
  return {
    LOGOS_STRUCTURES_DIR: fsr.mkdtempSync(p.join(os.tmpdir(), 'logos-structures-')),
    LOGOS_STRUCTURES_PUBLIC_PATH: '/uploads/structures',
  };
});
jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn() },
    structureSante: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { utilisateur: { findUnique: M }; structureSante: { findUnique: M; update: M } };
};

const user = (role: string) => ({ userId: 'u-1', role, sessionId: 's' }) as JwtPayload;

function membre(o: Partial<{
  role: string; idStructure: string | null; medecin: string | null; asc: string | null;
  officine: { idStructure: string; roleOfficine: string; roleOfficineTemporaire?: string | null; roleOfficineExpireLe?: Date | null } | null;
}> = {}) {
  return {
    role: o.role ?? 'ADMIN_STRUCTURE',
    idStructure: o.idStructure === undefined ? 'st-1' : o.idStructure,
    ascProfile: o.asc ? { idStructure: o.asc } : null,
    medecinProfile: o.medecin ? { idStructure: o.medecin } : null,
    pharmacienProfile: o.officine
      ? { roleOfficineTemporaire: null, roleOfficineExpireLe: null, ...o.officine }
      : null,
  } as Parameters<typeof estResponsable>[0];
}

const STRUCTURE = { id: 'st-1', nom: 'Clinique du Fleuve', type: 'CLINIQUE', palette: null };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.structureSante.findUnique.mockResolvedValue(STRUCTURE);
});

describe('paletteConnue — une liste fermee', () => {
  it('garde un nom connu, ramene le reste a la palette par defaut', () => {
    expect(paletteConnue('OCEAN')).toBe('OCEAN');
    expect(paletteConnue('ROUGE_VIF')).toBe('EMERAUDE');
    expect(paletteConnue(null)).toBe('EMERAUDE');
    expect(paletteConnue(undefined)).toBe('EMERAUDE');
  });
});

describe('structureDuMembre — par le compte ou par le profil metier', () => {
  it('le compte d abord, puis medecin, officine, agent de sante', () => {
    expect(structureDuMembre(membre({ idStructure: 'a', medecin: 'b' }))).toBe('a');
    expect(structureDuMembre(membre({ idStructure: null, medecin: 'b' }))).toBe('b');
    expect(structureDuMembre(membre({ idStructure: null, officine: { idStructure: 'c', roleOfficine: 'CAISSIER' } }))).toBe('c');
    expect(structureDuMembre(membre({ idStructure: null, asc: 'd' }))).toBe('d');
    expect(structureDuMembre(membre({ idStructure: null }))).toBeNull();
  });
});

describe('estResponsable — lui seul choisit', () => {
  it('administrateur de structure et assureur', () => {
    expect(estResponsable(membre({ role: 'ADMIN_STRUCTURE' }))).toBe(true);
    expect(estResponsable(membre({ role: 'ASSUREUR' }))).toBe(true);
  });

  it('ni le medecin, ni l accueil, ni l agent de sante', () => {
    for (const role of ['MEDECIN', 'AGENT_ACCUEIL', 'ASC', 'PATIENT', 'SUPER_ADMIN']) {
      expect(estResponsable(membre({ role }))).toBe(false);
    }
  });

  it('a l officine : le titulaire, pas son caissier ni son adjoint', () => {
    const officine = (roleOfficine: string) => membre({ role: 'PHARMACIEN', officine: { idStructure: 'st-1', roleOfficine } });
    expect(estResponsable(officine('TITULAIRE'))).toBe(true);
    expect(estResponsable(officine('ADJOINT'))).toBe(false);
    expect(estResponsable(officine('CAISSIER'))).toBe(false);
  });

  it('l adjoint qui remplace le titulaire le remplace aussi ici, le temps du remplacement', () => {
    const maintenant = new Date('2026-11-21T10:00:00Z');
    const remplacant = (fin: Date) => membre({
      role: 'PHARMACIEN',
      officine: { idStructure: 'st-1', roleOfficine: 'ADJOINT', roleOfficineTemporaire: 'TITULAIRE', roleOfficineExpireLe: fin },
    });
    expect(estResponsable(remplacant(new Date('2026-11-22T00:00:00Z')), maintenant)).toBe(true);
    expect(estResponsable(remplacant(new Date('2026-11-20T00:00:00Z')), maintenant)).toBe(false);
  });

  it('un pharmacien sans profil d officine n est pas responsable', () => {
    expect(estResponsable(membre({ role: 'PHARMACIEN', officine: null }))).toBe(false);
  });
});

describe('paletteDeLUtilisateur — ce que recoit /auth/me', () => {
  it('la palette de sa structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'MEDECIN', idStructure: null, medecin: 'st-1' }));
    prisma.structureSante.findUnique.mockResolvedValue({ palette: 'OCEAN' });
    await expect(paletteDeLUtilisateur('u-1')).resolves.toBe('OCEAN');
    expect(prisma.structureSante.findUnique.mock.calls[0][0].where).toEqual({ id: 'st-1' });
  });

  it('rien hors structure : le patient garde la palette par defaut', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'PATIENT', idStructure: null }));
    await expect(paletteDeLUtilisateur('u-1')).resolves.toBeNull();
    expect(prisma.structureSante.findUnique).not.toHaveBeenCalled();
  });

  it('rien pour la palette par defaut, ni pour un nom inconnu en base', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre());
    prisma.structureSante.findUnique.mockResolvedValue({ palette: null });
    await expect(paletteDeLUtilisateur('u-1')).resolves.toBeNull();
    prisma.structureSante.findUnique.mockResolvedValue({ palette: 'FLUO' });
    await expect(paletteDeLUtilisateur('u-1')).resolves.toBeNull();
  });
});

describe('apparence — ce que voit l ecran', () => {
  it('la palette, la structure, et le droit de changer', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'MEDECIN', idStructure: null, medecin: 'st-1' }));
    prisma.structureSante.findUnique.mockResolvedValue({ ...STRUCTURE, palette: 'SARCELLE' });
    await expect(apparence(user('MEDECIN'))).resolves.toEqual({
      palette: 'SARCELLE', logoUrl: '', nomStructure: 'Clinique du Fleuve', typeStructure: 'CLINIQUE', peutModifier: false,
    });
  });

  it('404 hors structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'PATIENT', idStructure: null }));
    await expect(apparence(user('PATIENT'))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('changerPalette', () => {
  it('le responsable change la palette de sa structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre());
    const vue = await changerPalette(user('ADMIN_STRUCTURE'), 'INDIGO');
    expect(prisma.structureSante.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { palette: 'INDIGO' } });
    expect(vue).toMatchObject({ palette: 'INDIGO', peutModifier: true });
  });

  it('revenir a la palette par defaut efface le choix', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre());
    await changerPalette(user('ADMIN_STRUCTURE'), 'EMERAUDE');
    expect(prisma.structureSante.update.mock.calls[0][0].data).toEqual({ palette: null });
  });

  it('refuse une palette inconnue, avant toute lecture', async () => {
    await expect(changerPalette(user('ADMIN_STRUCTURE'), '#FF00FF')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.utilisateur.findUnique).not.toHaveBeenCalled();
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });

  it('refuse qui n est pas responsable', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'PHARMACIEN', officine: { idStructure: 'st-1', roleOfficine: 'CAISSIER' } }));
    await expect(changerPalette(user('PHARMACIEN'), 'OCEAN')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });
});

// ── La structure en tete de l'interface ──────────────────────────────

describe('espaceDeLUtilisateur — le nom en tete de l interface', () => {
  const STRUCT = { id: 'st-1', nom: 'CHU Donka', type: 'CHU', palette: 'OCEAN', photoUrl: '/uploads/structures/l.png' };

  it('le personnel : sa structure et ses couleurs', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'MEDECIN', idStructure: null, medecin: 'st-1' }));
    prisma.structureSante.findUnique.mockResolvedValue(STRUCT);
    await expect(espaceDeLUtilisateur('u-1')).resolves.toEqual({
      palette: 'OCEAN',
      structure: { id: 'st-1', nom: 'CHU Donka', type: 'CHU', logoUrl: '/uploads/structures/l.png' },
    });
  });

  // Le patient voit sa structure, pour qu'elle lui soit rappelee ; les
  // couleurs restent celles d'origine, une palette est celle d'une equipe.
  it('le patient : sa structure par defaut, sans la palette de l equipe', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...membre({ role: 'PATIENT', idStructure: null }), patientProfile: { idStructurePreferee: 'st-1' } });
    prisma.structureSante.findUnique.mockResolvedValue(STRUCT);
    const e = await espaceDeLUtilisateur('u-1');
    expect(e.structure?.nom).toBe('CHU Donka');
    expect(e.palette).toBeNull();
    expect(prisma.structureSante.findUnique.mock.calls[0][0].where).toEqual({ id: 'st-1' });
  });

  it('le patient sans structure, le livreur : rien', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...membre({ role: 'PATIENT', idStructure: null }), patientProfile: { idStructurePreferee: null } });
    await expect(espaceDeLUtilisateur('u-1')).resolves.toEqual({ palette: null, structure: null });
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'LIVREUR', idStructure: null }));
    await expect(espaceDeLUtilisateur('u-1')).resolves.toEqual({ palette: null, structure: null });
  });

  it('l administration de la plateforme garde la plateforme, meme rattachee a une structure', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_REGIONAL']) {
      prisma.utilisateur.findUnique.mockResolvedValue(membre({ role, idStructure: 'st-1' }));
      await expect(espaceDeLUtilisateur('u-1')).resolves.toEqual({ palette: null, structure: null });
    }
    expect(prisma.structureSante.findUnique).not.toHaveBeenCalled();
  });
});

describe('le logo de la structure', () => {
  const { LOGOS_STRUCTURES_DIR } = jest.requireMock('../src/middlewares/upload.middleware') as { LOGOS_STRUCTURES_DIR: string };
  sharp.cache(false);
  const image = (l: number, h: number) =>
    sharp({ create: { width: l, height: h, channels: 3, background: { r: 30, g: 80, b: 140 } } }).png().toBuffer();

  beforeEach(() => {
    for (const f of fs.readdirSync(LOGOS_STRUCTURES_DIR)) fs.rmSync(path.join(LOGOS_STRUCTURES_DIR, f));
    prisma.structureSante.findUnique.mockResolvedValue({ ...STRUCTURE, photoUrl: null });
  });
  afterAll(() => fs.rmSync(LOGOS_STRUCTURES_DIR, { recursive: true, force: true }));

  it('le responsable le televerse : reduit, en PNG, enregistre', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre());
    const vue = await changerLogo(user('ADMIN_STRUCTURE'), await image(1200, 800));

    expect(vue.logoUrl).toMatch(/^\/uploads\/structures\/structure-st-1-.*\.png$/);
    expect(prisma.structureSante.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { photoUrl: vue.logoUrl } });
    const m = await sharp(fs.readFileSync(path.join(LOGOS_STRUCTURES_DIR, path.basename(vue.logoUrl)))).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', 512, 341]);
  });

  it('refuse un logo trop petit, ou qui n est pas une image', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre());
    await expect(changerLogo(user('ADMIN_STRUCTURE'), await image(60, 60))).rejects.toBeInstanceOf(ValidationError);
    await expect(changerLogo(user('ADMIN_STRUCTURE'), Buffer.from('<svg onload=x>'))).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });

  it('refuse qui n est pas responsable', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre({ role: 'MEDECIN', idStructure: null, medecin: 'st-1' }));
    await expect(changerLogo(user('MEDECIN'), await image(400, 400))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(retirerLogo(user('MEDECIN'))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('retirer le logo ramene le monogramme', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(membre());
    const vue = await retirerLogo(user('ADMIN_STRUCTURE'));
    expect(vue.logoUrl).toBe('');
    expect(prisma.structureSante.update).toHaveBeenCalledWith({ where: { id: 'st-1' }, data: { photoUrl: null } });
  });
});

