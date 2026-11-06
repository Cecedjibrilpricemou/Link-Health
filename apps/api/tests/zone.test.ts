// La zone d'une ordonnance ou d'une course : la commune, dans sa prefecture.
import { CHAMPS_RECHERCHE, filtreZone, memeZone, zoneDe, zoneDeLaCommande } from '../src/utils/zone';

const RATOMA_KIPE = { prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé' };

describe('memeZone', () => {
  it('même commune, autre quartier : même zone (la pharmacie voisine est sollicitée)', () => {
    expect(memeZone(RATOMA_KIPE, { prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Taouyah' })).toBe(true);
  });

  it('ignore la casse et les espaces', () => {
    expect(memeZone(RATOMA_KIPE, { prefecture: ' conakry ', commune: 'RATOMA ', quartier: 'x' })).toBe(true);
  });

  it('autre commune : hors zone, même avec un quartier du même nom', () => {
    expect(memeZone(RATOMA_KIPE, { prefecture: 'Conakry', commune: 'Matoto', quartier: 'Kipé' })).toBe(false);
  });

  it('autre préfecture : hors zone, même avec une commune et un quartier du même nom', () => {
    expect(memeZone(RATOMA_KIPE, { prefecture: 'Coyah', commune: 'Ratoma', quartier: 'Kipé' })).toBe(false);
  });

  it('repli sur le quartier quand l’un des deux n’a pas de commune', () => {
    expect(memeZone(RATOMA_KIPE, { prefecture: 'Conakry', commune: null, quartier: 'kipé' })).toBe(true);
    expect(memeZone(RATOMA_KIPE, { prefecture: 'Conakry', commune: null, quartier: 'Taouyah' })).toBe(false);
  });

  it('ancienne commande sans préfecture : compare comme avant, par le quartier', () => {
    expect(memeZone({ quartier: 'Kipé' }, RATOMA_KIPE)).toBe(true);
    expect(memeZone({ quartier: 'Taouyah' }, RATOMA_KIPE)).toBe(false);
  });

  it('rien en commun à comparer : hors zone', () => {
    expect(memeZone({ prefecture: 'Conakry' }, { prefecture: 'Conakry' })).toBe(false);
  });
});

describe('zoneDe', () => {
  it('garde préfecture, commune et quartier', () => {
    expect(zoneDe(RATOMA_KIPE)).toEqual({ prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé' });
  });
  it('refuse de deviner sans préfecture, ou sans commune ni quartier', () => {
    expect(zoneDe({ commune: 'Ratoma' })).toBeNull();
    expect(zoneDe({ prefecture: 'Conakry', commune: ' ', quartier: null })).toBeNull();
  });
});

describe('filtreZone (Prisma)', () => {
  const egal = (v: string) => ({ equals: v, mode: 'insensitive' });

  it('commune connue : même préfecture, et même commune ou (pas de commune et même quartier)', () => {
    expect(filtreZone(RATOMA_KIPE)).toEqual({
      AND: [
        { prefecture: egal('Conakry') },
        { OR: [{ commune: egal('Ratoma') }, { commune: null, quartier: egal('Kipé') }] },
      ],
    });
  });

  it('sans commune : même préfecture et même quartier', () => {
    expect(filtreZone({ prefecture: 'Conakry', quartier: 'Kipé' })).toEqual({
      AND: [{ prefecture: egal('Conakry') }, { quartier: egal('Kipé') }],
    });
  });

  it('écrit les noms de champs du modèle visé (commande), préfecture facultative pour les anciennes', () => {
    expect(filtreZone(RATOMA_KIPE, CHAMPS_RECHERCHE, { prefectureFacultative: true })).toEqual({
      AND: [
        { OR: [{ prefectureRecherche: egal('Conakry') }, { prefectureRecherche: null }] },
        { OR: [{ communeRecherche: egal('Ratoma') }, { communeRecherche: null, quartierRecherche: egal('Kipé') }] },
      ],
    });
  });

  it('se combine avec un autre OR de l’appelant sans l’écraser', () => {
    const where = { OR: [{ a: 1 }, { b: 2 }], ...filtreZone(RATOMA_KIPE) };
    expect(where.OR).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('zoneDeLaCommande : la zone figée, sous forme de lieu', () => {
    expect(zoneDeLaCommande({ prefectureRecherche: 'Conakry', communeRecherche: 'Ratoma', quartierRecherche: 'Kipé' }))
      .toEqual(RATOMA_KIPE);
  });

  it('zone inconnue : un filtre qui ne retient rien, plutôt que tout', () => {
    expect(filtreZone({ prefecture: 'Conakry' })).toEqual({ id: '__aucune_zone__' });
  });
});
