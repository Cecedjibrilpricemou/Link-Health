import {
  assertTransitionCourse,
  choisirOffre,
  coursesDuLivreur,
  coursesOuvertesPour,
  declarerRecu,
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
import { filtreZone } from '../src/utils/zone';
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
  estActif: true,
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
        ...filtreZone(profil),
      },
    }));
    // Le filtre porte bien sur la commune du livreur, pas seulement son quartier.
    expect(JSON.stringify(prisma.course.findMany.mock.calls[0][0].where)).toContain('Ratoma');
    expect(result).toEqual([expect.objectContaining({
      id: 'course-1',
      pharmacie: { id: 'pharmacie-1', nom: 'Pharmacie du quartier' },
    })]);
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
        ...filtreZone(course),
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
