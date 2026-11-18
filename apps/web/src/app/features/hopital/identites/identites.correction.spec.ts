// R15 : l'accueil corrige une erreur de saisie (sexe, date de naissance,
// prenom, nom) avec un motif. Seuls les traits modifies partent ; sans
// changement ou sans motif, rien a confirmer.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { CorrigerIdentiteDto, IdentitePatientView } from '@baobaoheath/shared-types';

import { IdentitesComponent } from './identites.component';
import { HopitalService } from '../../../core/services/hopital.service';
import { AuthService } from '../../../core/services/auth.service';

const PATIENT = {
  id: 'p1', nomComplet: 'Mariama Bah', prenom: 'Mariama', nom: 'Bah', telephone: '620100010',
  dateNaissance: '2002-03-15T00:00:00.000Z', sexe: 'M', prefecture: 'Conakry',
  lieuNaissance: null, nomMere: null, niveauIdentite: 'VERIFIEE', typePiece: null,
  numeroPieceMasque: null, verifieeLe: null, verifieePar: null, traitsManquants: [],
} as IdentitePatientView;
const MOTIF = "Erreur de saisie a l'admission";

function monter() {
  const envois: { id: string; dto: CorrigerIdentiteDto }[] = [];
  const chargements = { n: 0 };
  TestBed.configureTestingModule({
    imports: [IdentitesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: HopitalService,
        useValue: {
          identites: () => { chargements.n++; return of({ success: true, data: [PATIENT] }); },
          corrections: () => of({ success: true, data: [] }),
          demandesCorrection: () => of({ success: true, data: [] }),
          corrigerIdentite: (id: string, dto: CorrigerIdentiteDto) => {
            envois.push({ id, dto });
            return of({ success: true, data: { ...PATIENT, sexe: 'F' } });
          },
        },
      },
      { provide: AuthService, useValue: { userRole: () => 'AGENT_ACCUEIL' } },
    ],
  });
  // La logique seule : le gabarit Material est couvert par le build.
  TestBed.overrideComponent(IdentitesComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(IdentitesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, envois, chargements };
}

describe('identites : correction R15', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('pre-remplit avec l identite actuelle, date sans heure', () => {
    const { c } = monter();
    c.ouvrirCorrection(PATIENT);
    expect([c.corPrenom(), c.corNom(), c.corSexe(), c.corNaissance()]).toEqual(['Mariama', 'Bah', 'M', '2002-03-15']);
  });

  it('n autorise rien sans changement, ni sans motif suffisant', () => {
    const { c } = monter();
    c.ouvrirCorrection(PATIENT);
    c.corMotif.set(MOTIF);
    expect(c.peutCorriger()).toBe(false);
    c.corSexe.set('F');
    c.corMotif.set('erreur');
    expect(c.peutCorriger()).toBe(false);
    c.corMotif.set(MOTIF);
    expect(c.peutCorriger()).toBe(true);
  });

  it('n envoie que les traits modifies, avec le motif, puis recharge', () => {
    const { c, envois, chargements } = monter();
    c.ouvrirCorrection(PATIENT);
    c.corSexe.set('F');
    c.corNaissance.set('2020-03-15');
    c.corMotif.set(`  ${MOTIF}  `);

    c.confirmerCorrection();

    expect(envois).toEqual([{ id: 'p1', dto: { motif: MOTIF, sexe: 'F', dateNaissance: '2020-03-15' } }]);
    expect(c.aCorriger()).toBeNull();
    expect(chargements.n).toBe(2);
  });
});
