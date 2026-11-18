import {
  PARAMETRES_PAR_DEFAUT,
  fusionnerParametres,
  getIdentitePlateforme,
  getParametres,
  getValeursParametres,
  mentionCopyright,
  modifierLogo,
  modifierParametres,
  nomSms,
  verifierPays,
  verifierZones,
  decoupageChange,
} from '../src/services/parametres.service';
import { ConflictError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    parametresSysteme: { findUnique: jest.fn(), upsert: jest.fn() },
    lieuGeo: { count: jest.fn(), findFirst: jest.fn() },
    structureSante: { findFirst: jest.fn() },
    patientProfile: { findFirst: jest.fn() },
    livreurProfile: { findFirst: jest.fn() },
    commande: { findFirst: jest.fn() },
    course: { findFirst: jest.fn() },
    alerteEpidemique: { findFirst: jest.fn() },
    facture: { findFirst: jest.fn() },
    venteComptoir: { findFirst: jest.fn() },
    lotStock: { findFirst: jest.fn() },
    contratAssurance: { findFirst: jest.fn() },
    medicament: { findFirst: jest.fn() },
    consultation: { findFirst: jest.fn() },
    examen: { findFirst: jest.fn() },
    plateauTechnique: { findFirst: jest.fn() },
  },
}));

// Pas de Redis en test : withCache/cacheDel doivent passer au travers.
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    parametresSysteme: { findUnique: M; upsert: M };
    lieuGeo: { count: M; findFirst: M };
    structureSante: { findFirst: M }; patientProfile: { findFirst: M }; livreurProfile: { findFirst: M };
    commande: { findFirst: M }; course: { findFirst: M }; alerteEpidemique: { findFirst: M };
    facture: { findFirst: M }; venteComptoir: { findFirst: M }; lotStock: { findFirst: M };
    contratAssurance: { findFirst: M }; medicament: { findFirst: M }; consultation: { findFirst: M };
    examen: { findFirst: M }; plateauTechnique: { findFirst: M };
  };
};

/** Les tables dont une seule ligne suffit a figer le decoupage (R6). */
const TABLES_ADRESSES = [
  'lieuGeo', 'structureSante', 'patientProfile', 'livreurProfile', 'commande', 'course', 'alerteEpidemique',
] as const;

afterEach(() => jest.resetAllMocks());

describe('fusionnerParametres', () => {
  it('retourne les defauts quand la base est vide ou invalide', () => {
    expect(fusionnerParametres(PARAMETRES_PAR_DEFAUT, undefined)).toEqual(PARAMETRES_PAR_DEFAUT);
    expect(fusionnerParametres(PARAMETRES_PAR_DEFAUT, 'corrompu')).toEqual(PARAMETRES_PAR_DEFAUT);
    expect(fusionnerParametres(PARAMETRES_PAR_DEFAUT, [])).toEqual(PARAMETRES_PAR_DEFAUT);
  });

  it('applique un champ partiel sans toucher au reste de la section', () => {
    const fusion = fusionnerParametres(PARAMETRES_PAR_DEFAUT, { alertes: { seuilPaludisme: 42 } });
    expect(fusion.alertes).toEqual({ ...PARAMETRES_PAR_DEFAUT.alertes, seuilPaludisme: 42 });
    expect(fusion.sync).toEqual(PARAMETRES_PAR_DEFAUT.sync);
  });

  it('ignore les cles inconnues (parametre retire du contrat)', () => {
    const fusion = fusionnerParametres(PARAMETRES_PAR_DEFAUT, {
      alertes: { ancienSeuil: 99 },
      sectionDisparue: { x: 1 },
    });
    expect(fusion).toEqual(PARAMETRES_PAR_DEFAUT);
    expect((fusion as unknown as Record<string, unknown>)['sectionDisparue']).toBeUndefined();
  });

  it('conserve false et 0 comme valeurs explicites', () => {
    const fusion = fusionnerParametres(PARAMETRES_PAR_DEFAUT, {
      facturation: { paiementEspeces: false, margePct: 0 },
    });
    expect(fusion.facturation.paiementEspeces).toBe(false);
    expect(fusion.facturation.margePct).toBe(0);
  });
});

describe('getParametres', () => {
  it('expose les defauts et modifieLe=null quand la ligne globale n existe pas', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue(null);

    const vue = await getParametres();

    expect(vue).toEqual({ ...PARAMETRES_PAR_DEFAUT, modifieLe: null, idModifiePar: null, decoupageFige: false, deviseFigee: false });
    expect(prisma.parametresSysteme.findUnique).toHaveBeenCalledWith({ where: { id: 'global' } });
  });

  it('complete une ligne partielle avec les defauts', async () => {
    const modifieLe = new Date('2026-09-01T10:00:00Z');
    prisma.parametresSysteme.findUnique.mockResolvedValue({
      id: 'global',
      valeurs: { sync: { ussdTimeoutSecondes: 90 } },
      modifieLe,
      idModifiePar: 'admin-1',
    });

    const vue = await getParametres();

    expect(vue.sync.ussdTimeoutSecondes).toBe(90);
    expect(vue.decoupageFige).toBe(false);
    expect(vue.sync.frequenceMinutes).toBe(PARAMETRES_PAR_DEFAUT.sync.frequenceMinutes);
    expect(vue.modifieLe).toBe(modifieLe);
    expect(vue.idModifiePar).toBe('admin-1');
  });

  // R6 : l'ecran doit savoir que le decoupage est fige, pour ne pas proposer
  // une modification que l'API refusera.
  it('dit que le decoupage est fige des qu une adresse est enregistree', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue(null);
    prisma.course.findFirst.mockResolvedValue({ id: 'c1' });

    expect((await getParametres()).decoupageFige).toBe(true);
  });

  // R12 : l'ecran doit savoir que la devise est figee, pour ne pas proposer
  // une modification que l'API refusera.
  it('dit que la devise est figee des qu un montant est enregistre', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue(null);
    prisma.facture.findFirst.mockResolvedValue({ id: 'f1' });

    expect((await getParametres()).deviseFigee).toBe(true);
  });
});

describe('modifierParametres', () => {
  it('fusionne le DTO avec les valeurs existantes et persiste le resultat complet', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue({
      id: 'global',
      valeurs: { alertes: { seuilPaludisme: 30 } },
      modifieLe: new Date(),
      idModifiePar: 'admin-0',
    });
    const modifieLe = new Date('2026-09-12T12:00:00Z');
    prisma.parametresSysteme.upsert.mockResolvedValue({ id: 'global', modifieLe, idModifiePar: 'admin-1' });

    const vue = await modifierParametres('admin-1', { facturation: { paiementMomo: true } });

    const attendu = {
      ...PARAMETRES_PAR_DEFAUT,
      alertes: { ...PARAMETRES_PAR_DEFAUT.alertes, seuilPaludisme: 30 },
      facturation: { ...PARAMETRES_PAR_DEFAUT.facturation, paiementMomo: true },
    };
    expect(prisma.parametresSysteme.upsert).toHaveBeenCalledWith({
      where: { id: 'global' },
      create: { id: 'global', valeurs: attendu, idModifiePar: 'admin-1' },
      update: { valeurs: attendu, idModifiePar: 'admin-1' },
    });
    expect(vue).toEqual({ ...attendu, modifieLe, idModifiePar: 'admin-1', decoupageFige: false, deviseFigee: false });
  });

  // M1 : passer au decoupage d'un autre pays, verifie avant d'ecrire.
  describe('pays', () => {
    const NIGERIA = {
      code: 'NG', nom: 'Nigeria', indicatifTelephone: '+234', longueurNumero: 10,
      niveaux: [
        { code: 'state', libelles: { fr: 'État', en: 'State' } },
        { code: 'lga', libelles: { fr: 'Zone de gouvernement local', en: 'LGA' } },
        { code: 'ward', libelles: { fr: 'Quartier', en: 'Ward' } },
      ],
      niveauBase: 'ward', niveauElargissement: 'lga',
    };

    beforeEach(() => {
      prisma.parametresSysteme.findUnique.mockResolvedValue(null);
      prisma.parametresSysteme.upsert.mockResolvedValue({ id: 'global', modifieLe: new Date(), idModifiePar: 'admin-1' });
    });

    it('enregistre un decoupage coherent quand aucun lieu ne porte un niveau retire', async () => {
      prisma.lieuGeo.count.mockResolvedValue(0);

      const vue = await modifierParametres('admin-1', { pays: NIGERIA });

      expect(prisma.lieuGeo.count).toHaveBeenCalledWith({ where: { niveau: { notIn: ['state', 'lga', 'ward'] } } });
      expect(vue.pays).toEqual(NIGERIA);
    });

    it('refuse de retirer un niveau encore porte par des lieux, sans rien ecrire', async () => {
      prisma.lieuGeo.count.mockResolvedValue(55);

      await expect(modifierParametres('admin-1', { pays: NIGERIA })).rejects.toThrow('55');
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });

    // Un changement partiel est verifie contre le decoupage complet, apres fusion.
    it('refuse un niveau de base inconnu du decoupage actuel, sans rien ecrire', async () => {
      await expect(modifierParametres('admin-1', { pays: { niveauBase: 'ward' } })).rejects.toBeInstanceOf(ValidationError);
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });

    it('les autres sections ne declenchent aucune verification du pays', async () => {
      await modifierParametres('admin-1', { zones: { delaiElargissementCourseMinutes: 15 } });
      expect(prisma.lieuGeo.count).not.toHaveBeenCalled();
    });

    // R6 : une fois des adresses enregistrees, le decoupage ne bouge plus.
    // Changer le niveau d'elargissement ferait lire « Conakry » comme une
    // region dans toutes les tables, sans que personne le sache.
    it.each(TABLES_ADRESSES)('refuse de changer le decoupage des que %s a une ligne, sans rien ecrire', async (table) => {
      prisma[table].findFirst.mockResolvedValue({ id: 'x' });

      await expect(modifierParametres('admin-1', { pays: NIGERIA })).rejects.toBeInstanceOf(ConflictError);
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });

    it('refuse de changer seulement le niveau d elargissement quand des donnees existent', async () => {
      prisma.patientProfile.findFirst.mockResolvedValue({ id: 'p1' });

      await expect(modifierParametres('admin-1', { pays: { niveauElargissement: 'region' } }))
        .rejects.toBeInstanceOf(ConflictError);
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });

    it('laisse modifier nom, indicatif et libelles quand des donnees existent', async () => {
      for (const t of TABLES_ADRESSES) prisma[t].findFirst.mockResolvedValue({ id: 'x' });
      prisma.lieuGeo.count.mockResolvedValue(0);
      const niveaux = PARAMETRES_PAR_DEFAUT.pays.niveaux.map((n) =>
        n.code === 'commune' ? { ...n, libelles: { ...n.libelles, fr: 'Commune urbaine' } } : n);

      const vue = await modifierParametres('admin-1', { pays: { nom: 'République de Guinée', indicatifTelephone: '+224', niveaux } });

      expect(vue.pays.nom).toBe('République de Guinée');
      expect(vue.pays.niveaux[2]!.libelles.fr).toBe('Commune urbaine');
      expect(prisma.parametresSysteme.upsert).toHaveBeenCalled();
    });

    it('sur une installation vierge, le decoupage se choisit librement', async () => {
      for (const t of TABLES_ADRESSES) prisma[t].findFirst.mockResolvedValue(null);
      prisma.lieuGeo.count.mockResolvedValue(0);

      const vue = await modifierParametres('admin-1', { pays: NIGERIA });

      expect(vue.pays).toEqual(NIGERIA);
      for (const t of TABLES_ADRESSES) expect(prisma[t].findFirst).toHaveBeenCalled();
    });

    // R1 : un delai final trop court arreterait l'appel avant toute la prefecture.
    it('refuse un delai final qui ne laisse pas passer les deux elargissements', async () => {
      await expect(modifierParametres('admin-1', { zones: { delaiFinalCourseMinutes: 20 } }))
        .rejects.toThrow("Le delai final des courses doit depasser deux fois le delai d'elargissement");
      // Verifie apres fusion : allonger l'elargissement suffit a rendre l'actuel trop court.
      await expect(modifierParametres('admin-1', { zones: { delaiElargissementCommandeMinutes: 30 } }))
        .rejects.toThrow("Le delai final des commandes doit depasser deux fois le delai d'elargissement");
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
      await modifierParametres('admin-1', { zones: { delaiFinalCourseMinutes: 21 } });
      expect(prisma.parametresSysteme.upsert).toHaveBeenCalled();
    });

    // Compare aux reglages enregistres, pas aux defauts : un elargissement deja
    // porte a 25 minutes interdit un delai final de 45.
    it('verifie le delai final contre l elargissement deja enregistre', async () => {
      prisma.parametresSysteme.findUnique.mockResolvedValue({
        id: 'global',
        valeurs: { zones: { delaiElargissementCourseMinutes: 25, delaiFinalCourseMinutes: 100 } },
        modifieLe: new Date('2026-11-01T10:00:00Z'),
        idModifiePar: 'admin-1',
      });

      await expect(modifierParametres('admin-1', { zones: { delaiFinalCourseMinutes: 45 } }))
        .rejects.toThrow("Le delai final des courses doit depasser deux fois le delai d'elargissement");
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });
  });

  // R10 a R13 : des reglages qui ne doivent pas pouvoir se contredire.
  describe('reglages coherents', () => {
    const TABLES_MONTANTS = [
      'facture', 'venteComptoir', 'commande', 'course', 'lotStock', 'contratAssurance',
      'medicament', 'consultation', 'examen', 'plateauTechnique',
    ] as const;

    beforeEach(() => {
      prisma.parametresSysteme.findUnique.mockResolvedValue(null);
      prisma.parametresSysteme.upsert.mockResolvedValue({ id: 'global', modifieLe: new Date(), idModifiePar: 'admin-1' });
    });

    // R10 : le produit le plus controle ne doit pas rester valable le plus longtemps.
    it('refuse une validite reglementee plus longue que la validite ordinaire', async () => {
      await expect(modifierParametres('admin-1', { prescription: { dureeValiditeJours: 7 } }))
        .rejects.toThrow('ne peut pas depasser la validite ordinaire');
      await expect(modifierParametres('admin-1', { prescription: { dureeValiditeReglementeJours: 91 } }))
        .rejects.toBeInstanceOf(ValidationError);
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });

    it('accepte une validite reglementee egale ou plus courte', async () => {
      await modifierParametres('admin-1', { prescription: { dureeValiditeJours: 28 } });
      await modifierParametres('admin-1', { prescription: { dureeValiditeReglementeJours: 7 } });
      expect(prisma.parametresSysteme.upsert).toHaveBeenCalledTimes(2);
    });

    // R11 : sans moyen de paiement, plus rien ne peut etre paye.
    it('refuse de desactiver le dernier moyen de paiement', async () => {
      // Par defaut : especes et Orange Money actifs, MoMo non.
      await modifierParametres('admin-1', { facturation: { paiementEspeces: false } });
      await expect(modifierParametres('admin-1', { facturation: { paiementEspeces: false, paiementOrangeMoney: false } }))
        .rejects.toThrow('au moins un moyen de paiement');
      expect(prisma.parametresSysteme.upsert).toHaveBeenCalledTimes(1);
    });

    it('la marge seule ne declenche pas de refus', async () => {
      await modifierParametres('admin-1', { facturation: { margePct: 10 } });
      expect(prisma.parametresSysteme.upsert).toHaveBeenCalled();
    });

    // R12 : les montants n'ont pas de devise propre ; la changer les
    // reetiquetterait sans les convertir.
    it.each(TABLES_MONTANTS)('refuse de changer la devise des que %s porte un montant', async (table) => {
      prisma[table].findFirst.mockResolvedValue({ id: 'x' });

      await expect(modifierParametres('admin-1', { identite: { devise: 'XOF' } })).rejects.toBeInstanceOf(ConflictError);
      expect(prisma.parametresSysteme.upsert).not.toHaveBeenCalled();
    });

    it('renvoyer la meme devise avec le reste de l identite passe, meme avec des montants', async () => {
      prisma.facture.findFirst.mockResolvedValue({ id: 'f1' });

      const vue = await modifierParametres('admin-1', { identite: { devise: 'GNF', slogan: 'Nouveau' } });

      expect(vue.identite.slogan).toBe('Nouveau');
      expect(vue.deviseFigee).toBe(true);
    });

    it('sur une installation sans montant, la devise se choisit', async () => {
      const vue = await modifierParametres('admin-1', { identite: { devise: 'XOF' } });
      expect(vue.identite.devise).toBe('XOF');
      expect(vue.deviseFigee).toBe(false);
    });

    it('ne compte que les prix reellement saisis', async () => {
      await modifierParametres('admin-1', { identite: { devise: 'XOF' } });
      expect(prisma.medicament.findFirst).toHaveBeenCalledWith({ where: { prixUnitaireGnf: { gt: 0 } }, select: { id: true } });
      expect(prisma.consultation.findFirst).toHaveBeenCalledWith({ where: { tarifGnf: { not: null } }, select: { id: true } });
    });

    // R13 : un seul nom de pays, celui de l'installation.
    it('le pays de l identite est toujours celui de l installation', async () => {
      const vue = await modifierParametres('admin-1', { identite: { pays: 'Atlantide' } });
      expect(vue.identite.pays).toBe('Guinée');

      const autre = fusionnerParametres(PARAMETRES_PAR_DEFAUT, { identite: { pays: 'Guinée' }, pays: { nom: 'Sénégal' } });
      expect(autre.identite.pays).toBe('Sénégal');
    });
  });
});

// ── Identite de la plateforme ────────────────────────────────────────
describe('nomSms', () => {
  it('retire les accents et passe en majuscules (alphabet GSM)', () => {
    expect(nomSms({ nom: 'KÈNÈYA', nomCourt: '' })).toBe('KENEYA');
    expect(nomSms({ nom: 'Santé Ñandú', nomCourt: '' })).toBe('SANTE NANDU');
  });

  it('prefere le nom court saisi par l admin', () => {
    expect(nomSms({ nom: 'KÈNÈYA', nomCourt: 'KNY' })).toBe('KNY');
  });

  it('ne renvoie jamais une chaine vide', () => {
    expect(nomSms({ nom: '🌳', nomCourt: '' })).toBe('PLATEFORME');
  });
});

describe('mentionCopyright', () => {
  it('genere « © annee nom » quand rien n est saisi', () => {
    const annee = new Date().getFullYear();
    expect(mentionCopyright({ nom: 'KÈNÈYA', copyright: '' })).toBe(`© ${annee} KÈNÈYA — Tous droits réservés`);
  });

  it('respecte la mention saisie', () => {
    expect(mentionCopyright({ nom: 'X', copyright: '© 2030 Ma Plateforme' })).toBe('© 2030 Ma Plateforme');
  });
});

describe('getIdentitePlateforme', () => {
  it('renvoie l identite avec les derives renseignes', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue({
      id: 'global',
      valeurs: { identite: { nom: 'Kènèya Santé', emailContact: 'contact@keneya.gn' } },
    });

    const identite = await getIdentitePlateforme();

    expect(identite.nom).toBe('Kènèya Santé');
    expect(identite.nomCourt).toBe('KENEYA SANTE');
    expect(identite.emailContact).toBe('contact@keneya.gn');
    expect(identite.copyright).toContain('Kènèya Santé');
    expect(identite.devise).toBe(PARAMETRES_PAR_DEFAUT.identite.devise);
  });
});

describe('modifierLogo', () => {
  it('enregistre l URL du logo dans la section identite et renvoie l identite', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue(null);
    prisma.parametresSysteme.upsert.mockResolvedValue({ id: 'global', modifieLe: new Date(), idModifiePar: 'admin-1' });

    await modifierLogo('admin-1', 'http://localhost:3000/uploads/logos/logo-1.png');

    const appel = prisma.parametresSysteme.upsert.mock.calls[0][0];
    expect(appel.update.valeurs.identite.logoUrl).toBe('http://localhost:3000/uploads/logos/logo-1.png');
    expect(appel.update.valeurs.identite.nom).toBe(PARAMETRES_PAR_DEFAUT.identite.nom);
  });
});

describe('getValeursParametres', () => {
  it('retourne des valeurs completes pour les consommateurs internes', async () => {
    prisma.parametresSysteme.findUnique.mockResolvedValue({
      id: 'global',
      valeurs: { facturation: { paiementOrangeMoney: false } },
    });

    const valeurs = await getValeursParametres();

    expect(valeurs.facturation.paiementOrangeMoney).toBe(false);
    expect(valeurs.facturation.paiementEspeces).toBe(true);
    expect(valeurs.alertes.seuilEbola).toBe(PARAMETRES_PAR_DEFAUT.alertes.seuilEbola);
  });
});


// ── Les sections administrables, et le schema qui les laisse passer ──
//
// Le schema de mise a jour est `.strict()`. Une section absente du schema
// fait rejeter le corps en 400, et l'onglet correspondant de l'ecran
// d'administration s'affiche, repond, et n'enregistre rien. C'est ce qui
// arrivait a « Ordonnances » jusqu'au 2026-10-02.
describe('sections de parametres', () => {
  it('le schema de mise a jour accepte toutes les sections du contrat', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { updateParametresSystemeSchema } = require('../src/validators/api.schemas');
    for (const section of Object.keys(PARAMETRES_PAR_DEFAUT)) {
      const r = updateParametresSystemeSchema.safeParse({ [section]: {} });
      expect({ section, ok: r.success }).toEqual({ section, ok: true });
    }
  });

  it('le comptoir a des prix fixes et aucune categorie soumise par defaut', () => {
    expect(PARAMETRES_PAR_DEFAUT.pharmacie).toEqual({
      categoriesExigeantOrdonnance: [],
    });
  });

  it('la liste des categories soumises se remplace, elle ne fusionne pas', () => {
    const fusionne = fusionnerParametres(PARAMETRES_PAR_DEFAUT, {
      pharmacie: { categoriesExigeantOrdonnance: ['COSMETIQUE'] },
    });
    expect(fusionne.pharmacie.categoriesExigeantOrdonnance).toEqual(['COSMETIQUE']);
  });

  it('refuse une categorie qui n existe pas dans l enumeration', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { updateParametresSystemeSchema } = require('../src/validators/api.schemas');
    const r = updateParametresSystemeSchema.safeParse({
      pharmacie: { categoriesExigeantOrdonnance: ['CHAUSSURES'] },
    });
    expect(r.success).toBe(false);
  });

  // M5 : 10 minutes par defaut, entre 1 minute et une journee.
  it('le delai d elargissement vaut 10 minutes et se borne', () => {
    expect(PARAMETRES_PAR_DEFAUT.zones).toEqual({
      delaiElargissementCommandeMinutes: 10,
      delaiElargissementCourseMinutes: 10,
      // R1 : l'appel s'arrete au bout d'une heure, apres les deux elargissements.
      delaiFinalCommandeMinutes: 60,
      delaiFinalCourseMinutes: 60,
    });
    expect(() => verifierZones(PARAMETRES_PAR_DEFAUT.zones)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { updateParametresSystemeSchema } = require('../src/validators/api.schemas');
    const ok = (v: unknown) => updateParametresSystemeSchema.safeParse({ zones: { delaiElargissementCourseMinutes: v } }).success;
    expect([ok(1), ok(1440), ok('15')]).toEqual([true, true, true]);
    expect([ok(0), ok(1441), ok(2.5)]).toEqual([false, false, false]);
    expect(updateParametresSystemeSchema.safeParse({ zones: { rayonKm: 5 } }).success).toBe(false);
  });

  // M1 : une installation par pays ; la Guinee est la configuration fournie.
  it('le pays par defaut est la Guinee, commune de base et prefecture d elargissement', () => {
    expect(PARAMETRES_PAR_DEFAUT.pays).toMatchObject({
      code: 'GN', indicatifTelephone: '+224', niveauBase: 'commune', niveauElargissement: 'prefecture',
    });
    expect(() => verifierPays(PARAMETRES_PAR_DEFAUT.pays)).not.toThrow();
  });

  it('refuse un decoupage incoherent', () => {
    const p = PARAMETRES_PAR_DEFAUT.pays;
    // Elargir vers plus etroit retrecirait l'appel.
    expect(() => verifierPays({ ...p, niveauBase: 'prefecture', niveauElargissement: 'commune' })).toThrow(ValidationError);
    expect(() => verifierPays({ ...p, niveauElargissement: 'commune' })).toThrow(ValidationError);
    expect(() => verifierPays({ ...p, niveauBase: 'ward' })).toThrow('Niveau de base « ward » absent');
    expect(() => verifierPays({ ...p, niveauElargissement: 'lga' })).toThrow("Niveau d'elargissement « lga » absent");
    expect(() => verifierPays({ ...p, niveaux: [...p.niveaux, p.niveaux[0]!] })).toThrow(ValidationError);
  });

  // R6 : ce qui compte dans le decoupage, ce sont les codes et leur ordre,
  // le niveau de base et le niveau d'elargissement - pas les libelles.
  it('distingue un changement de decoupage d un changement de libelle', () => {
    const p = PARAMETRES_PAR_DEFAUT.pays;
    const [region, prefecture, commune] = p.niveaux as [typeof p.niveaux[0], typeof p.niveaux[0], typeof p.niveaux[0]];
    expect(decoupageChange(p, { ...p })).toBe(false);
    expect(decoupageChange(p, { ...p, nom: 'Autre', indicatifTelephone: '+000' })).toBe(false);
    expect(decoupageChange(p, { ...p, niveaux: [region, prefecture, { ...commune, libelles: { fr: 'Ward' } }] })).toBe(false);
    expect(decoupageChange(p, { ...p, niveauElargissement: 'region' })).toBe(true);
    expect(decoupageChange(p, { ...p, niveauBase: 'prefecture' })).toBe(true);
    expect(decoupageChange(p, { ...p, niveaux: [prefecture, region, commune] })).toBe(true);
    expect(decoupageChange(p, { ...p, niveaux: [region, prefecture, { code: 'sp', libelles: { fr: 'SP' } }, commune] })).toBe(true);
    expect(decoupageChange(p, { ...p, niveaux: [region, prefecture, commune, { code: 'quartier', libelles: { fr: 'Q' } }] })).toBe(true);
  });

  it('valide la forme du pays dans le schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { updateParametresSystemeSchema } = require('../src/validators/api.schemas');
    const ok = (pays: unknown) => updateParametresSystemeSchema.safeParse({ pays }).success;
    expect(ok({ code: 'SN', indicatifTelephone: '+221' })).toBe(true);
    expect([ok({ code: 'sn' }), ok({ code: 'SEN' }), ok({ indicatifTelephone: '221' })]).toEqual([false, false, false]);
    expect(ok({ niveaux: [{ code: 'state', libelles: { fr: 'État', en: 'State' } }, { code: 'lga', libelles: { fr: 'LGA' } }] })).toBe(true);
    expect(ok({ niveaux: [{ code: 'Mauvais Code', libelles: { fr: 'x' } }, { code: 'lga', libelles: { fr: 'LGA' } }] })).toBe(false);
    expect(ok({ niveaux: [{ code: 'state', libelles: { fr: 'État' } }] })).toBe(false);
  });

  it('refuse toute configuration de remise', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { updateParametresSystemeSchema } = require('../src/validators/api.schemas');
    expect(updateParametresSystemeSchema.safeParse({ pharmacie: { remiseMaxPourcent: 100 } }).success).toBe(false);
  });
});
