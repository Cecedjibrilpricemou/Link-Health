// Parametres > Pays (M1). Ce qui compte : le decoupage s'edite (ajout, ordre,
// retrait) et part nettoye a l'API — code pays en majuscules, codes de niveau
// en minuscules, noms vides retires plutot que refuses par le serveur.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { ParametresSystemeView, UpdateParametresSystemeDto } from '@baobaoheath/shared-types';

import { SettingsComponent } from './settings.component';
import { AdminService } from '../../../core/services/admin.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';

const PARAMS = {
  identite: { nom: 'KÈNÈYA' }, facturation: {}, securite: {}, alertes: {}, sync: {}, prescription: {},
  pharmacie: { categoriesExigeantOrdonnance: [] },
  zones: {
    delaiElargissementCommandeMinutes: 10, delaiElargissementCourseMinutes: 10,
    delaiFinalCommandeMinutes: 60, delaiFinalCourseMinutes: 90,
  },
  pays: {
    code: 'GN', nom: 'Guinée', indicatifTelephone: '+224',
    niveaux: [
      { code: 'region', libelles: { fr: 'Région', en: 'Region', pt: 'Região' } },
      { code: 'prefecture', libelles: { fr: 'Préfecture', en: 'Prefecture' } },
      { code: 'commune', libelles: { fr: 'Commune' } },
    ],
    niveauBase: 'commune', niveauElargissement: 'prefecture',
  },
  modifieLe: null, idModifiePar: null, decoupageFige: false,
} as unknown as ParametresSystemeView;

function monter(decoupageFige = false) {
  const envois: UpdateParametresSystemeDto[] = [];
  const vue = () => ({ ...structuredClone(PARAMS), decoupageFige });
  const admin = {
    getParametres: () => of({ success: true, data: vue() }),
    updateParametres: (dto: UpdateParametresSystemeDto) => { envois.push(dto); return of({ success: true, data: vue() }); },
  };
  TestBed.configureTestingModule({
    imports: [SettingsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AdminService, useValue: admin },
      { provide: PlateformeService, useValue: { appliquer() {} } },
      { provide: ToastrService, useValue: { success() {}, error() {} } },
    ],
  });
  const fixture = TestBed.createComponent(SettingsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, envois };
}

describe('parametres : pays', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('propose l onglet Pays et affiche un niveau par ligne', () => {
    const { c, el, rendre } = monter();
    expect(c.tabs.map((t) => t.id)).toContain('pays');

    c.setTab('pays');
    rendre();

    expect(el.querySelectorAll('.niveau-row')).toHaveLength(3);
    expect(el.querySelector('a[href="/admin/geographie"]')).not.toBeNull();
  });

  it('ajoute, deplace et retire des niveaux, sans descendre sous deux', () => {
    const { c } = monter();
    c.deplacerNiveau(0, 1);
    expect(c.pays.niveaux.map((n) => n.code)).toEqual(['prefecture', 'region', 'commune']);
    // Pas de deplacement hors de la liste.
    c.deplacerNiveau(0, -1);
    expect(c.pays.niveaux.map((n) => n.code)).toEqual(['prefecture', 'region', 'commune']);

    c.ajouterNiveau();
    expect(c.pays.niveaux).toHaveLength(4);
    c.retirerNiveau(3);
    expect(c.pays.niveaux).toHaveLength(3);
  });

  it('plafonne a six niveaux', () => {
    const { c } = monter();
    for (let i = 0; i < 10; i++) c.ajouterNiveau();
    expect(c.pays.niveaux).toHaveLength(c.maxNiveaux);
  });

  it('envoie un pays nettoye : majuscules, minuscules, noms vides retires', () => {
    const { c, envois } = monter();
    c.pays.code = ' sn ';
    c.pays.nom = ' Sénégal ';
    c.pays.niveaux[0]!.code = ' Region ';
    c.pays.niveaux[1]!.libelles = { fr: 'Département', en: '  ', pt: '' };

    c.enregistrer('pays');

    const pays = envois[0]!.pays!;
    expect(pays.code).toBe('SN');
    expect(pays.nom).toBe('Sénégal');
    expect(pays.niveaux![0]!.code).toBe('region');
    expect(pays.niveaux![1]!.libelles).toEqual({ fr: 'Département' });
    expect(pays.niveaux![0]!.libelles).toEqual({ fr: 'Région', en: 'Region', pt: 'Região' });
  });

  // R6 : des adresses existent selon ce decoupage. L'ecran ne propose plus ce
  // que l'API refuserait, et le dit.
  it('decoupage fige : le dit, verrouille codes, ordre et roles, garde les libelles', () => {
    const { c, el, rendre } = monter(true);
    c.setTab('pays');
    rendre();

    expect(el.querySelector('#pays-decoupage-fige')).not.toBeNull();
    expect(el.querySelector('#pays-ajouter-niveau')).toBeNull();
    expect(el.querySelector('.niveau-row__actions')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#niveau-code-0')!.readOnly).toBe(true);
    expect(el.querySelector<HTMLInputElement>('#niveau-fr-0')!.readOnly).toBe(false);
  });

  it('decoupage fige : ajouter, retirer ou deplacer ne fait rien', () => {
    const { c } = monter(true);
    c.ajouterNiveau();
    c.retirerNiveau(0);
    c.deplacerNiveau(0, 1);
    expect(c.pays.niveaux.map((n) => n.code)).toEqual(['region', 'prefecture', 'commune']);
  });

  it('decoupage fige : un libelle modifie part, avec les memes codes et roles', () => {
    const { c, envois } = monter(true);
    c.pays.niveaux[2]!.libelles.fr = 'Commune urbaine';

    c.enregistrer('pays');

    const pays = envois[0]!.pays!;
    expect(pays.niveaux!.map((n) => n.code)).toEqual(['region', 'prefecture', 'commune']);
    expect(pays.niveaux![2]!.libelles.fr).toBe('Commune urbaine');
    expect([pays.niveauBase, pays.niveauElargissement]).toEqual(['commune', 'prefecture']);
  });

  it('installation vierge : le decoupage reste modifiable', () => {
    const { c, el, rendre } = monter(false);
    c.setTab('pays');
    rendre();

    expect(el.querySelector('#pays-decoupage-fige')).toBeNull();
    expect(el.querySelector('#pays-ajouter-niveau')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('#niveau-code-0')!.readOnly).toBe(false);
  });

  it('les autres onglets partent tels quels', () => {
    const { c, envois } = monter();
    c.enregistrer('zones');
    expect(envois[0]).toEqual({ zones: {
      delaiElargissementCommandeMinutes: 10, delaiElargissementCourseMinutes: 10,
      // R1 : le delai final part avec la section, tel que lu.
      delaiFinalCommandeMinutes: 60, delaiFinalCourseMinutes: 90,
    } });
  });
});
