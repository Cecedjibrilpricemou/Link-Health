// Les palettes de structure restent lisibles.
//
// Ce fichier refait les mesures de contraste (WCAG 2.1) sur les valeurs
// livrees : une couleur retouchee a la main qui rendrait un texte difficile a
// lire ne passe pas. 4,5:1 pour le texte, 3:1 pour une bordure de controle.
//
// L'emeraude sert de reference : c'est la feuille de style d'origine. Une
// palette n'a pas le droit d'etre moins lisible qu'elle, nulle part.
import { PALETTES_STRUCTURE } from '@baobaoheath/shared-types';
import { APERCUS, cssDePalette, JeuDeCouleurs, PALETTES, PaletteSurchargee } from './palettes-structure';

function canal(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function rgb(hexa: string): [number, number, number] {
  const n = parseInt(hexa.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hexa: string): number {
  const [r, g, b] = rgb(hexa).map(canal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Du blanc a `alpha` sur un fond : ce que rend `rgba(255,255,255,alpha)`. */
function blancSur(fond: string, alpha: number): string {
  const [r, g, b] = rgb(fond).map((v) => Math.round(alpha * 255 + (1 - alpha) * v));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const BLANC = '#ffffff';

/** L'emeraude, telle que styles.scss et le theme Material la definissent. */
const EMERAUDE: JeuDeCouleurs = {
  clair: {
    deep: '#0B2618', mid: '#1A5C35', primary: '#2D7D46', bright: '#3EBB70', light: '#EDF7F1',
    'surface-ground': '#F4F7F6', 'surface-1': '#F3F7F5', 'surface-2': '#EDF7F1',
    border: '#DDE8E2', 'border-light': '#EBF1ED', 'border-strong': '#7E988A',
    'text-primary': '#0D2B1A', 'text-secondary': '#3A5848', 'text-muted': '#557063',
    'sidebar-bg': '#0B2618', 'topbar-border': '#DDE8E2', 'nav-top': '#1A5C35',
    'accent-bg': '#EDF7F1', 'accent-border': '#BBF7D0',
  },
  sombre: {
    'surface-ground': '#0A1810', 'surface-0': '#0F1F14', 'surface-1': '#142219', 'surface-2': '#1A2E20',
    'surface-card': '#142219', border: '#1F3828', 'border-light': '#1A2E20', 'border-strong': '#4E7660',
    'text-primary': '#E2F0E8', 'text-secondary': '#9BBFAB', 'text-muted': '#78A08B',
    'sidebar-bg': '#091510', 'topbar-bg': '#0F1F14', 'topbar-border': '#1F3828', 'nav-top': '#17422A',
    'accent-bg': '#0A1F10', 'accent-border': '#14532D',
  },
  material: {
    primary: ['#186c37', '#87d898'], 'on-primary': ['#ffffff', '#003918'],
    'secondary-container': ['#81fba8', '#00522a'], 'on-secondary-container': ['#00522a', '#81fba8'],
    surface: ['#f7fbf3', '#101410'], 'on-surface': ['#181d18', '#e0e4dc'],
    'surface-container': ['#ebefe7', '#1c211c'], 'on-surface-variant': ['#404940', '#dbe5d8'],
  },
};

type Mesure = { libelle: string; avant: (p: JeuDeCouleurs) => string; fond: (p: JeuDeCouleurs) => string; minimum: number };

const MESURES: Mesure[] = [
  // ── Mode clair : les textes sur les fonds
  { libelle: 'texte principal / fond de page', avant: (p) => p.clair['text-primary'], fond: (p) => p.clair['surface-ground'], minimum: 4.5 },
  { libelle: 'texte secondaire / carte', avant: (p) => p.clair['text-secondary'], fond: () => BLANC, minimum: 4.5 },
  { libelle: 'texte attenue / fond de page', avant: (p) => p.clair['text-muted'], fond: (p) => p.clair['surface-ground'], minimum: 4.5 },
  { libelle: 'texte attenue / encart', avant: (p) => p.clair['text-muted'], fond: (p) => p.clair['surface-2'], minimum: 4.5 },
  { libelle: 'lien et accent / carte', avant: (p) => p.clair.primary, fond: () => BLANC, minimum: 4.5 },
  { libelle: 'accent / etiquette de marque', avant: (p) => p.clair.primary, fond: (p) => p.clair['accent-bg'], minimum: 4.5 },
  { libelle: 'sombre : vif / etiquette de marque', avant: (p) => p.clair.bright, fond: (p) => p.sombre['accent-bg'], minimum: 4.5 },
  { libelle: 'accent / encart teinte', avant: (p) => p.clair.primary, fond: (p) => p.clair.light, minimum: 4.5 },
  { libelle: 'blanc / bouton primaire', avant: () => BLANC, fond: (p) => p.clair.primary, minimum: 4.5 },
  { libelle: 'blanc / bandeau', avant: () => BLANC, fond: (p) => p.clair.mid, minimum: 4.5 },
  { libelle: 'texte fonce / bouton vif', avant: (p) => p.clair.deep, fond: (p) => p.clair.bright, minimum: 4.5 },
  { libelle: 'bordure de controle / carte', avant: (p) => p.clair['border-strong'], fond: () => BLANC, minimum: 3 },
  // ── Le menu lateral : entrees (.78) et intitules (.68), haut et bas du degrade
  { libelle: 'menu : entree / haut', avant: (p) => blancSur(p.clair['nav-top'], 0.78), fond: (p) => p.clair['nav-top'], minimum: 4.5 },
  { libelle: 'menu : intitule / haut', avant: (p) => blancSur(p.clair['nav-top'], 0.68), fond: (p) => p.clair['nav-top'], minimum: 4.5 },
  { libelle: 'menu : intitule / bas', avant: (p) => blancSur(p.clair.deep, 0.68), fond: (p) => p.clair.deep, minimum: 4.5 },
  { libelle: 'menu sombre : intitule / haut', avant: (p) => blancSur(p.sombre['nav-top'], 0.68), fond: (p) => p.sombre['nav-top'], minimum: 4.5 },
  // ── Mode sombre
  { libelle: 'sombre : texte principal / carte', avant: (p) => p.sombre['text-primary'], fond: (p) => p.sombre['surface-card'], minimum: 4.5 },
  { libelle: 'sombre : texte secondaire / carte', avant: (p) => p.sombre['text-secondary'], fond: (p) => p.sombre['surface-card'], minimum: 4.5 },
  { libelle: 'sombre : texte attenue / carte', avant: (p) => p.sombre['text-muted'], fond: (p) => p.sombre['surface-card'], minimum: 4.5 },
  { libelle: 'sombre : texte attenue / encart', avant: (p) => p.sombre['text-muted'], fond: (p) => p.sombre['surface-2'], minimum: 4.5 },
  { libelle: 'sombre : accent vif / carte', avant: (p) => p.clair.bright, fond: (p) => p.sombre['surface-card'], minimum: 4.5 },
  { libelle: 'sombre : bordure de controle', avant: (p) => p.sombre['border-strong'], fond: (p) => p.sombre['surface-card'], minimum: 3 },
  // ── Angular Material, dans les deux modes
  { libelle: 'material clair : texte du bouton plein', avant: (p) => p.material['on-primary'][0], fond: (p) => p.material['primary'][0], minimum: 4.5 },
  { libelle: 'material sombre : texte du bouton plein', avant: (p) => p.material['on-primary'][1], fond: (p) => p.material['primary'][1], minimum: 4.5 },
  { libelle: 'material clair : accent / surface', avant: (p) => p.material['primary'][0], fond: (p) => p.material['surface'][0], minimum: 4.5 },
  { libelle: 'material sombre : accent / surface', avant: (p) => p.material['primary'][1], fond: (p) => p.material['surface'][1], minimum: 4.5 },
  { libelle: 'material clair : option choisie', avant: (p) => p.material['on-secondary-container'][0], fond: (p) => p.material['secondary-container'][0], minimum: 4.5 },
  { libelle: 'material sombre : option choisie', avant: (p) => p.material['on-secondary-container'][1], fond: (p) => p.material['secondary-container'][1], minimum: 4.5 },
  { libelle: 'material clair : texte de liste', avant: (p) => p.material['on-surface'][0], fond: (p) => p.material['surface-container'][0], minimum: 4.5 },
  { libelle: 'material sombre : texte de liste', avant: (p) => p.material['on-surface'][1], fond: (p) => p.material['surface-container'][1], minimum: 4.5 },
  { libelle: 'material clair : libelle de champ', avant: (p) => p.material['on-surface-variant'][0], fond: (p) => p.material['surface'][0], minimum: 4.5 },
  { libelle: 'material sombre : libelle de champ', avant: (p) => p.material['on-surface-variant'][1], fond: (p) => p.material['surface'][1], minimum: 4.5 },
];

const NOMS = Object.keys(PALETTES) as PaletteSurchargee[];

describe('les palettes de structure', () => {
  it('couvrent toute la liste partagee, emeraude a part', () => {
    expect([...NOMS].sort()).toEqual(PALETTES_STRUCTURE.filter((p) => p !== 'EMERAUDE').sort());
    expect(Object.keys(APERCUS).sort()).toEqual([...PALETTES_STRUCTURE].sort());
  });

  it('l emeraude de reference passe elle-meme toutes les mesures', () => {
    const echecs = MESURES.filter((m) => contraste(m.avant(EMERAUDE), m.fond(EMERAUDE)) < m.minimum).map((m) => m.libelle);
    expect(echecs).toEqual([]);
  });

  for (const nom of NOMS) {
    it(`${nom} : tous les textes lisibles, en clair comme en sombre`, () => {
      const p = PALETTES[nom];
      const echecs = MESURES
        .map((m) => ({ m, c: contraste(m.avant(p), m.fond(p)) }))
        .filter(({ m, c }) => c < m.minimum)
        .map(({ m, c }) => `${m.libelle} : ${c.toFixed(2)}:1`);
      expect(echecs).toEqual([]);
    });
  }

  it('les palettes se distinguent : pas deux primaires presque identiques', () => {
    const primaires = [EMERAUDE.clair.primary, ...NOMS.map((n) => PALETTES[n].clair.primary)];
    for (let i = 0; i < primaires.length; i += 1) {
      for (let j = i + 1; j < primaires.length; j += 1) {
        const [a, b] = [rgb(primaires[i]!), rgb(primaires[j]!)];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(distance).toBeGreaterThan(40);
      }
    }
  });

  it('ni rouge ni orange : les teintes du danger restent au danger', () => {
    for (const nom of NOMS) {
      const [r, g, b] = rgb(PALETTES[nom].clair.primary);
      expect(r > g && r > b).toBe(false);
    }
  });
});

describe('cssDePalette', () => {
  it('pose les jetons clairs et sombres sous des selecteurs qui l emportent', () => {
    const css = cssDePalette('OCEAN');
    expect(css).toContain('html[data-palette="OCEAN"] {');
    expect(css).toContain('html[data-palette="OCEAN"][data-theme="dark"] {');
    expect(css).toContain(`--bb-primary: ${PALETTES.OCEAN.clair.primary};`);
    expect(css).toContain(`--bb-surface-card: ${PALETTES.OCEAN.sombre['surface-card']};`);
    expect(css).toContain(`--mat-sys-primary: light-dark(${PALETTES.OCEAN.material['primary']![0]}, ${PALETTES.OCEAN.material['primary']![1]});`);
  });

  it('ne touche jamais aux couleurs semantiques', () => {
    for (const nom of NOMS) {
      expect(cssDePalette(nom)).not.toMatch(/--bb-(danger|warning|success|info)/);
    }
  });

  it('n ecrit que des couleurs valides', () => {
    for (const nom of NOMS) {
      const valeurs = cssDePalette(nom).match(/#[0-9A-Fa-f]+\b/g) ?? [];
      expect(valeurs.every((v) => v.length === 7)).toBe(true);
    }
  });
});
