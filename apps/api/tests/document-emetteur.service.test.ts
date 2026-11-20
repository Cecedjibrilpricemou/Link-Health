// L'en-tete des documents imprimes : la structure qui les emet.
import { identiteDocument, structureDeConsultation, structureDeDemandeAnalyse } from '../src/services/document-emetteur.service';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    structureSante: { findUnique: jest.fn() },
    consultation: { findUnique: jest.fn() },
    demandeAnalyse: { findUnique: jest.fn() },
  },
}));
jest.mock('../src/services/parametres.service', () => ({ getIdentitePlateforme: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { structureSante: { findUnique: M }; consultation: { findUnique: M }; demandeAnalyse: { findUnique: M } };
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as { getIdentitePlateforme: M };

const PLATEFORME = {
  nom: 'KÈNÈYA', logoUrl: '/uploads/logos/p.png', telephone: '+224600000000',
  emailContact: 'contact@keneya.gn', copyright: '© 2026 KÈNÈYA', siteWeb: 'https://keneya.gn',
};

beforeEach(() => {
  jest.resetAllMocks();
  getIdentitePlateforme.mockResolvedValue(PLATEFORME);
});

describe('identiteDocument', () => {
  it('la structure : son nom, son logo, ses coordonnees, et ou verifier', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({
      nom: 'Hôpital de Donka', photoUrl: '/uploads/structures/d.png', telephone: '+224622000000',
      adresse: 'Route de Donka', quartier: 'Donka', commune: 'Dixinn', prefecture: 'Conakry',
    });

    const i = await identiteDocument('st-1');

    expect(i).toEqual({
      nom: 'Hôpital de Donka',
      logoUrl: '/uploads/structures/d.png',
      telephone: '+224622000000',
      emailContact: 'Route de Donka, Donka, Dixinn, Conakry',
      copyright: 'Émis par Hôpital de Donka · vérifiable sur https://keneya.gn',
    });
  });

  it('sans site web, la verification nomme la plateforme ; sans logo, aucun', async () => {
    getIdentitePlateforme.mockResolvedValue({ ...PLATEFORME, siteWeb: '' });
    prisma.structureSante.findUnique.mockResolvedValue({
      nom: 'Clinique Pasteur', photoUrl: null, telephone: null, adresse: null, quartier: null, commune: 'Kaloum', prefecture: 'Kaloum',
    });

    const i = await identiteDocument('st-2');

    expect(i.logoUrl).toBe('');
    expect(i.telephone).toBe('');
    // Commune et prefecture identiques : une seule fois.
    expect(i.emailContact).toBe('Kaloum');
    expect(i.copyright).toBe('Émis par Clinique Pasteur · vérifiable sur KÈNÈYA');
  });

  it('sans structure, ou structure introuvable : la plateforme', async () => {
    await expect(identiteDocument(null)).resolves.toBe(PLATEFORME);
    expect(prisma.structureSante.findUnique).not.toHaveBeenCalled();
    prisma.structureSante.findUnique.mockResolvedValue(null);
    await expect(identiteDocument('disparue')).resolves.toBe(PLATEFORME);
  });
});

describe('la structure d un document', () => {
  it('consultation : l hopital de l episode d abord, puis l agent, puis le medecin', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      episode: { idStructure: 'hop' }, asc: { idStructure: 'poste' }, medecinValideur: { medecinProfile: { idStructure: 'med' } },
    });
    await expect(structureDeConsultation('c-1')).resolves.toBe('hop');

    prisma.consultation.findUnique.mockResolvedValue({ episode: null, asc: { idStructure: 'poste' }, medecinValideur: null });
    await expect(structureDeConsultation('c-2')).resolves.toBe('poste');

    prisma.consultation.findUnique.mockResolvedValue({ episode: null, asc: null, medecinValideur: { medecinProfile: { idStructure: 'med' } } });
    await expect(structureDeConsultation('c-3')).resolves.toBe('med');

    await expect(structureDeConsultation(null)).resolves.toBeNull();
  });

  it('bon d examen : la structure de l episode', async () => {
    prisma.demandeAnalyse.findUnique.mockResolvedValue({ episode: { idStructure: 'hop' } });
    await expect(structureDeDemandeAnalyse('da-1')).resolves.toBe('hop');
    prisma.demandeAnalyse.findUnique.mockResolvedValue(null);
    await expect(structureDeDemandeAnalyse('da-2')).resolves.toBeNull();
  });
});
