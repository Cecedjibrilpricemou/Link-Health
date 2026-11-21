// Le menu de l'administrateur : tout son etablissement, selon ce qu'il fait.
import type { TypeStructure } from '@baobaoheath/shared-types';
import { rubriquesAdmin } from './admin-structure-nav';

const titres = (type: TypeStructure | null, hosp = false) => rubriquesAdmin(type, hosp).map((r) => r.titreKey.split('_').pop());
const routes = (type: TypeStructure | null, hosp = false) => rubriquesAdmin(type, hosp).flatMap((r) => r.items.map((i) => i.route));

describe('le menu de l administrateur de structure', () => {
  it('un CHU : accueil, laboratoire, equipe, pharmacies et assurances', () => {
    expect(titres('CHU', true)).toEqual(['PILOTAGE', 'ACCUEIL', 'LABO', 'EQUIPE', 'ETABLISSEMENT']);
    const r = routes('CHU', true);
    for (const attendu of [
      '/admin-structure/accueil/admission', '/admin-structure/accueil/episodes', '/admin-structure/accueil/presences',
      '/admin-structure/laboratoire/demandes', '/admin-structure/laboratoire/plateau-technique',
      '/admin-structure/agents', '/admin-structure/pharmacies', '/admin-structure/assurances',
      '/admin-structure/identites', '/admin-structure/dossier', '/admin-structure/apparence',
    ]) expect(r).toContain(attendu);
  });

  it('une clinique et un centre de sante ont aussi accueil et laboratoire', () => {
    expect(titres('CLINIQUE', true)).toContain('LABO');
    expect(titres('CENTRE')).toEqual(['PILOTAGE', 'ACCUEIL', 'LABO', 'EQUIPE', 'ETABLISSEMENT']);
    expect(routes('CENTRE')).not.toContain('/admin-structure/pharmacies');
  });

  it('un poste de sante : l accueil, pas de laboratoire', () => {
    expect(titres('POSTE')).toEqual(['PILOTAGE', 'ACCUEIL', 'EQUIPE', 'ETABLISSEMENT']);
  });

  it('un laboratoire : son activite, sans accueil, ni identites, ni laboratoires conseilles', () => {
    expect(titres('LABORATOIRE')).toEqual(['PILOTAGE', 'LABO', 'EQUIPE', 'ETABLISSEMENT']);
    const r = routes('LABORATOIRE');
    expect(r).not.toContain('/admin-structure/conseillees');
    expect(r).not.toContain('/admin-structure/identites');
  });

  it('tant que la structure n est pas connue : l essentiel', () => {
    expect(titres(null)).toEqual(['PILOTAGE', 'EQUIPE', 'ETABLISSEMENT']);
  });

  // Tout, sauf le soin : aucune entree vers une consultation, un dossier
  // medical, une ordonnance ou des resultats.
  it('aucune entree ne mene au soin', () => {
    for (const type of ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'LABORATOIRE'] as TypeStructure[]) {
      expect(routes(type, true).filter((r) => /consultation|ordonnance|resultat|dossier-medical|medecin/.test(r))).toEqual([]);
    }
  });

  it('chaque route n apparait qu une fois', () => {
    const r = routes('CHU', true);
    expect(new Set(r).size).toBe(r.length);
  });

  it('les services : dans l equipe des hopitaux, cliniques et centres ; pas au poste ni au laboratoire', () => {
    for (const type of ['CHU', 'CLINIQUE', 'CENTRE', 'HOPITAL_PREF'] as TypeStructure[]) {
      expect(routes(type, true)).toContain('/admin-structure/services');
    }
    expect(routes('POSTE')).not.toContain('/admin-structure/services');
    expect(routes('LABORATOIRE')).not.toContain('/admin-structure/services');
  });
});

