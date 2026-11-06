// Un fichier televerse s'enregistre par son chemin (/uploads/...), jamais
// avec l'hote qui l'a recu.
//
// L'adresse complete figeait l'hote du moment : un logo televerse depuis
// http://localhost:3000 restait introuvable sur l'application mobile (pour qui
// « localhost » est le telephone) et, en production derriere HTTPS, une image
// en http:// est bloquee par le navigateur.
jest.mock('sharp', () => {
  const chaine = {
    rotate: () => chaine, resize: () => chaine, webp: () => chaine, png: () => chaine,
    toFile: jest.fn().mockResolvedValue(undefined),
  };
  return { __esModule: true, default: () => chaine };
});
jest.mock('../src/services/parametres.service', () => ({
  modifierLogo: jest.fn(async (_id: string, logoUrl: string) => ({ logoUrl })),
}));

import { uploadAvatarController, uploadLogoController } from '../src/controllers/upload.controller';
import { updatePatientSchema, updateProfileSchema, updateParametresSystemeSchema } from '../src/validators/api.schemas';
import { versChemin } from '../src/utils/chemin-media';
import type { AuthRequest } from '../src/middlewares/auth.middleware';
import type { Response } from 'express';

function requete(mimetype = 'image/png'): AuthRequest {
  return {
    file: { buffer: Buffer.from('image'), mimetype },
    user: { userId: 'u1' },
    protocol: 'http',
    get: () => 'localhost:3000',
  } as unknown as AuthRequest;
}
function reponse() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('televersements : un chemin, pas une adresse', () => {
  it('avatar : renvoie /uploads/avatars/<fichier>, sans hote', async () => {
    const res = reponse();
    await uploadAvatarController(requete(), res as unknown as Response);
    expect(res.json.mock.calls[0][0].data.url).toMatch(/^\/uploads\/avatars\/u1-\d+-[0-9a-f]{8}\.webp$/);
  });

  it('logo : enregistre /uploads/logos/<fichier>, sans hote', async () => {
    const res = reponse();
    await uploadLogoController(requete(), res as unknown as Response);
    expect(res.json.mock.calls[0][0].data.logoUrl).toMatch(/^\/uploads\/logos\/logo-\d+-[0-9a-f]{8}\.png$/);
  });
});

describe('televersements : ce que les formulaires acceptent', () => {
  const identite = (logoUrl: string) => updateParametresSystemeSchema.safeParse({
    identite: { nom: 'Lead Health', logoUrl },
  });

  it('le logo : vide, un chemin televerse ou une adresse http(s)', () => {
    expect(identite('').success).toBe(true);
    expect(identite('/uploads/logos/logo-1-abcd1234.png').success).toBe(true);
    expect(identite('https://cdn.example.org/logo.png').success).toBe(true);
  });

  it('le logo : refuse un chemin qui sort du dossier des logos', () => {
    for (const v of ['/uploads/../.env', '/etc/passwd', '/uploads/avatars/u1.webp', 'javascript:alert(1)', '//evil.example/x.png']) {
      expect([v, identite(v).success]).toEqual([v, false]);
    }
  });

  it('la photo de profil : un chemin d’avatar ou une adresse http(s)', () => {
    for (const schema of [updateProfileSchema, updatePatientSchema]) {
      expect(schema.safeParse({ photoUrl: '/uploads/avatars/u1-1-abcd1234.webp' }).success).toBe(true);
      expect(schema.safeParse({ photoUrl: 'https://cdn.example.org/a.webp' }).success).toBe(true);
      expect(schema.safeParse({ photoUrl: '/uploads/logos/logo.png' }).success).toBe(false);
      expect(schema.safeParse({ photoUrl: '/uploads/avatars/../../.env' }).success).toBe(false);
    }
  });
});

describe('versChemin : les adresses deja enregistrees', () => {
  it('garde le chemin d’un fichier televerse, quel que soit l’hote', () => {
    expect(versChemin('http://localhost:3000/uploads/logos/logo-1-ab.png')).toBe('/uploads/logos/logo-1-ab.png');
    expect(versChemin('https://lead.example.org/uploads/avatars/u1.webp')).toBe('/uploads/avatars/u1.webp');
  });
  it('laisse le reste tel quel', () => {
    expect(versChemin('')).toBe('');
    expect(versChemin('/uploads/logos/x.png')).toBe('/uploads/logos/x.png');
    expect(versChemin('https://cdn.example.org/logo.png')).toBe('https://cdn.example.org/logo.png');
  });
});
