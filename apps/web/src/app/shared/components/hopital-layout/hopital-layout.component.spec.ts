// L'espace de l'etablissement : le menu de l'accueil, et celui du directeur.
//
// Comme le titulaire en pharmacie, le directeur travaille dans cet espace et y
// voit en plus les menus de gestion. Le menu lit la structure seule
// (`/admin-structure/ma-structure`), jamais les statistiques : un calcul de
// compteurs en echec retirait autrefois Pharmacies et Assurances d'un hopital.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { HopitalLayoutComponent } from './hopital-layout.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

function monter(role: string, reponses: Record<string, () => unknown> = {}) {
  const api = { get: (url: string) => (reponses[url] ?? (() => throwError(() => ({ status: 500 }))))() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HopitalLayoutComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { currentUser: signal({ id: `u-${role}`, role }), doitChangerMotDePasse: signal(false), logout() {} } },
    ],
  });
  // On teste le menu, pas la coquille : le gabarit et ses enfants sont ecartes.
  TestBed.overrideComponent(HopitalLayoutComponent, { set: { template: '', imports: [] } });
  return TestBed.createComponent(HopitalLayoutComponent).componentInstance;
}

const routes = (c: HopitalLayoutComponent) => c.entrees().map((i) => i.route);
const structure = (data: unknown) => ({ '/admin-structure/ma-structure': () => of({ success: true, data }) });

describe('l espace de l etablissement', () => {
  it('l agent d accueil garde son menu, d un seul tenant, sans gestion', () => {
    const c = monter('AGENT_ACCUEIL');
    expect(c.rubriques()).toHaveLength(1);
    expect(routes(c)).toContain('/hopital/admission');
    expect(routes(c).some((r) => /agents|pharmacies|dossier|apparence|pilotage/.test(r))).toBe(false);
    expect(c.racineFil()).toBe('HOPITAL.ROLE');
  });

  it('le directeur d un hopital voit en plus ses menus de gestion, dans ce meme espace', () => {
    const c = monter('ADMIN_STRUCTURE', structure({ hospitaliere: true, type: 'CHU' }));
    expect(routes(c)).toEqual(expect.arrayContaining(['/hopital/pilotage', '/hopital/admission', '/hopital/agents', '/hopital/pharmacies', '/hopital/assurances']));
    expect(c.menuIllisible()).toBe(false);
  });

  it('Pharmacies et Assurances restent meme si les statistiques echouent', () => {
    const c = monter('ADMIN_STRUCTURE', { ...structure({ hospitaliere: true, type: 'CHU' }), '/admin-structure/stats': () => throwError(() => ({ status: 500 })) });
    expect(routes(c)).toContain('/hopital/pharmacies');
  });

  it('ni Pharmacies ni Assurances pour une structure non hospitaliere', () => {
    const c = monter('ADMIN_STRUCTURE', structure({ hospitaliere: false, type: 'CENTRE' }));
    expect(routes(c)).not.toContain('/hopital/pharmacies');
    expect(routes(c)).not.toContain('/hopital/assurances');
  });

  it('l echec n est signale que si la structure elle-meme est illisible', () => {
    const c = monter('ADMIN_STRUCTURE');
    expect(c.menuIllisible()).toBe(true);
  });
});
