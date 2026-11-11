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
  zones: { delaiElargissementCommandeMinutes: 10, delaiElargissementCourseMinutes: 10 },
  pays: {
    code: 'GN', nom: 'Guinée', indicatifTelephone: '+224',
    niveaux: [
      { code: 'region', libelles: { fr: 'Région', en: 'Region', pt: 'Região' } },
      { code: 'prefecture', libelles: { fr: 'Préfecture', en: 'Prefecture' } },
      { code: 'commune', libelles: { fr: 'Commune' } },
    ],
    niveauBase: 'commune', niveauElargissement: 'prefecture',
  },
  modifieLe: null, idModifiePar: null,
} as unknown as ParametresSystemeView;

function monter() {
  const envois: UpdateParametresSystemeDto[] = [];
  const admin = {
    getParametres: () => of({ success: true, data: structuredClone(PARAMS) }),
    updateParametres: (dto: UpdateParametresSystemeDto) => { envois.push(dto); return of({ success: true, data: structuredClone(PARAMS) }); },
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

  it('les autres onglets partent tels quels', () => {
    const { c, envois } = monter();
    c.enregistrer('zones');
    expect(envois[0]).toEqual({ zones: { delaiElargissementCommandeMinutes: 10, delaiElargissementCourseMinutes: 10 } });
  });
});
