// La modale de creation d'une structure dit ce que le serveur a fait.
//
// **Elle annoncait « identifiants envoyes par email » des qu'une adresse
// etait saisie**, meme quand aucun expediteur n'etait configure et que rien
// n'etait parti. L'administrateur fermait la modale en croyant le
// responsable servi : le mot de passe temporaire, affiche une seule fois,
// etait perdu, et personne ne pouvait plus entrer dans le compte.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

// La boite de dialogue de position charge Leaflet a l'import.
vi.mock('leaflet', () => ({
  map: vi.fn(() => ({ setView: vi.fn(), on: vi.fn(), remove: vi.fn() })),
  tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
  marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis() })),
  divIcon: vi.fn(() => ({})),
}));

function monter(emailEnvoye: boolean) {
  const reponse = of({
    success: true,
    data: {
      structure: { id: 's1', nom: 'Centre de Ratoma' },
      admin: { prenom: 'Awa', nom: 'Bah', telephone: '622000001', email: 'awa@example.gn' },
      motDePasseTemporaire: 'Kq7m-Xw3P-abcd-EFGH',
      emailEnvoye,
    },
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [StructuresComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: AdminService,
        useValue: { getStructures: () => of({ success: true, data: [] }), createStructure: () => reponse },
      },
      // Aucune piece attendue : on ne juge ici que la modale.
      { provide: DemandeAgrementService, useValue: { piecesAttendues: () => of({ success: true, data: [] }) } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(StructuresComponent);
  fixture.detectChanges();
  const c = fixture.componentInstance;
  c.newStructure = {
    nom: 'Centre de Ratoma', type: 'CENTRE', prefecture: 'Conakry', commune: 'Ratoma', quartier: '',
    adresse: '', latitude: null, longitude: null, telephone: '',
    rccm: '', numeroAgrementCreation: '', numeroAgrementExploitation: '', lieuAutorise: '',
    admin: { prenom: 'Awa', nom: 'Bah', telephone: '622000001', email: 'awa@example.gn' },
  };
  c.creerStructure();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('structures : la modale dit si le courriel est parti', () => {
  it('annonce l envoi quand le courriel est parti', () => {
    const el = monter(true);
    expect(el.querySelector('.bb-mdp-modal__email-note')?.textContent).toContain('awa@example.gn');
    expect(el.querySelector('.bb-mdp-modal__email-echec')).toBeNull();
  });

  it('dit que le courriel n est pas parti, et garde le mot de passe a l ecran', () => {
    const el = monter(false);
    expect(el.querySelector('.bb-mdp-modal__email-note')).toBeNull();
    expect(el.querySelector('.bb-mdp-modal__email-echec')?.textContent).toContain('awa@example.gn');
    expect(el.querySelector('.bb-mdp-modal__mdp')?.textContent).toBe('Kq7m-Xw3P-abcd-EFGH');
  });

  it.each([['fr', fr], ['en', en]] as const)('%s porte le message d echec', (_langue, catalogue) => {
    expect((catalogue as Record<string, any>)['ADMIN']['STRUCTURES']['EMAIL_NON_ENVOYE']).toContain('{{email}}');
  });
});
