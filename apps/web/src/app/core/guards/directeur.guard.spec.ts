// Le directeur, toujours dans le bon espace ; le personnel, jamais derange.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable, of, type Observable } from 'rxjs';

import { ancienneAdresseDirecteurGuard, espaceDirecteurGuard } from './directeur.guard';
import { AuthService } from '../services/auth.service';
import { DirecteurService, type StructureDuDirecteur } from '../services/directeur.service';

function monter(role: string, structure: StructureDuDirecteur) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal({ id: 'u', role }) } },
      { provide: DirecteurService, useValue: { structure: () => of(structure) } },
    ],
  });
}

async function resultat(r: unknown): Promise<string | boolean> {
  const v = isObservable(r) ? await firstValueFrom(r as Observable<unknown>) : r;
  return v instanceof UrlTree ? TestBed.inject(Router).serializeUrl(v) : (v as boolean);
}

const lancer = (garde: ReturnType<typeof espaceDirecteurGuard>, url = '/') =>
  TestBed.runInInjectionContext(() => garde({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));

const CHU: StructureDuDirecteur = { type: 'CHU', hospitaliere: true, illisible: false };
const LABO: StructureDuDirecteur = { type: 'LABORATOIRE', hospitaliere: false, illisible: false };

describe('le directeur dans le bon espace', () => {
  it('le directeur d un CHU entre dans /hopital ; dans /laboratoire, il est ramene a son pilotage', async () => {
    monter('ADMIN_STRUCTURE', CHU);
    expect(await resultat(lancer(espaceDirecteurGuard('/hopital')))).toBe(true);
    expect(await resultat(lancer(espaceDirecteurGuard('/laboratoire')))).toBe('/hopital/pilotage');
  });

  it('le directeur d un laboratoire est ramene a /laboratoire', async () => {
    monter('ADMIN_STRUCTURE', LABO);
    expect(await resultat(lancer(espaceDirecteurGuard('/hopital')))).toBe('/laboratoire/pilotage');
  });

  it('le personnel n est pas concerne', async () => {
    monter('AGENT_ACCUEIL', LABO);
    expect(await resultat(lancer(espaceDirecteurGuard('/hopital')))).toBe(true);
  });

  it('une structure illisible laisse entrer : le menu dira l echec', async () => {
    monter('ADMIN_STRUCTURE', { type: null, hospitaliere: false, illisible: true });
    expect(await resultat(lancer(espaceDirecteurGuard('/laboratoire')))).toBe(true);
  });

  it('une ancienne adresse mene a l ecran equivalent', async () => {
    monter('ADMIN_STRUCTURE', CHU);
    expect(await resultat(lancer(ancienneAdresseDirecteurGuard, '/admin-structure/accueil/episodes'))).toBe('/hopital/episodes');
    monter('ADMIN_STRUCTURE', LABO);
    expect(await resultat(lancer(ancienneAdresseDirecteurGuard, '/admin-structure/dashboard'))).toBe('/laboratoire/pilotage');
  });
});
