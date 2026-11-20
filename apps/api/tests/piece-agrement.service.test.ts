// Les pieces d'agrement des structures privees.
//
// **La creation n'exigeait aucune preuve reglementaire.** Les trois portes
// acceptaient un nom, une prefecture et un telephone : une pharmacie sans
// agrement, une clinique sans autorisation d'exploitation entraient comme les
// autres, et rien ne permettait de faire la difference.
//
// Ce fichier tient trois choses que le reste du code ne peut pas garantir :
// que le blocage porte sur les bons types, que ce sont les **octets** qui
// decident d'un PDF, et que le RCCM reste tolerant.
jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    utilisateur: { findUnique: jest.fn() },
    pharmacienProfile: { findUnique: jest.fn() },
    structureSante: { findUnique: jest.fn() },
    pieceAgrement: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn(), delete: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 contenu')),
  },
}));

import { promises as fs } from 'fs';

import {
  cheminPiece, deposerPieces, dossierDe, estStructurePublique, exigeDesPieces, libellePiece,
  lirePiece, maStructure, normaliserRccm, piecesRequisesPour, SOUS_AUTORISATION_DU_PARENT,
  validerIdentifiants, validerPieces,
} from '../src/services/piece-agrement.service';
import type { TypePieceAgrement } from '../src/config/generated/client/client';
import { estPdf, TAILLE_MAX_PIECE } from '../src/middlewares/upload.middleware';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';
import type { JwtPayload } from '../src/types/auth.types';

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: M };
    pharmacienProfile: { findUnique: M };
    structureSante: { findUnique: M };
    pieceAgrement: { findUnique: M; findMany: M; createMany: M; delete: M };
    $transaction: M;
  };
};

const qui = (role: string, userId = 'u-1') => ({ userId, role, sessionId: 's' }) as unknown as JwtPayload;

const NATIONAL = qui('ADMIN_NATIONAL', 'u-nat');
const ADMIN = qui('ADMIN_STRUCTURE', 'u-adm');
const TITULAIRE = qui('PHARMACIEN', 'u-ph');

/** Un PDF minimal. C'est la signature de tete qui fait foi. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');

const DOSSIER = {
  rccm: 'GN.TCC.2026.A.14724',
  numeroAgrementCreation: 'ARR/2026/MSHP/0123',
  numeroAgrementExploitation: 'ARR/2026/MSHP/0456',
  lieuAutorise: 'Quartier Donka, Dixinn, Conakry',
};

const QUATRE = [
  { fieldname: 'AGREMENT_CREATION', buffer: PDF },
  { fieldname: 'AGREMENT_EXPLOITATION', buffer: PDF },
  { fieldname: 'DIPLOME_RESPONSABLE', buffer: PDF },
  { fieldname: 'INSCRIPTION_ORDRE', buffer: PDF },
];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  (fs.writeFile as unknown as M).mockResolvedValue(undefined);
  (fs.unlink as unknown as M).mockResolvedValue(undefined);
  (fs.readFile as unknown as M).mockResolvedValue(Buffer.from('%PDF-1.7 contenu'));
});

// ── Qui doit produire un dossier ─────────────────────────────────────

describe('qui doit produire un dossier', () => {
  it.each(['PHARMACIE', 'CLINIQUE', 'LABORATOIRE', 'ASSURANCE'])(
    '%s en produit un',
    (type) => {
      expect(exigeDesPieces(type)).toBe(true);
    },
  );

  // **Le public en produit aussi, depuis le 2026-11-18.** Il n'en produisait
  // aucun : l'administration savait ce qu'elle creait. Mais une structure
  // entre desormais aussi par une demande publique, ou personne ne sait qui
  // depose, et deux portes qui n'exigent pas la meme chose finissent par
  // servir de contournement l'une a l'autre.
  it.each(['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU'])(
    'le public (%s) en produit un aussi',
    (type) => {
      expect(exigeDesPieces(type)).toBe(true);
      expect(piecesRequisesPour(type)).toContain('AGREMENT_CREATION');
      expect(piecesRequisesPour(type)).toContain('DIPLOME_RESPONSABLE');
    },
  );

  // Ce qu'il ne produit **pas** : l'arrete d'exploitation, qui n'existe pas
  // pour lui — l'acte qui le cree l'autorise du meme geste.
  it.each(['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU'])(
    'le public (%s) ne produit pas d arrete d exploitation',
    (type) => {
      expect(piecesRequisesPour(type)).not.toContain('AGREMENT_EXPLOITATION');
    },
  );

  // Un poste ou un centre est souvent tenu par un infirmier ou un agent
  // communautaire, que nul ordre professionnel n'inscrit. Un hopital, lui,
  // est dirige par un medecin.
  it('n exige l inscription a l ordre que des hopitaux, pas des postes ni des centres', () => {
    for (const type of ['POSTE', 'CENTRE']) {
      expect(piecesRequisesPour(type)).not.toContain('INSCRIPTION_ORDRE');
      expect(piecesRequisesPour(type)).toHaveLength(2);
    }
    for (const type of ['HOPITAL_PREF', 'HOPITAL_REG', 'CHU']) {
      expect(piecesRequisesPour(type)).toContain('INSCRIPTION_ORDRE');
      expect(piecesRequisesPour(type)).toHaveLength(3);
    }
  });

  // Le defaut va vers l'exemption : un type ajoute a l'enum sans etre pense
  // ici ne doit pas bloquer, il doit passer.
  it('un type inconnu n exige rien', () => {
    expect(exigeDesPieces('TYPE_QUI_N_EXISTE_PAS')).toBe(false);
  });

  it('les trois types sanitaires exigent les quatre memes pieces', () => {
    for (const type of ['PHARMACIE', 'CLINIQUE', 'LABORATOIRE']) {
      expect([...piecesRequisesPour(type)].sort()).toEqual([
        'AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
      ]);
    }
  });

  // L'assureur releve de la Banque Centrale, pas du ministere de la Sante : il
  // n'a ni diplome ni ordre professionnel a produire. Mais la compagnie prouve
  // son existence, et son responsable son identite et sa residence.
  it('l assureur produit son agrement, son extrait RCCM, et l identite et la residence de son responsable', () => {
    expect(piecesRequisesPour('ASSURANCE')).toEqual([
      'AGREMENT_ASSURANCE', 'EXTRAIT_RCCM', 'PIECE_IDENTITE_RESPONSABLE', 'CERTIFICAT_RESIDENCE_RESPONSABLE',
    ]);
    expect(piecesRequisesPour('ASSURANCE')).not.toContain('DIPLOME_RESPONSABLE');
    expect(piecesRequisesPour('ASSURANCE')).not.toContain('INSCRIPTION_ORDRE');
  });

  it('nomme chaque piece manquante d une assurance', () => {
    const agrementSeul = [{ fieldname: 'AGREMENT_ASSURANCE', buffer: Buffer.from('%PDF-1.4 bcrg') }];
    expect(() => validerPieces('ASSURANCE', agrementSeul)).toThrow(
      "Dossier incomplet : il manque l'extrait RCCM, la carte d'identité ou le passeport du responsable, "
      + 'le certificat de résidence du responsable.',
    );
  });

  it('reconnait les structures nees d un acte de l Etat', () => {
    for (const type of ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU']) {
      expect(estStructurePublique(type)).toBe(true);
    }
    for (const type of ['PHARMACIE', 'CLINIQUE', 'LABORATOIRE', 'ASSURANCE']) {
      expect(estStructurePublique(type)).toBe(false);
    }
  });

  /**
   * Le seul type que la table n'inscrit pas : la pharmacie d'un hopital, qui
   * opere sous l'autorisation de celui-ci et n'a pas d'agrement propre a
   * produire. Elle passe par `SOUS_AUTORISATION_DU_PARENT`.
   */
  it('n exempte que la structure qui opere sous l autorisation d une autre', () => {
    expect(exigeDesPieces(SOUS_AUTORISATION_DU_PARENT)).toBe(false);
    expect(piecesRequisesPour(SOUS_AUTORISATION_DU_PARENT)).toEqual([]);
  });

  /**
   * La meme piece ne porte pas le meme nom partout : un directeur d'hopital
   * cherchant un « agrément » dans ses archives ne trouverait rien.
   */
  it('nomme l acte de creation selon le type', () => {
    expect(libellePiece('CHU', 'AGREMENT_CREATION' as TypePieceAgrement)).toContain('acte de création');
    expect(libellePiece('POSTE', 'AGREMENT_CREATION' as TypePieceAgrement)).toContain('acte de création');
    expect(libellePiece('PHARMACIE', 'AGREMENT_CREATION' as TypePieceAgrement)).toContain('agrément de création');
  });
});

// ── Ce qui fait foi : les octets ──────────────────────────────────────

describe('la reconnaissance d un PDF', () => {
  it('accepte un vrai PDF', () => {
    expect(estPdf(PDF)).toBe(true);
  });

  // **`Content-Type` est declaratif.** Le filtre de multer lit l'en-tete
  // envoye par le client : un fichier renomme le passe.
  it.each([
    ['du HTML', '<html><script>alert(1)</script></html>'],
    ['un script', '#!/bin/sh\nrm -rf /'],
    ['du texte', 'ceci est mon agrement, promis'],
    ['une signature decalee', 'XX%PDF-1.7'],
    ['un fichier vide', ''],
  ])('refuse %s', (_quoi, contenu) => {
    expect(estPdf(Buffer.from(contenu))).toBe(false);
  });

  it('refuse un fichier qui ne contient que la signature', () => {
    expect(estPdf(Buffer.from('%PDF-'))).toBe(false);
  });
});

// ── Le RCCM ──────────────────────────────────────────────────────────

describe('le numero RCCM', () => {
  // Les deux formes qui circulent reellement en Guinee. Aucun texte officiel
  // n'en fixe le format : une regex serree refuserait l'une des deux.
  it.each([
    'GN.TCC.2026.A.14724',
    'GC-KAL.2017.B.000123',
    'ENTREPRISE/RCCM/GC-KAL.2018.B.009988',
  ])('accepte %s', (valeur) => {
    expect(() => normaliserRccm(valeur)).not.toThrow();
  });

  it('normalise la casse et les espaces', () => {
    expect(normaliserRccm('  gn.tcc.2026.a.14724 ')).toBe('GN.TCC.2026.A.14724');
    expect(normaliserRccm('GN TCC 2026 A 14724')).toBe('GNTCC2026A14724');
  });

  it('refuse un numero trop court', () => {
    expect(() => normaliserRccm('GN.1')).toThrow(ValidationError);
  });

  it('refuse des caracteres qui ne sont pas d un registre', () => {
    expect(() => normaliserRccm('GN.TCC.2026;DROP TABLE')).toThrow(ValidationError);
  });
});

// ── Les identifiants reglementaires ──────────────────────────────────

describe('les identifiants exiges', () => {
  it('accepte un dossier sanitaire complet', () => {
    const v = validerIdentifiants('CLINIQUE', DOSSIER);
    expect(v.rccm).toBe('GN.TCC.2026.A.14724');
    expect(v.numeroAgrementExploitation).toBe('ARR/2026/MSHP/0456');
  });

  it.each([
    ['rccm', 'le numéro RCCM'],
    ['lieuAutorise', "le lieu autorisé"],
    ['numeroAgrementCreation', "l'agrément de création"],
    ['numeroAgrementExploitation', "l'agrément d'exploitation"],
  ])('nomme %s quand il manque', (champ, attendu) => {
    const partiel = { ...DOSSIER, [champ]: undefined };
    expect(() => validerIdentifiants('LABORATOIRE', partiel)).toThrow(new RegExp(attendu, 'i'));
  });

  // Une chaine d'espaces n'est pas un numero : sinon le blocage se contourne
  // en tapant une barre d'espace.
  it('ne prend pas des espaces pour un numero', () => {
    expect(() => validerIdentifiants('CLINIQUE', { ...DOSSIER, rccm: '   ' })).toThrow(ValidationError);
  });

  // Il n'y a pas d'arrete d'exploitation distinct a la Banque Centrale : garder
  // la valeur laisserait en base un champ que personne ne saurait interpreter.
  it('l assureur n a qu une reference, et l autre est ecartee', () => {
    const v = validerIdentifiants('ASSURANCE', {
      ...DOSSIER, numeroAgrementCreation: 'D/2009/CAM/LOA/07',
    });
    expect(v.numeroAgrementCreation).toBe('D/2009/CAM/LOA/07');
    expect(v.numeroAgrementExploitation).toBeNull();
  });

  /**
   * Une structure publique doit produire **une** reference : celle de l'acte
   * qui la cree. Elle n'en produisait aucune jusqu'au 2026-11-18, quand la
   * creation par l'administration et la demande publique ont ete alignees.
   */
  it('une structure publique doit fournir la reference de son acte de creation', () => {
    expect(() => validerIdentifiants('CHU', {})).toThrow(ValidationError);
    expect(() => validerIdentifiants('CHU', {})).toThrow(/acte de création/);

    const v = validerIdentifiants('CHU', { numeroAgrementCreation: 'DECRET/2026/012' });
    expect(v.numeroAgrementCreation).toBe('DECRET/2026/012');
  });

  /**
   * Et **seulement** celle-la. Un RCCM saisi pour un hopital est efface :
   * l'acte de l'Etat qui le cree l'autorise du meme geste, et une valeur
   * gardee ici ferait croire des annees plus tard qu'il est immatricule au
   * registre du commerce.
   */
  it('efface le RCCM et l arrete d exploitation d une structure publique', () => {
    const v = validerIdentifiants('CHU', {
      numeroAgrementCreation: 'DECRET/2026/012',
      rccm: 'GN.TCC.2020.A.00001',
      numeroAgrementExploitation: 'ARR/2026/999',
    });

    expect(v.rccm).toBeNull();
    expect(v.numeroAgrementExploitation).toBeNull();
  });

  it('applique la meme regle au poste et au centre de sante', () => {
    for (const type of ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG']) {
      expect(() => validerIdentifiants(type, {})).toThrow(/acte de création/);
      expect(validerIdentifiants(type, { numeroAgrementCreation: 'ARR/2026/1', rccm: 'GN.TCC.2020.A.1' }).rccm)
        .toBeNull();
    }
  });
});

// ── Les pieces elles-memes ───────────────────────────────────────────

describe('la validation des pieces', () => {
  it('accepte les quatre pieces attendues', () => {
    expect(validerPieces('CLINIQUE', QUATRE)).toHaveLength(4);
  });

  it('nomme ce qui manque, au lieu de dire « incomplet »', () => {
    expect(() => validerPieces('CLINIQUE', QUATRE.slice(0, 2)))
      .toThrow(/diplôme légalisé du responsable.*inscription à l'ordre/i);
  });

  // Le nom de champ vient du client : jamais accepte tel quel.
  it('refuse un nom de champ qui ne nomme pas une piece', () => {
    expect(() => validerPieces('CLINIQUE', [{ fieldname: '../../etc/passwd', buffer: PDF }]))
      .toThrow(/Pièce inconnue/i);
  });

  it('refuse deux fois la meme piece', () => {
    expect(() => validerPieces('CLINIQUE', [...QUATRE, { fieldname: 'AGREMENT_CREATION', buffer: PDF }]))
      .toThrow(/deux fois/i);
  });

  it('refuse un fichier vide', () => {
    const vide = QUATRE.map((p) => (p.fieldname === 'INSCRIPTION_ORDRE'
      ? { ...p, buffer: Buffer.alloc(0) } : p));
    expect(() => validerPieces('CLINIQUE', vide)).toThrow(/fichier vide/i);
  });

  // La limite de multer s'applique au transport ; celle-ci s'applique au
  // contenu, pour les appels qui ne passent pas par multer.
  it('refuse une piece au-dela de la limite', () => {
    const gros = Buffer.concat([PDF, Buffer.alloc(TAILLE_MAX_PIECE)]);
    expect(() => validerPieces('CLINIQUE', [{ fieldname: 'AGREMENT_CREATION', buffer: gros }]))
      .toThrow(/5 Mo/i);
  });

  /**
   * **Le message est ce que le deposant lit** : il doit nommer les pieces
   * comme il les connait. Un sabotage l'a montre - remplacer le libelle par
   * type par un libelle unique ne faisait echouer aucun test, alors qu'un
   * directeur d'hopital se serait vu reclamer un « agrément de création »
   * qu'il n'a pas, au lieu de l'acte qui le cree.
   */
  it('nomme les pieces manquantes selon le type, dans le message', () => {
    expect(() => validerPieces('CHU', [])).toThrow(/acte de création/);
    expect(() => validerPieces('POSTE', [])).toThrow(/acte de création/);
    expect(() => validerPieces('PHARMACIE', [])).toThrow(/agrément de création/);
  });

  // `AUTRE` ne dit rien de lui-meme : sans libelle, la piece est illisible
  // dans la liste du dossier.
  it('refuse une piece complementaire sans libelle', () => {
    expect(() => validerPieces('CHU', [{ fieldname: 'AUTRE', buffer: PDF }]))
      .toThrow(/libellé/i);
  });

  /**
   * Le type neutre est `SOUS_AUTORISATION_DU_PARENT`, et non un CHU : depuis
   * que le public produit lui aussi son dossier, un CHU sans ses trois pieces
   * est refuse avant meme qu'on regarde les pieces complementaires.
   */
  it('accepte plusieurs pieces complementaires, chacune libellee', () => {
    const pieces = [
      { fieldname: 'AUTRE', buffer: PDF },
      { fieldname: 'AUTRE', buffer: PDF },
    ];
    expect(validerPieces(SOUS_AUTORISATION_DU_PARENT, pieces, { AUTRE: 'Plan architectural' }))
      .toHaveLength(2);
  });
});

// ── Le chemin du fichier ─────────────────────────────────────────────

describe('le chemin d une piece', () => {
  it('accepte un nom genere', () => {
    expect(() => cheminPiece('0191f4aa-2b3c-7d8e-9f01-23456789abcd.pdf')).not.toThrow();
  });

  // Le nom vient de la base : une ecriture directe pourrait y glisser un
  // chemin. La regex est la seconde barriere, apres le CHECK SQL.
  it.each([
    '../../../etc/passwd',
    '../../.env',
    'agrement.pdf.exe',
    'agrement.png',
    'dossier/agrement.pdf',
  ])('refuse %s', (nom) => {
    expect(() => cheminPiece(nom)).toThrow(NotFoundError);
  });
});

// ── Le perimetre de lecture ──────────────────────────────────────────

describe('qui peut lire une piece', () => {
  beforeEach(() => {
    prisma.pieceAgrement.findUnique.mockResolvedValue({
      fichier: 'aaaa-bbbb.pdf', type: 'AGREMENT_CREATION', idStructure: 'donka',
    });
    // Par defaut, personne n'a de profil d'officine : le pharmacien du
    // it.each ci-dessous est un pharmacien sans titre, pas un titulaire.
    prisma.pharmacienProfile.findUnique.mockResolvedValue(null);
  });

  it('l administration nationale lit tout', async () => {
    const r = await lirePiece(NATIONAL, 'p-1');
    expect(r.fichier).toBe('aaaa-bbbb.pdf');
  });

  it('l administrateur de la structure lit la sienne', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'donka' });
    await expect(lirePiece(ADMIN, 'p-1')).resolves.toBeDefined();
  });

  // **Une piece d'ailleurs se traite comme une piece inconnue** : un 403
  // confirmerait qu'elle existe.
  it('ne dit pas a un administrateur d ailleurs que la piece existe', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'autre-hopital' });
    await expect(lirePiece(ADMIN, 'p-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(['MEDECIN', 'PHARMACIEN', 'PATIENT', 'ASSUREUR', 'TECHNICIEN_LABO', 'LIVREUR'])(
    'refuse %s',
    async (role) => {
      await expect(lirePiece(qui(role), 'p-1')).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  // ── Le titulaire d'officine ────────────────────────────────────────
  //
  // Une pharmacie validee par agrement n'a pas d'ADMIN_STRUCTURE : son
  // titulaire est un PHARMACIEN, et c'est lui qui repond du dossier.
  // Le role seul ne suffit donc plus a decider, il faut le titre.

  it('le titulaire lit le dossier de son officine', async () => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue({ estResponsable: true, idStructure: 'donka' });
    await expect(lirePiece(TITULAIRE, 'p-1')).resolves.toBeDefined();
  });

  it.each(['ADJOINT', 'PREPARATEUR', 'CAISSIER'])(
    'refuse un %s de la meme officine',
    async (roleOfficine) => {
      prisma.pharmacienProfile.findUnique.mockResolvedValue({
        estResponsable: false, roleOfficine, idStructure: 'donka',
      });
      await expect(lirePiece(TITULAIRE, 'p-1')).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  // Le reste du module officine reconnait le titulaire a `roleOfficine`, et
  // le menu du navigateur filtre sur ce champ : un profil marque TITULAIRE
  // sans `estResponsable` verrait l'entree du dossier et se ferait refuser.
  it('reconnait le titulaire a son role d officine, pas seulement au drapeau', async () => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue({
      estResponsable: false, roleOfficine: 'TITULAIRE', idStructure: 'donka',
    });
    await expect(lirePiece(TITULAIRE, 'p-1')).resolves.toBeDefined();
  });

  it('ne dit pas a un titulaire d ailleurs que la piece existe', async () => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue({ estResponsable: true, idStructure: 'autre-officine' });
    await expect(lirePiece(TITULAIRE, 'p-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse un titulaire que son profil ne rattache a aucune structure', async () => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue({ estResponsable: true, idStructure: null });
    await expect(lirePiece(TITULAIRE, 'p-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('ne lit pas le disque pour une piece inconnue', async () => {
    prisma.pieceAgrement.findUnique.mockResolvedValue(null);
    await expect(lirePiece(NATIONAL, 'p-absente')).rejects.toBeInstanceOf(NotFoundError);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

// ── La structure dont on repond ──────────────────────────────────────
//
// Le titulaire n'a pas d'ecran d'administration de structure : c'est par la
// qu'il apprend quel dossier demander.

describe('ma structure', () => {
  beforeEach(() => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue(null);
    prisma.structureSante.findUnique.mockResolvedValue({ id: 'donka', nom: 'Pharmacie Donka' });
  });

  it('nomme la pharmacie de son titulaire', async () => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue({ estResponsable: true, idStructure: 'donka' });
    await expect(maStructure(TITULAIRE)).resolves.toEqual({ id: 'donka', nom: 'Pharmacie Donka' });
  });

  it('nomme sa structure a l administrateur', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'donka' });
    await expect(maStructure(ADMIN)).resolves.toEqual({ id: 'donka', nom: 'Pharmacie Donka' });
  });

  it('refuse un pharmacien qui n est pas titulaire', async () => {
    prisma.pharmacienProfile.findUnique.mockResolvedValue({ estResponsable: false, idStructure: 'donka' });
    await expect(maStructure(TITULAIRE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuse un compte sans structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: null });
    await expect(maStructure(ADMIN)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // L'administration nationale n'en repond d'aucune : cette route ne lui
  // sert a rien, et lui rendre une structure au hasard serait pire.
  it('refuse l administration nationale', async () => {
    await expect(maStructure(NATIONAL)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ── L etat du dossier ────────────────────────────────────────────────

describe('l etat du dossier', () => {
  it('dit complet quand les quatre pieces sont la', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({
      id: 'cl-1', nom: 'Clinique Kipe', type: 'CLINIQUE',
      rccm: 'GN.TCC.2026.A.1', numeroAgrementCreation: 'A', numeroAgrementExploitation: 'B',
      lieuAutorise: 'Kipe',
      piecesAgrement: QUATRE.map((p, i) => ({
        id: `p-${i}`, type: p.fieldname, taille: 1024, libelle: null, deposeLe: new Date(),
      })),
    });

    const d = await dossierDe('cl-1');
    expect(d.complet).toBe(true);
    expect(d.manquantes).toEqual([]);
  });

  it('nomme les pieces absentes', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({
      id: 'cl-1', nom: 'Clinique Kipe', type: 'CLINIQUE',
      rccm: null, numeroAgrementCreation: null, numeroAgrementExploitation: null, lieuAutorise: null,
      piecesAgrement: [{
        id: 'p-0', type: 'AGREMENT_CREATION', taille: 1024, libelle: null, deposeLe: new Date(),
      }],
    });

    const d = await dossierDe('cl-1');
    expect(d.complet).toBe(false);
    expect([...d.manquantes].sort()).toEqual([
      'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
    ]);
  });

  /**
   * Un hopital public vide n'est plus complet.
   *
   * Il l'etait tant que le public n'avait rien a produire. Depuis que les
   * deux portes de creation exigent les memes pieces, un dossier vide se
   * montre pour ce qu'il est — et nomme ce qui manque avec les mots de
   * l'hopital : « l'acte de création », pas « l'agrément de création ».
   */
  it('dit incomplet pour un hopital public sans pieces, et nomme ce qui manque', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({
      id: 'chu-1', nom: 'Hopital Donka', type: 'CHU',
      rccm: null, numeroAgrementCreation: null, numeroAgrementExploitation: null, lieuAutorise: null,
      piecesAgrement: [],
    });

    const d = await dossierDe('chu-1');
    expect(d.complet).toBe(false);
    expect(d.exigeDesPieces).toBe(true);
    expect([...d.manquantes].sort()).toEqual([
      'AGREMENT_CREATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
    ]);
  });

  /** La pharmacie d'un hopital, elle, reste complete sans rien deposer. */
  it('dit complet pour une structure qui opere sous l autorisation d une autre', async () => {
    prisma.structureSante.findUnique.mockResolvedValue({
      id: 'pharma-chu', nom: 'Pharmacie de Donka', type: SOUS_AUTORISATION_DU_PARENT,
      rccm: null, numeroAgrementCreation: null, numeroAgrementExploitation: null, lieuAutorise: null,
      piecesAgrement: [],
    });

    const d = await dossierDe('pharma-chu');
    expect(d.complet).toBe(true);
    expect(d.exigeDesPieces).toBe(false);
  });
});

// ── Le renouvellement ────────────────────────────────────────────────

describe('deposer et remplacer une piece', () => {
  beforeEach(() => {
    // Le meme mock sert deux lectures : le controle d'entree, puis
    // `dossierDe` que `deposerPieces` renvoie en fin de course.
    prisma.structureSante.findUnique.mockResolvedValue({
      id: 'cl-1', type: 'CLINIQUE', nom: 'Clinique Kipe',
      rccm: null, numeroAgrementCreation: null, numeroAgrementExploitation: null, lieuAutorise: null,
      piecesAgrement: [],
    });
    prisma.pieceAgrement.findMany.mockResolvedValue([]);
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'cl-1' });
  });

  // **Un agrement se renouvelle.** Remplacer la piece expiree doit etre un
  // geste, pas une recreation de la structure.
  it('remplace la piece du meme type', async () => {
    prisma.pieceAgrement.findMany.mockResolvedValue([{ id: 'ancienne', fichier: 'vieux.pdf' }]);

    await deposerPieces(ADMIN, 'cl-1', [{ fieldname: 'AGREMENT_EXPLOITATION', buffer: PDF }]);

    expect(prisma.pieceAgrement.delete).toHaveBeenCalledWith({ where: { id: 'ancienne' } });
    expect(prisma.pieceAgrement.createMany).toHaveBeenCalledTimes(1);
  });

  // **L'ancien fichier ne part qu'apres le commit.** Si la transaction avait
  // echoue, la piece en vigueur doit rester lisible.
  it('ne supprime l ancien fichier qu apres le commit', async () => {
    prisma.pieceAgrement.findMany.mockResolvedValue([{ id: 'ancienne', fichier: 'vieux.pdf' }]);
    prisma.$transaction.mockRejectedValue(new Error('base indisponible'));

    await expect(deposerPieces(ADMIN, 'cl-1', [{ fieldname: 'AGREMENT_EXPLOITATION', buffer: PDF }]))
      .rejects.toThrow('base indisponible');

    const supprimes = (fs.unlink as unknown as M).mock.calls.map((c) => String(c[0]));
    expect(supprimes.some((p) => p.endsWith('vieux.pdf'))).toBe(false);
  });

  // Completer piece par piece doit rester possible : exiger les quatre d'un
  // coup empecherait de rattraper un dossier ancien.
  it('n exige pas un dossier complet pour completer', async () => {
    await expect(deposerPieces(ADMIN, 'cl-1', [{ fieldname: 'DIPLOME_RESPONSABLE', buffer: PDF }]))
      .resolves.toBeDefined();
  });

  it('refuse un depot vide', async () => {
    await expect(deposerPieces(ADMIN, 'cl-1', [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse un administrateur d une autre structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ idStructure: 'autre' });
    await expect(deposerPieces(ADMIN, 'cl-1', [{ fieldname: 'DIPLOME_RESPONSABLE', buffer: PDF }]))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  // Rien ne doit rester d'une transaction qui echoue : ni ligne, ni fichier.
  it('supprime les fichiers ecrits si la transaction echoue', async () => {
    prisma.$transaction.mockRejectedValue(new Error('base indisponible'));

    await expect(deposerPieces(ADMIN, 'cl-1', [{ fieldname: 'DIPLOME_RESPONSABLE', buffer: PDF }]))
      .rejects.toThrow('base indisponible');
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});
