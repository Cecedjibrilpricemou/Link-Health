// Les demandes d'agrement : ce que le service doit refuser, et dans quel
// ordre.
//
// **Ce qui est verifie ici tient a une chose : un dossier refuse ne doit rien
// laisser derriere lui.** Ni fichier sur le disque, ni ligne en base, ni
// numero de dossier consomme. Le reste - les libelles, le motif obligatoire,
// le mot de passe qui ne sort jamais dans une reponse - sont des promesses
// faites au candidat et a l'agent, et une promesse non testee se perd au
// premier remaniement.
//
// La base est simulee : les tests de ce projet n'en ouvrent aucune. Ce qui est
// teste, c'est le comportement du service, pas celui de PostgreSQL.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

import { TypePieceAgrement } from '../src/config/generated/client/client';

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
    utilisateur: { findUnique: jest.fn(), create: jest.fn() },
    pieceAgrement: { findMany: jest.fn(), updateMany: jest.fn() },
    structureSante: { create: jest.fn() },
    assureur: { findUnique: jest.fn() },
    evenementDemandeAgrement: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// L'ecriture reelle des pieces irait dans `stockage-prive/agrements/` : une
// suite de tests ne doit pas laisser de PDF sur le disque. Tout le reste du
// module - `validerPieces`, `validerIdentifiants` - reste le vrai code, car
// c'est precisement ce qu'on veut eprouver.
jest.mock('../src/services/piece-agrement.service', () => {
  const vrai = jest.requireActual('../src/services/piece-agrement.service');
  return {
    ...vrai,
    ecrireFichiers: jest.fn(),
    supprimerFichiers: jest.fn(),
  };
});

jest.mock('../src/services/email.service', () => ({
  envoyerAccuseDemandeAgrement: jest.fn(),
  envoyerEmailAdminStructure: jest.fn(),
  envoyerRefusDemandeAgrement: jest.fn(),
  envoyerSuiviDemandeAgrement: jest.fn(),
  envoyerValidationDemandeAgrement: jest.fn(),
}));

jest.mock('../src/services/admin-structure.service', () => ({
  genererMotDePasseTemp: jest.fn(() => 'MotDePasseTemporaire9'),
}));

jest.mock('../src/utils/password.utils', () => ({
  hashPassword: jest.fn(async (v: string) => `hache:${v}`),
}));

import { prisma } from '../src/config/prisma';
import * as pieces from '../src/services/piece-agrement.service';
import * as courriels from '../src/services/email.service';
import * as service from '../src/services/demande-agrement.service';
import type { JwtPayload } from '../src/types/auth.types';

const bd = prisma as unknown as {
  demandeAgrement: Record<string, jest.Mock>;
  utilisateur: Record<string, jest.Mock>;
  pieceAgrement: Record<string, jest.Mock>;
  structureSante: Record<string, jest.Mock>;
  assureur: Record<string, jest.Mock>;
  evenementDemandeAgrement: Record<string, jest.Mock>;
  $transaction: jest.Mock;
};

/** Un motif assez explicite pour passer : chaque action en exige un. */
const MOTIF = 'Les pièces sont lisibles et les références concordent.';

const AGENT: JwtPayload = {
  userId: 'agent-1',
  role: 'SUPER_ADMIN',
} as unknown as JwtPayload;

/** Un PDF credible : `estPdf` lit les octets, pas l'extension. */
function pdf(nom: TypePieceAgrement) {
  return { fieldname: nom, originalname: `${nom}.pdf`, buffer: Buffer.from('%PDF-1.4 contenu') };
}

const QUATRE_PIECES = [
  pdf(TypePieceAgrement.AGREMENT_CREATION),
  pdf(TypePieceAgrement.AGREMENT_EXPLOITATION),
  pdf(TypePieceAgrement.DIPLOME_RESPONSABLE),
  pdf(TypePieceAgrement.INSCRIPTION_ORDRE),
];

const TROIS_PIECES = [
  pdf(TypePieceAgrement.AGREMENT_CREATION),
  pdf(TypePieceAgrement.DIPLOME_RESPONSABLE),
  pdf(TypePieceAgrement.INSCRIPTION_ORDRE),
];

function officine(surcharge: Record<string, unknown> = {}) {
  return {
    type: 'PHARMACIE',
    nom: 'Pharmacie du Marché',
    prefecture: 'Conakry',
    commune: 'Matam',
    quartier: 'Madina',
    adresse: 'Avenue de la République',
    telephone: '620000101',
    rccm: 'GN.TCC.2026.A.041',
    numeroAgrementCreation: 'ARR/2026/041',
    numeroAgrementExploitation: 'ARR/2026/141',
    lieuAutorise: 'Madina, Matam',
    responsable: {
      prenom: 'Mamadou',
      nom: 'Barry',
      telephone: '620000102',
      email: 'm.barry@example.gn',
    },
    ...surcharge,
  } as Parameters<typeof service.deposer>[0];
}

/** Une compagnie d'assurance : sa reference BCRG, son code, ses quatre pieces. */
function compagnie(surcharge: Record<string, unknown> = {}) {
  return officine({
    type: 'ASSURANCE',
    nom: 'Sunu Assurances',
    numeroAgrementCreation: 'D/2009/CAM/LOA/07',
    numeroAgrementExploitation: undefined,
    lieuAutorise: 'Kaloum',
    codeAssureur: 'sunu',
    modeEchange: 'PORTAIL',
    ...surcharge,
  });
}

const PIECES_ASSURANCE = [
  pdf(TypePieceAgrement.AGREMENT_ASSURANCE),
  pdf(TypePieceAgrement.EXTRAIT_RCCM),
  pdf(TypePieceAgrement.STATUTS_SOCIETE),
  pdf(TypePieceAgrement.PIECE_IDENTITE_RESPONSABLE),
  pdf(TypePieceAgrement.PASSEPORT_RESPONSABLE),
  pdf(TypePieceAgrement.CERTIFICAT_RESIDENCE_RESPONSABLE),
  pdf(TypePieceAgrement.CASIER_JUDICIAIRE_RESPONSABLE),
  pdf(TypePieceAgrement.MANDAT_RESPONSABLE),
  // La photo du responsable : une image, pas un PDF.
  { fieldname: TypePieceAgrement.PHOTO_RESPONSABLE, originalname: 'photo.jpg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
];

function hopital(surcharge: Record<string, unknown> = {}) {
  return officine({
    type: 'CHU',
    nom: 'CHU de Donka',
    rccm: undefined,
    numeroAgrementExploitation: undefined,
    numeroAgrementCreation: 'DECRET/2026/012',
    ...surcharge,
  });
}

const ANNEE = new Date().getFullYear();

/** Les demandes que la base est censee contenir pour le test en cours. */
type LigneDemande = { numero: string; telephone: string; statut: string; codeAssureur?: string };
let dejaEnBase: LigneDemande[] = [];

/**
 * Un `findFirst` qui **filtre vraiment**.
 *
 * Il repondait d'abord « oui » des que la requete portait un telephone, et un
 * sabotage l'a montre : en vidant la liste des statuts recherches - donc en
 * cessant de voir les demandes en cours -, le service continuait de passer
 * tous les tests. Un double substitut qui ignore le `where` ne teste pas la
 * requete, il teste la question qu'on lui a posee.
 */
function findFirstFidele(args: {
  where?: {
    numero?: { startsWith?: string };
    telephone?: string;
    codeAssureur?: string;
    statut?: { in?: string[] };
  };
}) {
  const ou = args?.where ?? {};
  let lignes = [...dejaEnBase];
  if (ou.numero?.startsWith) {
    const debut = ou.numero.startsWith;
    lignes = lignes
      .filter((l) => l.numero.startsWith(debut))
      .sort((a, b) => (a.numero < b.numero ? 1 : -1));
  }
  if (ou.telephone) lignes = lignes.filter((l) => l.telephone === ou.telephone);
  if (ou.codeAssureur) lignes = lignes.filter((l) => l.codeAssureur === ou.codeAssureur);
  if (ou.statut?.in) lignes = lignes.filter((l) => ou.statut!.in!.includes(l.statut));
  return Promise.resolve(lignes[0] ?? null);
}

beforeEach(() => {
  jest.clearAllMocks();

  // Rien en base : aucune demande en cours, aucun numero deja pris, aucun
  // compte sur les coordonnees du responsable.
  dejaEnBase = [];
  bd.demandeAgrement.findFirst.mockImplementation(findFirstFidele);
  bd.utilisateur.findUnique.mockResolvedValue(null);
  bd.assureur.findUnique.mockResolvedValue(null);
  bd.evenementDemandeAgrement.update.mockResolvedValue({});

  (pieces.ecrireFichiers as jest.Mock).mockImplementation(async (validees: { type: TypePieceAgrement; contenu: Buffer; libelle: string | null }[]) =>
    validees.map((p, i) => ({
      type: p.type,
      fichier: `fichier-${i}.pdf`,
      taille: p.contenu.length,
      libelle: p.libelle,
    })),
  );
  (pieces.supprimerFichiers as jest.Mock).mockResolvedValue(undefined);

  bd.demandeAgrement.create.mockImplementation(async (args: { data: { numero: string } }) => ({
    id: 'demande-1',
    numero: args.data.numero,
    deposeLe: new Date('2026-11-18T10:00:00.000Z'),
  }));
});

// ── Ce que chaque type doit produire ─────────────────────────────

describe('les types et leurs pieces', () => {
  // Depuis le 2026-11-20, une compagnie d'assurance depose sa demande en
  // ligne comme un etablissement de sante.
  it("n'accepte pas les types qui ne se demandent pas ici, et accepte l'assurance", () => {
    expect(service.TYPES_DEMANDE).toContain('ASSURANCE');
    expect(service.TYPES_DEMANDE).not.toContain('POSTE');
    expect(service.TYPES_DEMANDE).not.toContain('CENTRE');
    expect(service.TYPES_DEMANDE).toHaveLength(7);
  });

  it('reconnait les trois hopitaux publics, et eux seuls', () => {
    expect(service.estHopitalPublic('HOPITAL_PREF')).toBe(true);
    expect(service.estHopitalPublic('HOPITAL_REG')).toBe(true);
    expect(service.estHopitalPublic('CHU')).toBe(true);
    expect(service.estHopitalPublic('PHARMACIE')).toBe(false);
    expect(service.estHopitalPublic('CLINIQUE')).toBe(false);
    expect(service.estHopitalPublic('LABORATOIRE')).toBe(false);
  });

  it('exige quatre pieces du prive, toutes obligatoires', () => {
    for (const type of ['PHARMACIE', 'CLINIQUE', 'LABORATOIRE']) {
      expect(service.piecesDemandeesPour(type)).toEqual([
        TypePieceAgrement.AGREMENT_CREATION,
        TypePieceAgrement.AGREMENT_EXPLOITATION,
        TypePieceAgrement.DIPLOME_RESPONSABLE,
        TypePieceAgrement.INSCRIPTION_ORDRE,
      ]);
    }
  });

  it("n'exige pas d'arrete d'exploitation d'un hopital public, mais exige les trois autres", () => {
    for (const type of ['HOPITAL_PREF', 'HOPITAL_REG', 'CHU']) {
      const attendues = service.piecesDemandeesPour(type);
      expect(attendues).not.toContain(TypePieceAgrement.AGREMENT_EXPLOITATION);
      expect(attendues).toContain(TypePieceAgrement.AGREMENT_CREATION);
      expect(attendues).toContain(TypePieceAgrement.DIPLOME_RESPONSABLE);
      expect(attendues).toContain(TypePieceAgrement.INSCRIPTION_ORDRE);
      expect(attendues).toHaveLength(3);
    }
  });

  /**
   * La table des pieces est **partagee** avec la creation administrative
   * depuis le 2026-11-18 : un poste de sante y figure, avec ses deux pieces.
   * Ce qui l'exclut d'une demande n'est donc pas la table, c'est la liste des
   * types demandables — et c'est elle qu'il faut eprouver.
   */
  it("ne se laisse pas demander un type reserve a l'administration", () => {
    expect(service.piecesDemandeesPour('POSTE').length).toBeGreaterThan(0);
    expect(service.TYPES_DEMANDE).not.toContain('POSTE');
    expect(service.TYPES_DEMANDE).not.toContain('CENTRE');
  });

  it("appelle la meme piece « acte de creation » pour un CHU et « agrement de creation » pour une officine", () => {
    expect(service.libellePiece('CHU', TypePieceAgrement.AGREMENT_CREATION)).toContain('acte de création');
    expect(service.libellePiece('HOPITAL_PREF', TypePieceAgrement.AGREMENT_CREATION)).toContain('acte de création');
    expect(service.libellePiece('PHARMACIE', TypePieceAgrement.AGREMENT_CREATION)).toContain('agrément de création');
  });
});

// ── Le depot ─────────────────────────────────────────────────────

describe('deposer', () => {
  it('enregistre un dossier complet et rend le premier numero de l annee', async () => {
    const resultat = await service.deposer(officine(), QUATRE_PIECES);

    expect(resultat.numero).toBe(`DA-${ANNEE}-0001`);
    expect(resultat.statut).toBe('RECUE');
    expect(bd.demandeAgrement.create).toHaveBeenCalledTimes(1);
  });

  it('prend la suite du dernier numero de l annee', async () => {
    dejaEnBase = [{ numero: `DA-${ANNEE}-0041`, telephone: '620000999', statut: 'VALIDEE' }];

    const resultat = await service.deposer(officine(), QUATRE_PIECES);
    expect(resultat.numero).toBe(`DA-${ANNEE}-0042`);
  });

  it('recommence quand deux depots simultanes visent le meme numero', async () => {
    let appels = 0;
    bd.demandeAgrement.create.mockImplementation(async (args: { data: { numero: string } }) => {
      appels += 1;
      if (appels === 1) throw Object.assign(new Error('doublon'), { code: 'P2002' });
      return { id: 'demande-1', numero: args.data.numero, deposeLe: new Date() };
    });

    const resultat = await service.deposer(officine(), QUATRE_PIECES);
    expect(appels).toBe(2);
    expect(resultat.numero).toBe(`DA-${ANNEE}-0001`);
  });

  it('refuse un type qui ne se demande pas ici', async () => {
    await expect(service.deposer(officine({ type: 'POSTE' }), QUATRE_PIECES)).rejects.toThrow(
      /ne se demande pas ici/,
    );
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it('accepte un hopital public avec ses trois pieces', async () => {
    const resultat = await service.deposer(hopital(), TROIS_PIECES);
    expect(resultat.numero).toBe(`DA-${ANNEE}-0001`);
  });

  it("refuse un hopital public sans la reference de son acte de creation", async () => {
    await expect(
      service.deposer(hopital({ numeroAgrementCreation: undefined }), TROIS_PIECES),
    ).rejects.toThrow(/acte de création/);
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it("n'enregistre jamais de RCCM ni d'arrete d'exploitation pour un hopital public", async () => {
    await service.deposer(
      hopital({ rccm: 'GN.TCC.2026.A.999', numeroAgrementExploitation: 'ARR/2026/999' }),
      TROIS_PIECES,
    );

    const donnees = bd.demandeAgrement.create.mock.calls[0]![0].data;
    expect(donnees.rccm).toBeNull();
    expect(donnees.numeroAgrementExploitation).toBeNull();
    expect(donnees.numeroAgrementCreation).toBe('DECRET/2026/012');
  });

  it('refuse une officine a qui il manque une piece, en la nommant', async () => {
    const incomplet = QUATRE_PIECES.slice(0, 3);
    await expect(service.deposer(officine(), incomplet)).rejects.toThrow(
      /inscription à l'ordre professionnel/,
    );
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it("nomme « acte de creation » la piece manquante d'un hopital public", async () => {
    const sansActe = [
      pdf(TypePieceAgrement.DIPLOME_RESPONSABLE),
      pdf(TypePieceAgrement.INSCRIPTION_ORDRE),
    ];
    await expect(service.deposer(hopital(), sansActe)).rejects.toThrow(/acte de création/);
  });

  it('refuse un second dossier tant que le premier est en cours', async () => {
    dejaEnBase = [{ numero: `DA-${ANNEE}-0007`, telephone: '620000101', statut: 'RECUE' }];

    await expect(service.deposer(officine(), QUATRE_PIECES)).rejects.toThrow(
      new RegExp(`DA-${ANNEE}-0007`),
    );
  });

  it("refuse aussi pendant l'analyse du premier dossier", async () => {
    dejaEnBase = [{ numero: `DA-${ANNEE}-0008`, telephone: '620000101', statut: 'EN_ANALYSE' }];

    await expect(service.deposer(officine(), QUATRE_PIECES)).rejects.toThrow(/en cours d'examen/);
  });

  /**
   * L'autre sens du meme filtre, et il compte autant : un etablissement
   * refuse doit pouvoir redeposer une fois son dossier corrige. Sans ce
   * test, un filtre trop large - toutes les demandes au lieu des seules
   * demandes en cours - passerait inapercu et condamnerait un candidat a son
   * premier refus.
   */
  it('laisse redeposer apres un refus ou une validation', async () => {
    dejaEnBase = [
      { numero: `DA-${ANNEE}-0005`, telephone: '620000101', statut: 'REFUSEE' },
      { numero: `DA-${ANNEE}-0006`, telephone: '620000101', statut: 'VALIDEE' },
    ];

    const resultat = await service.deposer(officine(), QUATRE_PIECES);
    expect(resultat.numero).toBe(`DA-${ANNEE}-0007`);
  });

  it('refuse un responsable dont le telephone sert deja a un compte', async () => {
    bd.utilisateur.findUnique.mockImplementation(async (args: { where: { telephone?: string } }) =>
      args.where.telephone ? { id: 'autre' } : null,
    );

    await expect(service.deposer(officine(), QUATRE_PIECES)).rejects.toThrow(/téléphone du responsable/);
  });

  it('refuse un responsable dont l adresse sert deja a un compte', async () => {
    bd.utilisateur.findUnique.mockImplementation(async (args: { where: { email?: string } }) =>
      args.where.email ? { id: 'autre' } : null,
    );

    await expect(service.deposer(officine(), QUATRE_PIECES)).rejects.toThrow(/email du responsable/);
  });

  /**
   * Une piece complementaire ne peut pas traverser cette porte : le corps
   * multipart est remplace par le champ `donnees`, donc le libelle qui
   * l'accompagnait n'arrive jamais. Le refus doit le dire, et non parler d'un
   * libelle manquant que le candidat ne saurait pas fournir.
   */
  it('refuse une piece complementaire en disant pourquoi', async () => {
    const avecAutre = [...QUATRE_PIECES, pdf(TypePieceAgrement.AUTRE)];

    await expect(service.deposer(officine(), avecAutre)).rejects.toThrow(
      /pièces complémentaires ne sont pas acceptées/,
    );
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it("n'ecrit aucun fichier quand le dossier est refuse", async () => {
    await expect(service.deposer(officine(), QUATRE_PIECES.slice(0, 2))).rejects.toThrow();
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it('efface les fichiers ecrits quand l enregistrement echoue', async () => {
    bd.demandeAgrement.create.mockRejectedValue(new Error('base indisponible'));

    await expect(service.deposer(officine(), QUATRE_PIECES)).rejects.toThrow('base indisponible');
    expect(pieces.supprimerFichiers).toHaveBeenCalledWith([
      'fichier-0.pdf', 'fichier-1.pdf', 'fichier-2.pdf', 'fichier-3.pdf',
    ]);
  });

  it('envoie un accuse de reception portant le numero de dossier', async () => {
    await service.deposer(officine(), QUATRE_PIECES);

    expect(courriels.envoyerAccuseDemandeAgrement).toHaveBeenCalledWith(
      expect.objectContaining({
        destinataire: 'm.barry@example.gn',
        numero: `DA-${ANNEE}-0001`,
        nomStructure: 'Pharmacie du Marché',
      }),
    );
  });

  it("enregistre le dossier meme si l'accuse ne part pas", async () => {
    (courriels.envoyerAccuseDemandeAgrement as jest.Mock).mockRejectedValue(new Error('Brevo muet'));

    const resultat = await service.deposer(officine(), QUATRE_PIECES);
    expect(resultat.numero).toBe(`DA-${ANNEE}-0001`);
  });

  it('range l adresse du responsable en minuscules', async () => {
    await service.deposer(
      officine({
        responsable: {
          prenom: 'Mamadou', nom: 'Barry',
          telephone: '620000102', email: 'M.Barry@Example.GN',
        },
      }),
      QUATRE_PIECES,
    );

    const donnees = bd.demandeAgrement.create.mock.calls[0]![0].data;
    expect(donnees.responsableEmail).toBe('m.barry@example.gn');
  });
});

// ── L'examen ─────────────────────────────────────────────────────

/** Le dossier tel que la base le rend, assez complet pour `detail`. */
function demandeEnBase(surcharge: Record<string, unknown> = {}) {
  return {
    id: 'demande-1',
    numero: `DA-${ANNEE}-0041`,
    statut: 'RECUE',
    type: 'PHARMACIE',
    nom: 'Pharmacie du Marché',
    prefecture: 'Conakry',
    commune: 'Matam',
    quartier: 'Madina',
    adresse: 'Avenue de la République',
    telephone: '620000101',
    rccm: 'GN.TCC.2026.A.041',
    numeroAgrementCreation: 'ARR/2026/041',
    numeroAgrementExploitation: 'ARR/2026/141',
    lieuAutorise: 'Madina, Matam',
    responsablePrenom: 'Mamadou',
    responsableNom: 'Barry',
    responsableTelephone: '620000102',
    responsableEmail: 'm.barry@example.gn',
    motifRefus: null,
    examineLe: null,
    examinePar: null,
    idStructureCreee: null,
    codeAssureur: null,
    modeEchange: null,
    deposeLe: new Date('2026-11-18T10:00:00.000Z'),
    pieces: [],
    evenements: [],
    ...surcharge,
  };
}

let tx: {
  structureSante: Record<string, jest.Mock>;
  assureur: Record<string, jest.Mock>;
  pieceAgrement: Record<string, jest.Mock>;
  utilisateur: Record<string, jest.Mock>;
  pharmacienProfile: Record<string, jest.Mock>;
  demandeAgrement: Record<string, jest.Mock>;
};

beforeEach(() => {
  tx = {
    structureSante: { create: jest.fn(async () => ({ id: 'structure-1' })) },
    assureur: { create: jest.fn(async () => ({ id: 'assureur-1' })) },
    pieceAgrement: { updateMany: jest.fn(async () => ({ count: 4 })) },
    utilisateur: { create: jest.fn(async () => ({ id: 'compte-1' })) },
    pharmacienProfile: { create: jest.fn(async () => ({})) },
    demandeAgrement: { update: jest.fn(async () => ({})) },
  };
  bd.$transaction.mockImplementation(async (rappel: (t: typeof tx) => Promise<unknown>) => rappel(tx));

  bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase());
  bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(demandeEnBase());
  bd.demandeAgrement.update.mockResolvedValue({});
  bd.pieceAgrement.findMany.mockResolvedValue([
    { type: TypePieceAgrement.AGREMENT_CREATION },
    { type: TypePieceAgrement.AGREMENT_EXPLOITATION },
    { type: TypePieceAgrement.DIPLOME_RESPONSABLE },
    { type: TypePieceAgrement.INSCRIPTION_ORDRE },
  ]);
});

describe('mettreEnAnalyse', () => {
  it('note qui instruit le dossier, et garde le motif dans l historique', async () => {
    await service.mettreEnAnalyse(AGENT, 'demande-1', MOTIF);

    expect(bd.demandeAgrement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          statut: 'EN_ANALYSE',
          idExaminePar: 'agent-1',
          evenements: {
            create: expect.objectContaining({ action: 'MISE_EN_VERIFICATION', motif: MOTIF, idAuteur: 'agent-1' }),
          },
        },
      }),
    );
  });

  it('envoie le motif au candidat, et note que le courriel est parti', async () => {
    await service.mettreEnAnalyse(AGENT, 'demande-1', `  ${MOTIF}  `);

    expect(courriels.envoyerSuiviDemandeAgrement).toHaveBeenCalledWith(
      expect.objectContaining({ destinataire: 'm.barry@example.gn', motif: MOTIF, numero: `DA-${ANNEE}-0041` }),
    );
    const idEvenement = bd.demandeAgrement.update.mock.calls[0]![0].data.evenements.create.id;
    expect(bd.evenementDemandeAgrement.update).toHaveBeenCalledWith({
      where: { id: idEvenement },
      data: { emailEnvoye: true },
    });
  });

  it('ne note pas le courriel comme parti quand il echoue, sans defaire la mise en verification', async () => {
    (courriels.envoyerSuiviDemandeAgrement as jest.Mock).mockRejectedValueOnce(new Error('Brevo muet'));

    await expect(service.mettreEnAnalyse(AGENT, 'demande-1', MOTIF)).resolves.toBeDefined();
    expect(bd.demandeAgrement.update).toHaveBeenCalled();
    expect(bd.evenementDemandeAgrement.update).not.toHaveBeenCalled();
  });

  // Une piece illisible, puis une reference a confirmer : chaque fois le
  // candidat doit savoir ce qu'on attend de lui.
  it('se repete sur un dossier deja en verification, avec un nouveau motif', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ statut: 'EN_ANALYSE' }));

    await service.mettreEnAnalyse(AGENT, 'demande-1', MOTIF);

    expect(bd.demandeAgrement.update).toHaveBeenCalledTimes(1);
    expect(courriels.envoyerSuiviDemandeAgrement).toHaveBeenCalledTimes(1);
  });

  it('refuse sans motif explicite, et n ecrit rien', async () => {
    await expect(service.mettreEnAnalyse(AGENT, 'demande-1', 'ok')).rejects.toThrow(/au moins dix/);
    expect(bd.demandeAgrement.update).not.toHaveBeenCalled();
    expect(courriels.envoyerSuiviDemandeAgrement).not.toHaveBeenCalled();
  });

  it('ne remet pas en verification un dossier deja decide', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ statut: 'REFUSEE' }));

    await expect(service.mettreEnAnalyse(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/déjà été refusé/);
    expect(bd.demandeAgrement.update).not.toHaveBeenCalled();
  });
});

describe('valider', () => {
  it('cree la structure avec les references du dossier', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.structureSante.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nom: 'Pharmacie du Marché',
          type: 'PHARMACIE',
          prefecture: 'Conakry',
          rccm: 'GN.TCC.2026.A.041',
          numeroAgrementExploitation: 'ARR/2026/141',
          lieuAutorise: 'Madina, Matam',
          estActive: true,
        }),
      }),
    );
  });

  // **Une officine validee doit recevoir les commandes.** Elle a produit son
  // agrement, son diplome et son inscription a l'ordre, et son dossier a ete
  // examine ; la laisser hors du circuit reviendrait a valider pour rien, et
  // son titulaire ne verrait qu'un refus sans recours.
  it('rend la structure partenaire des la validation', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.structureSante.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estPartenaire: true, partenaireDepuis: expect.any(Date) }),
      }),
    );
  });

  it('rattache les pieces deja deposees a la structure creee, sans les recopier', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.pieceAgrement.updateMany).toHaveBeenCalledWith({
      where: { idDemande: 'demande-1' },
      data: { idStructure: 'structure-1' },
    });
    // Aucune piece recreee : les fichiers du disque ne bougent pas.
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it('cree le compte du responsable, a changer des la premiere connexion', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.utilisateur.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telephone: '620000102',
          email: 'm.barry@example.gn',
          idStructure: 'structure-1',
          doitChangerMotDePasse: true,
          motDePasseHash: 'hache:MotDePasseTemporaire9',
        }),
      }),
    );
  });

  // ── Le role du responsable depend du metier ────────────────────────
  //
  // Le responsable d'une officine est un pharmacien : il lui faut le role
  // PHARMACIEN pour tenir son comptoir, et le profil d'officine qui va
  // avec, sans quoi il serait admin d'une pharmacie ou il ne peut pas
  // vendre. Partout ailleurs, le responsable reste un ADMIN_STRUCTURE.

  it('fait du responsable d une officine un pharmacien titulaire', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.utilisateur.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'PHARMACIEN' }) }),
    );
    expect(tx.pharmacienProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idUtilisateur: 'compte-1',
          idStructure: 'structure-1',
          estResponsable: true,
          roleOfficine: 'TITULAIRE',
        }),
      }),
    );
  });

  // Une compagnie d'assurance se demande par cette porte depuis le
  // 2026-11-20 : son responsable entre dans l'espace assureur, et non dans
  // celui des etablissements de soins.
  it('fait du responsable d une assurance un ASSUREUR', async () => {
    // Une demande d'assurance porte toujours son code : le depot l'exige.
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ type: 'ASSURANCE', codeAssureur: 'SUNU' }));
    bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(demandeEnBase({ type: 'ASSURANCE', codeAssureur: 'SUNU' }));
    bd.pieceAgrement.findMany.mockResolvedValue(
      service.piecesDemandeesPour('ASSURANCE' as never).map((p) => ({ type: p })),
    );

    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.utilisateur.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ASSUREUR' }) }),
    );
    expect(tx.pharmacienProfile.create).not.toHaveBeenCalled();
  });

  it.each(['CLINIQUE', 'LABORATOIRE', 'HOPITAL_PREFECTORAL'])(
    'laisse le responsable d une %s administrateur de structure, sans profil d officine',
    async (type) => {
      bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ type }));
      bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(demandeEnBase({ type }));
      // Chaque metier a son dossier : l'assurance ne depose pas les quatre
      // pieces d'une officine. On depose exactement ce que le type demande.
      bd.pieceAgrement.findMany.mockResolvedValue(
        service.piecesDemandeesPour(type as never).map((p) => ({ type: p })),
      );

      await service.valider(AGENT, 'demande-1', MOTIF);

      expect(tx.utilisateur.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN_STRUCTURE' }) }),
      );
      expect(tx.pharmacienProfile.create).not.toHaveBeenCalled();
    },
  );

  it('marque le dossier valide et retient qui a decide', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.demandeAgrement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statut: 'VALIDEE',
          idStructureCreee: 'structure-1',
          idExaminePar: 'agent-1',
        }),
      }),
    );
  });

  it('envoie le motif et les identifiants au responsable, en un seul courriel', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(courriels.envoyerValidationDemandeAgrement).toHaveBeenCalledWith(
      expect.objectContaining({
        destinataire: 'm.barry@example.gn',
        telephone: '620000102',
        motDePasseTemporaire: 'MotDePasseTemporaire9',
        motif: MOTIF,
        codeAssureur: null,
      }),
    );
    expect(courriels.envoyerEmailAdminStructure).not.toHaveBeenCalled();
  });

  it('garde le motif de la validation dans l historique, et note le courriel parti', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    const donnees = tx.demandeAgrement.update.mock.calls[0]![0].data;
    expect(donnees.evenements.create).toEqual(
      expect.objectContaining({ action: 'VALIDATION', motif: MOTIF, idAuteur: 'agent-1' }),
    );
    expect(bd.evenementDemandeAgrement.update).toHaveBeenCalledWith({
      where: { id: donnees.evenements.create.id },
      data: { emailEnvoye: true },
    });
  });

  // Le courriel porte les identifiants : s'il ne part pas, l'historique doit
  // le dire, pour que l'administration rappelle le responsable.
  it('ne note pas le courriel comme parti quand il echoue', async () => {
    (courriels.envoyerValidationDemandeAgrement as jest.Mock).mockRejectedValueOnce(new Error('Brevo muet'));

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).resolves.toBeDefined();
    expect(tx.demandeAgrement.update).toHaveBeenCalled();
    expect(bd.evenementDemandeAgrement.update).not.toHaveBeenCalled();
  });

  it('refuse de valider sans motif explicite, avant toute ecriture', async () => {
    await expect(service.valider(AGENT, 'demande-1', 'ok')).rejects.toThrow(/au moins dix/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it("ne laisse le mot de passe temporaire ni dans la reponse ni dans les journaux", async () => {
    const { logger } = jest.requireMock('../src/config/logger') as {
      logger: Record<string, jest.Mock>;
    };

    const resultat = await service.valider(AGENT, 'demande-1', MOTIF);

    expect(JSON.stringify(resultat)).not.toContain('MotDePasseTemporaire9');
    const journaux = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(journaux).not.toContain('MotDePasseTemporaire9');
  });

  it('refuse de revalider un dossier deja valide', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ statut: 'VALIDEE' }));

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/déjà été validé/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('refuse de valider un dossier deja refuse', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ statut: 'REFUSEE' }));

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/déjà été refusé/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it("refuse de valider un dossier devenu incomplet", async () => {
    bd.pieceAgrement.findMany.mockResolvedValue([
      { type: TypePieceAgrement.AGREMENT_CREATION },
    ]);

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/Dossier incomplet/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it("refuse de valider quand le telephone du responsable a ete pris entretemps", async () => {
    bd.utilisateur.findUnique.mockImplementation(async (args: { where: { telephone?: string } }) =>
      args.where.telephone ? { id: 'autre' } : null,
    );

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/désormais utilisé/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });
});

describe('refuser', () => {
  it('enregistre le motif et le transmet tel quel au candidat', async () => {
    const motif = "L'agrément d'exploitation est expiré depuis mars 2026.";
    await service.refuser(AGENT, 'demande-1', motif);

    expect(bd.demandeAgrement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statut: 'REFUSEE',
          motifRefus: motif,
          idExaminePar: 'agent-1',
        }),
      }),
    );
    expect(courriels.envoyerRefusDemandeAgrement).toHaveBeenCalledWith(
      expect.objectContaining({ motif }),
    );
  });

  it('garde le refus dans l historique, et note le courriel parti', async () => {
    await service.refuser(AGENT, 'demande-1', MOTIF);

    const donnees = bd.demandeAgrement.update.mock.calls[0]![0].data;
    expect(donnees.evenements.create).toEqual(
      expect.objectContaining({ action: 'REFUS', motif: MOTIF, idAuteur: 'agent-1' }),
    );
    expect(bd.evenementDemandeAgrement.update).toHaveBeenCalledWith({
      where: { id: donnees.evenements.create.id },
      data: { emailEnvoye: true },
    });
  });

  it('refuse un motif trop court pour etre utile', async () => {
    await expect(service.refuser(AGENT, 'demande-1', 'non')).rejects.toThrow(/au moins dix/);
    expect(bd.demandeAgrement.update).not.toHaveBeenCalled();
    expect(courriels.envoyerRefusDemandeAgrement).not.toHaveBeenCalled();
  });

  it("refuse un motif fait d'espaces", async () => {
    await expect(service.refuser(AGENT, 'demande-1', '              ')).rejects.toThrow(/au moins dix/);
    expect(bd.demandeAgrement.update).not.toHaveBeenCalled();
  });

  it('ne revient pas sur un dossier deja decide', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({ statut: 'VALIDEE' }));

    await expect(
      service.refuser(AGENT, 'demande-1', 'Motif suffisamment long pour passer.'),
    ).rejects.toThrow(/déjà été validé/);
    expect(bd.demandeAgrement.update).not.toHaveBeenCalled();
  });

  it("notifie le refus meme si le courriel echoue, sans defaire la decision", async () => {
    (courriels.envoyerRefusDemandeAgrement as jest.Mock).mockRejectedValue(new Error('Brevo muet'));

    await expect(
      service.refuser(AGENT, 'demande-1', 'Motif suffisamment long pour passer.'),
    ).resolves.toBeDefined();
    expect(bd.demandeAgrement.update).toHaveBeenCalled();
  });
});

describe('detail', () => {
  it('recalcule ce qui manque a la lecture, avec les libelles du type', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(
      demandeEnBase({
        type: 'CHU',
        pieces: [
          {
            id: 'p1', type: TypePieceAgrement.AGREMENT_CREATION,
            taille: 2048, libelle: null, deposeLe: new Date('2026-11-18T10:00:00.000Z'),
          },
        ],
      }),
    );

    const vue = await service.detail('demande-1');

    expect(vue.complet).toBe(false);
    expect(vue.estHopitalPublic).toBe(true);
    expect(vue.manquantes.map((m) => m.type)).toEqual([
      TypePieceAgrement.DIPLOME_RESPONSABLE,
      TypePieceAgrement.INSCRIPTION_ORDRE,
    ]);
    expect(vue.pieces[0]!.libelle).toContain('acte de création');
  });

  it('ne rend pas de dossier inexistant', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(null);
    await expect(service.detail('inconnu')).rejects.toThrow(/introuvable/);
  });

  it('rend l historique dans l ordre, avec l auteur et le sort du courriel', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase({
      type: 'ASSURANCE',
      codeAssureur: 'SUNU',
      modeEchange: 'PORTAIL',
      evenements: [
        {
          id: 'e1', action: 'MISE_EN_VERIFICATION', motif: 'Extrait RCCM illisible, merci de le redéposer.',
          emailEnvoye: true, creeLe: new Date('2026-11-19T09:00:00.000Z'), auteur: { prenom: 'Fanta', nom: 'Camara' },
        },
        {
          id: 'e2', action: 'VALIDATION', motif: MOTIF,
          emailEnvoye: false, creeLe: new Date('2026-11-20T09:00:00.000Z'), auteur: null,
        },
      ],
    }));

    const vue = await service.detail('demande-1');

    expect(vue.codeAssureur).toBe('SUNU');
    expect(vue.modeEchange).toBe('PORTAIL');
    expect(vue.historique).toEqual([
      expect.objectContaining({ id: 'e1', action: 'MISE_EN_VERIFICATION', emailEnvoye: true, auteur: 'Fanta Camara', creeLe: '2026-11-19T09:00:00.000Z' }),
      expect.objectContaining({ id: 'e2', action: 'VALIDATION', emailEnvoye: false, auteur: null }),
    ]);
  });
});

// ── Les compagnies d'assurance, en ligne ─────────────────────────

describe('deposer une demande d assurance', () => {
  it('enregistre le code propose, en majuscules, et le mode d echange', async () => {
    const resultat = await service.deposer(compagnie(), PIECES_ASSURANCE);

    expect(resultat.statut).toBe('RECUE');
    const donnees = bd.demandeAgrement.create.mock.calls[0]![0].data;
    expect(donnees).toEqual(expect.objectContaining({
      type: 'ASSURANCE', codeAssureur: 'SUNU', modeEchange: 'PORTAIL',
      numeroAgrementCreation: 'D/2009/CAM/LOA/07',
      // Pas d'arrete d'exploitation : la seule reference est celle de la BCRG.
      numeroAgrementExploitation: null,
    }));
  });

  it('exige les quatre pieces d une assurance, en nommant celle qui manque', async () => {
    const sansResidence = PIECES_ASSURANCE.filter((f) => f.fieldname !== 'CERTIFICAT_RESIDENCE_RESPONSABLE');

    await expect(service.deposer(compagnie(), sansResidence)).rejects.toThrow(/certificat de résidence du responsable/);
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it('exige la reference de l agrement de la Banque Centrale', async () => {
    await expect(service.deposer(compagnie({ numeroAgrementCreation: undefined }), PIECES_ASSURANCE))
      .rejects.toThrow(/Banque Centrale/);
    expect(bd.demandeAgrement.create).not.toHaveBeenCalled();
  });

  it('exige un code de compagnie, avant toute ecriture', async () => {
    await expect(service.deposer(compagnie({ codeAssureur: undefined }), PIECES_ASSURANCE))
      .rejects.toThrow(/code de la compagnie/);
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it('refuse un code deja porte par une compagnie, en le nommant', async () => {
    bd.assureur.findUnique.mockResolvedValue({ id: 'autre' });

    await expect(service.deposer(compagnie(), PIECES_ASSURANCE)).rejects.toThrow(/code SUNU/);
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it('refuse un code deja propose par une autre demande en cours', async () => {
    dejaEnBase = [{ numero: `DA-${ANNEE}-0003`, telephone: '620999999', statut: 'EN_ANALYSE', codeAssureur: 'SUNU' }];

    await expect(service.deposer(compagnie(), PIECES_ASSURANCE)).rejects.toThrow(/déjà proposé/);
    expect(pieces.ecrireFichiers).not.toHaveBeenCalled();
  });

  it('laisse reprendre le code d une demande refusee', async () => {
    dejaEnBase = [{ numero: `DA-${ANNEE}-0003`, telephone: '620999999', statut: 'REFUSEE', codeAssureur: 'SUNU' }];

    await expect(service.deposer(compagnie(), PIECES_ASSURANCE)).resolves.toBeDefined();
  });

  it('ignore un code envoye pour un autre type que l assurance', async () => {
    await service.deposer(officine({ codeAssureur: 'PHARMA', modeEchange: 'API' }), QUATRE_PIECES);

    const donnees = bd.demandeAgrement.create.mock.calls[0]![0].data;
    expect(donnees.codeAssureur).toBeNull();
    expect(donnees.modeEchange).toBeNull();
    expect(bd.assureur.findUnique).not.toHaveBeenCalled();
  });
});

describe('valider une demande d assurance', () => {
  beforeEach(() => {
    const assurance = demandeEnBase({ type: 'ASSURANCE', nom: 'Sunu Assurances', codeAssureur: 'SUNU', modeEchange: 'PORTAIL' });
    bd.demandeAgrement.findUnique.mockResolvedValue(assurance);
    bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(assurance);
    bd.pieceAgrement.findMany.mockResolvedValue(PIECES_ASSURANCE.map((f) => ({ type: f.fieldname })));
  });

  it('fait naitre la compagnie avec sa structure, dans la meme transaction', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF);

    expect(tx.assureur.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nom: 'Sunu Assurances', code: 'SUNU', modeEchange: 'PORTAIL', idStructure: 'structure-1',
      }),
    }));
    expect(tx.utilisateur.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ASSUREUR' }) }),
    );
    // Comme par la creation directe : une assurance ne recoit pas de commandes.
    expect(tx.structureSante.create.mock.calls[0]![0].data.estPartenaire).toBeUndefined();
  });

  it('retient le code corrige par l administration, et l annonce au responsable', async () => {
    await service.valider(AGENT, 'demande-1', MOTIF, 'sunu-gn');

    expect(tx.assureur.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ code: 'SUNU-GN' }),
    }));
    expect(tx.demandeAgrement.update.mock.calls[0]![0].data.codeAssureur).toBe('SUNU-GN');
    expect(courriels.envoyerValidationDemandeAgrement).toHaveBeenCalledWith(
      expect.objectContaining({ codeAssureur: 'SUNU-GN' }),
    );
  });

  it('refuse un code pris entre le depot et la decision, avant toute ecriture', async () => {
    bd.assureur.findUnique.mockResolvedValue({ id: 'autre' });

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/code SUNU/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('nomme le code quand la base le refuse pendant la transaction', async () => {
    tx.assureur.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002', meta: { modelName: 'Assureur', target: ['code'] },
    }));

    await expect(service.valider(AGENT, 'demande-1', MOTIF)).rejects.toThrow(/code SUNU/);
  });

  it('refuse un code mal forme', async () => {
    await expect(service.valider(AGENT, 'demande-1', MOTIF, 'SU NU')).rejects.toThrow(/code de la compagnie/);
    expect(bd.$transaction).not.toHaveBeenCalled();
  });

  it('ne cree aucune compagnie pour un autre type', async () => {
    bd.demandeAgrement.findUnique.mockResolvedValue(demandeEnBase());
    bd.demandeAgrement.findUniqueOrThrow.mockResolvedValue(demandeEnBase());
    bd.pieceAgrement.findMany.mockResolvedValue(QUATRE_PIECES.map((f) => ({ type: f.fieldname })));

    await service.valider(AGENT, 'demande-1', MOTIF, 'IGNORE');

    expect(tx.assureur.create).not.toHaveBeenCalled();
    expect(bd.assureur.findUnique).not.toHaveBeenCalled();
  });
});
