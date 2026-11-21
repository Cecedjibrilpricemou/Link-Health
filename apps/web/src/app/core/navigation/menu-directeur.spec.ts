// Le directeur, dans l'espace de son etablissement : son menu, et ses
// anciennes adresses.
import type { TypeStructure } from '@baobaoheath/shared-types';
import { accueilDuDirecteur, espaceDuDirecteur, rubriquesDirecteur, traduireAncienneAdresse } from './menu-directeur';

const titres = (type: TypeStructure | null, hosp = false) => rubriquesDirecteur(type, hosp).map((r) => r.titreKey.split('_').pop());
const routes = (type: TypeStructure | null, hosp = false) => rubriquesDirecteur(type, hosp).flatMap((r) => r.items.map((i) => i.route));

describe('l espace du directeur', () => {
  // Comme le titulaire en pharmacie : l'espace de son personnel, pas une
  // interface a part.
  it('un laboratoire : /laboratoire ; tout etablissement qui recoit : /hopital', () => {
    expect(espaceDuDirecteur('LABORATOIRE')).toBe('/laboratoire');
    for (const t of ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'] as TypeStructure[]) {
      expect(espaceDuDirecteur(t)).toBe('/hopital');
    }
    expect(accueilDuDirecteur('CHU')).toBe('/hopital/pilotage');
    expect(accueilDuDirecteur('LABORATOIRE')).toBe('/laboratoire/pilotage');
  });

  it('aucune entree du menu ne mene a l ancienne interface', () => {
    for (const t of ['POSTE', 'CENTRE', 'CHU', 'CLINIQUE', 'LABORATOIRE', null] as (TypeStructure | null)[]) {
      expect(routes(t, true).filter((r) => r.startsWith('/admin-structure'))).toEqual([]);
    }
  });
});

describe('le menu du directeur', () => {
  it('un CHU : accueil, laboratoire, equipe, pharmacies et assurances, dans /hopital', () => {
    expect(titres('CHU', true)).toEqual(['PILOTAGE', 'ACCUEIL', 'LABO', 'EQUIPE', 'ETABLISSEMENT']);
    const r = routes('CHU', true);
    for (const attendu of [
      '/hopital/pilotage', '/hopital/admission', '/hopital/episodes', '/hopital/presences',
      '/hopital/laboratoire/demandes', '/hopital/laboratoire/plateau-technique',
      '/hopital/agents', '/hopital/services', '/hopital/pharmacies', '/hopital/assurances',
      '/hopital/identites', '/hopital/dossier', '/hopital/apparence',
    ]) expect(r).toContain(attendu);
  });

  it('une clinique et un centre ont aussi accueil et laboratoire ; un centre sans pharmacies', () => {
    expect(titres('CLINIQUE', true)).toContain('LABO');
    expect(titres('CENTRE')).toEqual(['PILOTAGE', 'ACCUEIL', 'LABO', 'EQUIPE', 'ETABLISSEMENT']);
    expect(routes('CENTRE')).not.toContain('/hopital/pharmacies');
  });

  it('un poste de sante : l accueil, pas de laboratoire ni de services', () => {
    expect(titres('POSTE')).toEqual(['PILOTAGE', 'ACCUEIL', 'EQUIPE', 'ETABLISSEMENT']);
    expect(routes('POSTE')).not.toContain('/hopital/services');
  });

  it('un laboratoire : ses ecrans, dans /laboratoire, sans accueil, ni identites, ni conseilles', () => {
    expect(titres('LABORATOIRE')).toEqual(['PILOTAGE', 'LABO', 'EQUIPE', 'ETABLISSEMENT']);
    const r = routes('LABORATOIRE');
    for (const attendu of ['/laboratoire/pilotage', '/laboratoire/demandes', '/laboratoire/agents', '/laboratoire/dossier', '/laboratoire/apparence']) {
      expect(r).toContain(attendu);
    }
    expect(r.some((x) => x.startsWith('/hopital'))).toBe(false);
    expect(r).not.toContain('/laboratoire/conseillees');
    expect(r).not.toContain('/laboratoire/services');
  });

  it('tant que la structure n est pas connue : l essentiel', () => {
    expect(titres(null)).toEqual(['PILOTAGE', 'EQUIPE', 'ETABLISSEMENT']);
  });

  // Tout, sauf le soin.
  it('aucune entree ne mene au soin', () => {
    for (const type of ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'LABORATOIRE'] as TypeStructure[]) {
      expect(routes(type, true).filter((r) => /consultation|ordonnance|resultat|dossier-medical|medecin|alertes/.test(r))).toEqual([]);
    }
  });

  it('chaque route n apparait qu une fois', () => {
    const r = routes('CHU', true);
    expect(new Set(r).size).toBe(r.length);
  });
});

describe('les anciennes adresses de l administration', () => {
  it('menent a l ecran equivalent de l espace', () => {
    expect(traduireAncienneAdresse('/admin-structure', 'CHU')).toBe('/hopital/pilotage');
    expect(traduireAncienneAdresse('/admin-structure/dashboard', 'CHU')).toBe('/hopital/pilotage');
    expect(traduireAncienneAdresse('/admin-structure/agents', 'CHU')).toBe('/hopital/agents');
    expect(traduireAncienneAdresse('/admin-structure/accueil/episodes/ep-1', 'CHU')).toBe('/hopital/episodes/ep-1');
    expect(traduireAncienneAdresse('/admin-structure/laboratoire/demandes/d-1', 'CHU')).toBe('/hopital/laboratoire/demandes/d-1');
  });

  it('pour un laboratoire, son espace ; la requete est gardee', () => {
    expect(traduireAncienneAdresse('/admin-structure/dashboard', 'LABORATOIRE')).toBe('/laboratoire/pilotage');
    expect(traduireAncienneAdresse('/admin-structure/laboratoire/demandes', 'LABORATOIRE')).toBe('/laboratoire/demandes');
    expect(traduireAncienneAdresse('/admin-structure/dossier?piece=x', 'LABORATOIRE')).toBe('/laboratoire/dossier?piece=x');
  });
});
