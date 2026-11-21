// Le dossier de la visite, cote infirmier.
//
// Ce que ce fichier tient :
//   - les allergies s'affichent en tete, avant tout geste ;
//   - un passage n'emporte que les constantes saisies, virgule acceptee ; vide,
//     rien ne part ;
//   - le passage enregistre rejoint l'historique sans rechargement ;
//   - l'ecran n'offre aucun geste de prescription.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { DossierVisiteInfirmierView, SoinInfirmierView } from '@baobaoheath/shared-types';

import { InfirmierVisiteComponent } from './visite.component';
import { InfirmierService } from '../../../core/services/infirmier.service';
import { VaccinationService } from '../../../core/services/vaccination.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string): string { return cle; }
}

const SANS_CONSTANTES = {
  temperature: null, tensionSystolique: null, tensionDiastolique: null, frequenceCardiaque: null,
  frequenceRespiratoire: null, spo2: null, poidsKg: null, glycemie: null,
};

const VISITE: DossierVisiteInfirmierView = {
  idEpisode: 'ep-1', numero: 'EP-1', motif: 'Fièvre', service: 'Urgences', statut: 'EN_COURS',
  ouvertLe: '2026-11-21T08:00:00.000Z', responsable: 'Dr Alpha Bah',
  patient: {
    id: 'p-1', prenom: 'Fanta', nom: 'Camara', dateNaissance: '1990-01-01T00:00:00.000Z', sexe: 'F',
    groupeSanguin: 'O+', allergies: ['Pénicilline'], maladiesChroniques: [],
  },
  prescriptions: [{ produit: 'Paracétamol 500 mg', posologie: '1 cp', frequence: '3x/j', dureeJours: 5, prescritLe: '2026-11-21T09:00:00.000Z' }],
  vaccinations: [],
  soins: [],
};

function monter() {
  const soin: SoinInfirmierView = { id: 's1', creeLe: '2026-11-21T10:00:00.000Z', note: null, constantes: { ...SANS_CONSTANTES, temperature: 38.5 }, auteur: 'Mariama Sow' };
  const service = {
    visite: vi.fn(() => of({ success: true, data: VISITE })),
    noterSoin: vi.fn(() => of({ success: true, data: soin })),
  };
  const toastr = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [InfirmierVisiteComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'ep-1']]) } } },
      { provide: InfirmierService, useValue: service },
      { provide: VaccinationService, useValue: { administrerVaccin: vi.fn(() => of({ success: true })) } },
      { provide: ToastrService, useValue: toastr },
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });
  const fixture = TestBed.createComponent(InfirmierVisiteComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, service, toastr };
}

describe('le dossier de la visite, cote infirmier', () => {
  it('les allergies en tete, et les prescriptions de la visite', () => {
    const { el } = monter();
    expect(el.querySelector('.bb-inf-alerte')?.textContent).toContain('Pénicilline');
    expect(el.textContent).toContain('Paracétamol 500 mg');
  });

  it('un passage n emporte que les constantes saisies ; la virgule vaut le point', () => {
    const { c, service } = monter();
    c.passage = { ...c.passage, temperature: '38,5', spo2: '97', note: '  Pansement refait ' };
    c.noterPassage();
    expect(service.noterSoin).toHaveBeenCalledWith('ep-1', { temperature: 38.5, spo2: 97, note: 'Pansement refait' });
  });

  it('vide, rien ne part, et on le dit', () => {
    const { c, service, toastr } = monter();
    c.noterPassage();
    expect(service.noterSoin).not.toHaveBeenCalled();
    expect(toastr.error).toHaveBeenCalledWith('INFIRMIER.VISITE.PASSAGE_VIDE');
  });

  it('le passage rejoint l historique, et le formulaire se vide', () => {
    const { c, fixture, el } = monter();
    c.passage = { ...c.passage, temperature: '38.5' };
    c.noterPassage();
    fixture.detectChanges();
    expect(c.visite()!.soins).toHaveLength(1);
    expect(c.passage.temperature).toBe('');
    expect(el.textContent).toContain('Mariama Sow');
  });

  // Il soigne sans prescrire : l'ecran ne lui offre ni ordonnance, ni
  // analyse, ni cloture.
  it('aucun geste de prescription', () => {
    const { el } = monter();
    const textes = [...el.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(textes.some((t) => /ORDONNANCE|ANALYSE|CLOTURER/.test(t))).toBe(false);
  });
});
