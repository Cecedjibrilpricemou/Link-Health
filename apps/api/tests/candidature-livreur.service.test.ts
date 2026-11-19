// Les candidatures de motards livreurs : ce que le service doit refuser, et
// ce qu'il ne doit jamais laisser derriere lui.
//
// **Trois promesses tiennent tout le reste.** Aucun compte ne nait d'un
// depot - seulement d'une validation. Un dossier refuse ne laisse ni fichier,
// ni ligne, ni numero consomme. Et un mot de passe parti par courriel ne
// ressort pas dans la reponse de l'agent.
//
// La base et le disque sont simules : ce qui est teste, c'est le service.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    candidatureLivreur: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    pieceCandidatureLivreur: { findUnique: jest.fn() },
    utilisateur: { findUnique: jest.fn(), create: jest.fn() },
    livreurProfile: { create: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});

jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Le disque est simule : une suite de tests ne doit pas laisser de cartes
// d'identite dans `stockage-prive/`. Les fonctions synchrones restent vraies,
// d'autres modules en ont besoin au chargement.
jest.mock('fs', () => {
  const vrai = jest.requireActual('fs');
  return {
    ...vrai,
    mkdirSync: jest.fn(),
    promises: { ...vrai.promises, writeFile: jest.fn(), unlink: jest.fn(), readFile: jest.fn() },
  };
});

jest.mock('../src/services/email.service', () => ({
  envoyerAccuseCandidatureLivreur: jest.fn(),
  envoyerIdentifiantsLivreur: jest.fn(),
  envoyerRefusCandidatureLivreur: jest.fn(),
}));

jest.mock('../src/services/admin-structure.service', () => ({
  genererMotDePasseTemp: jest.fn(() => 'MotDePasseTemporaire9'),
}));

jest.mock('../src/utils/password.utils', () => ({
  hashPassword: jest.fn(async (v: string) => `hache:${v}`),
}));

import { promises as fs } from 'fs';
import { prisma } from '../src/config/prisma';
import * as courriels from '../src/services/email.service';
import * as service from '../src/services/candidature-livreur.service';
import { typeMimeReel } from '../src/middlewares/upload.middleware';
import type { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError, ValidationError } from '../src/utils/app-error';

type M = jest.Mock;
const bd = prisma as unknown as {
  candidatureLivreur: Record<string, M>;
  pieceCandidatureLivreur: Record<string, M>;
  utilisateur: Record<string, M>;
  livreurProfile: Record<string, M>;
  $transaction: M;
};
const disque = fs as unknown as { writeFile: M; unlink: M; readFile: M };
const mails = courriels as unknown as Record<string, M>;

const AGENT = { userId: 'agent-1', role: 'ADMIN_REGIONAL' } as unknown as JwtPayload;
const PATIENT = { userId: 'patient-1', role: 'PATIENT' } as unknown as JwtPayload;

const PDF = Buffer.from('%PDF-1.4 contenu');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

/** Les six pieces, en photos et en PDF melanges, comme un vrai motard. */
function sixPieces() {
  return [
    { fieldname: 'CNI_RECTO', buffer: JPEG },
    { fieldname: 'CNI_VERSO', buffer: JPEG },
    { fieldname: 'PERMIS_CONDUIRE', buffer: PNG },
    { fieldname: 'CARTE_GRISE', buffer: PDF },
    { fieldname: 'ASSURANCE', buffer: PDF },
    { fieldname: 'CERTIFICAT_RESIDENCE', buffer: PDF },
  ];
}

const CANDIDAT: service.CandidatRecu = {
  prenom: ' Mamadou ',
  nom: 'Diallo',
  dateNaissance: '1995-04-12',
  sexe: 'M',
  telephone: '620100099',
  prefecture: 'Conakry',
  commune: 'Dixinn',
  quartier: 'Donka',
};

/** Un dossier tel que la base le rendrait, pour l'examen. */
function dossier(sur: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    numero: 'DL-2026-0001',
    statut: 'RECUE',
    deposeParAdministration: false,
    prenom: 'Mamadou',
    nom: 'Diallo',
    dateNaissance: new Date('1995-04-12T00:00:00Z'),
    sexe: 'M',
    telephone: '620100099',
    email: null,
    prefecture: 'Conakry',
    commune: 'Dixinn',
    quartier: 'Donka',
    motifRefus: null,
    examineLe: null,
    idLivreurCree: null,
    deposeLe: new Date('2026-11-20T08:00:00Z'),
    examinePar: null,
    pieces: service.PIECES_LIVREUR.map((type, i) => ({
      id: `piece-${i}`,
      type,
      typeMime: 'application/pdf',
      taille: 1000,
      deposeLe: new Date('2026-11-20T08:00:00Z'),
    })),
    ...sur,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  bd.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  bd.candidatureLivreur['findFirst']!.mockResolvedValue(null);
  bd.candidatureLivreur['create']!.mockResolvedValue({
    id: 'cand-1', numero: 'DL-2026-0001', deposeLe: new Date('2026-11-20T08:00:00Z'),
  });
  bd.candidatureLivreur['findUnique']!.mockResolvedValue(dossier());
  bd.candidatureLivreur['findUniqueOrThrow']!.mockResolvedValue(dossier());
  bd.candidatureLivreur['updateMany']!.mockResolvedValue({ count: 1 });
  bd.utilisateur['findUnique']!.mockResolvedValue(null);
  bd.utilisateur['create']!.mockResolvedValue({ id: 'livreur-1' });
  bd.livreurProfile['create']!.mockResolvedValue({});
  disque.writeFile.mockResolvedValue(undefined);
  disque.unlink.mockResolvedValue(undefined);
  mails['envoyerIdentifiantsLivreur']!.mockResolvedValue(undefined);
});

// ── Le format des pieces ────────────────────────────────────────

describe('typeMimeReel', () => {
  it('reconnait une photo et un PDF a leurs octets', () => {
    expect(typeMimeReel(JPEG)).toBe('image/jpeg');
    expect(typeMimeReel(PNG)).toBe('image/png');
    expect(typeMimeReel(PDF)).toBe('application/pdf');
  });

  // Un HTML renomme en .jpg, servi sous son type declare depuis notre
  // domaine, serait une page executee chez l'agent qui l'ouvre.
  it('ne reconnait rien dans une page HTML deguisee', () => {
    expect(typeMimeReel(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });
});

// ── Le depot public ─────────────────────────────────────────────

describe('deposer', () => {
  it('enregistre le dossier recu, avec le type lu dans les octets, sans creer de compte', async () => {
    const recu = await service.deposer(CANDIDAT, sixPieces());

    expect(recu).toEqual({ numero: 'DL-2026-0001', statut: 'RECUE', deposeLe: '2026-11-20T08:00:00.000Z' });
    const donnees = bd.candidatureLivreur['create']!.mock.calls[0][0].data;
    expect(donnees.prenom).toBe('Mamadou');
    expect(donnees.pieces.create).toHaveLength(6);
    expect(donnees.pieces.create.find((p: { type: string }) => p.type === 'CNI_RECTO').typeMime).toBe('image/jpeg');
    expect(donnees.pieces.create.find((p: { type: string }) => p.type === 'CNI_RECTO').fichier).toMatch(/\.jpg$/);
    // Le compte nait de la validation, jamais du depot.
    expect(bd.utilisateur['create']).not.toHaveBeenCalled();
    expect(bd.livreurProfile['create']).not.toHaveBeenCalled();
  });

  it('refuse un dossier incomplet en nommant la piece, sans rien ecrire', async () => {
    const cinq = sixPieces().filter((p) => p.fieldname !== 'PERMIS_CONDUIRE');

    await expect(service.deposer(CANDIDAT, cinq)).rejects.toThrow(/le permis de conduire/);
    expect(disque.writeFile).not.toHaveBeenCalled();
    expect(bd.candidatureLivreur['create']).not.toHaveBeenCalled();
  });

  it('refuse un fichier qui n est ni une photo ni un PDF, quelle que soit son extension', async () => {
    const pieces = sixPieces();
    pieces[0] = { fieldname: 'CNI_RECTO', buffer: Buffer.from('<html>faux</html>') };

    await expect(service.deposer(CANDIDAT, pieces)).rejects.toBeInstanceOf(ValidationError);
    expect(disque.writeFile).not.toHaveBeenCalled();
  });

  it('refuse un nom de champ qui ne nomme pas une piece', async () => {
    const pieces = [...sixPieces(), { fieldname: '../../etc/passwd', buffer: PDF }];

    await expect(service.deposer(CANDIDAT, pieces)).rejects.toThrow(/Pièce inconnue/);
  });

  it('refuse une piece envoyee deux fois', async () => {
    const pieces = [...sixPieces(), { fieldname: 'CARTE_GRISE', buffer: PDF }];

    await expect(service.deposer(CANDIDAT, pieces)).rejects.toThrow(/deux fois/);
  });

  it('refuse un mineur', async () => {
    const hier17ans = new Date();
    hier17ans.setUTCFullYear(hier17ans.getUTCFullYear() - 17);
    const date = hier17ans.toISOString().slice(0, 10);

    await expect(service.deposer({ ...CANDIDAT, dateNaissance: date }, sixPieces()))
      .rejects.toThrow(/au moins 18 ans/);
    expect(disque.writeFile).not.toHaveBeenCalled();
  });

  // `new Date('2001-02-30')` donne le 2 mars sans broncher : sans relecture,
  // une date impossible passait pour une autre.
  it('refuse une date qui n existe pas', async () => {
    await expect(service.deposer({ ...CANDIDAT, dateNaissance: '2001-02-30' }, sixPieces()))
      .rejects.toThrow(/invalide/);
  });

  it('refuse un second dossier pour un telephone dont le premier est en examen', async () => {
    bd.candidatureLivreur['findFirst']!.mockResolvedValue({ numero: 'DL-2026-0007' });

    await expect(service.deposer(CANDIDAT, sixPieces())).rejects.toThrow(/DL-2026-0007/);
    expect(disque.writeFile).not.toHaveBeenCalled();
  });

  it('refuse un telephone deja porte par un compte', async () => {
    bd.utilisateur['findUnique']!.mockResolvedValue({ id: 'quelqu-un' });

    await expect(service.deposer(CANDIDAT, sixPieces())).rejects.toBeInstanceOf(ConflictError);
    expect(disque.writeFile).not.toHaveBeenCalled();
  });

  it('efface les fichiers ecrits si la base refuse le dossier', async () => {
    bd.candidatureLivreur['create']!.mockRejectedValue(new Error('base indisponible'));

    await expect(service.deposer(CANDIDAT, sixPieces())).rejects.toThrow('base indisponible');
    expect(disque.writeFile).toHaveBeenCalledTimes(6);
    expect(disque.unlink).toHaveBeenCalledTimes(6);
  });

  it('reprend avec le numero suivant quand deux depots visent le meme', async () => {
    bd.candidatureLivreur['findFirst']!
      .mockResolvedValueOnce(null) // pas de dossier en cours
      .mockResolvedValueOnce({ numero: 'DL-2026-0004' })
      .mockResolvedValueOnce({ numero: 'DL-2026-0005' });
    bd.candidatureLivreur['create']!
      .mockRejectedValueOnce(Object.assign(new Error('doublon'), { code: 'P2002', meta: { target: ['numero'] } }))
      .mockResolvedValueOnce({ numero: 'DL-2026-0006', deposeLe: new Date() });

    const recu = await service.deposer(CANDIDAT, sixPieces());

    expect(recu.numero).toBe('DL-2026-0006');
    expect(disque.unlink).not.toHaveBeenCalled();
  });

  it('garde le dossier quand l accuse de reception ne part pas', async () => {
    mails['envoyerAccuseCandidatureLivreur']!.mockRejectedValue(new Error('pas d expediteur'));

    const recu = await service.deposer({ ...CANDIDAT, email: 'motard@exemple.gn' }, sixPieces());

    expect(recu.numero).toBe('DL-2026-0001');
    expect(disque.unlink).not.toHaveBeenCalled();
  });
});

// ── L'examen ────────────────────────────────────────────────────

describe('valider', () => {
  it('cree le compte livreur et son profil, et marque le dossier valide, dans une transaction', async () => {
    await service.valider(AGENT, 'cand-1');

    expect(bd.$transaction).toHaveBeenCalledTimes(1);
    expect(bd.utilisateur['create']).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: 'LIVREUR',
        telephone: '620100099',
        doitChangerMotDePasse: true,
        motDePasseHash: 'hache:MotDePasseTemporaire9',
      }),
    }));
    expect(bd.livreurProfile['create']).toHaveBeenCalledWith({
      data: { idUtilisateur: 'livreur-1', quartier: 'Donka', prefecture: 'Conakry', commune: 'Dixinn' },
    });
    expect(bd.candidatureLivreur['updateMany']).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: 'VALIDEE', idLivreurCree: 'livreur-1', idExaminePar: 'agent-1' }),
    }));
  });

  it('ne renvoie pas le mot de passe quand il est parti par courriel', async () => {
    bd.candidatureLivreur['findUniqueOrThrow']!.mockResolvedValue(dossier({ email: 'motard@exemple.gn' }));

    const r = await service.valider(AGENT, 'cand-1');

    expect(mails['envoyerIdentifiantsLivreur']).toHaveBeenCalledWith(expect.objectContaining({
      destinataire: 'motard@exemple.gn',
      motDePasseTemporaire: 'MotDePasseTemporaire9',
    }));
    expect(r.motDePasseTemporaire).toBeNull();
  });

  // Sans repli, un motard sans email n'apprendrait jamais son mot de passe :
  // les SMS ne partent pas encore.
  it('renvoie le mot de passe a l agent quand le livreur n a pas d email', async () => {
    const r = await service.valider(AGENT, 'cand-1');

    expect(mails['envoyerIdentifiantsLivreur']).not.toHaveBeenCalled();
    expect(r.motDePasseTemporaire).toBe('MotDePasseTemporaire9');
  });

  it('renvoie le mot de passe a l agent quand le courriel echoue', async () => {
    bd.candidatureLivreur['findUniqueOrThrow']!.mockResolvedValue(dossier({ email: 'motard@exemple.gn' }));
    mails['envoyerIdentifiantsLivreur']!.mockRejectedValue(new Error('pas d expediteur'));

    const r = await service.valider(AGENT, 'cand-1');

    expect(r.motDePasseTemporaire).toBe('MotDePasseTemporaire9');
  });

  it('ne revient pas sur un dossier deja decide', async () => {
    bd.candidatureLivreur['findUnique']!.mockResolvedValue(dossier({ statut: 'REFUSEE' }));

    await expect(service.valider(AGENT, 'cand-1')).rejects.toThrow(/déjà été refusé/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('refuse si le telephone a ete pris depuis le depot', async () => {
    bd.utilisateur['findUnique']!.mockResolvedValue({ id: 'arrive-entre-temps' });

    await expect(service.valider(AGENT, 'cand-1')).rejects.toThrow(/ne peut pas être validée/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  // Deux agents ouvrent le meme dossier : le second ne doit pas creer un
  // second compte par-dessus la decision du premier.
  it('annule tout si un autre agent a decide entre-temps', async () => {
    bd.candidatureLivreur['updateMany']!.mockResolvedValue({ count: 0 });

    await expect(service.valider(AGENT, 'cand-1')).rejects.toThrow(/autre agent/);
    expect(mails['envoyerIdentifiantsLivreur']).not.toHaveBeenCalled();
  });

  it('refuse un dossier devenu incomplet', async () => {
    const d = dossier();
    bd.candidatureLivreur['findUniqueOrThrow']!.mockResolvedValue({ ...d, pieces: d.pieces.slice(1) });

    await expect(service.valider(AGENT, 'cand-1')).rejects.toThrow(/recto/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });
});

describe('refuser', () => {
  it('exige un motif explicite', async () => {
    await expect(service.refuser(AGENT, 'cand-1', 'non')).rejects.toBeInstanceOf(ValidationError);
    expect(bd.candidatureLivreur['updateMany']).not.toHaveBeenCalled();
  });

  it('enregistre le refus et previent le candidat qui a un email', async () => {
    bd.candidatureLivreur['findUniqueOrThrow']!.mockResolvedValue(dossier({ email: 'motard@exemple.gn' }));

    await service.refuser(AGENT, 'cand-1', 'Le permis de conduire est illisible.');

    expect(bd.candidatureLivreur['updateMany']).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: 'REFUSEE', motifRefus: 'Le permis de conduire est illisible.' }),
    }));
    expect(mails['envoyerRefusCandidatureLivreur']).toHaveBeenCalledWith(expect.objectContaining({
      motif: 'Le permis de conduire est illisible.',
    }));
  });

  it('n ecrase pas la decision d un autre agent', async () => {
    bd.candidatureLivreur['updateMany']!.mockResolvedValue({ count: 0 });

    await expect(service.refuser(AGENT, 'cand-1', 'Le permis de conduire est illisible.'))
      .rejects.toThrow(/autre agent/);
    expect(mails['envoyerRefusCandidatureLivreur']).not.toHaveBeenCalled();
  });

  it('ne refuse pas un dossier deja valide', async () => {
    bd.candidatureLivreur['findUnique']!.mockResolvedValue(dossier({ statut: 'VALIDEE' }));

    await expect(service.refuser(AGENT, 'cand-1', 'Le permis de conduire est illisible.'))
      .rejects.toThrow(/déjà été validé/);
  });
});

describe('droits', () => {
  it('ferme l examen a qui ne recrute pas', async () => {
    await expect(service.lister(PATIENT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.detail(PATIENT, 'cand-1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.valider(PATIENT, 'cand-1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.lirePiece(PATIENT, 'piece-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(disque.readFile).not.toHaveBeenCalled();
  });

  it('rend une piece sous le type lu au depot, jamais un autre', async () => {
    bd.pieceCandidatureLivreur['findUnique']!.mockResolvedValue({
      fichier: 'abc.jpg', type: 'CNI_RECTO', typeMime: 'image/jpeg',
    });
    disque.readFile.mockResolvedValue(JPEG);

    const piece = await service.lirePiece(AGENT, 'piece-1');

    expect(piece.typeMime).toBe('image/jpeg');
  });

  it('ne lit jamais hors du dossier prive', () => {
    expect(() => service.cheminPieceLivreur('../../.env')).toThrow();
  });
});

// ── La creation directe par l'administration ────────────────────

describe('creerAvecDossier', () => {
  it('cree le compte, le profil et un dossier deja valide, dans une transaction', async () => {
    const r = await service.creerAvecDossier(AGENT, CANDIDAT, sixPieces());

    expect(bd.$transaction).toHaveBeenCalledTimes(1);
    expect(bd.candidatureLivreur['create']).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        statut: 'VALIDEE',
        deposeParAdministration: true,
        idLivreurCree: 'livreur-1',
        idExaminePar: 'agent-1',
      }),
    }));
    expect(r.idUtilisateur).toBe('livreur-1');
    expect(r.motDePasseTemporaire).toBe('MotDePasseTemporaire9');
  });

  // La porte de l'administration ne doit jamais exiger moins que celle du
  // motard : on passerait par celle qui demande le moins.
  it('exige les six pieces, comme le depot public', async () => {
    await expect(service.creerAvecDossier(AGENT, CANDIDAT, sixPieces().slice(0, 5)))
      .rejects.toBeInstanceOf(ValidationError);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('enregistre une commune vide comme absente', async () => {
    await service.creerAvecDossier(AGENT, { ...CANDIDAT, commune: '   ' }, sixPieces());

    expect(bd.livreurProfile['create']).toHaveBeenCalledWith({
      data: expect.objectContaining({ commune: null }),
    });
  });

  it('efface les fichiers si la creation du compte echoue', async () => {
    bd.livreurProfile['create']!.mockRejectedValue(new Error('echec profil'));

    await expect(service.creerAvecDossier(AGENT, CANDIDAT, sixPieces())).rejects.toThrow('echec profil');
    expect(disque.unlink).toHaveBeenCalledTimes(6);
  });

  it('refuse un telephone deja utilise avant d ecrire quoi que ce soit', async () => {
    bd.utilisateur['findUnique']!.mockResolvedValue({ id: 'existant' });

    await expect(service.creerAvecDossier(AGENT, CANDIDAT, sixPieces())).rejects.toBeInstanceOf(ConflictError);
    expect(disque.writeFile).not.toHaveBeenCalled();
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('refuse un role qui ne recrute pas', async () => {
    await expect(service.creerAvecDossier(PATIENT, CANDIDAT, sixPieces())).rejects.toBeInstanceOf(ForbiddenError);
    expect(disque.writeFile).not.toHaveBeenCalled();
  });
});
