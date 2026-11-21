// Le menu de l'administrateur de structure : tout son etablissement, par
// rubriques, selon ce que la structure fait.
//
// **Une seule interface.** Comme le titulaire d'une officine, l'administrateur
// d'un hopital, d'une clinique ou d'un centre de sante trouve ici l'accueil,
// le laboratoire, son equipe et son etablissement. Il ne change pas
// d'interface pour suivre une admission ou une analyse.
//
// **Tout, sauf le soin** : aucune entree n'ouvre une consultation, une
// prescription ou une valeur d'analyse (l'API les lui refuse).
import type { TypeStructure } from '@baobaoheath/shared-types';

export interface EntreeNav {
  labelKey: string;
  icon: string;
  route: string;
}

export interface RubriqueNav {
  titreKey: string;
  items: EntreeNav[];
}

/** Les structures qui recoivent des patients : elles ont un accueil. */
export const TYPES_AVEC_ACCUEIL: readonly TypeStructure[] = ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'];
/** Les structures qui ont des services (Urgences, Maternite...). */
export const TYPES_AVEC_SERVICES: readonly TypeStructure[] = ['CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'];
/** Les structures qui realisent des analyses. */
export const TYPES_AVEC_LABORATOIRE: readonly TypeStructure[] = ['CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'LABORATOIRE'];

const R = '/admin-structure';

/**
 * Les rubriques du menu. `type` vaut `null` tant que la structure n'est pas
 * connue : le menu montre alors l'essentiel, puis se complete.
 */
export function rubriquesAdmin(type: TypeStructure | null, hospitaliere: boolean): RubriqueNav[] {
  const rubriques: RubriqueNav[] = [
    { titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_PILOTAGE', items: [
      { labelKey: 'ADMIN_STRUCTURE.NAV_DASHBOARD', icon: 'pi-home', route: `${R}/dashboard` },
    ] },
  ];

  if (type && TYPES_AVEC_ACCUEIL.includes(type)) {
    rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_ACCUEIL', items: [
      { labelKey: 'ADMIN_STRUCTURE.NAV_ACCUEIL_ACTIVITE', icon: 'pi-chart-bar', route: `${R}/accueil/tableau-de-bord` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_ADMISSIONS', icon: 'pi-user-plus', route: `${R}/accueil/admission` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_RDV', icon: 'pi-inbox', route: `${R}/accueil/demandes` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_PRESENCES', icon: 'pi-check-square', route: `${R}/accueil/presences` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_EPISODES', icon: 'pi-folder', route: `${R}/accueil/episodes` },
    ] });
  }

  if (type && TYPES_AVEC_LABORATOIRE.includes(type)) {
    rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_LABO', items: [
      { labelKey: 'ADMIN_STRUCTURE.NAV_LABO_ACTIVITE', icon: 'pi-chart-line', route: `${R}/laboratoire/tableau-de-bord` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_PLATEAU', icon: 'pi-th-large', route: `${R}/laboratoire/plateau-technique` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_ANALYSES', icon: 'pi-filter', route: `${R}/laboratoire/demandes` },
    ] });
  }

  const equipe: EntreeNav[] = [{ labelKey: 'ADMIN_STRUCTURE.NAV_AGENTS', icon: 'pi-users', route: `${R}/agents` }];
  if (type && TYPES_AVEC_SERVICES.includes(type)) {
    equipe.push({ labelKey: 'ADMIN_STRUCTURE.NAV_SERVICES', icon: 'pi-sitemap', route: `${R}/services` });
  }
  rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_EQUIPE', items: equipe });

  const etablissement: EntreeNav[] = [];
  if (hospitaliere) {
    etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_PHARMACIES', icon: 'pi-building', route: `${R}/pharmacies` });
    etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_ASSURANCES', icon: 'pi-shield', route: `${R}/assurances` });
  }
  // Un laboratoire ne conseille pas d'autres laboratoires a ses medecins.
  if (type !== 'LABORATOIRE') {
    etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_CONSEILLEES', icon: 'pi-sitemap', route: `${R}/conseillees` });
  }
  if (!type || TYPES_AVEC_ACCUEIL.includes(type)) {
    etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_IDENTITES', icon: 'pi-id-card', route: `${R}/identites` });
  }
  etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_DOSSIER', icon: 'pi-folder-open', route: `${R}/dossier` });
  etablissement.push({ labelKey: 'APPARENCE.NAV', icon: 'pi-palette', route: `${R}/apparence` });
  rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_ETABLISSEMENT', items: etablissement });

  return rubriques;
}
