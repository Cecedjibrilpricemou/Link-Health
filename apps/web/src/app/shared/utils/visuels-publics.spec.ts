// Quelle image afficher pour un emplacement des pages publiques.
import { EMPLACEMENTS_VISUELS } from '@baobaoheath/shared-types';
import type { ParametresVisuelsView } from '@baobaoheath/shared-types';
import { imagePublique, LARGEUR_MINIMUM, LARGEURS_VISUELS, VISUELS_D_ORIGINE } from './visuels-publics';

const vide = { url: '', urlPetite: '', description: '' };
function visuels(sur: Partial<ParametresVisuelsView> = {}): ParametresVisuelsView {
  return { ...Object.fromEntries(EMPLACEMENTS_VISUELS.map((e) => [e, vide])), ...sur } as ParametresVisuelsView;
}

describe('imagePublique', () => {
  it('sans choix du super-admin : l image livree avec le site, et sa description', () => {
    const img = imagePublique('ACCUEIL', visuels())!;
    expect(img.src).toBe('assets/images/login-hero-1024.webp');
    expect(img.descriptionCle).toBe('LANDING.HERO_PHOTO_ALT');
    expect(img.personnalisee).toBe(false);
  });

  it('avant la reponse de l API aussi : l image d origine, jamais un trou', () => {
    expect(imagePublique('ETAPE_3', null)?.src).toBe('assets/images/hero-pharma-800.webp');
  });

  it('une etape sans photo d origine garde son icone', () => {
    expect(imagePublique('ETAPE_1', visuels())).toBeNull();
    expect(imagePublique('ETAPE_7', null)).toBeNull();
  });

  it('l image televersee, avec ses deux largeurs', () => {
    const img = imagePublique('ETAPE_1', visuels({
      ETAPE_1: { url: '/uploads/visuels/e1-1200.webp', urlPetite: '/uploads/visuels/e1-600.webp', description: 'Une inscription au guichet' },
    }))!;
    expect(img.src).toMatch(/\/uploads\/visuels\/e1-1200\.webp$/);
    expect(img.srcset).toMatch(/e1-600\.webp 600w, .*e1-1200\.webp 1200w$/);
    expect(img.description).toBe('Une inscription au guichet');
    expect(img.personnalisee).toBe(true);
  });

  // L'ancienne description decrirait une autre image.
  it('une image televersee ne reprend pas la description de celle d origine', () => {
    const img = imagePublique('ACCUEIL', visuels({ ACCUEIL: { url: '/uploads/visuels/a.webp', urlPetite: '', description: '' } }))!;
    expect(img.descriptionCle).toBeNull();
    expect(img.srcset).toBe('');
  });

  it('la description saisie l emporte sur celle d origine', () => {
    const img = imagePublique('ETAPE_5', visuels({ ETAPE_5: { ...vide, description: 'Un medecin en consultation' } }))!;
    expect(img.personnalisee).toBe(false);
    expect(img.description).toBe('Un medecin en consultation');
  });

  it('tous les emplacements sont connus des tables de largeurs', () => {
    for (const e of EMPLACEMENTS_VISUELS) {
      expect(LARGEURS_VISUELS[e][0]).toBeLessThan(LARGEURS_VISUELS[e][1]);
      expect(LARGEUR_MINIMUM[e]).toBeGreaterThan(0);
    }
    expect(Object.keys(VISUELS_D_ORIGINE).every((e) => (EMPLACEMENTS_VISUELS as readonly string[]).includes(e))).toBe(true);
  });
});
