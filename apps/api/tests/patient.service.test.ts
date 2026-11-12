// Dossier patient : creation par un agent, acces par QR code, profil et
// structure preferee. Le controle d'acces inter-structures est teste a part
// (access-control.test.ts) ; ici on verifie qu'il est bien invoque.
import {
  createPatient,
  getPatientById,
  getPatientByQrCode,
  updateMyProfile,
  updateStructurePreferee,
} from '../src/services/patient.service';
import { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn(), update: jest.fn() },
    patientProfile: { findUnique: jest.fn(), update: jest.fn() },
    structureSante: { findUnique: jest.fn() },
    session: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessPatient: jest.fn(),
  buildPatientWhereForUser: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/services/sync.service', () => ({ recordSyncEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/privacy.service', () => ({ initialiserConsentementsParDefaut: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn().mockResolvedValue('$hash') }));
jest.mock('../src/utils/jwt.utils', () => ({
  generateTokenPair: jest.fn().mockReturnValue({ accessToken: 'a', refreshToken: 'r' }),
}));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: jest.Mock; update: jest.Mock };
    patientProfile: { findUnique: jest.Mock; update: jest.Mock };
    structureSante: { findUnique: jest.Mock };
    session: { create: jest.Mock };
    $transaction: jest.Mock;
  };
};
const { assertCanAccessPatient } = jest.requireMock('../src/services/access-control.service') as { assertCanAccessPatient: jest.Mock };
const { initialiserConsentementsParDefaut } = jest.requireMock('../src/services/privacy.service') as { initialiserConsentementsParDefaut: jest.Mock };
const { recordSyncEvent } = jest.requireMock('../src/services/sync.service') as { recordSyncEvent: jest.Mock };
const { generateTokenPair } = jest.requireMock('../src/utils/jwt.utils') as { generateTokenPair: jest.Mock };
const { hashPassword } = jest.requireMock('../src/utils/password.utils') as { hashPassword: jest.Mock };

const ASC = { userId: 'asc-u', role: 'ASC', sessionId: 's' } as JwtPayload;

const DTO = {
  telephone: '620000001', motDePasse: 'secret', prenom: 'Awa', nom: 'Diallo',
  dateNaissance: '1990-05-01', sexe: 'F', prefecture: 'Kindia',
};

beforeEach(() => {
  assertCanAccessPatient.mockResolvedValue(undefined);
  recordSyncEvent.mockResolvedValue(undefined);
  initialiserConsentementsParDefaut.mockResolvedValue(undefined);
  generateTokenPair.mockReturnValue({ accessToken: 'a', refreshToken: 'r' });
  hashPassword.mockResolvedValue('$hash');
});
afterEach(() => jest.resetAllMocks());

describe('createPatient', () => {
  it('refuse un telephone deja utilise', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ id: 'u-existant' });
    await expect(createPatient(DTO)).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cree utilisateur + profil dans une transaction, initialise les consentements, ouvre une session', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue(null);
    const tx = {
      utilisateur: { create: jest.fn().mockResolvedValue({ id: 'u1', role: 'PATIENT' }) },
      patientProfile: { create: jest.fn().mockResolvedValue({ id: 'p1', prefecture: 'Kindia' }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    prisma.session.create.mockResolvedValue({});

    const res = await createPatient({ ...DTO, allergies: ['Pénicilline'] });

    expect(tx.utilisateur.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ telephone: '620000001', motDePasseHash: '$hash', role: 'PATIENT' }),
    });
    expect(tx.patientProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idUtilisateur: 'u1', sexe: 'F', prefecture: 'Kindia', allergies: ['Pénicilline'], maladiesChroniques: [] }),
    }));
    expect(initialiserConsentementsParDefaut).toHaveBeenCalledWith(tx, 'p1', 'u1');
    expect(prisma.session.create).toHaveBeenCalledWith({ data: expect.objectContaining({ refreshToken: 'r', idUtilisateur: 'u1' }) });
    expect(recordSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'PatientProfile', entityId: 'p1', operation: 'CREATE' }));
    expect(res).toEqual({ tokenPair: { accessToken: 'a', refreshToken: 'r' }, patient: { id: 'p1', prefecture: 'Kindia' } });
  });
});

describe('acces au dossier', () => {
  it('getPatientById verifie l acces AVANT de lire le dossier', async () => {
    assertCanAccessPatient.mockRejectedValue(new ForbiddenError('non'));
    await expect(getPatientById(ASC, 'p-autre')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.patientProfile.findUnique).not.toHaveBeenCalled();
  });

  it('getPatientByQrCode : 404 sur QR inconnu, sinon controle d acces sur le patient trouve', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(getPatientByQrCode(ASC, 'qr-x')).rejects.toBeInstanceOf(NotFoundError);

    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1', qrCode: 'qr-1' });
    await getPatientByQrCode(ASC, 'qr-1');
    expect(assertCanAccessPatient).toHaveBeenCalledWith(ASC, 'p1');
  });
});

describe('updateMyProfile', () => {
  it('404 sans profil patient', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(updateMyProfile('u-x', { prenom: 'A' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('ne touche l utilisateur que si un champ d identite change', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
    const tx = {
      utilisateur: { update: jest.fn() },
      patientProfile: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));

    await updateMyProfile('u1', { allergies: ['Arachide'], village: 'Foulaya' });

    expect(tx.utilisateur.update).not.toHaveBeenCalled();
    expect(tx.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: { allergies: ['Arachide'], village: 'Foulaya' },
    }));
  });

  it('met a jour l identite et le profil dans la meme transaction', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.utilisateur.findUnique.mockResolvedValue({
      prenom: 'Aw', nom: 'Diallo', patientProfile: { idFusionneDans: null, niveauIdentite: 'PROVISOIRE' },
    });
    const tx = {
      utilisateur: { update: jest.fn().mockResolvedValue({}) },
      patientProfile: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));

    await updateMyProfile('u1', { prenom: 'Awa', groupeSanguin: 'O+' });

    expect(tx.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { prenom: 'Awa' } });
    expect(tx.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { groupeSanguin: 'O+' } }));
  });

  // R15 : une fois verifiee sur piece, l'identite ne se reecrit plus sans trace.
  describe('nom fige apres verification', () => {
    const tx = () => ({
      utilisateur: { update: jest.fn().mockResolvedValue({}) },
      patientProfile: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    });
    const verifie = (etat: Record<string, unknown> = {}) => prisma.utilisateur.findUnique.mockResolvedValue({
      prenom: 'Awa', nom: 'Diallo', patientProfile: { idFusionneDans: null, niveauIdentite: 'VERIFIEE' }, ...etat,
    });

    it('refuse un autre nom, sans rien ecrire, et dit ou s adresser', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
      verifie();

      await expect(updateMyProfile('u1', { nom: 'Camara' })).rejects.toThrow("adressez-vous a l'accueil");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('laisse passer le meme nom renvoye avec le reste du formulaire', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
      verifie();
      const t = tx();
      prisma.$transaction.mockImplementation(async (fn: (x: unknown) => unknown) => fn(t));

      await updateMyProfile('u1', { prenom: 'Awa', nom: 'Diallo', groupeSanguin: 'A+' });

      expect(t.patientProfile.update).toHaveBeenCalled();
    });

    it('laisse le patient provisoire corriger son nom lui-meme', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
      verifie({ patientProfile: { idFusionneDans: null, niveauIdentite: 'PROVISOIRE' } });
      const t = tx();
      prisma.$transaction.mockImplementation(async (fn: (x: unknown) => unknown) => fn(t));

      await updateMyProfile('u1', { nom: 'Camara' });

      expect(t.utilisateur.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { nom: 'Camara' } });
    });

    // Le dossier absorbe n'est plus le sien : meme provisoire, le nom passe par l'accueil.
    it('fige le nom d un dossier absorbe par une fusion, meme provisoire', async () => {
      prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p-absorbe', idFusionneDans: 'p-principal' });
      verifie({ patientProfile: { idFusionneDans: 'p-principal', niveauIdentite: 'PROVISOIRE' } });

      await expect(updateMyProfile('u1', { prenom: 'Aissatou' })).rejects.toBeInstanceOf(ForbiddenError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // Apres une fusion, le patient lit le dossier principal : il doit y ecrire.
  it('ecrit dans le dossier principal apres une fusion', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p-absorbe', idFusionneDans: 'p-principal' });
    const t = {
      utilisateur: { update: jest.fn() },
      patientProfile: { update: jest.fn().mockResolvedValue({ id: 'p-principal' }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (x: unknown) => unknown) => fn(t));

    await updateMyProfile('u1', { allergies: ['Arachide'] });

    expect(t.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p-principal' } }));
  });

  it('vide un champ quand le patient l efface, et accepte une liste vide', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' });
    const t = {
      utilisateur: { update: jest.fn() },
      patientProfile: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (x: unknown) => unknown) => fn(t));

    await updateMyProfile('u1', { groupeSanguin: '', urgenceTelephone: '', urgenceNom: ' ', allergies: [] });

    expect(t.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { groupeSanguin: null, urgenceNom: null, urgenceTelephone: null, allergies: [] },
    }));
  });
});

describe('updateStructurePreferee', () => {
  beforeEach(() => prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p1' }));

  it('refuse une structure inconnue ou desactivee', async () => {
    prisma.structureSante.findUnique.mockResolvedValue(null);
    await expect(updateStructurePreferee('u1', 'st-x')).rejects.toBeInstanceOf(NotFoundError);

    prisma.structureSante.findUnique.mockResolvedValue({ id: 'st-1', estActive: false });
    await expect(updateStructurePreferee('u1', 'st-1')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.patientProfile.update).not.toHaveBeenCalled();
  });

  it('accepte null pour retirer la preference sans verifier de structure', async () => {
    prisma.patientProfile.update.mockResolvedValue({ id: 'p1', idStructurePreferee: null });

    await updateStructurePreferee('u1', null);

    expect(prisma.structureSante.findUnique).not.toHaveBeenCalled();
    expect(prisma.patientProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { idStructurePreferee: null } }));
    expect(recordSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ payload: { idStructurePreferee: null } }));
  });
});
