import { documentRecu } from '../src/services/recu-paiement.service';
import { NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    patientProfile: { findUnique: jest.fn() },
    facture: { findUnique: jest.fn() },
  },
}));
jest.mock('../src/services/parametres.service', () => ({ getIdentitePlateforme: jest.fn() }));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    patientProfile: { findUnique: jest.Mock };
    facture: { findUnique: jest.Mock };
  };
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as {
  getIdentitePlateforme: jest.Mock;
};

const PATIENT = { userId: 'u-pat', role: 'PATIENT' } as never;

function facture(etat: Record<string, unknown> = {}) {
  return {
    id: 'fac-1',
    montantGnf: 150000,
    statut: 'PAYEE',
    modePaiement: 'ORANGE_MONEY',
    referenceOperateur: 'OM-REF-123',
    payeeLe: new Date('2026-11-05T10:30:00Z'),
    patient: {
      id: 'pat-1',
      qrCode: 'qr-1',
      utilisateur: { prenom: 'Aminata', nom: 'Camara', telephone: '+224600000002' },
    },
    consultation: {
      consulteeLE: new Date('2026-11-05T09:00:00Z'),
      motifPrincipal: 'Consultation generale',
    },
    ...etat,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.patientProfile.findUnique.mockResolvedValue({ id: 'pat-1' });
  prisma.facture.findUnique.mockResolvedValue(facture());
  getIdentitePlateforme.mockResolvedValue({
    nom: 'Lead Health', logoUrl: '/uploads/logo.png', telephone: '+224 620 00 00 00',
    emailContact: 'contact@exemple.test', copyright: '© Lead Health',
  });
});

describe('recu de paiement', () => {
  it('rend les informations d un paiement paye', async () => {
    const html = await documentRecu(PATIENT, 'fac-1');

    expect(html).toContain('Aminata Camara');
    // Le mode en clair, pas le code de l'enumeration.
    expect(html).toContain('<td>Orange Money</td>');
    expect(html).not.toContain('ORANGE_MONEY');
    expect(html).toContain('Re&ccedil;u N&deg;');
    expect(html).toContain('OM-REF-123');
    expect(html).toMatch(/150\s000/u);
    expect(html).toContain('Consultation generale');
    expect(html).toContain('Ce re&ccedil;u atteste du paiement.');
  });

  it('refuse une facture non payee', async () => {
    prisma.facture.findUnique.mockResolvedValue(facture({ statut: 'EN_ATTENTE' }));

    await expect(documentRecu(PATIENT, 'fac-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('renvoie NotFoundError pour une facture d un autre patient', async () => {
    prisma.facture.findUnique.mockResolvedValue(facture({ patient: { ...facture().patient, id: 'pat-autre' } }));

    await expect(documentRecu(PATIENT, 'fac-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renvoie NotFoundError pour une facture introuvable', async () => {
    prisma.facture.findUnique.mockResolvedValue(null);

    await expect(documentRecu(PATIENT, 'fac-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('echappe le motif de consultation', async () => {
    prisma.facture.findUnique.mockResolvedValue(facture({
      consultation: { consulteeLE: new Date('2026-11-05T09:00:00Z'), motifPrincipal: '<script>alert(1)</script>' },
    }));

    const html = await documentRecu(PATIENT, 'fac-1');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
