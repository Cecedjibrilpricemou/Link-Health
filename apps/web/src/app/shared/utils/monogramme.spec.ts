// Les initiales d'une structure, en attendant son logo.
import { monogramme } from './monogramme';

describe('monogramme', () => {
  it('garde un sigle de tete tel quel', () => {
    expect(monogramme('CHU Donka')).toBe('CHU');
    expect(monogramme('CMC Flamboyants')).toBe('CMC');
  });

  it('prend les initiales des deux premiers mots utiles', () => {
    expect(monogramme('Clinique Pasteur')).toBe('CP');
    expect(monogramme('Centre de santé de Matam')).toBe('CS');
    expect(monogramme("Hôpital national Ignace Deen")).toBe('HN');
    expect(monogramme("Pharmacie de l'Espoir")).toBe('PE');
  });

  it('un seul mot, ou des minuscules : une initiale capitale', () => {
    expect(monogramme('dispensaire')).toBe('D');
    expect(monogramme('  hôpital   régional ')).toBe('HR');
  });

  it('jamais vide', () => {
    expect(monogramme('')).toBe('?');
    expect(monogramme('de la')).toBe('DL');
  });
});
