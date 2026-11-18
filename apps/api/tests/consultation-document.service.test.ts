// Compte rendu de consultation imprimable (EF-05-03).
//
// Trois choses comptent :
//   - l'habilitation : un compte rendu porte des diagnostics, il ne sort que
//     pour qui a acces a la consultation ;
//   - l'honnetete du papier : non signe ou annule, il le dit sur lui-meme ;
//   - ce qui n'y est pas : le resume de l'IA (une aide, pas un avis) et le
//     code de verification des ordonnances (le secret du comptoir).
import { documentConsultation } from '../src/services/consultation-document.service';
import { ForbiddenError, NotFoundError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: { consultation: { findUnique: jest.fn() } },
}));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessConsultation: jest.fn(),
}));
jest.mock('../src/services/parametres.service', () => ({ getIdentitePlateforme: jest.fn() }));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { consultation: { findUnique: jest.Mock } };
};
const { assertCanAccessConsultation } = jest.requireMock('../src/services/access-control.service') as {
  assertCanAccessConsultation: jest.Mock;
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as {
  getIdentitePlateforme: jest.Mock;
};

const PATIENT = { userId: 'u-pat', role: 'PATIENT' } as never;

function consultation(etat: Record<string, unknown> = {}) {
  return {
    id: 'cons-1',
    statut: 'TERMINEE',
    motifPrincipal: 'Fievre depuis trois jours',
    symptomes: ['fievre', 'cephalees'],
    resumeIa: 'SUSPICION_IA_PALUDISME',
    confianceIa: 0.87,
    notesAsc: 'Patiente fatiguee.\nBoit peu.',
    notesMedecin: 'Paludisme simple, traitement ACT.',
    signeLe: new Date('2026-11-05T10:30:00Z'),
    consulteeLE: new Date('2026-11-05T09:00:00Z'),
    patient: {
      dateNaissance: new Date('1990-05-04'), sexe: 'F', allergies: ['Penicilline'], qrCode: 'qr-1',
      utilisateur: { prenom: 'Aminata', nom: 'Camara', telephone: '+224600000002' },
    },
    asc: { utilisateur: { prenom: 'Mamadou', nom: 'Bah' } },
    medecinValideur: { prenom: 'David', nom: 'Loua' },
    constantes: {
      temperature: 39.2, tensionSystolique: 120, tensionDiastolique: 80, frequenceCardiaque: 98,
      frequenceRespiratoire: null, spo2: 97, glycemie: null, poidsKg: 62, tailleCm: null, perimetreBrachial: null,
      alertes: ['Hyperthermie severe'],
    },
    diagnostics: [{ libelle: 'Paludisme simple', codeIcd11: '1F40', typeDiagnostic: 'PRINCIPAL', severite: 'MODERE' }],
    ordonnances: [{
      numero: 'OR-2026-000042', signeLe: new Date('2026-11-05T10:30:00Z'), creeLe: new Date('2026-11-05T09:30:00Z'),
      codeVerification: 'SECRET9',
      lignes: [{
        posologie: '4 cp', frequence: '2x/j', dureeJours: 3, quantite: 24,
        medicament: { nomCommercial: 'Coartem', dci: 'Artemether-lumefantrine', dosage: '20/120mg', forme: 'Comprime' },
      }],
    }],
    referencement: null,
    ...etat,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  assertCanAccessConsultation.mockResolvedValue(undefined);
  getIdentitePlateforme.mockResolvedValue({
    nom: 'Lead Health', logoUrl: '/uploads/logos/logo.png', telephone: '+224 620 00 00 00',
    emailContact: 'contact@exemple.test', copyright: '© Lead Health',
  });
  prisma.consultation.findUnique.mockResolvedValue(consultation());
});

describe('compte rendu de consultation', () => {
  it('verifie l habilitation avant de lire la consultation', async () => {
    assertCanAccessConsultation.mockRejectedValue(new ForbiddenError('Acces refuse a cette consultation'));

    await expect(documentConsultation(PATIENT, 'cons-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.consultation.findUnique).not.toHaveBeenCalled();
  });

  it('repond 404 pour une consultation introuvable', async () => {
    prisma.consultation.findUnique.mockResolvedValue(null);
    await expect(documentConsultation(PATIENT, 'cons-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reprend le patient, le motif, les constantes saisies, le diagnostic et la conclusion', async () => {
    const html = await documentConsultation(PATIENT, 'cons-1');

    expect(html).toContain('Aminata');
    expect(html).toContain('Allergies connues : Penicilline');
    expect(html).toContain('Fievre depuis trois jours');
    expect(html).toContain('fievre, cephalees');
    expect(html).toContain('39.2 &deg;C');
    expect(html).toContain('120/80 mmHg');
    expect(html).toContain('Hyperthermie severe');
    expect(html).toContain('Paludisme simple');
    expect(html).toContain('1F40');
    // Les codes deviennent des mots : le papier se lit sans le referentiel.
    expect(html).toContain('<td>Principal</td><td>Mod&eacute;r&eacute;</td>');
    expect(html).toContain('Paludisme simple, traitement ACT.');
    expect(html).toContain('Patiente fatiguee.<br>Boit peu.');
    expect(html).toContain('OR-2026-000042');
    expect(html).toContain('Coartem');
    expect(html).toContain('Mamadou');
  });

  it('n affiche pas les constantes non saisies', async () => {
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).not.toContain('Glyc&eacute;mie');
    expect(html).not.toContain('Taille');
  });

  it('ne reprend ni le resume de l IA ni le code de verification', async () => {
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).not.toContain('SUSPICION_IA_PALUDISME');
    expect(html).not.toContain('0.87');
    expect(html).not.toContain('SECRET9');
  });

  it('signe : nom du medecin et date, sans filigrane', async () => {
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).toContain('Sign&eacute; le');
    expect(html).toContain('Dr David Loua');
    expect(html).not.toContain('class="filigrane"');
  });

  it('non signe : filigrane NON SIGNE et mention explicite', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consultation({ signeLe: null, medecinValideur: null }));
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).toContain('<div class="filigrane">NON SIGNE</div>');
    expect(html).toContain('Non sign&eacute; par un m&eacute;decin');
  });

  it('annulee : filigrane ANNULEE, meme si elle avait ete signee', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consultation({ statut: 'ANNULEE' }));
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).toContain('<div class="filigrane">ANNULEE</div>');
  });

  it('echappe le texte libre saisi par les soignants', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consultation({ notesMedecin: '<script>alert(1)</script>' }));
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('montre l orientation quand le patient a ete refere', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consultation({
      referencement: { urgence: 'URGENT', resumeClinique: 'A voir au CHU', structureCible: { nom: 'CHU Donka' } },
    }));
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).toContain('CHU Donka');
    expect(html).toContain('Urgent');
    expect(html).toContain('A voir au CHU');
  });

  it('omet les sections vides', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consultation({
      constantes: null, diagnostics: [], notesAsc: null, notesMedecin: null, ordonnances: [],
    }));
    const html = await documentConsultation(PATIENT, 'cons-1');
    expect(html).not.toContain('<h2>Constantes</h2>');
    expect(html).not.toContain('<h2>Diagnostics</h2>');
    expect(html).not.toContain('<h2>Prescriptions</h2>');
    expect(html).not.toContain('<h2>Orientation</h2>');
  });

  it('ne demande pas le code de verification a la base', async () => {
    await documentConsultation(PATIENT, 'cons-1');
    const { include } = prisma.consultation.findUnique.mock.calls[0][0];
    // Les ordonnances sont lues champ par champ : le code n'est jamais charge.
    expect(include.ordonnances.select).not.toHaveProperty('codeVerification');
  });
});
