// Les metiers du personnel, et ce que l'API en recoit.
import { libelleSpecialite, metierDe, metiersPour, SPECIALITES_DE_SPECIALISTE, versCreation } from './metiers-personnel';

describe('les metiers du personnel', () => {
  it('un hopital : medecins, dentistes, accueil, laboratoire ; pas d agents communautaires', () => {
    expect(metiersPour('CHU')).toEqual([
      'MEDECIN_GENERALISTE', 'MEDECIN_SPECIALISTE', 'CHIRURGIEN_DENTISTE', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO',
    ]);
  });

  it('un centre de sante : tout, agents communautaires compris ; un laboratoire : ses techniciens', () => {
    expect(metiersPour('CENTRE')).toContain('ASC');
    expect(metiersPour('CENTRE')).toContain('ASC_SUPERVISOR');
    expect(metiersPour('LABORATOIRE')).toEqual(['TECHNICIEN_LABO']);
    expect(metiersPour(null)).toEqual([]);
  });

  it('un metier medical devient un medecin, avec sa specialite', () => {
    expect(versCreation('MEDECIN_GENERALISTE')).toEqual({ role: 'MEDECIN', specialite: 'MEDECINE_GENERALE' });
    expect(versCreation('CHIRURGIEN_DENTISTE')).toEqual({ role: 'MEDECIN', specialite: 'DENTAIRE' });
    expect(versCreation('MEDECIN_SPECIALISTE', 'PEDIATRIE')).toEqual({ role: 'MEDECIN', specialite: 'PEDIATRIE' });
    expect(versCreation('AGENT_ACCUEIL')).toEqual({ role: 'AGENT_ACCUEIL' });
  });

  it('et se relit depuis un compte existant', () => {
    expect(metierDe('MEDECIN', null)).toBe('MEDECIN_GENERALISTE');
    expect(metierDe('MEDECIN', 'DENTAIRE')).toBe('CHIRURGIEN_DENTISTE');
    expect(metierDe('MEDECIN', 'CARDIOLOGIE')).toBe('MEDECIN_SPECIALISTE');
    expect(metierDe('TECHNICIEN_LABO')).toBe('TECHNICIEN_LABO');
    expect(metierDe('SUPER_ADMIN')).toBeNull();
  });

  it('un specialiste n est ni generaliste ni dentiste', () => {
    expect(SPECIALITES_DE_SPECIALISTE).not.toContain('MEDECINE_GENERALE');
    expect(SPECIALITES_DE_SPECIALISTE).not.toContain('DENTAIRE');
    expect(SPECIALITES_DE_SPECIALISTE).toContain('PEDIATRIE');
  });

  it('le libelle d une specialite : traduit, ou tel que saisi avant la liste', () => {
    const t = (c: string) => `[${c}]`;
    expect(libelleSpecialite(t, 'ORL')).toBe('[SPECIALITE.ORL]');
    expect(libelleSpecialite(t, 'Généraliste')).toBe('Généraliste');
    expect(libelleSpecialite(t, null)).toBeUndefined();
  });
});
