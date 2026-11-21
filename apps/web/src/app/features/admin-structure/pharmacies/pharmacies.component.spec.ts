// Les pharmacies de l'hopital, vues par son administrateur.
//
// Ce que ce fichier tient :
//   - le formulaire envoie une **demande**, jamais une creation, et sans mot
//     de passe ; l'adresse du titulaire est exigee ;
//   - le numero de la demande est annonce, et la liste des demandes rechargee ;
//   - chaque demande montre son etat et le dernier motif de l'administration ;
//   - aucun mot de passe ne s'affiche plus sur cet ecran.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import type { DemandePharmacieView } from '@baobaoheath/shared-types';

import { PharmaciesComponent } from './pharmacies.component';
import { AdminService } from '../../../core/services/admin.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string { return p ? `${cle} ${JSON.stringify(p)}` : cle; }
}

const demande = (o: Partial<DemandePharmacieView> = {}): DemandePharmacieView => ({
  id: 'd1', numero: 'DA-2026-0007', statut: 'RECUE', nom: 'Pharmacie du CHU', titulaire: 'Aminata Diallo',
  dernierMotif: null, deposeLe: '2026-11-21T09:00:00.000Z', examineLe: null, ...o,
});

function monter(demandes: DemandePharmacieView[] = [], echec = false) {
  const admin = {
    getPharmaciesHospitalieres: vi.fn(() => of({ success: true, data: [] })),
    getDemandesPharmacie: vi.fn(() => of({ success: true, data: demandes })),
    demanderPharmacieHospitaliere: vi.fn(() => echec
      ? throwError(() => ({ error: { error: 'Ce numéro de téléphone du pharmacien est déjà utilisé par un compte.' } }))
      : of({ success: true, data: { numero: 'DA-2026-0008', statut: 'RECUE', deposeLe: '2026-11-21T10:00:00.000Z' } })),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PharmaciesComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      { provide: AdminService, useValue: admin },
      { provide: I18nService, useClass: I18nMaquette },
      {
        provide: GeographieService,
        useValue: {
          libelle: () => 'Préfecture',
          configuration: () => null,
          chargerConfiguration: () => of(null),
          nomsSuggeres: () => of([]),
        },
      },
    ],
  });
  return admin;
}

function remplir(c: PharmaciesComponent, email = 'a.diallo@example.gn') {
  c.form = {
    nom: ' Pharmacie du CHU ', prefecture: 'Conakry', adresse: '', telephone: '',
    prenom: 'Aminata', nomPharmacien: 'Diallo', telephonePharmacien: '620000201', email,
  };
}

describe('les pharmacies de l hopital', () => {
  it('envoie une demande, sans mot de passe, et annonce son numero', () => {
    const admin = monter();
    const fixture = TestBed.createComponent(PharmaciesComponent);
    const c = fixture.componentInstance;
    c.ngOnInit();
    remplir(c);
    c.create();

    expect(admin.demanderPharmacieHospitaliere).toHaveBeenCalledWith({
      nom: 'Pharmacie du CHU',
      prefecture: 'Conakry',
      pharmacien: { prenom: 'Aminata', nom: 'Diallo', telephone: '620000201', email: 'a.diallo@example.gn' },
    });
    expect(JSON.stringify(admin.demanderPharmacieHospitaliere.mock.calls[0])).not.toMatch(/motDePasse/i);
    expect(c.envoyee()).toBe('DA-2026-0008');
    // La liste des demandes est relue : la nouvelle y apparait.
    expect(admin.getDemandesPharmacie).toHaveBeenCalledTimes(2);
  });

  it('sans adresse du titulaire, rien ne part', () => {
    const admin = monter();
    const c = TestBed.createComponent(PharmaciesComponent).componentInstance;
    remplir(c, '  ');
    c.create();
    expect(admin.demanderPharmacieHospitaliere).not.toHaveBeenCalled();
    expect(c.error()).toBe('ADMIN_STRUCTURE.PHARMACIES.REQUIRED_ERROR');
  });

  it('un refus du serveur est dit tel quel', () => {
    monter([], true);
    const c = TestBed.createComponent(PharmaciesComponent).componentInstance;
    remplir(c);
    c.create();
    expect(c.error()).toContain('déjà utilisé');
    expect(c.envoyee()).toBeNull();
  });

  it('chaque demande montre son etat et le dernier motif', () => {
    monter([
      demande({ statut: 'EN_ANALYSE', dernierMotif: 'Diplôme du titulaire à confirmer.' }),
      demande({ id: 'd2', numero: 'DA-2026-0005', statut: 'REFUSEE' }),
    ]);
    const fixture = TestBed.createComponent(PharmaciesComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const cartes = el.querySelectorAll<HTMLElement>('.bb-pharma__demande');
    expect(cartes).toHaveLength(2);
    expect(cartes[0]!.querySelector('.bb-pharma__statut')!.classList).toContain('bb-badge--warning');
    expect(cartes[0]!.textContent).toContain('ADMIN.AGREMENT_REQUESTS.STATE_EN_ANALYSE');
    expect(cartes[0]!.querySelector('.bb-pharma__motif')!.textContent).toContain('Diplôme du titulaire à confirmer.');
    expect(cartes[1]!.querySelector('.bb-pharma__statut')!.classList).toContain('bb-badge--danger');
    expect(cartes[1]!.querySelector('.bb-pharma__motif')).toBeNull();
  });

  it('aucun mot de passe ne s affiche apres l envoi', () => {
    monter();
    const fixture = TestBed.createComponent(PharmaciesComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    remplir(c);
    c.create();
    fixture.detectChanges();
    const texte = (fixture.nativeElement as HTMLElement).textContent!;
    expect(texte).toContain('ADMIN_STRUCTURE.PHARMACIES.SENT');
    expect(texte).not.toMatch(/PASSWORD|mot de passe/i);
  });
});
