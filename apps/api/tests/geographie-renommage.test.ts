// R7 : renommer et supprimer un lieu du referentiel.
//
// Le nom d'une commune ou d'une prefecture est recopie en texte dans les
// adresses et les appels en cours. Ce qui compte :
// - renommer propage le nom, dans la bonne zone seulement, et le journalise ;
// - les appels en cours suivent (communes voisines gardees en cle) ;
// - un renommage qui melangerait deux lieux est refuse ;
// - un autre niveau (region) ne touche aucune adresse ;
// - supprimer n'est permis qu'a un lieu inutilise, et nettoie le voisinage.
import type { ParametresPaysView } from '@baobaoheath/shared-types';
import { renommerLieu, supprimerLieu, utilisationLieu } from '../src/services/geographie.service';
import { ConflictError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => {
  const prisma: Record<string, unknown> = {
    lieuGeo: { findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    structureSante: { count: jest.fn(), updateMany: jest.fn() },
    patientProfile: { count: jest.fn(), updateMany: jest.fn() },
    livreurProfile: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    commande: { findMany: jest.fn(), update: jest.fn() },
    course: { findMany: jest.fn(), update: jest.fn() },
    journalAudit: { create: jest.fn() },
  };
  prisma['$transaction'] = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../src/services/parametres.service', () => ({ getValeursParametres: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    lieuGeo: { findMany: M; update: M; delete: M };
    structureSante: { count: M; updateMany: M };
    patientProfile: { count: M; updateMany: M };
    livreurProfile: { findMany: M; update: M; updateMany: M };
    commande: { findMany: M; update: M };
    course: { findMany: M; update: M };
    journalAudit: { create: M };
    $transaction: M;
  };
};
const { getValeursParametres } = jest.requireMock('../src/services/parametres.service') as { getValeursParametres: M };

const GUINEE: ParametresPaysView = {
  code: 'GN', nom: 'Guinée', indicatifTelephone: '+224', longueurNumero: 9,
  niveaux: [
    { code: 'region', libelles: { fr: 'Région' } },
    { code: 'prefecture', libelles: { fr: 'Préfecture' } },
    { code: 'commune', libelles: { fr: 'Commune' } },
  ],
  niveauBase: 'commune', niveauElargissement: 'prefecture',
};

const lieu = (id: string, niveau: string, nom: string, idParent: string | null, voisins: string[] = []) =>
  ({ id, niveau, nom, idParent, voisins, aValider: false });

const REG = lieu('r-cky', 'region', 'Conakry', null);
const PREF = lieu('p-cky', 'prefecture', 'Conakry', 'r-cky');
const RATOMAH = lieu('c-ratomah', 'commune', 'Ratomah', 'p-cky', ['c-dixinn']);
const DIXINN = lieu('c-dixinn', 'commune', 'Dixinn', 'p-cky', ['c-ratomah']);
const REG_KINDIA = lieu('r-kindia', 'region', 'Kindia', null);
const PREF_KINDIA = lieu('p-kindia', 'prefecture', 'Kindia', 'r-kindia');
// Une commune homonyme, dans une autre prefecture : elle ne doit jamais bouger.
const RATOMAH_KINDIA = lieu('c-ratomah-kindia', 'commune', 'Ratomah', 'p-kindia');
const ARBRE = [REG, PREF, RATOMAH, DIXINN, REG_KINDIA, PREF_KINDIA, RATOMAH_KINDIA];

const AUTEUR = 'admin-1';
const MAINTENANT = new Date('2026-11-12T10:00:00.000Z');
const egal = (s: string) => ({ equals: s, mode: 'insensitive' });

function installer(lieux = ARBRE) {
  getValeursParametres.mockResolvedValue({ pays: GUINEE });
  prisma.lieuGeo.findMany.mockResolvedValue(lieux);
  prisma.lieuGeo.update.mockImplementation(({ where, data }) =>
    Promise.resolve({ ...lieux.find((l) => l.id === where.id), ...data }));
  prisma.structureSante.count.mockResolvedValue(0);
  prisma.patientProfile.count.mockResolvedValue(0);
  prisma.structureSante.updateMany.mockResolvedValue({ count: 0 });
  prisma.patientProfile.updateMany.mockResolvedValue({ count: 0 });
  prisma.livreurProfile.updateMany.mockResolvedValue({ count: 0 });
  prisma.livreurProfile.findMany.mockResolvedValue([]);
  prisma.commande.findMany.mockResolvedValue([]);
  prisma.course.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  installer();
});

describe('renommer une commune (niveau de base)', () => {
  it('propage le nom aux adresses de sa prefecture seulement, et le journalise', async () => {
    prisma.structureSante.updateMany.mockResolvedValue({ count: 3 });
    prisma.patientProfile.updateMany.mockResolvedValue({ count: 40 });

    const r = await renommerLieu(AUTEUR, 'c-ratomah', ' Ratoma ', MAINTENANT);

    expect(prisma.lieuGeo.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-ratomah' }, data: { nom: 'Ratoma' } }));
    const where = { prefecture: egal('Conakry'), commune: egal('Ratomah') };
    expect(prisma.structureSante.updateMany).toHaveBeenCalledWith({ where, data: { commune: 'Ratoma' } });
    expect(prisma.patientProfile.updateMany).toHaveBeenCalledWith({ where, data: { commune: 'Ratoma' } });
    expect(r.lieu.nom).toBe('Ratoma');
    expect(r.renommes).toMatchObject({ structures: 3, patients: 40 });
    expect(prisma.journalAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'RENOMMAGE_LIEU', ressource: 'geo_lieux', idRessource: 'c-ratomah', idUtilisateur: AUTEUR, creeLe: MAINTENANT,
        metadonnees: expect.objectContaining({ avant: 'Ratomah', apres: 'Ratoma' }),
      }),
    });
  });

  it('renomme l adresse et les communes desservies des motards de la zone', async () => {
    prisma.livreurProfile.findMany.mockResolvedValue([
      { id: 'l1', commune: 'ratomah', communesDesservies: ['Dixinn'] },
      { id: 'l2', commune: 'Dixinn', communesDesservies: ['Ratomah ', 'Matam'] },
      { id: 'l3', commune: 'Matam', communesDesservies: [] },
    ]);

    const r = await renommerLieu(AUTEUR, 'c-ratomah', 'Ratoma', MAINTENANT);

    expect(prisma.livreurProfile.findMany.mock.calls[0][0].where).toEqual({ prefecture: egal('Conakry') });
    expect(prisma.livreurProfile.update).toHaveBeenCalledTimes(2);
    expect(prisma.livreurProfile.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { commune: 'Ratoma', communesDesservies: ['Dixinn'] } });
    expect(prisma.livreurProfile.update).toHaveBeenCalledWith({ where: { id: 'l2' }, data: { commune: 'Dixinn', communesDesservies: ['Ratoma', 'Matam'] } });
    expect(r.renommes.motards).toBe(2);
  });

  it('les appels en cours suivent : commune cherchee et voisines (en cle)', async () => {
    prisma.commande.findMany.mockResolvedValue([
      { id: 'cmd-1', communeRecherche: 'Ratomah', communesVoisines: [] },
      { id: 'cmd-2', communeRecherche: 'Matam', communesVoisines: ['ratomah', 'dixinn'] },
      { id: 'cmd-3', communeRecherche: 'Matam', communesVoisines: ['dixinn'] },
    ]);
    prisma.course.findMany.mockResolvedValue([{ id: 'crs-1', commune: 'Ratomah', communesVoisines: ['dixinn'] }]);

    const r = await renommerLieu(AUTEUR, 'c-ratomah', 'Ratoma', MAINTENANT);

    expect(prisma.commande.findMany.mock.calls[0][0].where).toEqual({ statut: 'RECHERCHE_PHARMACIE', prefectureRecherche: egal('Conakry') });
    expect(prisma.course.findMany.mock.calls[0][0].where).toEqual({ statut: 'APPEL_OFFRES', prefecture: egal('Conakry') });
    expect(prisma.commande.update).toHaveBeenCalledWith({ where: { id: 'cmd-1' }, data: { communeRecherche: 'Ratoma', communesVoisines: [] } });
    expect(prisma.commande.update).toHaveBeenCalledWith({ where: { id: 'cmd-2' }, data: { communeRecherche: 'Matam', communesVoisines: ['ratoma', 'dixinn'] } });
    expect(prisma.commande.update).toHaveBeenCalledTimes(2);
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 'crs-1' }, data: { commune: 'Ratoma', communesVoisines: ['dixinn'] } });
    expect(r.renommes.appelsEnCours).toBe(3);
  });

  it('une simple correction de casse est permise', async () => {
    await renommerLieu(AUTEUR, 'c-dixinn', 'DIXINN', MAINTENANT);
    expect(prisma.lieuGeo.update).toHaveBeenCalled();
  });
});

describe('renommer une prefecture (niveau d elargissement)', () => {
  it('propage a toutes les adresses et appels de la prefecture', async () => {
    prisma.livreurProfile.updateMany.mockResolvedValue({ count: 5 });
    prisma.commande.findMany.mockResolvedValue([{ id: 'cmd-1', communeRecherche: 'Matam', communesVoisines: [] }]);
    prisma.course.findMany.mockResolvedValue([{ id: 'crs-1', commune: 'Matam', communesVoisines: [] }]);

    const r = await renommerLieu(AUTEUR, 'p-kindia', 'Kindia Centre', MAINTENANT);

    const where = { prefecture: egal('Kindia') };
    expect(prisma.structureSante.updateMany).toHaveBeenCalledWith({ where, data: { prefecture: 'Kindia Centre' } });
    expect(prisma.patientProfile.updateMany).toHaveBeenCalledWith({ where, data: { prefecture: 'Kindia Centre' } });
    expect(prisma.livreurProfile.updateMany).toHaveBeenCalledWith({ where, data: { prefecture: 'Kindia Centre' } });
    expect(prisma.commande.update).toHaveBeenCalledWith({ where: { id: 'cmd-1' }, data: { prefectureRecherche: 'Kindia Centre' } });
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 'crs-1' }, data: { prefecture: 'Kindia Centre' } });
    expect(r.renommes).toEqual({ structures: 0, patients: 0, motards: 5, appelsEnCours: 2 });
  });
});

describe('renommer une region', () => {
  it('aucune adresse ne porte son nom : seul le referentiel change', async () => {
    const r = await renommerLieu(AUTEUR, 'r-kindia', 'Basse-Guinée', MAINTENANT);

    expect(prisma.lieuGeo.update).toHaveBeenCalled();
    expect(prisma.structureSante.updateMany).not.toHaveBeenCalled();
    expect(prisma.patientProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.commande.findMany).not.toHaveBeenCalled();
    expect(r.renommes).toEqual({ structures: 0, patients: 0, motards: 0, appelsEnCours: 0 });
  });
});

describe('renommages refuses', () => {
  const rienEcrit = () => {
    expect(prisma.lieuGeo.update).not.toHaveBeenCalled();
    expect(prisma.structureSante.updateMany).not.toHaveBeenCalled();
    expect(prisma.journalAudit.create).not.toHaveBeenCalled();
  };

  it('vers le nom d un autre lieu de la zone : leurs adresses se melangeraient', async () => {
    await expect(renommerLieu(AUTEUR, 'c-ratomah', 'dixinn', MAINTENANT)).rejects.toBeInstanceOf(ConflictError);
    rienEcrit();
  });

  it('quand l ancien nom est porte par un autre lieu de la meme zone', async () => {
    installer([...ARBRE, lieu('c-ratomah-bis', 'commune', 'Ratomah', 'p-cky')]);
    await expect(renommerLieu(AUTEUR, 'c-ratomah', 'Ratoma', MAINTENANT)).rejects.toThrow('aussi');
    rienEcrit();
  });

  it('un homonyme dans une autre prefecture ne bloque pas', async () => {
    await renommerLieu(AUTEUR, 'c-ratomah', 'Ratoma', MAINTENANT);
    expect(prisma.lieuGeo.update).toHaveBeenCalled();
  });

  it('vers le nom d une autre prefecture', async () => {
    await expect(renommerLieu(AUTEUR, 'p-kindia', 'conakry', MAINTENANT)).rejects.toBeInstanceOf(ConflictError);
    rienEcrit();
  });

  it('vers le nom d un frere, a un niveau non recopie', async () => {
    await expect(renommerLieu(AUTEUR, 'r-kindia', 'CONAKRY', MAINTENANT)).rejects.toBeInstanceOf(ConflictError);
    rienEcrit();
  });

  it('un nom vide ou inchange', async () => {
    await expect(renommerLieu(AUTEUR, 'c-ratomah', '   ', MAINTENANT)).rejects.toBeInstanceOf(ValidationError);
    await expect(renommerLieu(AUTEUR, 'c-ratomah', 'Ratomah', MAINTENANT)).rejects.toBeInstanceOf(ValidationError);
    rienEcrit();
  });

  it('un lieu inconnu', async () => {
    await expect(renommerLieu(AUTEUR, 'x', 'Ratoma', MAINTENANT)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('utilisation d un lieu', () => {
  it('compte enfants, adresses de la zone et appels en cours', async () => {
    prisma.structureSante.count.mockResolvedValue(2);
    prisma.patientProfile.count.mockResolvedValue(7);
    prisma.livreurProfile.findMany.mockResolvedValue([
      { id: 'l1', commune: 'Dixinn', communesDesservies: ['ratomah'] },
      { id: 'l2', commune: 'Dixinn', communesDesservies: [] },
    ]);
    prisma.course.findMany.mockResolvedValue([{ id: 'crs-1', commune: 'Matam', communesVoisines: ['ratomah'] }]);

    expect(await utilisationLieu('c-ratomah')).toEqual({ enfants: 0, structures: 2, patients: 7, motards: 1, appelsEnCours: 1 });
    expect(prisma.structureSante.count).toHaveBeenCalledWith({ where: { prefecture: egal('Conakry'), commune: egal('Ratomah') } });
  });

  it('une prefecture compte ses communes comme enfants', async () => {
    expect((await utilisationLieu('p-cky')).enfants).toBe(2);
  });
});

describe('supprimer un lieu', () => {
  it('inutilise : supprime, retire le voisinage des deux cotes, journalise', async () => {
    await supprimerLieu(AUTEUR, 'c-ratomah', MAINTENANT);

    expect(prisma.lieuGeo.update).toHaveBeenCalledWith({ where: { id: 'c-dixinn' }, data: { voisins: [] } });
    expect(prisma.lieuGeo.delete).toHaveBeenCalledWith({ where: { id: 'c-ratomah' } });
    expect(prisma.journalAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'SUPPRESSION_LIEU', idRessource: 'c-ratomah', idUtilisateur: AUTEUR }),
    });
  });

  it('refuse un lieu qui contient d autres lieux', async () => {
    await expect(supprimerLieu(AUTEUR, 'p-cky', MAINTENANT)).rejects.toThrow('contient 2');
    expect(prisma.lieuGeo.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['une structure', () => prisma.structureSante.count.mockResolvedValue(1)],
    ['un patient', () => prisma.patientProfile.count.mockResolvedValue(1)],
    ['un motard', () => prisma.livreurProfile.findMany.mockResolvedValue([{ id: 'l1', commune: 'Ratomah', communesDesservies: [] }])],
    ['un appel en cours', () => prisma.commande.findMany.mockResolvedValue([{ id: 'c', communeRecherche: 'Ratomah', communesVoisines: [] }])],
  ])('refuse un lieu encore porte par %s', async (_quoi, poser) => {
    poser();
    await expect(supprimerLieu(AUTEUR, 'c-ratomah', MAINTENANT)).rejects.toThrow('encore utilise');
    expect(prisma.lieuGeo.delete).not.toHaveBeenCalled();
    expect(prisma.lieuGeo.update).not.toHaveBeenCalled();
    expect(prisma.journalAudit.create).not.toHaveBeenCalled();
  });

  it('un lieu inconnu', async () => {
    await expect(supprimerLieu(AUTEUR, 'x', MAINTENANT)).rejects.toBeInstanceOf(NotFoundError);
  });
});
