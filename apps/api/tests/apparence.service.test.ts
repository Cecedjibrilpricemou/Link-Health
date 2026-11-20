// Les couleurs de l'interface, par structure.
//
// Une structure, une palette, choisie par son responsable seul, dans une
// liste fermee. Ces tests disent qui choisit, ce qui est refuse, et ce que
// l'interface recoit a la connexion.
import {
  apparence,
  changerPalette,
  estResponsable,
  paletteConnue,
  paletteDeLUtilisateur,
  structureDuMembre,
} from '../src/services/apparence.service';
import { JwtPayload } from '../src/types/auth.types';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

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
      palette: 'SARCELLE', nomStructure: 'Clinique du Fleuve', typeStructure: 'CLINIQUE', peutModifier: false,
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
