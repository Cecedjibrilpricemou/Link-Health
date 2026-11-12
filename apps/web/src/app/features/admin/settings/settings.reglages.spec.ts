// R10 a R14 : des reglages qui ne peuvent plus se contredire, vus de l'ecran.
// Ce qui compte : le dernier moyen de paiement ne se coupe pas ; une validite
// reglementee plus longue que l'ordinaire n'est pas envoyee ; la devise se
// verrouille des qu'un montant existe ; le pays de l'identite est celui de
// l'installation ; et la longueur du numero part avec le pays.
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
  identite: { nom: 'KÈNÈYA', pays: 'Guinée', devise: 'GNF', slogan: '' },
  facturation: { paiementEspeces: true, paiementOrangeMoney: true, paiementMomo: false, margePct: 15 },
  securite: {}, alertes: {}, sync: {},
  prescription: { dureeValiditeJours: 90, dureeValiditeReglementeJours: 28, longueurCodeVerification: 6, renouvellementsMax: 6, signatureObligatoire: false },
  pharmacie: { categoriesExigeantOrdonnance: [] },
  zones: {
    delaiElargissementCommandeMinutes: 10, delaiElargissementCourseMinutes: 10,
    delaiFinalCommandeMinutes: 60, delaiFinalCourseMinutes: 90,
  },
  pays: {
    code: 'GN', nom: 'Guinée', indicatifTelephone: '+224', longueurNumero: 9,
    niveaux: [
      { code: 'region', libelles: { fr: 'Région' } },
      { code: 'prefecture', libelles: { fr: 'Préfecture' } },
      { code: 'commune', libelles: { fr: 'Commune' } },
    ],
    niveauBase: 'commune', niveauElargissement: 'prefecture',
  },
  modifieLe: null, idModifiePar: null, decoupageFige: false, deviseFigee: false,
} as unknown as ParametresSystemeView;

function monter(deviseFigee = false) {
  const envois: UpdateParametresSystemeDto[] = [];
  const erreurs: string[] = [];
  const vue = () => ({ ...structuredClone(PARAMS), deviseFigee });
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
      { provide: ToastrService, useValue: { success() {}, error(m: string) { erreurs.push(m); } } },
    ],
  });
  const fixture = TestBed.createComponent(SettingsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, envois, erreurs };
}

describe('parametres : reglages coherents (R10-R14)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  // R11 : sans moyen de paiement, plus rien ne peut etre paye.
  it('le dernier moyen de paiement actif est verrouille', () => {
    const { c } = monter();
    // Deux actifs au depart : aucun n'est le dernier.
    expect(c.dernierMoyenPaiement('paiementEspeces')).toBe(false);
    expect(c.dernierMoyenPaiement('paiementOrangeMoney')).toBe(false);

    c.facturation.paiementOrangeMoney = false;

    expect(c.dernierMoyenPaiement('paiementEspeces')).toBe(true);
    // Un moyen deja inactif n'est jamais « le dernier ».
    expect(c.dernierMoyenPaiement('paiementMomo')).toBe(false);
  });

  it('couper le dernier moyen actif est refuse, et explique', () => {
    const { c, erreurs } = monter();
    c.basculerPaiement('paiementOrangeMoney', false);
    expect(c.facturation.paiementOrangeMoney).toBe(false);
    expect(erreurs).toHaveLength(0);

    // Les especes sont desormais le seul moyen actif.
    c.basculerPaiement('paiementEspeces', false);

    expect(c.facturation.paiementEspeces).toBe(true);
    expect(erreurs).toHaveLength(1);
  });

  it('rallumer un moyen reste toujours possible', () => {
    const { c, erreurs } = monter();
    c.basculerPaiement('paiementOrangeMoney', false);
    c.basculerPaiement('paiementMomo', true);
    expect(c.facturation.paiementMomo).toBe(true);
    expect(c.dernierMoyenPaiement('paiementEspeces')).toBe(false);
    expect(erreurs).toHaveLength(0);
  });

  it('l ecran explique la regle, et la section part avec deux moyens actifs', () => {
    const { c, el, rendre, envois } = monter();
    c.setTab('facturation');
    rendre();

    expect(el.querySelector('#paiement-dernier')).not.toBeNull();
    c.enregistrer('facturation');
    expect(envois[0]!.facturation).toMatchObject({ paiementEspeces: true, paiementOrangeMoney: true });
  });

  // R10 : le produit le plus controle ne doit pas rester valable le plus longtemps.
  it('une validite reglementee plus longue que l ordinaire n est pas envoyee, et l ecran le dit', () => {
    const { c, el, rendre, envois, erreurs } = monter();
    c.setTab('prescription');
    c.prescription.dureeValiditeJours = 7;
    rendre();

    expect(c.validiteIncoherente()).toBe(true);
    expect(el.querySelector('#presc-reg-incoherent')).not.toBeNull();

    c.enregistrer('prescription');
    expect(envois).toHaveLength(0);
    expect(erreurs).toHaveLength(1);
  });

  it('une validite reglementee egale ou plus courte part normalement', () => {
    const { c, el, rendre, envois } = monter();
    c.setTab('prescription');
    c.prescription.dureeValiditeReglementeJours = 90;
    rendre();

    expect(c.validiteIncoherente()).toBe(false);
    expect(el.querySelector('#presc-reg-incoherent')).toBeNull();
    c.enregistrer('prescription');
    expect(envois).toHaveLength(1);
  });

  // R12 : les montants enregistres n'ont pas de devise propre.
  it('devise figee : le champ est en lecture seule et l ecran l explique', () => {
    const { el, rendre } = monter(true);
    rendre();

    expect(el.querySelector<HTMLInputElement>('#id-devise')!.readOnly).toBe(true);
    expect(el.querySelector('#id-devise-figee')).not.toBeNull();
  });

  it('installation sans montant : la devise se modifie', () => {
    const { el, rendre } = monter(false);
    rendre();

    expect(el.querySelector<HTMLInputElement>('#id-devise')!.readOnly).toBe(false);
    expect(el.querySelector('#id-devise-figee')).toBeNull();
  });

  // R13 : un seul nom de pays, celui de l'installation.
  it('le pays de l identite montre celui de l installation, sans se saisir', () => {
    const { el, rendre } = monter();
    rendre();

    const champ = el.querySelector<HTMLInputElement>('#id-pays')!;
    expect(champ.value).toBe('Guinée');
    expect(champ.disabled).toBe(true);
    expect(el.querySelector('#id-pays-hint')).not.toBeNull();
  });

  // R14 : la longueur du numero national fait partie du pays.
  it('la longueur du numero part avec le pays, en nombre', () => {
    const { c, envois } = monter();
    c.pays.longueurNumero = '10' as unknown as number;

    c.enregistrer('pays');

    expect(envois[0]!.pays!.longueurNumero).toBe(10);
  });
});
