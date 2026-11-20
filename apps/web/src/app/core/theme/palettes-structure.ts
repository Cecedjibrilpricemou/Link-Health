// core/theme/palettes-structure.ts — les couleurs de l'interface, par structure.
//
// **Construites, pas choisies a l'oeil.** Chaque palette part de l'emeraude
// (le vert d'origine) : chaque couleur passe en OKLCH, garde sa luminosite -
// c'est elle qui porte les contrastes deja regles - et prend la teinte de la
// palette. Saturation ramenee dans le gamut sRGB, puis contrastes mesures
// (WCAG AA : 4,5:1 pour le texte, 3:1 pour les bordures de controle), en
// clair comme en sombre. `palettes-structure.spec.ts` refait ces mesures :
// une valeur retouchee a la main qui casserait la lisibilite ne passe pas.
//
// **L'emeraude n'est pas ici** : c'est la feuille de style elle-meme. Une
// structure qui ne choisit rien ne recoit aucune surcharge.
//
// Pas de rouge ni d'orange : ce sont les couleurs du danger et de
// l'avertissement. Les teintes semantiques (succes, alerte, danger, info) ne
// changent jamais avec la palette.
import type { PaletteStructure } from '@baobaoheath/shared-types';

/** Les jetons `--bb-*` du mode clair qu'une palette redefinit. */
export type JetonClair =
  | 'deep' | 'mid' | 'primary' | 'bright' | 'light'
  | 'surface-ground' | 'surface-1' | 'surface-2'
  | 'border' | 'border-light' | 'border-strong'
  | 'text-primary' | 'text-secondary' | 'text-muted'
  | 'sidebar-bg' | 'topbar-border' | 'nav-top' | 'accent-bg' | 'accent-border';

/** Ceux du mode sombre. */
export type JetonSombre =
  | 'surface-ground' | 'surface-0' | 'surface-1' | 'surface-2' | 'surface-card'
  | 'border' | 'border-light' | 'border-strong'
  | 'text-primary' | 'text-secondary' | 'text-muted'
  | 'sidebar-bg' | 'topbar-bg' | 'topbar-border' | 'nav-top' | 'accent-bg' | 'accent-border';

export interface JeuDeCouleurs {
  clair: Record<JetonClair, string>;
  sombre: Record<JetonSombre, string>;
  /** Jetons `--mat-sys-*` d'Angular Material : [clair, sombre]. */
  material: Record<string, [string, string]>;
}

export type PaletteSurchargee = Exclude<PaletteStructure, 'EMERAUDE'>;

export const PALETTES: Record<PaletteSurchargee, JeuDeCouleurs> = {
  OCEAN: {
    clair: {
      'deep': '#102134',
      'mid': '#1C517D',
      'primary': '#2270A9',
      'bright': '#40A6FB',
      'light': '#EEF5FD',
      'surface-ground': '#F4F7F6',
      'surface-1': '#F4F6F9',
      'surface-2': '#EEF5FD',
      'border': '#DFE5EF',
      'border-light': '#EBF0F5',
      'border-strong': '#8392A7',
      'text-primary': '#10253B',
      'text-secondary': '#405269',
      'text-muted': '#5C6A7F',
      'sidebar-bg': '#102134',
      'topbar-border': '#DFE5EF',
      'nav-top': '#1C517D',
      'accent-bg': '#EEF5FD',
      'accent-border': '#D4E9FF',
    },
    sombre: {
      'surface-ground': '#0C1520',
      'surface-0': '#0F1C28',
      'surface-1': '#151F2A',
      'surface-2': '#192A3A',
      'surface-card': '#151F2A',
      'border': '#203346',
      'border-light': '#192A3A',
      'border-strong': '#556E8C',
      'text-primary': '#E4EDF8',
      'text-secondary': '#A1B7D4',
      'text-muted': '#8097B7',
      'sidebar-bg': '#0D121B',
      'topbar-bg': '#0F1C28',
      'topbar-border': '#203346',
      'nav-top': '#1C3A58',
      'accent-bg': '#081B2B',
      'accent-border': '#134973',
    },
    material: {
      'primary': ['#0A5F96', '#8AC9FD'],
      'on-primary': ['#FFFFFF', '#013152'],
      'primary-container': ['#C2E3FE', '#014773'],
      'on-primary-container': ['#014773', '#C2E3FE'],
      'inverse-primary': ['#8AC9FD', '#0A5F96'],
      'surface-tint': ['#0A5F96', '#8AC9FD'],
      'primary-fixed': ['#C2E3FE', '#C2E3FE'],
      'primary-fixed-dim': ['#8AC9FD', '#8AC9FD'],
      'secondary': ['#0E5E99', '#8CC7FE'],
      'on-secondary': ['#FFFFFF', '#043053'],
      'secondary-container': ['#C2E1FE', '#0A4675'],
      'on-secondary-container': ['#0A4675', '#C2E1FE'],
      'secondary-fixed': ['#C2E1FE', '#C2E1FE'],
      'secondary-fixed-dim': ['#8CC7FE', '#8CC7FE'],
      'background': ['#F2FBFF', '#0F1317'],
      'on-background': ['#161C21', '#DBE4E8'],
      'surface': ['#F2FBFF', '#0F1317'],
      'on-surface': ['#161C21', '#DBE4E8'],
      'surface-variant': ['#D5E4ED', '#3D484F'],
      'on-surface-variant': ['#3D484F', '#D5E4ED'],
      'surface-bright': ['#F2FBFF', '#343A3D'],
      'surface-dim': ['#D3DBDF', '#0F1317'],
      'surface-container-lowest': ['#FFFFFF', '#0A0E12'],
      'surface-container-low': ['#ECF5F9', '#161C21'],
      'surface-container': ['#E6EFF3', '#1A2025'],
      'surface-container-high': ['#E1E9ED', '#252B2E'],
      'surface-container-highest': ['#DBE4E8', '#2F353A'],
      'outline': ['#6C7981', '#85929B'],
      'outline-variant': ['#BAC8D1', '#3D484F'],
    },
  },
  INDIGO: {
    clair: {
      'deep': '#1C1D34',
      'mid': '#3F4880',
      'primary': '#5465AD',
      'bright': '#8597FB',
      'light': '#F2F3FD',
      'surface-ground': '#F4F7F6',
      'surface-1': '#F5F5F9',
      'surface-2': '#F2F3FD',
      'border': '#E3E4EE',
      'border-light': '#EEEFF5',
      'border-strong': '#8D8EA7',
      'text-primary': '#1E223B',
      'text-secondary': '#4C4D68',
      'text-muted': '#66667E',
      'sidebar-bg': '#1C1D34',
      'topbar-border': '#E3E4EE',
      'nav-top': '#3F4880',
      'accent-bg': '#F2F3FD',
      'accent-border': '#E0E5FE',
    },
    sombre: {
      'surface-ground': '#121320',
      'surface-0': '#161A29',
      'surface-1': '#1B1D2B',
      'surface-2': '#23273B',
      'surface-card': '#1B1D2B',
      'border': '#2C3047',
      'border-light': '#23273B',
      'border-strong': '#65688C',
      'text-primary': '#EAEBF8',
      'text-secondary': '#B0B2D4',
      'text-muted': '#9092B6',
      'sidebar-bg': '#11111B',
      'topbar-bg': '#161A29',
      'topbar-border': '#2C3047',
      'nav-top': '#303559',
      'accent-bg': '#14182C',
      'accent-border': '#374175',
    },
    material: {
      'primary': ['#45549A', '#ACBFFF'],
      'on-primary': ['#FFFFFF', '#212A56'],
      'primary-container': ['#D2DDFE', '#323D79'],
      'on-primary-container': ['#323D79', '#D2DDFE'],
      'inverse-primary': ['#ACBFFF', '#45549A'],
      'surface-tint': ['#45549A', '#ACBFFF'],
      'primary-fixed': ['#D2DDFE', '#D2DDFE'],
      'primary-fixed-dim': ['#ACBFFF', '#ACBFFF'],
      'secondary': ['#48529C', '#AEBDFF'],
      'on-secondary': ['#FFFFFF', '#242A54'],
      'secondary-container': ['#D2DBFE', '#363D77'],
      'on-secondary-container': ['#363D77', '#D2DBFE'],
      'secondary-fixed': ['#D2DBFE', '#D2DBFE'],
      'secondary-fixed-dim': ['#AEBDFF', '#AEBDFF'],
      'background': ['#F5FAFF', '#111317'],
      'on-background': ['#191B21', '#DDE3EA'],
      'surface': ['#F5FAFF', '#111317'],
      'on-surface': ['#191B21', '#DDE3EA'],
      'surface-variant': ['#DAE2F0', '#414651'],
      'on-surface-variant': ['#414651', '#DAE2F0'],
      'surface-bright': ['#F5FAFF', '#36393E'],
      'surface-dim': ['#D5DAE0', '#111317'],
      'surface-container-lowest': ['#FFFFFF', '#0C0E12'],
      'surface-container-low': ['#EEF4FB', '#191B21'],
      'surface-container': ['#E8EEF5', '#1D1F25'],
      'surface-container-high': ['#E3E8EE', '#272A2F'],
      'surface-container-highest': ['#DDE3EA', '#32343A'],
      'outline': ['#717783', '#8A909C'],
      'outline-variant': ['#BFC6D3', '#414651'],
    },
  },
  SARCELLE: {
    clair: {
      'deep': '#012627',
      'mid': '#025A5A',
      'primary': '#047B78',
      'bright': '#04B7B6',
      'light': '#EBF7F8',
      'surface-ground': '#F4F7F6',
      'surface-1': '#F2F7F7',
      'surface-2': '#EBF7F8',
      'border': '#DBE8E9',
      'border-light': '#EAF1F1',
      'border-strong': '#79979A',
      'text-primary': '#012A2B',
      'text-secondary': '#33575A',
      'text-muted': '#506F73',
      'sidebar-bg': '#012627',
      'topbar-border': '#DBE8E9',
      'nav-top': '#025A5A',
      'accent-bg': '#EBF7F8',
      'accent-border': '#A8F7F8',
    },
    sombre: {
      'surface-ground': '#061819',
      'surface-0': '#081F1F',
      'surface-1': '#0F2222',
      'surface-2': '#112E2E',
      'surface-card': '#0F2222',
      'border': '#153838',
      'border-light': '#112E2E',
      'border-strong': '#437578',
      'text-primary': '#DFF0F1',
      'text-secondary': '#93BEC1',
      'text-muted': '#709FA3',
      'sidebar-bg': '#071516',
      'topbar-bg': '#081F1F',
      'topbar-border': '#153838',
      'nav-top': '#014143',
      'accent-bg': '#011F1E',
      'accent-border': '#035150',
    },
    material: {
      'primary': ['#026966', '#56D9D4'],
      'on-primary': ['#FFFFFF', '#023635'],
      'primary-container': ['#75F7F0', '#034E4D'],
      'on-primary-container': ['#034E4D', '#75F7F0'],
      'inverse-primary': ['#56D9D4', '#026966'],
      'surface-tint': ['#026966', '#56D9D4'],
      'primary-fixed': ['#75F7F0', '#75F7F0'],
      'primary-fixed-dim': ['#56D9D4', '#56D9D4'],
      'secondary': ['#036868', '#1FDCDB'],
      'on-secondary': ['#FFFFFF', '#013636'],
      'secondary-container': ['#13FCFA', '#034E4E'],
      'on-secondary-container': ['#034E4E', '#13FCFA'],
      'secondary-fixed': ['#13FCFA', '#13FCFA'],
      'secondary-fixed-dim': ['#1FDCDB', '#1FDCDB'],
      'background': ['#F3FCF8', '#0E1413'],
      'on-background': ['#151D1C', '#DCE5E1'],
      'surface': ['#F3FCF8', '#0E1413'],
      'on-surface': ['#151D1C', '#DCE5E1'],
      'surface-variant': ['#D5E6E2', '#3C4948'],
      'on-surface-variant': ['#3C4948', '#D5E6E2'],
      'surface-bright': ['#F3FCF8', '#343A39'],
      'surface-dim': ['#D3DCD9', '#0E1413'],
      'surface-container-lowest': ['#FFFFFF', '#090F0E'],
      'surface-container-low': ['#EDF6F2', '#151D1C'],
      'surface-container': ['#E7F0EC', '#1A2120'],
      'surface-container-high': ['#E1EAE7', '#242B2A'],
      'surface-container-highest': ['#DCE5E1', '#2F3635'],
      'outline': ['#6B7B78', '#849491'],
      'outline-variant': ['#B9CAC6', '#3C4948'],
    },
  },
  AMETHYSTE: {
    clair: {
      'deep': '#271A2E',
      'mid': '#5B4073',
      'primary': '#7A599D',
      'bright': '#B985E7',
      'light': '#F7F2FA',
      'surface-ground': '#F4F7F6',
      'surface-1': '#F7F5F8',
      'surface-2': '#F7F2FA',
      'border': '#E9E2EB',
      'border-light': '#F1EEF3',
      'border-strong': '#998B9F',
      'text-primary': '#2B1E35',
      'text-secondary': '#594961',
      'text-muted': '#726376',
      'sidebar-bg': '#271A2E',
      'topbar-border': '#E9E2EB',
      'nav-top': '#5B4073',
      'accent-bg': '#F7F2FA',
      'accent-border': '#F0DEFF',
    },
    sombre: {
      'surface-ground': '#18111C',
      'surface-0': '#1E1725',
      'surface-1': '#221B27',
      'surface-2': '#2D2436',
      'surface-card': '#221B27',
      'border': '#382C41',
      'border-light': '#2D2436',
      'border-strong': '#776282',
      'text-primary': '#F1E9F4',
      'text-secondary': '#C0ADC9',
      'text-muted': '#A28CAB',
      'sidebar-bg': '#160F17',
      'topbar-bg': '#1E1725',
      'topbar-border': '#382C41',
      'nav-top': '#422F50',
      'accent-bg': '#1E1528',
      'accent-border': '#523869',
    },
    material: {
      'primary': ['#69498B', '#D2AFFE'],
      'on-primary': ['#FFFFFF', '#38224C'],
      'primary-container': ['#E6D5FF', '#50346C'],
      'on-primary-container': ['#50346C', '#E6D5FF'],
      'inverse-primary': ['#D2AFFE', '#69498B'],
      'surface-tint': ['#69498B', '#D2AFFE'],
      'primary-fixed': ['#E6D5FF', '#E6D5FF'],
      'primary-fixed-dim': ['#D2AFFE', '#D2AFFE'],
      'secondary': ['#6C478B', '#D6ACFF'],
      'on-secondary': ['#FFFFFF', '#39234A'],
      'secondary-container': ['#E8D3FF', '#513469'],
      'on-secondary-container': ['#513469', '#E8D3FF'],
      'secondary-fixed': ['#E8D3FF', '#E8D3FF'],
      'secondary-fixed-dim': ['#D6ACFF', '#D6ACFF'],
      'background': ['#F8F9FF', '#131217'],
      'on-background': ['#1C1A20', '#E1E2EA'],
      'surface': ['#F8F9FF', '#131217'],
      'on-surface': ['#1C1A20', '#E1E2EA'],
      'surface-variant': ['#E2DFEE', '#47444F'],
      'on-surface-variant': ['#47444F', '#E2DFEE'],
      'surface-bright': ['#F8F9FF', '#39383D'],
      'surface-dim': ['#D9D9E0', '#131217'],
      'surface-container-lowest': ['#FFFFFF', '#0E0D12'],
      'surface-container-low': ['#F2F3FB', '#1C1A20'],
      'surface-container': ['#ECEDF5', '#201E24'],
      'surface-container-high': ['#E7E7EE', '#2A292E'],
      'surface-container-highest': ['#E1E2EA', '#353339'],
      'outline': ['#787581', '#918E9A'],
      'outline-variant': ['#C6C3D1', '#47444F'],
    },
  },
  ARDOISE: {
    clair: {
      'deep': '#1B2028',
      'mid': '#404F62',
      'primary': '#576D85',
      'bright': '#86A2C7',
      'light': '#F2F4F8',
      'surface-ground': '#F4F7F6',
      'surface-1': '#F5F6F7',
      'surface-2': '#F2F4F8',
      'border': '#E3E5E9',
      'border-light': '#EEEFF1',
      'border-strong': '#8C919A',
      'text-primary': '#1E252E',
      'text-secondary': '#4B505A',
      'text-muted': '#656972',
      'sidebar-bg': '#1B2028',
      'topbar-border': '#E3E5E9',
      'nav-top': '#404F62',
      'accent-bg': '#F2F4F8',
      'accent-border': '#D9E8FC',
    },
    sombre: {
      'surface-ground': '#121519',
      'surface-0': '#171B21',
      'surface-1': '#1B1F23',
      'surface-2': '#242930',
      'surface-card': '#1B1F23',
      'border': '#2C323A',
      'border-light': '#242930',
      'border-strong': '#646C79',
      'text-primary': '#E9ECF1',
      'text-secondary': '#AEB5C2',
      'text-muted': '#8E96A3',
      'sidebar-bg': '#101216',
      'topbar-bg': '#171B21',
      'topbar-border': '#2C323A',
      'nav-top': '#303946',
      'accent-bg': '#151A21',
      'accent-border': '#384759',
    },
    material: {
      'primary': ['#485D74', '#ACC5E1'],
      'on-primary': ['#FFFFFF', '#232F3E'],
      'primary-container': ['#C7E1FE', '#344559'],
      'on-primary-container': ['#344559', '#C7E1FE'],
      'inverse-primary': ['#ACC5E1', '#485D74'],
      'surface-tint': ['#485D74', '#ACC5E1'],
      'primary-fixed': ['#C7E1FE', '#C7E1FE'],
      'primary-fixed-dim': ['#ACC5E1', '#ACC5E1'],
      'secondary': ['#485C75', '#A6C4EA'],
      'on-secondary': ['#FFFFFF', '#242F3E'],
      'secondary-container': ['#C7DFFE', '#364558'],
      'on-secondary-container': ['#364558', '#C7DFFE'],
      'secondary-fixed': ['#C7DFFE', '#C7DFFE'],
      'secondary-fixed-dim': ['#A6C4EA', '#A6C4EA'],
      'background': ['#F6FAFC', '#111314'],
      'on-background': ['#1A1C1E', '#DFE3E5'],
      'surface': ['#F6FAFC', '#111314'],
      'on-surface': ['#1A1C1E', '#DFE3E5'],
      'surface-variant': ['#DDE2E6', '#43474A'],
      'on-surface-variant': ['#43474A', '#DDE2E6'],
      'surface-bright': ['#F6FAFC', '#37393B'],
      'surface-dim': ['#D7DADC', '#111314'],
      'surface-container-lowest': ['#FFFFFF', '#0C0E0F'],
      'surface-container-low': ['#F0F4F6', '#1A1C1E'],
      'surface-container': ['#EAEEF0', '#1E2022'],
      'surface-container-high': ['#E5E8EA', '#282A2C'],
      'surface-container-highest': ['#DFE3E5', '#333537'],
      'outline': ['#73777B', '#8C9094'],
      'outline-variant': ['#C1C6CA', '#43474A'],
    },
  },
};

/**
 * Ce que montre la vignette de chaque palette, emeraude comprise : les
 * valeurs de la feuille de style pour elle, celles d'ici pour les autres.
 */
export const APERCUS: Record<PaletteStructure, { menuHaut: string; menuBas: string; primaire: string; vif: string; fond: string; texte: string }> = {
  EMERAUDE: { menuHaut: '#1A5C35', menuBas: '#0B2618', primaire: '#2D7D46', vif: '#3EBB70', fond: '#F4F7F6', texte: '#0D2B1A' },
  OCEAN: { menuHaut: '#1C517D', menuBas: '#102134', primaire: '#2270A9', vif: '#40A6FB', fond: '#F4F7F6', texte: '#10253B' },
  INDIGO: { menuHaut: '#3F4880', menuBas: '#1C1D34', primaire: '#5465AD', vif: '#8597FB', fond: '#F4F7F6', texte: '#1E223B' },
  SARCELLE: { menuHaut: '#025A5A', menuBas: '#012627', primaire: '#047B78', vif: '#04B7B6', fond: '#F4F7F6', texte: '#012A2B' },
  AMETHYSTE: { menuHaut: '#5B4073', menuBas: '#271A2E', primaire: '#7A599D', vif: '#B985E7', fond: '#F4F7F6', texte: '#2B1E35' },
  ARDOISE: { menuHaut: '#404F62', menuBas: '#1B2028', primaire: '#576D85', vif: '#86A2C7', fond: '#F4F7F6', texte: '#1E252E' },
};

/** `#RRGGBB` et une opacite, en `rgba()` : pour les ombres et les halos. */
function rgba(hexa: string, alpha: number): string {
  const n = parseInt(hexa.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * La feuille de style d'une palette : les jetons du mode clair sur
 * `html[data-palette]`, ceux du mode sombre sur
 * `html[data-palette][data-theme="dark"]`. Ces selecteurs l'emportent sur
 * `:root` et `[data-theme="dark"]` de styles.scss, et sur `html` du theme
 * Material, quel que soit l'ordre des feuilles.
 */
export function cssDePalette(nom: PaletteSurchargee): string {
  const p = PALETTES[nom];
  const c = p.clair;
  const s = p.sombre;
  const clair: Record<string, string> = {
    ...Object.fromEntries(Object.entries(c).map(([k, v]) => [`--bb-${k}`, v])),
    '--bb-surface-overlay': 'rgba(255, 255, 255, 0.97)',
    '--bb-sidebar-active': rgba(c.bright, 0.18),
    '--bb-shadow-xs': `0 1px 2px ${rgba(c.deep, 0.05)}`,
    '--bb-shadow-sm': `0 1px 2px ${rgba(c.deep, 0.04)}, 0 2px 8px ${rgba(c.deep, 0.05)}`,
    '--bb-shadow': `0 2px 4px ${rgba(c.deep, 0.04)}, 0 8px 24px ${rgba(c.deep, 0.07)}`,
    '--bb-shadow-lg': `0 4px 8px ${rgba(c.deep, 0.05)}, 0 18px 44px ${rgba(c.deep, 0.12)}`,
    '--bb-shadow-hover': `0 4px 10px ${rgba(c.deep, 0.05)}, 0 14px 34px ${rgba(c.deep, 0.10)}`,
    '--bb-focus-ring': `0 0 0 3px ${rgba(c.bright, 0.40)}`,
    '--bb-focus-ring-color': rgba(c.bright, 0.40),
    ...Object.fromEntries(Object.entries(p.material).map(([k, [a, b]]) => [`--mat-sys-${k}`, `light-dark(${a}, ${b})`])),
  };
  const sombre: Record<string, string> = {
    ...Object.fromEntries(Object.entries(s).map(([k, v]) => [`--bb-${k}`, v])),
    '--bb-surface-overlay': rgba(s['surface-0'], 0.98),
    '--bb-sidebar-active': rgba(c.bright, 0.22),
    '--bb-focus-ring': `0 0 0 3px ${rgba(c.bright, 0.55)}`,
    '--bb-focus-ring-color': rgba(c.bright, 0.55),
  };
  const regles = (d: Record<string, string>) => Object.entries(d).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `html[data-palette="${nom}"] {\n${regles(clair)}\n}\n`
    + `html[data-palette="${nom}"][data-theme="dark"] {\n${regles(sombre)}\n}\n`;
}
