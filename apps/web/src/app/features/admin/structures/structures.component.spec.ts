// Page Structures (admin) : un bouton rouge « Desactiver » sur chaque ligne,
// sans recherche ni filtre, et la meme icone pour un poste de sante et un CHU.
//
// L'action qui coupe une structure passe dans un menu, toujours suivie d'une
// confirmation ; on peut chercher et filtrer ; chaque type a son icone.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';

const cartes = vi.hoisted(() => {
  const carte = { setView: vi.fn(), on: vi.fn(), remove: vi.fn() };
  const coucheTuiles = { addTo: vi.fn() };
  const marqueur = {
    addTo: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    setLatLng: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 9.5, lng: -13.6 })),
  };
  return {
    carte,
    map: vi.fn(() => carte),
    tileLayer: vi.fn(() => coucheTuiles),
    marker: vi.fn(() => marqueur),
    divIcon: vi.fn(() => ({})),
  };
});

vi.mock('leaflet', () => cartes);

const STRUCTURES = [
  { id: 'chu', nom: 'CHU Donka', type: 'CHU', prefecture: 'Conakry', telephone: '620000001', estActive: true, estPartenaire: true, creeLe: '2026-01-01' },
  { id: 'poste', nom: 'Poste de santé de Bantignel', type: 'POSTE', prefecture: 'Pita', telephone: null, estActive: true, estPartenaire: false, creeLe: '2026-01-02' },
  { id: 'pharma', nom: 'Pharmacie du Port', type: 'PHARMACIE', prefecture: 'Conakry', telephone: null, estActive: false, estPartenaire: true, creeLe: '2026-01-03' },
  { id: 'labo', nom: 'Laboratoire Mamou Analyses', type: 'LABORATOIRE', prefecture: 'Mamou', telephone: null, estActive: true, estPartenaire: false, creeLe: '2026-01-04' },
  // Une officine ouverte, mais hors du circuit des commandes : le cas que
  // l'ecran doit savoir montrer et corriger.
  { id: 'horscircuit', nom: 'Pharmacie de Kindia', type: 'PHARMACIE', prefecture: 'Kindia', telephone: null, estActive: true, estPartenaire: false, creeLe: '2026-01-05' },
];

function monter() {
  const appels: string[] = [];
  const admin = {
    getStructures: () => of({ success: true, data: STRUCTURES }),
    deleteStructure: (id: string) => { appels.push(`desactiver:${id}`); return of({ success: true }); },
    updateStructure: (id: string) => { appels.push(`reactiver:${id}`); return of({ success: true }); },
    definirPartenariat: (id: string, etat: boolean) => {
      appels.push(`partenariat:${id}:${etat}`);
      return of({ success: true, data: {} });
    },
  };
  TestBed.configureTestingModule({
    imports: [StructuresComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AdminService, useValue: admin },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(StructuresComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, appels };
}

const noms = (el: HTMLElement) =>
  [...el.querySelectorAll('.bb-struct__item .bb-struct__name')].map((n) => n.textContent?.trim());
const ligne = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`.bb-struct__item[data-id="${id}"]`)!;
const saisir = (input: HTMLInputElement | HTMLSelectElement, valeur: string) => {
  input.value = valeur;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('admin : page Structures', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('ne montre plus de bouton « Désactiver » sur chaque ligne', () => {
    const { el } = monter();
    expect(el.querySelector('.bb-struct__deactivate-btn')).toBeNull();
    const menu = ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!;
    expect(menu.getAttribute('aria-haspopup')).toBe('menu');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('désactive par le menu, et seulement après confirmation', () => {
    const { el, rendre, appels } = monter();
    ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    const menu = el.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    menu.querySelector<HTMLButtonElement>('[data-action="desactiver"]')!.click();
    rendre();
    expect(appels).toEqual([]);
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(el.querySelector('#struct-deactivate-title')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.bb-logout-modal__btn--confirm')!.click();
    expect(appels).toEqual(['desactiver:chu']);
  });

  it('ouvre le dialogue « Situer sur la carte » depuis le menu de la ligne', () => {
    const { el, rendre } = monter();
    ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    el.querySelector<HTMLButtonElement>('[role="menu"] [data-action="situer"]')!.click();
    rendre();

    expect(el.querySelector('#struct-situer-title')).not.toBeNull();
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('reflète les nouvelles coordonnées sur la ligne sans recharger la liste', () => {
    const { c, el, rendre } = monter();

    c.appliquerPositionStructure({ id: 'chu', latitude: 9.5123456, longitude: -13.6123456 });

    const position = rendre().querySelector('.bb-struct__item[data-id="chu"] .bb-struct__position');
    expect(position?.textContent).toContain('9.512346');
    expect(position?.textContent).toContain('-13.612346');
  });

  it('propose « Réactiver » pour une structure inactive', () => {
    const { el, rendre, appels } = monter();
    ligne(el, 'pharma').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    expect(el.querySelector('[role="menu"] [data-action="desactiver"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[role="menu"] [data-action="reactiver"]')!.click();
    expect(appels).toEqual(['reactiver:pharma']);
  });

  it('ferme le menu avec Échap', () => {
    const { el, rendre } = monter();
    ligne(el, 'chu').querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
    rendre();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(rendre().querySelector('[role="menu"]')).toBeNull();
  });

  it('cherche par nom ou par préfecture', () => {
    const { el, rendre } = monter();
    const champ = el.querySelector<HTMLInputElement>('.bb-struct__recherche input')!;
    saisir(champ, 'donka');
    expect(noms(rendre())).toEqual(['CHU Donka']);
    saisir(champ, 'conakry');
    expect(noms(rendre())).toEqual(['CHU Donka', 'Pharmacie du Port']);
  });

  it('filtre par type et par état, et annonce le nombre de résultats', () => {
    const { el, rendre } = monter();
    saisir(el.querySelector<HTMLSelectElement>('select.bb-struct__filtre-type')!, 'LABORATOIRE');
    expect(noms(rendre())).toEqual(['Laboratoire Mamou Analyses']);
    saisir(el.querySelector<HTMLSelectElement>('select.bb-struct__filtre-type')!, '');
    el.querySelector<HTMLButtonElement>('[data-etat="INACTIVES"]')!.click();
    expect(noms(rendre())).toEqual(['Pharmacie du Port']);
    expect(el.querySelector('.bb-struct__resultats')!.textContent).toContain('1');
  });

  it('dit quand aucun résultat ne correspond', () => {
    const { el, rendre } = monter();
    saisir(el.querySelector<HTMLInputElement>('.bb-struct__recherche input')!, 'zzz');
    expect(rendre().querySelector('.bb-struct__aucun')).not.toBeNull();
  });

  it('donne à chaque type sa propre icône', () => {
    const { el } = monter();
    const icone = (id: string) => ligne(el, id).querySelector('.bb-struct__icon i')!.className;
    const icones = new Set(['chu', 'poste', 'pharma', 'labo'].map(icone));
    expect(icones.size).toBe(4);
  });

  it('exporte les structures affichées', () => {
    const { c, el, rendre } = monter();
    el.querySelector<HTMLButtonElement>('[data-etat="INACTIVES"]')!.click();
    rendre();
    expect(c.structuresFiltrees().map((s) => s.id)).toEqual(['pharma']);
  });
});

describe('commune et position', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('envoie la commune et le quartier saisis, et désactive le bouton sans commune', () => {
    const { c, el, rendre } = monter();
    el.querySelector<HTMLButtonElement>('.bb-struct__add-btn')!.click();
    rendre();

    const btn = el.querySelector<HTMLButtonElement>('.bb-struct__save-btn')!;
    expect(btn.disabled).toBe(true);

    const nom = el.querySelector<HTMLInputElement>('#struct-nom')!;
    const prefecture = el.querySelector<HTMLInputElement>('#struct-pref')!;
    const commune = el.querySelector<HTMLInputElement>('#struct-commune')!;
    const quartier = el.querySelector<HTMLInputElement>('#struct-quartier')!;
    const adminPrenom = el.querySelector<HTMLInputElement>('#struct-admin-prenom')!;
    const adminNom = el.querySelector<HTMLInputElement>('#struct-admin-nom')!;
    const adminTel = el.querySelector<HTMLInputElement>('#struct-admin-tel')!;
    const adminEmail = el.querySelector<HTMLInputElement>('#struct-admin-email')!;

    saisir(nom, 'Centre de santé');
    saisir(prefecture, 'Conakry');
    saisir(commune, 'Ratoma');
    saisir(quartier, 'Kipé');
    saisir(adminPrenom, 'Awa');
    saisir(adminNom, 'Bah');
    saisir(adminTel, '+224620000001');
    saisir(adminEmail, 'awa@example.com');
    rendre();

    expect(c.newStructure.commune).toBe('Ratoma');
    expect(c.newStructure.quartier).toBe('Kipé');
    expect(el.querySelector<HTMLButtonElement>('.bb-struct__save-btn')!.disabled).toBe(false);
  });

  it('remplit les coordonnées depuis la géolocalisation et affiche l’erreur si elle échoue', () => {
    const { c, el, rendre } = monter();
    el.querySelector<HTMLButtonElement>('.bb-struct__add-btn')!.click();
    rendre();

    const originalGeo = navigator.geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          success({ coords: { latitude: 9.6170123456, longitude: -13.6380987654 } } as GeolocationPosition);
        },
      },
      configurable: true,
    });

    c.positionActuelle();
    expect(c.newStructure.latitude).toBe(9.617012);
    expect(c.newStructure.longitude).toBe(-13.638099);

    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => {
          failure({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
        },
      },
      configurable: true,
    });
    c.positionActuelle();
    expect(c.erreurGps()).toContain('Position');

    Object.defineProperty(navigator, 'geolocation', { value: originalGeo, configurable: true });
  });
});

// ── Le partenariat ───────────────────────────────────────────────────
//
// **Le drapeau n'avait aucune porte.** `estPartenaire` decide qui recoit les
// appels de commande du quartier ; il naissait a faux et rien, dans toute
// l'application, ne le levait. Une pharmacie entree avec ses quatre pieces
// reglementaires restait muette, et son titulaire ne voyait qu'un refus —
// « votre pharmacie n'est pas partenaire de la plateforme » — que personne ne
// pouvait corriger autrement qu'en ecrivant dans la base.

describe('le partenariat des officines', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const menuDe = (el: HTMLElement, id: string) => {
    ligne(el, id).querySelector<HTMLButtonElement>('.bb-struct__menu-btn')!.click();
  };

  it('signale une officine hors du circuit des commandes', () => {
    const { el, rendre } = monter();

    expect(ligne(rendre(), 'horscircuit').querySelector('.bb-struct__badge-hors-circuit')).toBeTruthy();
    expect(ligne(el, 'pharma').querySelector('.bb-struct__badge-hors-circuit')).toBeNull();
  });

  // Un poste de sante n'est jamais sollicite pour une ordonnance : lui coller
  // « hors circuit » inquieterait pour rien.
  it('ne dit rien du partenariat des structures qui ne servent pas d ordonnances', () => {
    const { el, rendre } = monter();
    rendre();

    for (const id of ['chu', 'poste', 'labo']) {
      expect(ligne(el, id).querySelector('.bb-struct__badge-hors-circuit')).toBeNull();
    }
  });

  it('accorde le partenariat depuis le menu', () => {
    const { el, rendre, appels } = monter();
    rendre();

    menuDe(el, 'horscircuit');
    rendre().querySelector<HTMLButtonElement>('.bb-struct__item[data-id="horscircuit"] [data-action="partenariat"]')!.click();

    expect(appels).toContain('partenariat:horscircuit:true');
  });

  // L'etat vise est envoye explicitement, jamais une bascule : on verifie
  // donc qu'une officine deja partenaire recoit bien `false`.
  it('retire le partenariat d une officine qui l a', () => {
    const { c, rendre, appels } = monter();
    rendre();

    c.basculerPartenariat({ id: 'pharma', nom: 'Pharmacie du Port', estPartenaire: true } as never);

    expect(appels).toContain('partenariat:pharma:false');
  });

  it("n'offre pas l'action sur une structure qui ne sert pas d'ordonnances", () => {
    const { el, rendre } = monter();
    rendre();

    menuDe(el, 'chu');
    expect(rendre().querySelector('.bb-struct__item[data-id="chu"] [data-action="partenariat"]')).toBeNull();
  });
});
