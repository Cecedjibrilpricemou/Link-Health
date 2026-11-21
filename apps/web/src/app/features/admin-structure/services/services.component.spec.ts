// Les services de l'etablissement, vus par l'administrateur.
//
// Ce que ce fichier tient :
//   - ouverts et fermes sont separes, avec le nombre de medecins ;
//   - les suggestions ne proposent pas un service deja declare ;
//   - ajouter, renommer, fermer et rouvrir appellent l'API et mettent la
//     liste a jour sans rechargement.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { ServiceHospitalierView } from '@baobaoheath/shared-types';

import { ServicesComponent } from './services.component';
import { ApiService } from '../../../core/services/api.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string { return p ? `${cle} ${JSON.stringify(p)}` : cle; }
}

const sv = (o: Partial<ServiceHospitalierView>): ServiceHospitalierView => ({ id: 'x', nom: 'X', actif: true, nbMedecins: 0, ...o });

function monter(services: ServiceHospitalierView[]) {
  const api = {
    get: vi.fn(() => of({ success: true, data: services })),
    post: vi.fn((_u: string, corps: { nom: string }) => of({ success: true, data: sv({ id: 'nouveau', nom: corps.nom }) })),
    put: vi.fn((u: string, corps: { nom?: string; actif?: boolean }) => {
      const id = u.split('/').pop()!;
      const avant = services.find((s) => s.id === id)!;
      return of({ success: true, data: { ...avant, ...corps } });
    }),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ServicesComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      { provide: ApiService, useValue: api },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: { success: vi.fn(), error: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(ServicesComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, api };
}

const carte = (el: HTMLElement, nom: string) => el.querySelector<HTMLElement>(`[data-service="${nom}"]`)!;

describe('les services de l etablissement', () => {
  it('separe ouverts et fermes, avec leurs medecins', () => {
    const { el } = monter([sv({ id: 'a', nom: 'Pédiatrie', nbMedecins: 3 }), sv({ id: 'b', nom: 'Ancien', actif: false })]);
    expect(el.querySelectorAll('.bb-svc__section')).toHaveLength(2);
    expect(carte(el, 'Pédiatrie').textContent).toContain('{"n":3}');
    expect(carte(el, 'Ancien').classList).toContain('bb-svc__carte--ferme');
  });

  it('les suggestions ne reproposent pas un service deja declare', () => {
    const { c } = monter([sv({ nom: 'urgences' })]);
    expect(c.suggestions()).not.toContain('Urgences');
    expect(c.suggestions()).toContain('Pédiatrie');
  });

  it('ajouter une suggestion d un clic', () => {
    const { el, fixture, api, c } = monter([]);
    const bouton = [...el.querySelectorAll<HTMLButtonElement>('.bb-svc__suggestion')].find((b) => b.textContent?.includes('Maternité'))!;
    bouton.click();
    fixture.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/admin-structure/services', { nom: 'Maternité' });
    expect(c.services().map((s) => s.nom)).toEqual(['Maternité']);
    expect(c.suggestions()).not.toContain('Maternité');
  });

  it('ajouter un service saisi ; trop court, rien ne part', () => {
    const { c, api } = monter([]);
    c.nouveau = 'a';
    c.ajouter();
    expect(api.post).not.toHaveBeenCalled();
    c.nouveau = 'Dialyse';
    c.ajouter();
    expect(api.post).toHaveBeenCalledWith('/admin-structure/services', { nom: 'Dialyse' });
    expect(c.nouveau).toBe('');
  });

  it('fermer puis rouvrir', () => {
    const { el, fixture, api, c } = monter([sv({ id: 'a', nom: 'Pédiatrie' })]);
    carte(el, 'Pédiatrie').querySelector<HTMLButtonElement>('.bb-svc__basculer')!.click();
    fixture.detectChanges();
    expect(api.put).toHaveBeenCalledWith('/admin-structure/services/a', { actif: false });
    expect(c.fermes().map((s) => s.nom)).toEqual(['Pédiatrie']);
  });

  it('renommer ; un nom inchange ne part pas', () => {
    const { el, fixture, api, c } = monter([sv({ id: 'a', nom: 'Pédiatrie' })]);
    carte(el, 'Pédiatrie').querySelector<HTMLButtonElement>('.bb-svc__btn-renommer')!.click();
    fixture.detectChanges();
    c.renommer(c.services()[0]!);
    expect(api.put).not.toHaveBeenCalled();
    c.ouvrirRenommage(c.services()[0]!);
    c.nomSaisi = 'Pédiatrie générale';
    c.renommer(c.services()[0]!);
    expect(api.put).toHaveBeenCalledWith('/admin-structure/services/a', { nom: 'Pédiatrie générale' });
  });
});
