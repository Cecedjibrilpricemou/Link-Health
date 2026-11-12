import {
  assertTransitionCourse,
  choisirOffre,
  coursesDuLivreur,
  coursesOuvertesPour,
  declarerRecu,
  elargirCourse,
  elargirCoursesEnAttente,
  conclureCoursesExpirees,
  relancerCourse,
  ouvrirCourse,
  proposer,
  remettreAuMotard,
  renoncerALaLivraison,
  transitionCoursePermise,
  notifierLivreursCourse,
  type CourseTransactionClient,
} from '../src/services/course.service';
import { prochainNumero } from '../src/services/numero.service';
import { notifierSansBloquer } from '../src/services/notification.service';
import type { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError } from '../src/utils/app-error';
import { filtreZone, filtreZones, zonesDuLivreur } from '../src/utils/zone';
import { Role, StatutCommande, StatutCourse } from '../src/config/generated/client/client';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    commande: { findUnique: jest.fn(), updateMany: jest.fn() },
    course: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    livreurProfile: { findUnique: jest.fn(), findMany: jest.fn() },
    offreCourse: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    utilisateur: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});

jest.mock('../src/services/numero.service', () => ({
  prochainNumero: jest.fn(),
}));
jest.mock('../src/services/notification.service', () => ({
  notifierSansBloquer: jest.fn(),
}));
// M1-C : les voisines viennent du referentiel ; aucune par defaut, chaque test precise.
jest.mock('../src/services/geographie.service', () => ({ voisinsDe: jest.fn() }));
const { voisinsDe } = jest.requireMock('../src/services/geographie.service') as { voisinsDe: jest.Mock };

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    commande: { findUnique: M; updateMany: M };
    course: {
      create: M; findFirst: M; findMany: M; findUnique: M; updateMany: M;
    };
    livreurProfile: { findUnique: M; findMany: M };
    offreCourse: { findFirst: M; findMany: M; upsert: M };
    utilisateur: { findUnique: M; findMany: M };
    $transaction: M;
  };
};
const numero = prochainNumero as jest.Mock;

const livreur: JwtPayload = { userId: 'livreur-user', role: Role.LIVREUR, sessionId: 'session-1' };
const patient: JwtPayload = { userId: 'patient-user', role: Role.PATIENT, sessionId: 'session-2' };
const pharmacien: JwtPayload = { userId: 'pharmacien-user', role: Role.PHARMACIEN, sessionId: 'session-3' };

const profil = {
  id: 'profil-livreur',
  qrCode: 'qr-livreur-test',
  quartier: 'Kipé',
  prefecture: 'Conakry',
  commune: 'Ratoma',
  communesDesservies: [] as string[],
  estActif: true,
  enService: true,
  utilisateur: { role: Role.LIVREUR },
};
const courseOuverte = {
  id: 'course-1',
  numero: 'LV-2026-000001',
  statut: StatutCourse.APPEL_OFFRES,
  quartier: 'Kipé',
  prefecture: 'Conakry',
  commune: 'Ratoma',
  prixGnf: null,
  delaiAnnonceMinutes: null,
  creeeLe: new Date('2026-10-23T10:00:00.000Z'),
  attribueeLe: null,
  remiseLe: null,
  livreeLe: null,
  commande: { pharmacie: { id: 'pharmacie-1', nom: 'Pharmacie du quartier' } },
};
const courseView = {
  ...courseOuverte,
  annuleeLe: null,
  motifAnnulation: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  voisinsDe.mockResolvedValue([]);
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  prisma.livreurProfile.findUnique.mockResolvedValue(profil);
  prisma.course.updateMany.mockResolvedValue({ count: 1 });
  prisma.livreurProfile.findMany.mockResolvedValue([]);
  (notifierSansBloquer as jest.Mock).mockResolvedValue(undefined);
  numero.mockResolvedValue('LV-2026-000001');
});

describe('transitions de course', () => {
  it('refuse chaque transition absente de la table, dont EN_COURS vers ANNULEE', () => {
    const statuts = Object.values(StatutCourse);
    for (const depart of statuts) {
      for (const arrivee of statuts) {
        if (transitionCoursePermise(depart, arrivee)) {
          expect(() => assertTransitionCourse(depart, arrivee)).not.toThrow();
        } else {
          expect(() => assertTransitionCourse(depart, arrivee)).toThrow(ConflictError);
        }
      }
    }
    expect(transitionCoursePermise(StatutCourse.EN_COURS, StatutCourse.ANNULEE)).toBe(false);
    expect(() => assertTransitionCourse(StatutCourse.EN_COURS, StatutCourse.ANNULEE)).toThrow(ConflictError);
    expect(transitionCoursePermise(StatutCourse.ATTRIBUEE, StatutCourse.APPEL_OFFRES)).toBe(true);
  });
});

describe('ouverture et visibilité des courses', () => {
  it('copie la zone patient et le numéro LV dans la transaction', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      id: 'commande-1',
      statut: StatutCommande.PRETE_POUR_LIVRAISON,
      modeRemise: 'LIVRAISON',
      quartierRecherche: 'Kipé',
      communeRecherche: 'Ratoma',
      ordonnance: { consultation: { patient: { prefecture: 'Conakry', commune: 'Dixinn' } } },
    });
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.course.create.mockResolvedValue({ id: 'course-1', statut: StatutCourse.APPEL_OFFRES });

    const result = await prisma.$transaction((tx: unknown) =>
      ouvrirCourse('commande-1', tx as CourseTransactionClient));

    expect(numero).toHaveBeenCalledWith('LV', prisma);
    expect(prisma.course.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        numero: 'LV-2026-000001',
        idCommande: 'commande-1',
        quartier: 'Kipé',
        prefecture: 'Conakry',
        // La commune figee sur la commande prime sur l'adresse du patient.
        commune: 'Ratoma',
      }),
    }));
    expect(result).toEqual({ id: 'course-1', statut: StatutCourse.APPEL_OFFRES });
  });

  it('prend la commune du patient pour une commande anterieure sans commune figee', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      id: 'commande-1',
      statut: StatutCommande.PRETE_POUR_LIVRAISON,
      modeRemise: 'LIVRAISON',
      quartierRecherche: 'Kipé',
      communeRecherche: null,
      ordonnance: { consultation: { patient: { prefecture: 'Conakry', commune: 'Ratoma' } } },
    });
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.course.create.mockResolvedValue({ id: 'course-1', statut: StatutCourse.APPEL_OFFRES });

    await prisma.$transaction((tx: unknown) =>
      ouvrirCourse('commande-1', tx as CourseTransactionClient));

    expect(prisma.course.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ commune: 'Ratoma' }),
    }));
  });

  it('retourne la course active existante sans en creer une autre', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      id: 'commande-1',
      statut: StatutCommande.PRETE_POUR_LIVRAISON,
      modeRemise: 'LIVRAISON',
      quartierRecherche: 'Kipé',
      ordonnance: { consultation: { patient: { prefecture: 'Conakry' } } },
    });
    prisma.course.findFirst.mockResolvedValue({ id: 'course-existante', statut: StatutCourse.APPEL_OFFRES });

    const result = await prisma.$transaction((tx: unknown) =>
      ouvrirCourse('commande-1', tx as CourseTransactionClient));

    expect(result.id).toBe('course-existante');
    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  it('ne montre au livreur que les courses de sa commune et de sa prefecture', async () => {
    prisma.course.findMany.mockResolvedValue([courseOuverte]);

    const result = await coursesOuvertesPour(livreur);

    expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        statut: StatutCourse.APPEL_OFFRES,
        OR: [
          ...(filtreZones(zonesDuLivreur(profil)).OR as unknown[]),
          // M5 : une course elargie se voit dans toute sa prefecture.
          { elargieLe: { not: null }, prefecture: { equals: 'Conakry', mode: 'insensitive' } },
          // M1-C : et celles ouvertes a sa commune comme voisine.
          {
            voisinesLe: { not: null },
            communesVoisines: { hasSome: ['ratoma'] },
            prefecture: { equals: 'Conakry', mode: 'insensitive' },
          },
        ],
      },
    }));
    // Le filtre porte bien sur la commune du livreur, pas seulement son quartier.
    expect(JSON.stringify(prisma.course.findMany.mock.calls[0][0].where)).toContain('Ratoma');
    expect(result).toEqual([expect.objectContaining({
      id: 'course-1',
      pharmacie: { id: 'pharmacie-1', nom: 'Pharmacie du quartier' },
    })]);
  });

  it('montre aussi les courses des communes qu il dessert', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, communesDesservies: ['Dixinn'] });
    prisma.course.findMany.mockResolvedValue([]);

    await coursesOuvertesPour(livreur);

    const { where } = prisma.course.findMany.mock.calls[0][0];
    // Ratoma, Dixinn, les courses elargies, et celles ouvertes a ses communes comme voisines.
    expect(where.OR).toHaveLength(4);
    expect(JSON.stringify(where.OR[1])).toContain('Dixinn');
    // Une commune desservie compte aussi comme voisine possible.
    expect(where.OR[3].communesVoisines).toEqual({ hasSome: ['ratoma', 'dixinn'] });
  });

  it('notifie uniquement les livreurs actifs de la zone a l ouverture', async () => {
    const course = {
      numero: 'LV-2026-000001',
      quartier: profil.quartier,
      prefecture: profil.prefecture,
      commune: profil.commune,
    };
    prisma.course.findUnique.mockResolvedValue(course);
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'livreur-user' } }]);

    await notifierLivreursCourse('course-1');

    expect(prisma.livreurProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        estActif: true,
        // Seuls les motards en service, de la commune ou qui la desservent.
        enService: true,
        OR: [
          filtreZone(course),
          { AND: [
            { prefecture: { equals: 'Conakry', mode: 'insensitive' } },
            { communesDesservies: { has: 'Ratoma' } },
          ] },
        ],
        utilisateur: { role: Role.LIVREUR, estActif: true },
      }),
    }));
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'livreur-user',
      type: 'COURSE_OUVERTE',
      metadonnees: expect.objectContaining({ idCourse: 'course-1' }),
    }));
  });

  it('ne donne aucune donnee de produit ou ordonnance dans la vue livreur attribuee', async () => {
    prisma.course.findMany.mockResolvedValue([{
      ...courseOuverte,
      statut: StatutCourse.ATTRIBUEE,
      idLivreur: profil.id,
      prixGnf: 15_000,
      delaiAnnonceMinutes: 25,
      commande: {
        pharmacie: { id: 'pharmacie-1', nom: 'Pharmacie du quartier' },
        ordonnance: {
          consultation: {
            patient: { utilisateur: { prenom: 'Awa', nom: 'Diallo', telephone: '+224600000000' } },
          },
        },
      },
    }]);

    const result = await coursesDuLivreur(livreur);
    const course = result.courses[0]!;
    const serialise = JSON.stringify(result);

    expect(result.qrCode).toBe('qr-livreur-test');
    expect(course.patient).toEqual({ prenom: 'Awa', nom: 'Diallo', telephone: '+224600000000' });
    expect(serialise).not.toMatch(/produit|ordonnance|diagnostic|medicament|posologie|lignes/i);
  });

  // M3 : ou livrer, le temps de la course seulement.
  function courseDuMotard(statut: StatutCourse) {
    return {
      ...courseOuverte, statut, idLivreur: profil.id,
      commande: {
        pharmacie: { id: 'pharmacie-1', nom: 'Pharmacie du quartier' },
        ordonnance: { consultation: { patient: {
          utilisateur: { prenom: 'Awa', nom: 'Diallo', telephone: '+224600000000' },
          commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee', latitude: 9.64, longitude: -13.58,
        } } },
      },
    };
  }

  it.each([StatutCourse.ATTRIBUEE, StatutCourse.EN_COURS])(
    'donne au motard l adresse et la position du patient pendant la course (%s)',
    async (statut) => {
      prisma.course.findMany.mockResolvedValue([courseDuMotard(statut)]);

      const { courses } = await coursesDuLivreur(livreur);

      expect(courses[0]!.adresseLivraison).toEqual({
        commune: 'Ratoma', quartier: 'Kipé', pointRepere: 'Derriere la mosquee', latitude: 9.64, longitude: -13.58,
      });
    },
  );

  it.each([StatutCourse.LIVREE, StatutCourse.ANNULEE])(
    'ne montre plus ou habite le patient une fois la course finie (%s)',
    async (statut) => {
      prisma.course.findMany.mockResolvedValue([courseDuMotard(statut)]);

      const { courses } = await coursesDuLivreur(livreur);

      expect(courses[0]).not.toHaveProperty('adresseLivraison');
      expect(JSON.stringify(courses)).not.toMatch(/mosquee|9\.64/);
    },
  );

  it('demande l adresse du patient a la base', async () => {
    prisma.course.findMany.mockResolvedValue([]);
    await coursesDuLivreur(livreur);
    const patient = prisma.course.findMany.mock.calls[0][0].select.commande.select.ordonnance.select.consultation.select.patient;
    expect(patient.select).toMatchObject({ commune: true, quartier: true, pointRepere: true, latitude: true, longitude: true });
  });
});

describe('elargissement aux communes voisines (M1-C)', () => {
  const dansRatoma = {
    id: 'course-1', numero: 'LV-2026-000001', statut: StatutCourse.APPEL_OFFRES, elargieLe: null,
    voisinesLe: null, communesVoisines: [] as string[], prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
  };
  const motardsDesVoisines = [
    { prefecture: { equals: 'Conakry', mode: 'insensitive' }, commune: { in: ['Dixinn'], mode: 'insensitive' } },
    { prefecture: { equals: 'Conakry', mode: 'insensitive' }, communesDesservies: { hasSome: ['Dixinn', 'dixinn'] } },
  ];

  it('premiere etape : previent les motards des voisines, et fige leur liste', async () => {
    voisinsDe.mockResolvedValue(['Dixinn']);
    prisma.course.findUnique.mockResolvedValue(dansRatoma);
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'motard-dixinn' } }]);

    expect(await elargirCourse('course-1')).toBe(1);

    expect(voisinsDe).toHaveBeenCalledWith('Conakry', 'Ratoma');
    expect(prisma.livreurProfile.findMany.mock.calls[0][0].where).toMatchObject({
      estActif: true, enService: true, OR: motardsDesVoisines,
    });
    expect(prisma.course.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 'course-1', statut: StatutCourse.APPEL_OFFRES, voisinesLe: null, elargieLe: null },
      data: { voisinesLe: expect.any(Date), communesVoisines: ['dixinn'] },
    });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'motard-dixinn',
      contenu: expect.stringContaining('communes voisines'),
    }));
  });

  it('personne en service chez les voisines : l etape est sautee, la prefecture est ouverte', async () => {
    voisinsDe.mockResolvedValue(['Dixinn']);
    prisma.course.findUnique.mockResolvedValue(dansRatoma);
    prisma.livreurProfile.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ utilisateur: { id: 'motard-matoto' } }]);

    await elargirCourse('course-1');

    expect(prisma.course.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.course.updateMany.mock.calls[0][0].data).toEqual({ elargieLe: expect.any(Date) });
  });

  it('seconde etape : la prefecture, sans reprevenir la commune ni les voisines', async () => {
    prisma.course.findUnique.mockResolvedValue({ ...dansRatoma, voisinesLe: new Date(), communesVoisines: ['dixinn'] });
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'motard-matoto' } }]);

    await elargirCourse('course-1');

    expect(voisinsDe).not.toHaveBeenCalled();
    const { NOT } = prisma.livreurProfile.findMany.mock.calls[0][0].where;
    expect(NOT.OR).toEqual(expect.arrayContaining([
      { prefecture: { equals: 'Conakry', mode: 'insensitive' }, commune: { in: ['dixinn'], mode: 'insensitive' } },
      { prefecture: { equals: 'Conakry', mode: 'insensitive' }, communesDesservies: { hasSome: ['dixinn'] } },
    ]));
    expect(prisma.course.updateMany.mock.calls[0][0].data).toEqual({ elargieLe: expect.any(Date) });
  });

  it('un passage simultane a la premiere etape ne previent personne', async () => {
    voisinsDe.mockResolvedValue(['Dixinn']);
    prisma.course.findUnique.mockResolvedValue(dansRatoma);
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'motard-dixinn' } }]);
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    expect(await elargirCourse('course-1')).toBe(0);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  it('un motard d une voisine peut proposer une fois la course ouverte aux voisines, pas avant', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, commune: 'Dixinn', quartier: 'Donka' });
    prisma.offreCourse.upsert.mockResolvedValue({ id: 'offre-1', prixGnf: 10_000, delaiMinutes: 20, creeeLe: new Date() });

    prisma.course.findUnique.mockResolvedValue({ ...dansRatoma });
    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 })).rejects.toBeInstanceOf(ForbiddenError);

    prisma.course.findUnique.mockResolvedValue({ ...dansRatoma, voisinesLe: new Date(), communesVoisines: ['dixinn'] });
    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }).catch(() => undefined);
    expect(prisma.offreCourse.upsert).toHaveBeenCalled();
  });

  it('une commune desservie compte comme voisine', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, commune: 'Matoto', quartier: 'Gbessia', communesDesservies: ['Dixinn'] });
    prisma.offreCourse.upsert.mockResolvedValue({ id: 'offre-1', prixGnf: 10_000, delaiMinutes: 20, creeeLe: new Date() });
    prisma.course.findUnique.mockResolvedValue({ ...dansRatoma, voisinesLe: new Date(), communesVoisines: ['dixinn'] });

    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }).catch(() => undefined);

    expect(prisma.offreCourse.upsert).toHaveBeenCalled();
  });

  it('une commune non voisine, ou d une autre prefecture, reste refusee', async () => {
    prisma.course.findUnique.mockResolvedValue({ ...dansRatoma, voisinesLe: new Date(), communesVoisines: ['dixinn'] });

    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, commune: 'Matoto', quartier: 'Gbessia' });
    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 })).rejects.toBeInstanceOf(ForbiddenError);

    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, commune: 'Dixinn', quartier: 'Donka', prefecture: 'Kindia' });
    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });
});

describe('elargissement a la prefecture (M5)', () => {
  const sansOffre = {
    id: 'course-1', numero: 'LV-2026-000001', statut: StatutCourse.APPEL_OFFRES, elargieLe: null,
    prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
  };

  it('previent les motards en service de la prefecture qui ne l avaient pas ete', async () => {
    prisma.course.findUnique.mockResolvedValue(sansOffre);
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'motard-matoto' } }]);

    expect(await elargirCourse('course-1')).toBe(1);

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 'course-1', statut: StatutCourse.APPEL_OFFRES, elargieLe: null },
      data: { elargieLe: expect.any(Date) },
    });
    expect(prisma.livreurProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        estActif: true,
        enService: true,
        prefecture: { equals: 'Conakry', mode: 'insensitive' },
        // Ceux de la zone ont deja ete prevenus a l'ouverture.
        NOT: { OR: [
          filtreZone(sansOffre),
          { AND: [
            { prefecture: { equals: 'Conakry', mode: 'insensitive' } },
            { communesDesservies: { has: 'Ratoma' } },
          ] },
        ] },
        utilisateur: { role: Role.LIVREUR, estActif: true },
      },
    }));
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'motard-matoto',
      type: 'COURSE_OUVERTE',
      metadonnees: expect.objectContaining({ idCourse: 'course-1', elargie: true }),
    }));
  });

  it('un second passage simultane ne previent personne une seconde fois', async () => {
    prisma.course.findUnique.mockResolvedValue(sansOffre);
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    expect(await elargirCourse('course-1')).toBe(0);
    expect(prisma.livreurProfile.findMany).not.toHaveBeenCalled();
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  it('n elargit pas une course deja elargie ou deja attribuee', async () => {
    prisma.course.findUnique.mockResolvedValue({ ...sansOffre, elargieLe: new Date() });
    expect(await elargirCourse('course-1')).toBe(0);
    prisma.course.findUnique.mockResolvedValue({ ...sansOffre, statut: StatutCourse.ATTRIBUEE });
    expect(await elargirCourse('course-1')).toBe(0);
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('le job ne prend que les courses sans offre plus vieilles que le delai', async () => {
    prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
    prisma.course.findUnique.mockResolvedValue(sansOffre);
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'motard-matoto' } }]);

    const res = await elargirCoursesEnAttente(10, new Date('2026-11-11T12:00:00Z'));

    expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        statut: StatutCourse.APPEL_OFFRES,
        elargieLe: null,
        // Depuis l'ouverture dans la commune, depuis l'ouverture aux voisines ensuite (M1-C).
        OR: [
          // R1 : depuis l'ouverture de l'appel en cours, remise a l'heure par une relance.
          { voisinesLe: null, ouverteLe: { lte: new Date('2026-11-11T11:50:00Z') } },
          { voisinesLe: { lte: new Date('2026-11-11T11:50:00Z') } },
        ],
        // Des offres attendent deja le choix du patient : rien a elargir.
        offres: { none: {} },
      },
    }));
    expect(res).toEqual({ elargies: 1 });
  });

  it('le job ne compte pas une course sans motard de plus dans la prefecture', async () => {
    prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
    prisma.course.findUnique.mockResolvedValue(sansOffre);

    expect(await elargirCoursesEnAttente(10)).toEqual({ elargies: 0 });
  });
});

describe('offres de course', () => {
  it('refuse une proposition hors zone', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      statut: StatutCourse.APPEL_OFFRES,
      quartier: 'Matoto',
      prefecture: 'Conakry',
      commune: 'Matoto',
    });

    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });

  it('refuse une course de meme commune mais d une autre prefecture', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      statut: StatutCourse.APPEL_OFFRES,
      quartier: 'Kipé',
      prefecture: 'Coyah',
      commune: 'Ratoma',
    });

    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });

  it('accepte une course de la meme commune dans un autre quartier', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      statut: StatutCourse.APPEL_OFFRES,
      quartier: 'Lambanyi',
      prefecture: 'Conakry',
      commune: 'Ratoma',
    });

    prisma.offreCourse.upsert.mockResolvedValue({
      id: 'offre-1', prixGnf: 10_000, delaiMinutes: 20, creeeLe: new Date('2026-11-06T10:00:00.000Z'),
    });

    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }).catch(() => undefined);

    // La zone est acceptee : l'offre est bien enregistree.
    expect(prisma.offreCourse.upsert).toHaveBeenCalled();
  });

  it('refuse toute offre d un motard hors service, avant de toucher a la course', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, enService: false });

    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }))
      .rejects.toThrow('Passez en service');
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });

  it('accepte une course dans une commune qu il dessert', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, communesDesservies: ['Dixinn'] });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1', statut: StatutCourse.APPEL_OFFRES,
      quartier: 'Donka', prefecture: 'Conakry', commune: 'Dixinn',
    });
    prisma.offreCourse.upsert.mockResolvedValue({
      id: 'offre-1', prixGnf: 10_000, delaiMinutes: 20, creeeLe: new Date('2026-11-11T10:00:00.000Z'),
    });

    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }).catch(() => undefined);

    expect(prisma.offreCourse.upsert).toHaveBeenCalled();
  });

  it('refuse une commune desservie si elle est dans une autre prefecture', async () => {
    prisma.livreurProfile.findUnique.mockResolvedValue({ ...profil, communesDesservies: ['Dixinn'] });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1', statut: StatutCourse.APPEL_OFFRES,
      quartier: 'Centre', prefecture: 'Kindia', commune: 'Dixinn',
    });

    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });

  // M5 : une course elargie accepte les motards de toute sa prefecture...
  it('accepte une course elargie d une autre commune de sa prefecture', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1', statut: StatutCourse.APPEL_OFFRES, elargieLe: new Date(),
      quartier: 'Centre', prefecture: 'Conakry', commune: 'Matoto',
    });
    prisma.offreCourse.upsert.mockResolvedValue({
      id: 'offre-1', prixGnf: 10_000, delaiMinutes: 20, creeeLe: new Date('2026-11-11T10:00:00.000Z'),
    });

    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }).catch(() => undefined);

    expect(prisma.offreCourse.upsert).toHaveBeenCalled();
  });

  // ... mais jamais au-dela.
  it('refuse une course elargie d une autre prefecture', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1', statut: StatutCourse.APPEL_OFFRES, elargieLe: new Date(),
      quartier: 'Centre', prefecture: 'Kindia', commune: 'Matoto',
    });

    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });

  it('refuse une proposition si la course a ete attribuee entre-temps', async () => {
    prisma.course.updateMany.mockResolvedValue({ count: 0 });
    prisma.course.findUnique.mockResolvedValue({ id: 'course-1' });

    await expect(proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(prisma.offreCourse.upsert).not.toHaveBeenCalled();
  });

  it('met a jour l offre unique du livreur au lieu de creer un doublon', async () => {
    const ouverte = {
      id: 'course-1',
      statut: StatutCourse.APPEL_OFFRES,
      quartier: profil.quartier,
      prefecture: profil.prefecture,
    };
    const notification = {
      numero: 'LV-2026-000001',
      commande: { ordonnance: { consultation: { patient: { idUtilisateur: patient.userId } } } },
    };
    prisma.course.findUnique
      .mockResolvedValueOnce(ouverte)
      .mockResolvedValueOnce(notification)
      .mockResolvedValueOnce(ouverte)
      .mockResolvedValueOnce(notification);
    prisma.offreCourse.upsert
      .mockResolvedValueOnce({
        id: 'offre-1', prixGnf: 10_000, delaiMinutes: 20, creeeLe: new Date('2026-10-23T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'offre-1', prixGnf: 12_000, delaiMinutes: 15, creeeLe: new Date('2026-10-23T10:00:00Z'),
      });

    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 });
    const updated = await proposer(livreur, 'course-1', { prixGnf: 12_000, delaiMinutes: 15 });

    expect(prisma.offreCourse.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.offreCourse.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { idCourse_idLivreur: { idCourse: 'course-1', idLivreur: profil.id } },
      update: { prixGnf: 12_000, delaiMinutes: 15 },
    }));
    expect(updated).toMatchObject({ id: 'offre-1', prixGnf: 12_000, delaiMinutes: 15 });
  });

  it('notifie le patient a l arrivee d une offre sans divulguer de produits', async () => {
    prisma.course.findUnique
      .mockResolvedValueOnce({
        id: 'course-1',
        statut: StatutCourse.APPEL_OFFRES,
        quartier: profil.quartier,
        prefecture: profil.prefecture,
      })
      .mockResolvedValueOnce({
        numero: 'LV-2026-000001',
        commande: {
          ordonnance: { consultation: { patient: { idUtilisateur: patient.userId } } },
        },
      });
    prisma.offreCourse.upsert.mockResolvedValue({
      id: 'offre-1',
      prixGnf: 10_000,
      delaiMinutes: 20,
      creeeLe: new Date('2026-10-23T10:00:00Z'),
    });

    await proposer(livreur, 'course-1', { prixGnf: 10_000, delaiMinutes: 20 });

    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: patient.userId,
      type: 'OFFRE_COURSE',
      contenu: expect.stringContaining('10000 GNF'),
    }));
    expect(JSON.stringify((notifierSansBloquer as jest.Mock).mock.calls[0]?.[0]))
      .not.toMatch(/produit|ordonnance|diagnostic/i);
  });

  it('copie le prix choisi dans la course sans dependance ulterieure a l offre', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      id: 'commande-1',
      statut: StatutCommande.PRETE_POUR_LIVRAISON,
      modeRemise: 'LIVRAISON',
      idPharmacie: 'pharmacie-1',
      quartierRecherche: 'Kipé',
      ordonnance: { consultation: { patient: { idUtilisateur: patient.userId, prefecture: 'Conakry' } } },
    });
    prisma.offreCourse.findFirst.mockResolvedValue({
      idCourse: 'course-1',
      idLivreur: profil.id,
      prixGnf: 10_000,
      delaiMinutes: 20,
      course: { statut: StatutCourse.APPEL_OFFRES },
    });
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUnique
      .mockResolvedValueOnce({
        ...courseView,
        statut: StatutCourse.ATTRIBUEE,
        prixGnf: 10_000,
        delaiAnnonceMinutes: 20,
      })
      .mockResolvedValueOnce({
        numero: 'LV-2026-000001',
        prixGnf: 10_000,
        delaiAnnonceMinutes: 20,
        commande: { idPharmacie: 'pharmacie-1' },
      });
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'pharmacien-user' }]);

    const result = await choisirOffre(patient, 'commande-1', 'offre-1');

    expect(prisma.course.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        statut: StatutCourse.ATTRIBUEE,
        idLivreur: profil.id,
        prixGnf: 10_000,
        delaiAnnonceMinutes: 20,
        attribueeLe: expect.any(Date),
      }),
    }));
    expect(result.prixGnf).toBe(10_000);
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'pharmacien-user',
      type: 'COURSE_ATTRIBUEE',
    }));
    prisma.offreCourse.upsert.mockResolvedValue({
      id: 'offre-1', prixGnf: 99_000, delaiMinutes: 90, creeeLe: new Date(),
    });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      statut: StatutCourse.APPEL_OFFRES,
      quartier: profil.quartier,
      prefecture: profil.prefecture,
    });
    prisma.course.findUnique
      .mockResolvedValueOnce({
        id: 'course-1',
        statut: StatutCourse.APPEL_OFFRES,
        quartier: profil.quartier,
        prefecture: profil.prefecture,
      })
      .mockResolvedValueOnce({
        numero: 'LV-2026-000001',
        commande: { ordonnance: { consultation: { patient: { idUtilisateur: patient.userId } } } },
      });
    await proposer(livreur, 'course-1', { prixGnf: 99_000, delaiMinutes: 90 });
    expect(result.prixGnf).toBe(10_000);
  });
});

describe('remise et confirmation patient', () => {
  it('un QR incorrect ne change ni la course ni la commande', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      idStructure: 'pharmacie-1',
      structure: { type: 'PHARMACIE', estPartenaire: true },
    });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      statut: StatutCourse.ATTRIBUEE,
      idLivreur: profil.id,
      livreur: { qrCode: 'QR-ATTENDU' },
      commande: { id: 'commande-1', idPharmacie: 'pharmacie-1' },
    });

    await expect(remettreAuMotard(pharmacien, 'course-1', 'QR-INCORRECT'))
      .rejects.toThrow(/ne correspond pas au motard attribue/);
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it('refuse au livreur de declarer la reception', async () => {
    await expect(declarerRecu(livreur, 'course-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
  });

  it('un QR correspondant fait avancer course et commande dans la meme transaction', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      idStructure: 'pharmacie-1',
      structure: { type: 'PHARMACIE', estPartenaire: true },
    });
    prisma.course.findUnique
      .mockResolvedValueOnce({
        id: 'course-1',
        statut: StatutCourse.ATTRIBUEE,
        idLivreur: profil.id,
        livreur: { qrCode: 'QR-ATTENDU' },
        commande: { id: 'commande-1', idPharmacie: 'pharmacie-1' },
      })
      .mockResolvedValueOnce({ ...courseView, statut: StatutCourse.EN_COURS });
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    const result = await remettreAuMotard(pharmacien, 'course-1', 'QR-ATTENDU');

    expect(prisma.course.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'course-1', statut: StatutCourse.ATTRIBUEE, idLivreur: profil.id },
      data: expect.objectContaining({ statut: StatutCourse.EN_COURS, remiseLe: expect.any(Date) }),
    }));
    expect(prisma.commande.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'commande-1', statut: StatutCommande.PRETE_POUR_LIVRAISON },
      data: expect.objectContaining({ statut: StatutCommande.RETIREE }),
    }));
    expect(result.statut).toBe(StatutCourse.EN_COURS);
  });

  it('le patient proprietaire confirme la reception et cloture la commande ensemble', async () => {
    prisma.course.findUnique
      .mockResolvedValueOnce({
        id: 'course-1', statut: StatutCourse.EN_COURS, idCommande: 'commande-1',
      })
      .mockResolvedValueOnce({ ...courseView, statut: StatutCourse.LIVREE });
    prisma.commande.findUnique.mockResolvedValue({
      id: 'commande-1',
      statut: StatutCommande.RETIREE,
      modeRemise: 'LIVRAISON',
      idPharmacie: 'pharmacie-1',
      quartierRecherche: 'Kipé',
      ordonnance: { consultation: { patient: { idUtilisateur: patient.userId, prefecture: 'Conakry' } } },
    });
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    const result = await declarerRecu(patient, 'course-1');

    expect(prisma.course.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statut: StatutCourse.LIVREE, livreeLe: expect.any(Date) }),
    }));
    expect(prisma.commande.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'commande-1', statut: StatutCommande.RETIREE },
      data: expect.objectContaining({ statut: StatutCommande.CLOTUREE }),
    }));
    expect(result.statut).toBe(StatutCourse.LIVREE);
  });

  it('permet au patient de revenir au retrait sans motard avant la remise', async () => {
    prisma.course.findUnique
      .mockResolvedValueOnce({
        id: 'course-1', statut: StatutCourse.APPEL_OFFRES, idCommande: 'commande-1',
      })
      .mockResolvedValueOnce({ ...courseView, statut: StatutCourse.SANS_MOTARD });
    prisma.commande.findUnique.mockResolvedValue({
      id: 'commande-1',
      statut: StatutCommande.PRETE_POUR_LIVRAISON,
      modeRemise: 'LIVRAISON',
      idPharmacie: 'pharmacie-1',
      quartierRecherche: 'Kipé',
      ordonnance: { consultation: { patient: { idUtilisateur: patient.userId, prefecture: 'Conakry' } } },
    });
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.commande.updateMany.mockResolvedValue({ count: 1 });

    const result = await renoncerALaLivraison(patient, 'course-1', 'Je viens chercher');

    expect(prisma.course.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'course-1', statut: StatutCourse.APPEL_OFFRES },
      data: { statut: StatutCourse.SANS_MOTARD },
    }));
    expect(prisma.commande.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { statut: StatutCommande.PRETE_POUR_RETRAIT, modeRemise: 'RETRAIT_PHARMACIE' },
    }));
    expect(result.statut).toBe(StatutCourse.SANS_MOTARD);
  });
});

// R1 : une course sans offre s'arrete au delai final ; le patient choisit la suite.
describe('delai final de la course', () => {
  const MAINTENANT = new Date('2026-11-12T10:00:00Z');
  const pourNotifier = {
    numero: 'LV-2026-000001',
    commande: {
      idPharmacie: 'pharmacie-1',
      ordonnance: { consultation: { patient: { idUtilisateur: patient.userId } } },
    },
  };

  beforeEach(() => {
    prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
    prisma.course.findUnique.mockResolvedValue(pourNotifier);
    prisma.utilisateur.findMany.mockResolvedValue([{ id: 'pharmacien-user' }]);
  });

  it('ne prend que les courses sans offre ouvertes avant le delai', async () => {
    await conclureCoursesExpirees(60, MAINTENANT);

    expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        statut: StatutCourse.APPEL_OFFRES,
        // Des offres attendent le choix du patient : la course n'expire pas.
        offres: { none: {} },
        ouverteLe: { lte: new Date('2026-11-12T09:00:00Z') },
      },
    }));
  });

  it('passe sans motard, sans toucher a la commande, et previent patient et officine', async () => {
    const res = await conclureCoursesExpirees(60, MAINTENANT);

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 'course-1', statut: StatutCourse.APPEL_OFFRES, offres: { none: {} } },
      data: { statut: StatutCourse.SANS_MOTARD },
    });
    // Le patient choisit : relancer, ou aller chercher. Rien n'est decide pour lui.
    expect(prisma.commande.updateMany).not.toHaveBeenCalled();
    expect(res).toEqual({ conclues: 1 });
    const avis = (notifierSansBloquer as jest.Mock).mock.calls.map((c) => c[0]);
    expect(avis.map((a) => [a.idUtilisateur, a.type])).toEqual([
      [patient.userId, 'COURSE_SANS_MOTARD'],
      ['pharmacien-user', 'COURSE_SANS_MOTARD'],
    ]);
  });

  it('garde ouverte une course qui recoit une offre a la meme seconde', async () => {
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    expect(await conclureCoursesExpirees(60, MAINTENANT)).toEqual({ conclues: 0 });
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });
});

describe('relance de la course par le patient', () => {
  const commandeALivrer = {
    id: 'commande-1',
    statut: StatutCommande.PRETE_POUR_LIVRAISON,
    modeRemise: 'LIVRAISON',
    idPharmacie: 'pharmacie-1',
    quartierRecherche: 'Kipe',
    ordonnance: { consultation: { patient: { idUtilisateur: patient.userId, prefecture: 'Conakry' } } },
  };

  beforeEach(() => {
    prisma.course.findUnique
      .mockResolvedValueOnce({ id: 'course-1', statut: StatutCourse.SANS_MOTARD, idCommande: 'commande-1' })
      .mockResolvedValueOnce(courseView)
      .mockResolvedValueOnce({ numero: 'LV-2026-000001', quartier: 'Kipe', prefecture: 'Conakry', commune: 'Ratoma' });
    prisma.commande.findUnique.mockResolvedValue(commandeALivrer);
    prisma.livreurProfile.findMany.mockResolvedValue([{ utilisateur: { id: 'motard-ratoma' } }]);
  });

  it('rouvre l appel depuis la commune, delais remis a zero, et previent les motards', async () => {
    const res = await relancerCourse(patient, 'course-1');

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 'course-1', statut: StatutCourse.SANS_MOTARD },
      data: {
        statut: StatutCourse.APPEL_OFFRES,
        ouverteLe: expect.any(Date),
        voisinesLe: null,
        communesVoisines: [],
        elargieLe: null,
      },
    });
    expect((notifierSansBloquer as jest.Mock).mock.calls.map((c) => [c[0].idUtilisateur, c[0].type]))
      .toEqual([['motard-ratoma', 'COURSE_OUVERTE']]);
    expect(res.statut).toBe(StatutCourse.APPEL_OFFRES);
  });

  it('refuse une commande deja repassee au retrait', async () => {
    prisma.commande.findUnique.mockResolvedValue({ ...commandeALivrer, statut: StatutCommande.PRETE_POUR_RETRAIT });

    await expect(relancerCourse(patient, 'course-1')).rejects.toThrow("La commande n'attend plus de livraison");
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('refuse une course qui n est pas sans motard', async () => {
    prisma.course.findUnique.mockReset();
    prisma.course.findUnique.mockResolvedValue({ id: 'course-1', statut: StatutCourse.APPEL_OFFRES, idCommande: 'commande-1' });

    await expect(relancerCourse(patient, 'course-1')).rejects.toThrow('Seule une course sans livreur peut etre relancee');
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('refuse la commande d un autre patient', async () => {
    prisma.commande.findUnique.mockResolvedValue({
      ...commandeALivrer,
      ordonnance: { consultation: { patient: { idUtilisateur: 'autre-patient', prefecture: 'Conakry' } } },
    });

    await expect(relancerCourse(patient, 'course-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('perd sans rien ecrire si la course a change entre-temps', async () => {
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    await expect(relancerCourse(patient, 'course-1')).rejects.toBeInstanceOf(ConflictError);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });
});
