// La pharmacie d'un hopital : demandee par son administrateur, validee par
// l'administration de la plateforme.
//
// Ce que ce fichier tient :
//   - seul l'administrateur d'un hopital la demande, et pour son hopital ;
//   - la demande ne cree rien : ni pharmacie, ni compte, ni mot de passe ;
//   - elle n'exige aucune piece - la pharmacie opere sous l'autorisation de
//     son hopital -, et se valide donc sans dossier ;
//   - la validation fait naitre la pharmacie **fille de l'hopital** et son
//     titulaire, qui seul recoit ses identifiants ;
//   - chaque etape, avec son motif, part a l'administrateur qui l'a demandee,
//     et non au pharmacien, qui n'a rien depose.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

jest.mock('../src/config/prisma', () => ({
  prisma: {
    demandeAgrement: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    utilisateur: { findUnique: jest.fn() },
    pieceAgrement: { findMany: jest.fn() },
    assureur: { findUnique: jest.fn() },
    evenementDemandeAgrement: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/services/email.service', () => ({
  envoyerAccuseDemandeAgrement: jest.fn(),
  envoyerRefusDemandeAgrement: jest.fn(),
  envoyerSuiviDemandeAgrement: jest.fn(),
  envoyerSuiviPharmacieHospitaliere: jest.fn(),
  envoyerValidationDemandeAgrement: jest.fn(),
}));

jest.mock('../src/services/admin-structure.service', () => ({
  genererMotDePasseTemp: jest.fn(() => 'MotDePasseTemporaire9'),
}));

jest.mock('../src/utils/password.utils', () => ({
  hashPassword: jest.fn(async (v: string) => `hache:${v}`),
}));

import { prisma } from '../src/config/prisma';
import * as courriels from '../src/services/email.service';
import * as service from '../src/services/demande-agrement.service';
import { ConflictError, ForbiddenError } from '../src/utils/app-error';
import type { JwtPayload } from '../src/types/auth.types';

const bd = prisma as unknown as {
  demandeAgrement: Record<string, jest.Mock>;
  utilisateur: Record<string, jest.Mock>;
  pieceAgrement: Record<string, jest.Mock>;
  evenementDemandeAgrement: Record<string, jest.Mock>;
  $transaction: jest.Mock;
};
const mail = courriels as unknown as Record<string, jest.Mock>;

const ADMIN = { userId: 'admin-chu', role: 'ADMIN_STRUCTURE' } as unknown as JwtPayload;
const AGENT = { userId: 'agent-1', role: 'SUPER_ADMIN' } as unknown as JwtPayload;
const MOTIF = 'Le titulaire est inscrit à l’ordre, la pharmacie peut ouvrir.';
const ANNEE = new Date().getFullYear();

const HOPITAL = { id: 'hopital-1', nom: 'CHU de Donka', type: 'CHU', commune: 'Dixinn', quartier: 'Donka', telephone: '620000300' };

const DTO = {
  nom: '  Pharmacie du CHU ',
  prefecture: 'Conakry',
  pharmacien: { prenom: 'Aminata', nom: 'Diallo', telephone: '620000201', email: 'A.Diallo@Example.gn' },
};

/** L'administrateur, puis les comptes deja pris par telephone ou adresse. */
function comptes(o: { structure?: Record<string, unknown> | null; telPris?: boolean; emailPris?: boolean } = {}) {
  bd.utilisateur.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
    if (where['id'] === ADMIN.userId) {
      return { prenom: 'Awa', nom: 'Camara', email: 'admin.chu@example.gn', structure: o.structure === undefined ? HOPITAL : o.structure };
    }
    if (where['telephone']) return o.telPris ? { id: 'x' } : null;
    if (where['email']) return o.emailPris ? { id: 'y' } : null;
    return null;
  });
}

/** La demande en base, telle que la lisent l'examen et la validation. */
function ligne(o: Record<string, unknown> = {}) {
  return {
    id: 'dem-1', numero: `DA-${ANNEE}-0007`, statut: 'RECUE', type: 'PHARMACIE', nom: 'Pharmacie du CHU',
    prefecture: 'Conakry', commune: 'Dixinn', quartier: 'Donka', adresse: null, telephone: '620000300',
    rccm: null, numeroAgrementCreation: null, numeroAgrementExploitation: null, lieuAutorise: null,
    responsablePrenom: 'Aminata', responsableNom: 'Diallo', responsableTelephone: '620000201', responsableEmail: 'a.diallo@example.gn',
    motifRefus: null, examineLe: null, idStructureCreee: null, codeAssureur: null, modeEchange: null,
    deposeLe: new Date('2026-11-21T09:00:00Z'), examinePar: null, pieces: [], evenements: [],
    idStructureParente: 'hopital-1',
    structureParente: { id: 'hopital-1', nom: 'CHU de Donka', estActive: true },
    deposePar: { prenom: 'Awa', nom: 'Camara', email: 'admin.chu@example.gn' },
    ...o,
  };
}

let tx: Record<string, Record<string, jest.Mock>>;

beforeEach(() => {
  jest.clearAllMocks();
  comptes();
  bd.demandeAgrement.findFirst.mockResolvedValue(null);
  bd.demandeAgrement.create.mockImplementation(async ({ data }: { data: { numero: string } }) => ({
    id: 'dem-1', numero: data.numero, deposeLe: new Date('2026-11-21T09:00:00Z'),
  }));
  bd.demandeAgrement.findUnique.mockResolvedValue(ligne());
  bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(ligne());
  bd.demandeAgrement.update.mockResolvedValue({});
  bd.pieceAgrement.findMany.mockResolvedValue([]);
  tx = {
    structureSante: { create: jest.fn(async () => ({ id: 'pharmacie-1' })) },
    pieceAgrement: { updateMany: jest.fn(async () => ({ count: 0 })) },
    utilisateur: { create: jest.fn(async () => ({ id: 'titulaire-1' })) },
    pharmacienProfile: { create: jest.fn(async () => ({})) },
    demandeAgrement: { update: jest.fn(async () => ({})) },
  };
  bd.$transaction.mockImplementation(async (rappel: (t: typeof tx) => Promise<unknown>) => rappel(tx));
});

describe('demander une pharmacie hospitaliere', () => {
  it('seul l administrateur d un hopital la demande', async () => {
    comptes({ structure: { ...HOPITAL, type: 'CENTRE' } });
    await expect(service.deposerPharmacieHospitaliere(ADMIN, DTO)).rejects.toBeInstanceOf(ForbiddenError);
    comptes({ structure: null });
    await expect(service.deposerPharmacieHospitaliere(ADMIN, DTO)).rejects.toBeInstanceOf(ForbiddenError);
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it('enregistre une demande, rattachee a son hopital, sans rien creer d autre', async () => {
    const r = await service.deposerPharmacieHospitaliere(ADMIN, DTO);

    expect(r).toEqual({ numero: `DA-${ANNEE}-0001`, statut: 'RECUE', deposeLe: '2026-11-21T09:00:00.000Z' });
    const data = bd.demandeAgrement.create.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({
      type: 'PHARMACIE',
      nom: 'Pharmacie du CHU',
      idStructureParente: 'hopital-1',
      idDeposePar: 'admin-chu',
      // Ce que l'administrateur ne precise pas est celui de son hopital.
      commune: 'Dixinn',
      quartier: 'Donka',
      telephone: '620000300',
      responsableEmail: 'a.diallo@example.gn',
    }));
    // Ni piece, ni mot de passe : rien ne se garde avant la decision.
    expect(data).not.toHaveProperty('pieces');
    expect(JSON.stringify(data)).not.toMatch(/motDePasse/i);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('accuse reception a l administrateur, pas au pharmacien', async () => {
    await service.deposerPharmacieHospitaliere(ADMIN, DTO);
    expect(mail['envoyerSuiviPharmacieHospitaliere']).toHaveBeenCalledWith(expect.objectContaining({
      destinataire: 'admin.chu@example.gn', etape: 'RECUE', nomHopital: 'CHU de Donka', nomPharmacie: 'Pharmacie du CHU',
    }));
    expect(mail['envoyerAccuseDemandeAgrement']).not.toHaveBeenCalled();
  });

  it('une seconde demande pour la meme pharmacie, a la casse pres, est refusee', async () => {
    bd.demandeAgrement.findFirst.mockResolvedValueOnce({ numero: `DA-${ANNEE}-0003` });
    await expect(service.deposerPharmacieHospitaliere(ADMIN, { ...DTO, nom: 'PHARMACIE DU CHU' }))
      .rejects.toThrow(/déjà en cours d'examen/);
    expect(bd.demandeAgrement.findFirst.mock.calls[0][0].where).toEqual({
      idStructureParente: 'hopital-1',
      nom: { equals: 'PHARMACIE DU CHU', mode: 'insensitive' },
      statut: { in: ['RECUE', 'EN_ANALYSE'] },
    });
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it('un titulaire dont le telephone ou l adresse sert deja est refuse des le depot', async () => {
    comptes({ telPris: true });
    await expect(service.deposerPharmacieHospitaliere(ADMIN, DTO)).rejects.toBeInstanceOf(ConflictError);
    comptes({ emailPris: true });
    await expect(service.deposerPharmacieHospitaliere(ADMIN, DTO)).rejects.toBeInstanceOf(ConflictError);
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it('l hopital suit ses demandes, avec le dernier motif', async () => {
    bd.demandeAgrement.findMany.mockResolvedValue([{
      id: 'dem-1', numero: `DA-${ANNEE}-0007`, statut: 'EN_ANALYSE', nom: 'Pharmacie du CHU',
      deposeLe: new Date('2026-11-21T09:00:00Z'), examineLe: null,
      responsablePrenom: 'Aminata', responsableNom: 'Diallo',
      evenements: [{ motif: 'Diplôme du titulaire à confirmer.' }],
    }]);
    const liste = await service.listerDemandesPharmacie(ADMIN);
    expect(bd.demandeAgrement.findMany.mock.calls[0][0].where).toEqual({ idStructureParente: 'hopital-1' });
    expect(liste).toEqual([expect.objectContaining({
      statut: 'EN_ANALYSE', titulaire: 'Aminata Diallo', dernierMotif: 'Diplôme du titulaire à confirmer.', examineLe: null,
    })]);
  });
});

describe('l examen par l administration', () => {
  it('le dossier est complet sans piece, et dit son hopital', async () => {
    const d = await service.detail('dem-1');
    expect(d.complet).toBe(true);
    expect(d.manquantes).toEqual([]);
    expect(d.structureParente).toEqual(expect.objectContaining({ id: 'hopital-1', nom: 'CHU de Donka' }));
    expect(d.deposePar).toBe('Awa Camara');
  });

  it('la mise en analyse ecrit le motif a l administrateur, et le note', async () => {
    await service.mettreEnAnalyse(AGENT, 'dem-1', MOTIF);
    expect(mail['envoyerSuiviPharmacieHospitaliere']).toHaveBeenCalledWith(expect.objectContaining({
      destinataire: 'admin.chu@example.gn', etape: 'EN_ANALYSE', motif: MOTIF,
    }));
    expect(mail['envoyerSuiviDemandeAgrement']).not.toHaveBeenCalled();
    expect(bd.evenementDemandeAgrement.update).toHaveBeenCalledWith(expect.objectContaining({ data: { emailEnvoye: true } }));
  });

  it('le refus aussi, et le pharmacien ne recoit rien', async () => {
    await service.refuser(AGENT, 'dem-1', MOTIF);
    expect(mail['envoyerSuiviPharmacieHospitaliere']).toHaveBeenCalledWith(expect.objectContaining({ etape: 'REFUSEE', motif: MOTIF }));
    expect(mail['envoyerRefusDemandeAgrement']).not.toHaveBeenCalled();
  });

  it('un administrateur sans adresse suit a l ecran : aucun courriel n est dit parti', async () => {
    bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(ligne({ deposePar: { prenom: 'Awa', nom: 'Camara', email: null } }));
    await service.mettreEnAnalyse(AGENT, 'dem-1', MOTIF);
    expect(mail['envoyerSuiviPharmacieHospitaliere']).not.toHaveBeenCalled();
    expect(mail['envoyerSuiviDemandeAgrement']).not.toHaveBeenCalled();
    expect(bd.evenementDemandeAgrement.update).not.toHaveBeenCalled();
  });
});

describe('valider la pharmacie', () => {
  it('fait naitre la pharmacie fille de l hopital et son titulaire', async () => {
    await service.valider(AGENT, 'dem-1', MOTIF);

    expect(tx['structureSante']!['create']).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'PHARMACIE', nom: 'Pharmacie du CHU', idStructureParente: 'hopital-1', estPartenaire: true }),
    }));
    expect(tx['utilisateur']!['create']).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'PHARMACIEN', idStructure: 'pharmacie-1', doitChangerMotDePasse: true }),
    }));
    expect(tx['pharmacienProfile']!['create']).toHaveBeenCalledWith({
      data: expect.objectContaining({ idUtilisateur: 'titulaire-1', roleOfficine: 'TITULAIRE', estResponsable: true }),
    });
  });

  it('les identifiants vont au titulaire seul ; l hopital apprend la decision sans eux', async () => {
    await service.valider(AGENT, 'dem-1', MOTIF);

    expect(mail['envoyerValidationDemandeAgrement']).toHaveBeenCalledWith(expect.objectContaining({
      destinataire: 'a.diallo@example.gn', motDePasseTemporaire: 'MotDePasseTemporaire9',
    }));
    const auDemandeur = mail['envoyerSuiviPharmacieHospitaliere']!.mock.calls[0][0];
    expect(auDemandeur).toEqual(expect.objectContaining({ destinataire: 'admin.chu@example.gn', etape: 'VALIDEE', motif: MOTIF }));
    expect(JSON.stringify(auDemandeur)).not.toContain('MotDePasseTemporaire9');
  });

  it('ne s ouvre pas dans un hopital desactive entre-temps', async () => {
    bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(ligne({ structureParente: { id: 'hopital-1', nom: 'CHU de Donka', estActive: false } }));
    await expect(service.valider(AGENT, 'dem-1', MOTIF)).rejects.toThrow(/n'est plus actif/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });
});
