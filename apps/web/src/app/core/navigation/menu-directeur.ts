// core/navigation/menu-directeur.ts — le directeur, dans l'espace de son etablissement.
//
// **Pas d'interface a part.** Comme le titulaire d'une officine, qui tient
// son comptoir et gere son officine depuis l'espace pharmacie, le directeur
// d'un hopital, d'un centre ou d'un laboratoire entre dans l'espace de son
// etablissement - celui de son personnel - et y voit en plus les menus de
// gestion : son equipe, ses services, ses pharmacies, son dossier.
//
//   - un etablissement qui recoit des patients : l'espace de l'accueil, /hopital ;
//   - un laboratoire : l'espace du laboratoire, /laboratoire.
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

export type EspaceDirecteur = '/hopital' | '/laboratoire';

/** L'espace ou travaille le directeur : celui de son personnel. */
export function espaceDuDirecteur(type: TypeStructure | null | undefined): EspaceDirecteur {
  return type === 'LABORATOIRE' ? '/laboratoire' : '/hopital';
}

/** La page d'arrivee du directeur : le pilotage de son etablissement. */
export function accueilDuDirecteur(type: TypeStructure | null | undefined): string {
  return `${espaceDuDirecteur(type)}/pilotage`;
}

/**
 * Les rubriques du menu du directeur. `type` vaut `null` tant que la
 * structure n'est pas connue : le menu montre alors l'essentiel, puis se
 * complete.
 */
export function rubriquesDirecteur(type: TypeStructure | null, hospitaliere: boolean): RubriqueNav[] {
  const R = espaceDuDirecteur(type);
  const rubriques: RubriqueNav[] = [
    { titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_PILOTAGE', items: [
      { labelKey: 'ADMIN_STRUCTURE.NAV_DASHBOARD', icon: 'pi-home', route: `${R}/pilotage` },
    ] },
  ];

  if (type && TYPES_AVEC_ACCUEIL.includes(type)) {
    rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_ACCUEIL', items: [
      { labelKey: 'ADMIN_STRUCTURE.NAV_ACCUEIL_ACTIVITE', icon: 'pi-chart-bar', route: '/hopital/tableau-de-bord' },
      { labelKey: 'ADMIN_STRUCTURE.NAV_ADMISSIONS', icon: 'pi-user-plus', route: '/hopital/admission' },
      { labelKey: 'ADMIN_STRUCTURE.NAV_RDV', icon: 'pi-inbox', route: '/hopital/demandes' },
      { labelKey: 'ADMIN_STRUCTURE.NAV_PRESENCES', icon: 'pi-check-square', route: '/hopital/presences' },
      { labelKey: 'ADMIN_STRUCTURE.NAV_EPISODES', icon: 'pi-folder', route: '/hopital/episodes' },
    ] });
  }

  if (type && TYPES_AVEC_LABORATOIRE.includes(type)) {
    // Dans un laboratoire, ses ecrans sont ceux de l'espace ; dans un
    // hopital, ils vivent sous /hopital/laboratoire, sans changer d'espace.
    const L = type === 'LABORATOIRE' ? '/laboratoire' : '/hopital/laboratoire';
    rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_LABO', items: [
      { labelKey: 'ADMIN_STRUCTURE.NAV_LABO_ACTIVITE', icon: 'pi-chart-line', route: `${L}/tableau-de-bord` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_PLATEAU', icon: 'pi-th-large', route: `${L}/plateau-technique` },
      { labelKey: 'ADMIN_STRUCTURE.NAV_ANALYSES', icon: 'pi-filter', route: `${L}/demandes` },
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
    etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_IDENTITES', icon: 'pi-id-card', route: '/hopital/identites' });
  }
  etablissement.push({ labelKey: 'ADMIN_STRUCTURE.NAV_DOSSIER', icon: 'pi-folder-open', route: `${R}/dossier` });
  etablissement.push({ labelKey: 'APPARENCE.NAV', icon: 'pi-palette', route: `${R}/apparence` });
  rubriques.push({ titreKey: 'ADMIN_STRUCTURE.NAV_RUBRIQUE_ETABLISSEMENT', items: etablissement });

  return rubriques;
}

/**
 * Une ancienne adresse de l'interface d'administration, traduite dans
 * l'espace de l'etablissement : un favori, un lien recu par courriel ou un
 * onglet rouvert continuent de mener au bon ecran.
 *
 *   /admin-structure, /admin-structure/dashboard  -> {espace}/pilotage
 *   /admin-structure/accueil/x                    -> /hopital/x
 *   /admin-structure/laboratoire/x                -> /laboratoire/x ou /hopital/laboratoire/x
 *   /admin-structure/x                            -> {espace}/x
 */
export function traduireAncienneAdresse(url: string, type: TypeStructure | null | undefined): string {
  const [chemin, ...reste] = url.split(/(?=[?#])/);
  const suite = reste.join('');
  const R = espaceDuDirecteur(type);
  const sous = (chemin ?? '').replace(/^\/admin-structure\/?/, '').replace(/\/$/, '');
  let cible: string;
  if (sous === '' || sous === 'dashboard') cible = `${R}/pilotage`;
  else if (sous === 'accueil' || sous.startsWith('accueil/')) cible = `/hopital/${sous.slice('accueil'.length).replace(/^\//, '') || 'tableau-de-bord'}`;
  else if (sous === 'laboratoire' || sous.startsWith('laboratoire/')) {
    const fin = sous.slice('laboratoire'.length).replace(/^\//, '') || 'tableau-de-bord';
    cible = type === 'LABORATOIRE' ? `/laboratoire/${fin}` : `/hopital/laboratoire/${fin}`;
  } else cible = `${R}/${sous}`;
  return cible + suite;
}
