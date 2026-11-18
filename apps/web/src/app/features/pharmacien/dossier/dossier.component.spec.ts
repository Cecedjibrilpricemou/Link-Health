// Le dossier réglementaire vu par le titulaire de l'officine.
//
// **Cet écran existe parce que le titulaire n'est plus un administrateur de
// structure.** Une demande d'agrément validée lui donne le rôle `PHARMACIEN`
// et le profil d'officine : il travaille dans l'espace pharmacien, où aucun
// écran ne parle de structure. Deux choses comptent donc ici :
//   - il ne demande pas les statistiques de structure, qui lui sont fermées,
//     mais la route qui ne rend que l'identifiant et le nom ;
//   - un refus du serveur — un adjoint qui force l'URL — n'affiche pas un
//     écran vide mais le bandeau qui dit pourquoi.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { PharmacienDossierComponent } from './dossier.component';
import { ApiService } from '../../../core/services/api.service';
import { AdminService } from '../../../core/services/admin.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nStub {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string) { return cle; }
}

class ToastrStub {
  success() { /* rien a observer ici */ }
  error() { /* rien a observer ici */ }
}

/** L'enfant partagé ; son propre spec couvre son comportement. */
class AdminStub {
  lus: string[] = [];
  dossierStructure(id: string) {
    this.lus.push(id);
    return of({
      success: true,
      data: {
        idStructure: id, nom: 'Pharmacie Donka', type: 'PHARMACIE',
        rccm: null, numeroAgrementCreation: null, numeroAgrementExploitation: null,
        lieuAutorise: null, exigeDesPieces: true, complet: false,
        manquantes: [], pieces: [],
      },
    });
  }
  deposerPieces() { return of({ success: true }); }
  piece() { return of(new Blob(['%PDF-'], { type: 'application/pdf' })); }
}

class ApiStub {
  appels: string[] = [];
  reponse: unknown = { success: true, data: { id: 'donka', nom: 'Pharmacie Donka' } };
  refuse = false;

  get(url: string) {
    this.appels.push(url);
    if (this.refuse) return throwError(() => ({ status: 403 }));
    return of(this.reponse);
  }
}

function monter(api: ApiStub) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PharmacienDossierComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: AdminService, useClass: AdminStub },
      { provide: ToastrService, useClass: ToastrStub },
      { provide: I18nService, useClass: I18nStub },
    ],
  });
  const fixture = TestBed.createComponent(PharmacienDossierComponent);
  fixture.detectChanges();
  return fixture;
}

describe('le dossier du titulaire', () => {
  it('demande sa structure, et non les statistiques de structure', () => {
    const api = new ApiStub();
    monter(api);

    expect(api.appels).toEqual(['/admin-structure/mon-dossier/structure']);
    expect(api.appels.some(u => u.includes('/stats'))).toBe(false);
  });

  it('ouvre le dossier de l officine rendue par le serveur', () => {
    const api = new ApiStub();
    const fixture = monter(api);

    expect(fixture.componentInstance.idStructure()).toBe('donka');
    expect(fixture.componentInstance.nomStructure()).toBe('Pharmacie Donka');
    expect(fixture.nativeElement.querySelector('app-dossier-agrement')).toBeTruthy();
  });

  // Un adjoint qui force l'URL : le serveur refuse, et l'ecran doit le dire.
  it('affiche le bandeau quand le serveur refuse', () => {
    const api = new ApiStub();
    api.refuse = true;
    const fixture = monter(api);

    expect(fixture.componentInstance.idStructure()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-dossier-agrement')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('AGREMENT.DOSSIER.SANS_STRUCTURE');
  });

  it('affiche le bandeau quand aucune structure n est rattachee', () => {
    const api = new ApiStub();
    api.reponse = { success: true };
    const fixture = monter(api);

    expect(fixture.componentInstance.idStructure()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('AGREMENT.DOSSIER.SANS_STRUCTURE');
  });

  // Tant que la reponse n'est pas la, ni dossier ni bandeau : un bandeau
  // affiche le temps du chargement ferait croire a un refus.
  it('ne dit rien avant la reponse', () => {
    const api = new ApiStub();
    api.get = function (url: string) { this.appels.push(url); return of<never>(); };
    const fixture = monter(api);

    expect(fixture.componentInstance.chargement()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('AGREMENT.DOSSIER.SANS_STRUCTURE');
  });
});
