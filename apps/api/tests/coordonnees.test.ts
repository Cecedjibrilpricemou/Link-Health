import { ValidationError } from '../src/utils/app-error';
import { distanceKm, verifierCoordonnees } from '../src/utils/coordonnees';

describe('coordonnees', () => {
  it('accepte une position vide ou complète', () => {
    expect(() => verifierCoordonnees(undefined, undefined)).not.toThrow();
    expect(() => verifierCoordonnees(9.5, -13.7)).not.toThrow();
  });

  it('refuse une latitude sans longitude et inversement', () => {
    expect(() => verifierCoordonnees(9.5, undefined)).toThrow(ValidationError);
    expect(() => verifierCoordonnees(undefined, -13.7)).toThrow(ValidationError);
  });

  it('calcule la distance entre Conakry Kaloum et Kipé', () => {
    const d = distanceKm({ latitude: 9.5092, longitude: -13.7122 }, { latitude: 9.6170, longitude: -13.6380 });
    expect(d).toBeGreaterThanOrEqual(14);
    expect(d).toBeLessThanOrEqual(15);
  });

  it('donne une distance nulle à un point avec lui-même', () => {
    expect(distanceKm({ latitude: 9.5, longitude: -13.7 }, { latitude: 9.5, longitude: -13.7 })).toBe(0);
  });
});
