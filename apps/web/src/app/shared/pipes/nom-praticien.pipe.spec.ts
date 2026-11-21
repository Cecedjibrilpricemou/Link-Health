// « Dr » pour le medecin seul : une sage-femme n'est pas docteur.
import { NomPraticienPipe, nomPraticien } from './nom-praticien.pipe';

describe('le nom d un praticien', () => {
  it('Dr pour le medecin, et sans role connu ; le nom seul pour la sage-femme', () => {
    expect(nomPraticien({ prenom: 'Alpha', nom: 'Bah', role: 'MEDECIN' })).toBe('Dr Alpha Bah');
    expect(nomPraticien({ prenom: 'Alpha', nom: 'Bah' })).toBe('Dr Alpha Bah');
    expect(nomPraticien({ prenom: 'Awa', nom: 'Keita', role: 'SAGE_FEMME' })).toBe('Awa Keita');
    expect(new NomPraticienPipe().transform(null)).toBe('');
  });
});
