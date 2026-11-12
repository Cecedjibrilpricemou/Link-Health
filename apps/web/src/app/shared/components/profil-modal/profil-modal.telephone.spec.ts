// Le numero de telephone ne se change plus dans le formulaire du profil : il
// faut le mot de passe actuel, puis le code envoye au nouveau numero.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { ProfilModalComponent } from './profil-modal.component';
import { AuthService } from '../../../core/services/auth.service';

function monter() {
  const appels = { profil: [] as unknown[], demande: [] as unknown[][], confirmation: [] as string[] };
  const auth = {
    currentUser: signal({ id: 'u1', prenom: 'Awa', nom: 'Diallo', telephone: '620100010', email: '', role: 'PATIENT' }),
    updateProfil: (dto: unknown) => { appels.profil.push(dto); return of({}); },
    demanderChangementTelephone: (tel: string, mdp: string) => {
      appels.demande.push([tel, mdp]);
      return of({ telephoneMasque: '•••••••99', expireDansMinutes: 10 });
    },
    confirmerChangementTelephone: (code: string) => { appels.confirmation.push(code); return of({}); },
  };
  TestBed.configureTestingModule({
    imports: [ProfilModalComponent],
    providers: [provideZonelessChangeDetection(), { provide: AuthService, useValue: auth }],
  });
  TestBed.overrideComponent(ProfilModalComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(ProfilModalComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, appels, auth };
}

describe('profil : changement de numero', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('le formulaire du profil n envoie plus le numero', () => {
    const { c, appels } = monter();
    c.saveProfil();
    expect(appels.profil[0]).toEqual({ prenom: 'Awa', nom: 'Diallo', email: '' });
  });

  it('exige un numero et le mot de passe avant de demander un code', () => {
    const { c } = monter();
    c.ouvrirChangementTel();
    c.nouveauTel.set('620999999');
    expect(c.peutDemanderCodeTel()).toBe(false);
    c.motDePasseTel.set('secret');
    expect(c.peutDemanderCodeTel()).toBe(true);
  });

  it('demande le code, oublie le mot de passe, puis confirme avec six chiffres', () => {
    const { c, appels } = monter();
    c.ouvrirChangementTel();
    c.nouveauTel.set(' 620999999 ');
    c.motDePasseTel.set('secret');

    c.demanderCodeTel();

    expect(appels.demande).toEqual([['620999999', 'secret']]);
    expect(c.motDePasseTel()).toBe('');
    expect(c.etapeTel()).toBe('code');

    c.codeTel.set('12345');
    expect(c.peutConfirmerTel()).toBe(false);
    c.codeTel.set('123456');
    c.confirmerCodeTel();
    expect(appels.confirmation).toEqual(['123456']);
    expect(c.etapeTel()).toBe('ferme');
  });

  it('montre l erreur du serveur et reste a l etape', () => {
    const { c, auth } = monter();
    auth.demanderChangementTelephone = () => throwError(() => ({ error: { error: 'Mot de passe incorrect' } }));
    c.ouvrirChangementTel();
    c.nouveauTel.set('620999999');
    c.motDePasseTel.set('faux');

    c.demanderCodeTel();

    expect(c.errorMsg()).toBe('Mot de passe incorrect');
    expect(c.etapeTel()).toBe('saisie');
  });
});
