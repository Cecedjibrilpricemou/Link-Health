// Jeux de depart du referentiel geographique (M1), un par pays.
//
// Un jeu ne se charge que si le pays installe et son decoupage correspondent
// exactement (meme code pays, memes niveaux dans le meme ordre) : charger des
// prefectures guineennes dans une installation sénégalaise serait pire que
// ne rien charger. Tout lieu charge reste « a valider » tant qu'un
// administrateur ne l'a pas confirme.
//
// Pour ajouter un pays : un nouvel objet ici, avec ses sources en commentaire,
// verifiees par quelqu'un du pays.

export interface NoeudJeu {
  nom: string;
  enfants?: NoeudJeu[];
}

export interface JeuDeDepart {
  pays: string;
  /** Codes des niveaux, du plus large au plus fin, tels que dans les parametres. */
  niveaux: string[];
  lieux: NoeudJeu[];
}

const communes = (...noms: string[]): NoeudJeu[] => noms.map((nom) => ({ nom }));
const prefectures = (...noms: string[]): NoeudJeu[] => noms.map((nom) => ({ nom }));

/**
 * Guinee : 7 regions et la zone speciale de Conakry, 33 prefectures
 * (decoupage publie, recensement de 2014), et les 13 communes de Conakry
 * issues de la loi adoptee par le CNT le 18 janvier 2024. Les communes de
 * l'interieur se saisissent depuis l'ecran d'administration.
 */
const GUINEE: JeuDeDepart = {
  pays: 'GN',
  niveaux: ['region', 'prefecture', 'commune'],
  lieux: [
    {
      nom: 'Conakry',
      enfants: [{
        nom: 'Conakry',
        enfants: communes(
          'Kaloum', 'Dixinn', 'Matam', 'Ratoma', 'Matoto', 'Kassa', 'Lambanyi',
          'Sonfonia', 'Gbessia', 'Tombolia', 'Kagbelen', 'Sanoyah', 'Maneah',
        ),
      }],
    },
    { nom: 'Boké', enfants: prefectures('Boffa', 'Boké', 'Fria', 'Gaoual', 'Koundara') },
    { nom: 'Faranah', enfants: prefectures('Dabola', 'Dinguiraye', 'Faranah', 'Kissidougou') },
    { nom: 'Kankan', enfants: prefectures('Kankan', 'Kérouané', 'Kouroussa', 'Mandiana', 'Siguiri') },
    { nom: 'Kindia', enfants: prefectures('Coyah', 'Dubréka', 'Forécariah', 'Kindia', 'Télimélé') },
    { nom: 'Labé', enfants: prefectures('Koubia', 'Labé', 'Lélouma', 'Mali', 'Tougué') },
    { nom: 'Mamou', enfants: prefectures('Dalaba', 'Mamou', 'Pita') },
    { nom: 'Nzérékoré', enfants: prefectures('Beyla', 'Guéckédou', 'Lola', 'Macenta', 'Nzérékoré', 'Yomou') },
  ],
};

export const JEUX_DE_DEPART: Record<string, JeuDeDepart> = {
  GN: GUINEE,
};

/** Le jeu qui correspond exactement au pays installe, ou rien. */
export function jeuPour(pays: { code: string; niveaux: { code: string }[] }): JeuDeDepart | null {
  const jeu = JEUX_DE_DEPART[pays.code];
  if (!jeu) return null;
  const codes = pays.niveaux.map((n) => n.code);
  const memes = jeu.niveaux.length === codes.length && jeu.niveaux.every((c, i) => c === codes[i]);
  return memes ? jeu : null;
}
