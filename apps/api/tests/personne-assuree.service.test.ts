// Les fiches d'identite des personnes assurees (lot assurance, 2026-10-21).
//
// Ce qui ne doit jamais etre faux ici :
//   - un numero deja pris par une autre personne n'est pas detourne ;
//   - un compte cree recoit un mot de passe a changer, et garde une identite
//     PROVISOIRE dans son dossier medical ;
//   - une meme piece ne designe pas deux personnes dans une compagnie ;
//   - une photo ne sort que pour la compagnie, le comptoir ou son patient.
import {
  ajouterTravailleur,
  assurerPersonne,
  cheminPhoto,
  dateCsv,
  importerTravailleurs,
  modifierPersonne,
  photoPourPatient,
} from '../src/services/personne-assuree.service';
import { ENCRYPTED_FIELDS } from '../src/config/prisma-encryption.extension';
import { Prisma } from '../src/config/generated/client/client';
import { JwtPayload } from '../src/types/auth.types';
import { ConflictError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma = {
    utilisateur: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    assureur: { findUnique: jest.fn() },
    patientProfile: { findUnique: jest.fn(), create: jest.fn() },
    personneAssuree: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    contratCollectifAssurance: { findFirst: jest.fn() },
    adhesionAssurance: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    contratAssurance: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
// R14 : la numerotation vient des parametres du pays installe.
jest.mock('../src/services/parametres.service', () => {
  const vrai = jest.requireActual('../src/services/parametres.service');
  return { ...vrai, getValeursParametres: async () => ({ pays: vrai.PARAMETRES_PAR_DEFAUT.pays }) };
});
jest.mock('../src/config/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn(async () => 'hache') }));
jest.mock('../src/services/hopital.service', () => ({
  genererMotDePasseTemp: () => 'abcd2345',
  filtreRecherchePatient: jest.fn(),
}));
jest.mock('../src/services/privacy.service', () => ({ initialiserConsentementsParDefaut: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as { prisma: Record<string, Record<string, M>> & { $transaction: M } };
const { initialiserConsentementsParDefaut } = jest.requireMock('../src/services/privacy.service') as { initialiserConsentementsParDefaut: M };
const { hashPassword } = jest.requireMock('../src/utils/password.utils') as { hashPassword: M };

const agent = { userId: 'agent-1', role: 'ASSUREUR', sessionId: 's' } as JwtPayload;
const LE_21_OCTOBRE = new Date('2026-10-21T10:00:00Z');

const PERSONNE = {
  nom: 'Camara', prenoms: 'Fanta', sexe: 'F' as const, dateNaissance: '1988-06-02',
  lieuNaissance: 'Kindia', nationalite: 'Guineenne', typePiece: 'CARTE_NATIONALE' as const,
  numeroPiece: 'gn 123 456', dateExpirationPiece: '2030-01-01',
  telephone: '+224 620 10 00 13', prefecture: 'Conakry',
};

const CONTRAT = {
  id: 'cc-1', statut: 'ACTIF', dateEffet: new Date('2026-01-01'), dateFin: new Date('2026-12-31'), periodeGraceJours: 0,
};

/** La fiche telle que la base la rend apres creation. */
const fiche = (donnees: Record<string, unknown> = {}) => ({
  id: 'pa-1', nom: 'Camara', prenoms: 'Fanta', sexe: 'F', dateNaissance: new Date('1988-06-02'),
  lieuNaissance: 'Kindia', nationalite: 'Guineenne', typePiece: 'CARTE_NATIONALE', numeroPiece: 'GN123456',
  dateDelivrancePiece: null, dateExpirationPiece: new Date('2030-01-01'), telephone: '620100013', adresse: null,
  photo: null, creeLe: LE_21_OCTOBRE, modifieLe: LE_21_OCTOBRE, idAssureur: 'as-1', idPatient: 'p-1', idSaisiePar: 'agent-1',
  ...donnees,
});

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  hashPassword.mockResolvedValue('hache');
  prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'struct-A' });
  prisma.assureur.findUnique.mockResolvedValue({ id: 'as-1' });
  prisma.contratCollectifAssurance.findFirst.mockResolvedValue(CONTRAT);
  prisma.utilisateur.findMany.mockResolvedValue([]);
  prisma.utilisateur.create.mockResolvedValue({ id: 'u-1' });
  prisma.patientProfile.create.mockResolvedValue({ id: 'p-1' });
  prisma.personneAssuree.findUnique.mockResolvedValue(null);
  prisma.personneAssuree.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(fiche(data)));
  prisma.adhesionAssurance.findFirst.mockResolvedValue(null);
  prisma.adhesionAssurance.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
    id: 'ad-1', statut: 'ACTIF', motifFin: null, finEnregistreeLe: null,
    patient: { id: 'p-1', utilisateur: { prenom: 'Fanta', nom: 'Camara' } }, ...data,
  }));
});

describe('ajouterTravailleur : le compte patient', () => {
  it('cree le compte d un travailleur inconnu, avec un mot de passe a changer', async () => {
    const r = await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);

    expect(r.compteCree).toBe(true);
    expect(r.motDePasseTemporaire).toBe('abcd2345');
    expect(prisma.utilisateur.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ telephone: '620100013', role: 'PATIENT', doitChangerMotDePasse: true, motDePasseHash: 'hache' }),
    }));
    expect(initialiserConsentementsParDefaut).toHaveBeenCalledWith(prisma, 'p-1', 'u-1');
  });

  // Le dossier medical garde le niveau constate par les soignants : c'est la
  // fiche de la compagnie qui ouvre le tiers payant, pas un dossier « verifie ».
  it('laisse le dossier medical du nouveau compte en identite provisoire', async () => {
    await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);
    const [{ data }] = prisma.patientProfile.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data).not.toHaveProperty('niveauIdentite');
  });

  it('rattache le compte existant quand le nom correspond, sans en creer', async () => {
    prisma.utilisateur.findMany.mockResolvedValue([
      { id: 'u-9', prenom: 'Fanta', nom: 'CAMARA', role: 'PATIENT', patientProfile: { id: 'p-9' } },
    ]);
    const r = await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);

    expect(r.compteCree).toBe(false);
    expect(r.motDePasseTemporaire).toBeNull();
    expect(prisma.utilisateur.create).not.toHaveBeenCalled();
    expect(prisma.adhesionAssurance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idPatient: 'p-9' }),
    }));
  });

  it('cherche le compte sur les 9 chiffres du numero, quel que soit son format', async () => {
    await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);
    expect(prisma.utilisateur.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { telephone: { endsWith: '620100013' } },
    }));
  });

  it('refuse de detourner le numero d une autre personne', async () => {
    prisma.utilisateur.findMany.mockResolvedValue([
      { id: 'u-9', prenom: 'Ibrahima', nom: 'Sylla', role: 'PATIENT', patientProfile: { id: 'p-9' } },
    ]);
    await expect(ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toThrow(/appartient deja a Ibrahima Sylla/);
    expect(prisma.adhesionAssurance.create).not.toHaveBeenCalled();
  });

  it('refuse le numero d un compte professionnel', async () => {
    prisma.utilisateur.findMany.mockResolvedValue([
      { id: 'u-9', prenom: 'Fanta', nom: 'Camara', role: 'PHARMACIEN', patientProfile: null },
    ]);
    await expect(ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('refuse un numero qui n a pas 9 chiffres', async () => {
    await expect(ajouterTravailleur(agent, 'cc-1', { personne: { ...PERSONNE, telephone: '62010' }, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ajouterTravailleur : la fiche et l adhesion', () => {
  it('enregistre la piece sans espaces ni minuscules, et le telephone sur 9 chiffres', async () => {
    await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);
    expect(prisma.personneAssuree.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ numeroPiece: 'GN123456', telephone: '620100013', idAssureur: 'as-1', idSaisiePar: 'agent-1' }),
    }));
    expect(ENCRYPTED_FIELDS.PersonneAssuree).toEqual({
      scalar: ['lieuNaissance', 'nationalite', 'adresse'],
      array: [],
    });
  });

  it('donne au travailleur sa propre carte, liee a sa fiche', async () => {
    const r = await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);
    const [{ data }] = prisma.adhesionAssurance.create.mock.calls[0] as [{ data: { jetonCarte: string } }];
    expect(data.jetonCarte).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.adhesion?.personne).toMatchObject({ id: 'pa-1', numeroPiece: 'GN123456', photoDisponible: false, pieceExpiree: false });
  });

  it('refuse une piece deja enregistree pour une autre personne de la compagnie', async () => {
    prisma.personneAssuree.findUnique
      .mockResolvedValueOnce(null) // pas de fiche pour ce patient
      .mockResolvedValueOnce({ prenoms: 'Ibrahima', nom: 'Sylla' }); // mais la piece est prise
    await expect(ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toThrow(/deja enregistree pour Ibrahima Sylla/);
  });

  it('reutilise la fiche existante quand la piece est la meme', async () => {
    prisma.personneAssuree.findUnique.mockResolvedValueOnce(fiche());
    await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);
    expect(prisma.personneAssuree.create).not.toHaveBeenCalled();
  });

  it('refuse une fiche existante avec une autre piece : il faut la mettre a jour', async () => {
    prisma.personneAssuree.findUnique.mockResolvedValueOnce(fiche({ numeroPiece: 'AUTRE-999' }));
    await expect(ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toThrow(/autre piece/);
  });

  it('refuse un numero d adherent deja attribue', async () => {
    prisma.adhesionAssurance.findFirst.mockResolvedValue({ idPatient: 'p-autre' });
    await expect(ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toThrow(/deja attribue/);
  });

  it('ne trouve pas le contrat d une autre compagnie', async () => {
    prisma.contratCollectifAssurance.findFirst.mockResolvedValue(null);
    await expect(ajouterTravailleur(agent, 'cc-autre', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.contratCollectifAssurance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cc-autre', idAssureur: 'as-1' },
    }));
    expect(prisma.utilisateur.create).not.toHaveBeenCalled();
  });

  it('fait tout dans une seule transaction : rien n est cree a moitie', async () => {
    await ajouterTravailleur(agent, 'cc-1', { personne: PERSONNE, numeroAdherent: 'EMP-1' }, LE_21_OCTOBRE);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('assurerPersonne', () => {
  it('cree la fiche et la police individuelle de la compagnie connectee', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p-1', utilisateur: { prenom: 'Fanta', nom: 'Camara' } });
    prisma.contratAssurance.findFirst.mockResolvedValue(null);
    prisma.contratAssurance.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({
      id: 'ct-1', statut: 'ACTIF', carenceJours: 0, periodeGraceJours: 0, plafondAnnuelGnf: 0, franchiseGnf: 0, dateFin: null, ...data,
    }));
    prisma.assureur.findUnique.mockResolvedValueOnce({ id: 'as-1' }).mockResolvedValue({ id: 'as-1', nom: 'PFA', code: 'PFA' });

    const r = await assurerPersonne(agent, {
      personne: PERSONNE, police: { numeroPolice: 'IND-1', tauxBasePourcent: 70, dateEffet: '2026-01-01' },
    }, LE_21_OCTOBRE);

    expect(r.contrat?.numeroPolice).toBe('IND-1');
    expect(prisma.contratAssurance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idAssureur: 'as-1', idPatient: 'p-1', tauxBasePourcent: 70 }),
    }));
  });
});

describe('modifierPersonne', () => {
  it('refuse une piece deja prise, sans laisser fuir l erreur de base', async () => {
    prisma.personneAssuree.findFirst.mockResolvedValue(fiche());
    prisma.personneAssuree.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(modifierPersonne(agent, 'pa-1', { numeroPiece: 'PRIS-1' }, LE_21_OCTOBRE)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuse une expiration anterieure a la delivrance deja enregistree', async () => {
    prisma.personneAssuree.findFirst.mockResolvedValue(fiche({ dateDelivrancePiece: new Date('2025-01-01') }));
    await expect(modifierPersonne(agent, 'pa-1', { dateExpirationPiece: '2024-01-01' }, LE_21_OCTOBRE))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('ne modifie que la fiche de sa compagnie', async () => {
    prisma.personneAssuree.findFirst.mockResolvedValue(null);
    await expect(modifierPersonne(agent, 'pa-autre', { nom: 'X' }, LE_21_OCTOBRE)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.personneAssuree.findFirst).toHaveBeenCalledWith({ where: { id: 'pa-autre', idAssureur: 'as-1' } });
  });
});

describe('la photo', () => {
  it('ne sort jamais du dossier prive', () => {
    expect(() => cheminPhoto('../../.env')).toThrow(NotFoundError);
    expect(() => cheminPhoto('pa-1-1.webp/../../x')).toThrow(NotFoundError);
    expect(cheminPhoto('pa-1-1729500000000.webp')).toContain('stockage-prive');
  });

  it('refuse la photo de la carte d un autre patient, comme une carte inconnue', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({ id: 'p-moi' });
    prisma.contratAssurance.findUnique.mockResolvedValue(null);
    prisma.adhesionAssurance.findUnique.mockResolvedValue({
      id: 'ad-1', idPatient: 'p-autre', contratCollectif: { idAssureur: 'as-1', assureur: {}, entreprise: {}, regles: [] },
      patient: { id: 'p-autre', niveauIdentite: 'PROVISOIRE', utilisateur: { prenom: 'X', nom: 'Y' } },
    });
    await expect(photoPourPatient('u-moi', 'J'.repeat(43))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('importerTravailleurs', () => {
  const ENTETE = 'nom;prenoms;sexe;date_naissance;lieu_naissance;nationalite;type_piece;numero_piece;telephone;prefecture;numero_adherent';

  it('lit les dates d Excel en francais', () => {
    expect(dateCsv('02/06/1988')).toBe('1988-06-02');
    expect(dateCsv('2/6/1988')).toBe('1988-06-02');
    expect(dateCsv('1988-06-02')).toBe('1988-06-02');
    expect(dateCsv('')).toBeUndefined();
  });

  it('refuse un fichier dont il manque des colonnes, en les nommant', async () => {
    await expect(importerTravailleurs(agent, 'cc-1', 'nom;prenoms\nCamara;Fanta', LE_21_OCTOBRE))
      .rejects.toThrow(/Colonnes manquantes : sexe, date_naissance/);
  });

  it('traite chaque ligne pour elle-meme et rapporte le rang exact du fichier', async () => {
    const contenu = [
      ENTETE,
      'Camara;Fanta;F;02/06/1988;Kindia;Guineenne;carte nationale;GN-1;620100013;Conakry;EMP-1',
      '',
      'Sylla;Ibrahima;X;23/11/1979;Boke;Guineenne;CARTE_NATIONALE;GN-2;620100014;Conakry;EMP-2',
    ].join('\n');
    const r = await importerTravailleurs(agent, 'cc-1', contenu, LE_21_OCTOBRE);

    expect(r).toMatchObject({ crees: 1, rattaches: 0, refuses: 1 });
    expect(r.lignes[0]).toMatchObject({ numero: 2, statut: 'CREE', nom: 'Fanta Camara', motDePasseTemporaire: 'abcd2345' });
    // La ligne vide est sautee sans decaler le rang de la suivante.
    expect(r.lignes[1]).toMatchObject({ numero: 4, statut: 'REFUSE', nom: 'Ibrahima Sylla' });
    expect(r.lignes[1]!.motif).toMatch(/sexe/);
  });

  it('rapporte une erreur metier sur sa ligne sans arreter l import', async () => {
    prisma.adhesionAssurance.findFirst
      .mockResolvedValueOnce({ idPatient: 'p-1' })
      .mockResolvedValueOnce(null);
    const contenu = [
      ENTETE,
      'Camara;Fanta;F;1988-06-02;Kindia;Guineenne;CARTE_NATIONALE;GN-1;620100013;Conakry;EMP-1',
      'Bah;Aissatou;F;1995-01-30;Labe;Guineenne;PASSEPORT;P-9;620100015;Conakry;EMP-3',
    ].join('\n');
    const r = await importerTravailleurs(agent, 'cc-1', contenu, LE_21_OCTOBRE);
    expect(r.lignes.map((l) => l.statut)).toEqual(['REFUSE', 'CREE']);
    expect(r.lignes[0]!.motif).toMatch(/deja adherente/);
  });
});
