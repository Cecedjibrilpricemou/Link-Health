// Les images des pages publiques : celle choisie par le super-admin, sinon
// celle livree avec le site, sinon rien (l'etape garde son icone).
//
// Un seul endroit dit quelles images existent d'origine et ou : la page
// d'accueil, l'ecran Images des parametres et les tests le lisent ici.
import type { EmplacementVisuel, ParametresVisuelsView } from '@baobaoheath/shared-types';
import { urlMedia } from './url-media';

/** Ce qu'affiche une balise <img> pour un emplacement. */
export interface ImagePublique {
  src: string;
  srcset: string;
  /** La description saisie par le super-admin ; vide, on prend `descriptionCle`. */
  description: string;
  /** La description d'origine, a traduire. `null` : image decorative. */
  descriptionCle: string | null;
  /** Televersee par le super-admin, et non livree avec le site. */
  personnalisee: boolean;
}

type Origine = { src: string; srcset: string; descriptionCle: string | null };

/** Les images livrees avec le site. Une etape absente d'ici garde son icone. */
export const VISUELS_D_ORIGINE: Partial<Record<EmplacementVisuel, Origine>> = {
  ACCUEIL: {
    src: 'assets/images/login-hero-1024.webp',
    srcset: 'assets/images/login-hero-640.webp 640w, assets/images/login-hero-1024.webp 1024w',
    descriptionCle: 'LANDING.HERO_PHOTO_ALT',
  },
  // Decorative : le panneau de connexion est masque aux lecteurs d'ecran.
  CONNEXION: { src: 'assets/images/loginimage.webp', srcset: '', descriptionCle: null },
  // hero-pharma est en realite un accueil de clinique ; hero-hospital un
  // portrait de medecin ; hero-vaccine des plaquettes de medicaments. Les noms
  // de fichier mentent, les descriptions non.
  ETAPE_3: {
    src: 'assets/images/hero-pharma-800.webp',
    srcset: 'assets/images/hero-pharma-480.webp 480w, assets/images/hero-pharma-800.webp 800w',
    descriptionCle: 'LANDING.HOW_STEP3_ALT',
  },
  ETAPE_5: {
    src: 'assets/images/hero-hospital-800.webp',
    srcset: 'assets/images/hero-hospital-480.webp 480w, assets/images/hero-hospital-800.webp 800w',
    descriptionCle: 'LANDING.HOW_STEP5_ALT',
  },
  ETAPE_6: {
    src: 'assets/images/hero-vaccine-800.webp',
    srcset: 'assets/images/hero-vaccine-480.webp 480w, assets/images/hero-vaccine-800.webp 800w',
    descriptionCle: 'LANDING.HOW_STEP6_ALT',
  },
};

/** Les largeurs produites par l'API pour chaque emplacement (petite, grande). */
export const LARGEURS_VISUELS: Record<EmplacementVisuel, [number, number]> = {
  ACCUEIL: [800, 1600],
  CONNEXION: [640, 1200],
  ETAPE_1: [600, 1200], ETAPE_2: [600, 1200], ETAPE_3: [600, 1200], ETAPE_4: [600, 1200],
  ETAPE_5: [600, 1200], ETAPE_6: [600, 1200], ETAPE_7: [600, 1200],
};

/** La largeur minimale acceptee par l'API : en dessous, l'image serait floue. */
export const LARGEUR_MINIMUM: Record<EmplacementVisuel, number> = {
  ACCUEIL: 900,
  CONNEXION: 700,
  ETAPE_1: 600, ETAPE_2: 600, ETAPE_3: 600, ETAPE_4: 600, ETAPE_5: 600, ETAPE_6: 600, ETAPE_7: 600,
};

/**
 * L'image a afficher pour un emplacement : la televersee, sinon celle
 * d'origine, sinon `null`.
 */
export function imagePublique(
  emplacement: EmplacementVisuel,
  visuels: ParametresVisuelsView | null,
): ImagePublique | null {
  const v = visuels?.[emplacement];
  const origine = VISUELS_D_ORIGINE[emplacement] ?? null;
  if (v?.url) {
    const [petite, grande] = LARGEURS_VISUELS[emplacement];
    return {
      src: urlMedia(v.url),
      srcset: v.urlPetite ? `${urlMedia(v.urlPetite)} ${petite}w, ${urlMedia(v.url)} ${grande}w` : '',
      description: v.description,
      // Une nouvelle image n'est plus decrite par le texte de l'ancienne.
      descriptionCle: null,
      personnalisee: true,
    };
  }
  if (!origine) return null;
  return { ...origine, description: v?.description ?? '', personnalisee: false };
}
