// EF-01-08 : verifier le numero d'ordre (la route existait sans ecran) et
// corriger le nom d'un professionnel, avec un motif.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { CompteView, CorrigerNomCompteDto } from '@baobaoheath/shared-types';

import { ComptesComponent } from './comptes.component';
import { AdminService } from '../../../core/services/admin.service';

const MEDECIN = {
  id: 'med-1', prenom: 'Mamadou', nom: 'Dialo', email: 'm@example.org', telephone: '620', role: 'MEDECIN',
  estActif: false, structure: null, derniereConnexion: null, suspension: null, fermeSansMotif: false,
  soumisOrdre: true, numeroOrdre: null, ordreVerifieLe: null,
} as CompteView;
const MOTIF = "Faute de frappe a la creation du compte";

function monter() {
  const appels = { ordre: [] as [string, string][], nom: [] as [string, CorrigerNomCompteDto][], recherches: 0 };
  TestBed.configureTestingModule({
    imports: [ComptesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: AdminService,
        useValue: {
          rechercherComptes: () => { appels.recherches++; return of({ success: true, data: { comptes: [MEDECIN], total: 1, page: 1, limit: 50 } }); },
          verifierOrdre: (id: string, numero: string) => { appels.ordre.push([id, numero]); return of({ success: true, data: {} }); },
          corrigerNomCompte: (id: string, dto: CorrigerNomCompteDto) => {
            appels.nom.push([id, dto]);
            return of({ success: true, data: { ...MEDECIN, ...dto } });
          },
        },
      },
    ],
  });
  TestBed.overrideComponent(ComptesComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(ComptesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, appels };
}

describe('comptes : ordre et nom', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('verifie un numero d ordre d au moins trois caracteres, puis recharge', () => {
    const { c, appels } = monter();
    c.ouvrirVerificationOrdre(MEDECIN);
    c.numeroOrdre.set('GN');
    expect(c.peutVerifierOrdre()).toBe(false);
    c.numeroOrdre.set('  GN-123 ');

    c.confirmerVerificationOrdre();

    expect(appels.ordre).toEqual([['med-1', 'GN-123']]);
    expect(c.aVerifier()).toBeNull();
    expect(appels.recherches).toBe(2);
  });

  it('n envoie que ce qui change, avec le motif', () => {
    const { c, appels } = monter();
    c.ouvrirCorrectionNom(MEDECIN);
    c.motifNom.set(MOTIF);
    expect(c.peutCorrigerNom()).toBe(false);
    c.nomCorrige.set(' Diallo ');
    c.motifNom.set('faute');
    expect(c.peutCorrigerNom()).toBe(false);
    c.motifNom.set(MOTIF);

    c.confirmerCorrectionNom();

    expect(appels.nom).toEqual([['med-1', { nom: 'Diallo', motif: MOTIF }]]);
    expect(c.aRenommer()).toBeNull();
  });

  it('refuse un nom vide', () => {
    const { c } = monter();
    c.ouvrirCorrectionNom(MEDECIN);
    c.nomCorrige.set('  ');
    c.motifNom.set(MOTIF);
    expect(c.peutCorrigerNom()).toBe(false);
  });
});
