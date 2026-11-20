// Lecture et impression d'une ordonnance.
//
// Deux choses comptent ici. D'abord l'habilitation : le code de verification
// est le secret qui permet de retirer un traitement, il ne doit jamais sortir
// pour quelqu'un qui n'a pas acces au dossier. Ensuite l'honnetete du papier :
// une ordonnance non signee ou expiree doit le dire sur elle-meme, sinon on
// imprime un document qui a l'air opposable et ne l'est pas.
import {
  documentOrdonnance,
  getOrdonnance,
  getOrdonnancesPatient,
} from '../src/services/ordonnance-vue.service';
import { ForbiddenError, NotFoundError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    ordonnance: { findUnique: jest.fn(), findMany: jest.fn() },
    patientProfile: { findUnique: jest.fn() },
  },
}));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessConsultation: jest.fn(),
}));
jest.mock('../src/services/parametres.service', () => ({ getIdentitePlateforme: jest.fn() }));
// L'en-tete vient de la structure emettrice : le test en fournit une.
jest.mock('../src/services/document-emetteur.service', () => ({
  structureDeConsultation: jest.fn(),
  identiteDocument: jest.fn(),
}));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    ordonnance: { findUnique: jest.Mock; findMany: jest.Mock };
    patientProfile: { findUnique: jest.Mock };
  };
};
const { assertCanAccessConsultation } = jest.requireMock('../src/services/access-control.service') as {
  assertCanAccessConsultation: jest.Mock;
};
const emetteur = jest.requireMock('../src/services/document-emetteur.service') as {
  structureDeConsultation: jest.Mock; identiteDocument: jest.Mock;
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as {
  getIdentitePlateforme: jest.Mock;
};

const PATIENT = { userId: 'u-pat', role: 'PATIENT' } as never;

const DANS_30_JOURS = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const HIER = new Date(Date.now() - 24 * 3600 * 1000);

function ordonnance(etat: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    numero: 'OR-2026-000001',
    statut: 'EN_ATTENTE',
    codeVerification: 'A7D27Y',
    valideJusquau: DANS_30_JOURS,
    signeLe: new Date('2026-09-01'),
    creeLe: new Date('2026-09-01'),
    idConsultation: 'cons-1',
    signataire: { prenom: 'Fatoumata', nom: 'Diallo' },
    lignes: [{
      id: 'l1', statut: 'EN_ATTENTE', posologie: '1 cp', frequence: '3x/j',
      dureeJours: 5, quantite: 15, instructions: 'Apres le repas',
      medicament: { id: 'm1', dci: 'Paracetamol', nomCommercial: 'Doliprane', forme: 'Comprime', dosage: '500mg', prixUnitaireGnf: 1000 },
    }],
    consultation: {
      asc: { utilisateur: { prenom: 'Mamadou', nom: 'Bah' } },
      patient: {
        sexe: 'F', dateNaissance: new Date('1990-05-04'), qrCode: 'qr-1', allergies: [],
        utilisateur: { prenom: 'Aminata', nom: 'Camara', telephone: '+224600000002' },
      },
    },
    ...etat,
  };
}

beforeEach(() => {
  assertCanAccessConsultation.mockResolvedValue(undefined);
  const identite = {
    nom: 'KÈNÈYA', logoUrl: '', copyright: '© 2026 KÈNÈYA',
    telephone: '+224600000000', emailContact: 'contact@keneya.gn',
  };
  getIdentitePlateforme.mockResolvedValue(identite);
  emetteur.structureDeConsultation.mockResolvedValue('st-1');
  emetteur.identiteDocument.mockResolvedValue(identite);
});
afterEach(() => jest.resetAllMocks());

// ── Habilitation ─────────────────────────────────────────────────────
describe('habilitation', () => {
  it("juge l'acces sur la consultation, pas sur l'ordonnance", async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());

    await getOrdonnance(PATIENT, 'ord-1');

    expect(assertCanAccessConsultation).toHaveBeenCalledWith(PATIENT, 'cons-1');
  });

  // Le code de verification permet de retirer un traitement : il ne doit
  // jamais sortir pour quelqu'un qui n'a pas acces au dossier.
  it('ne rend rien si la consultation est refusee', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());
    assertCanAccessConsultation.mockRejectedValue(new ForbiddenError('Acces refuse'));

    await expect(getOrdonnance(PATIENT, 'ord-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuse aussi l'impression d'une ordonnance hors dossier", async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());
    assertCanAccessConsultation.mockRejectedValue(new ForbiddenError('Acces refuse'));

    await expect(documentOrdonnance(PATIENT, 'ord-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404 sur une ordonnance inconnue', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(null);
    await expect(getOrdonnance(PATIENT, 'ord-x')).rejects.toBeInstanceOf(NotFoundError);
    // Le controle d'acces n'a meme pas ete sollicite : rien a proteger.
    expect(assertCanAccessConsultation).not.toHaveBeenCalled();
  });
});

// ── Vue ──────────────────────────────────────────────────────────────
describe('getOrdonnance', () => {
  it('expose le couple numero + code au patient', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());

    const vue = await getOrdonnance(PATIENT, 'ord-1');

    expect(vue.numero).toBe('OR-2026-000001');
    expect(vue.codeVerification).toBe('A7D27Y');
    expect(vue.expiree).toBe(false);
    expect(vue.lignes).toHaveLength(1);
  });

  it('signale une ordonnance dont la validite est passee', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance({ valideJusquau: HIER }));

    expect((await getOrdonnance(PATIENT, 'ord-1')).expiree).toBe(true);
  });

  // Une ordonnance d'ASC n'a pas de signataire : afficher « — » priverait le
  // patient du nom de la personne qui l'a recu.
  it("retombe sur l'agent de la consultation quand personne n'a signe", async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance({ signataire: null, signeLe: null }));

    const vue = await getOrdonnance(PATIENT, 'ord-1');

    expect(vue.signataire).toEqual({ prenom: 'Mamadou', nom: 'Bah' });
    expect(vue.signeLe).toBeNull();
  });
});

describe('getOrdonnancesPatient', () => {
  it('404 si le compte n a pas de dossier patient', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(getOrdonnancesPatient(PATIENT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('ne lit que les ordonnances du patient connecte', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.ordonnance.findMany.mockResolvedValue([ordonnance()]);

    const vues = await getOrdonnancesPatient(PATIENT);

    expect(prisma.ordonnance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { consultation: { idPatient: 'p1' } },
    }));
    expect(vues).toHaveLength(1);
  });
});

// ── Document imprimable ──────────────────────────────────────────────
describe('documentOrdonnance', () => {
  // Une ordonnance de l'hopital porte le nom de l'hopital, pas de la plateforme.
  it('porte en tete la structure ou elle a ete redigee', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());
    emetteur.identiteDocument.mockResolvedValue({
      nom: 'Hôpital de Donka', logoUrl: '/uploads/structures/s.png', telephone: '+224600111222',
      emailContact: 'Dixinn, Conakry', copyright: 'Émis par Hôpital de Donka · vérifiable sur KÈNÈYA',
    });

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(emetteur.structureDeConsultation).toHaveBeenCalledWith('cons-1');
    expect(emetteur.identiteDocument).toHaveBeenCalledWith('st-1');
    expect(html).toContain('<h1>Hôpital de Donka</h1>');
    expect(html).toContain('/uploads/structures/s.png');
    expect(html).toContain('vérifiable sur KÈNÈYA');
  });

  it('imprime le numero, le code et les medicaments', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(html).toContain('OR-2026-000001');
    expect(html).toContain('A7D27Y');
    expect(html).toContain('Doliprane');
    expect(html).toContain('Aminata');
  });

  // Sans filigrane, on imprime un papier qui a l'air opposable et ne l'est pas.
  it('marque NON SIGNEE une ordonnance sans signature', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance({ signeLe: null, signataire: null }));

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(html).toContain('NON SIGNEE');
  });

  it('marque EXPIREE une ordonnance dont la validite est passee', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance({ valideJusquau: HIER }));

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(html).toContain('EXPIREE');
  });

  it('ne marque rien sur une ordonnance signee et valide', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance());

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(html).not.toContain('filigrane">NON SIGNEE');
    expect(html).not.toContain('filigrane">EXPIREE');
  });

  it('rappelle les allergies connues du patient', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance({
      consultation: {
        asc: null,
        patient: {
          sexe: 'F', dateNaissance: new Date('1990-05-04'), qrCode: 'qr-1',
          allergies: ['Penicilline'],
          utilisateur: { prenom: 'Aminata', nom: 'Camara', telephone: '+224600000002' },
        },
      },
    }));

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(html).toContain('Penicilline');
  });

  // Un nom de patient contenant < ou & casserait le document, et pire, un
  // champ libre pourrait y injecter du balisage.
  it('echappe le contenu venu de la base', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnance({
      consultation: {
        asc: null,
        patient: {
          sexe: 'F', dateNaissance: new Date('1990-05-04'), qrCode: 'qr-1', allergies: [],
          utilisateur: { prenom: '<script>alert(1)</script>', nom: 'Camara', telephone: '+224' },
        },
      },
    }));

    const html = await documentOrdonnance(PATIENT, 'ord-1');

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
