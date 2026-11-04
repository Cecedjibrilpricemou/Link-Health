// Creer un agent d'officine : ce que le formulaire envoie, et ce qu'il dit
// quand l'API refuse.
//
// Le refus etait masque par un message generique (« creation impossible ») :
// impossible de savoir si le numero etait deja pris ou si la requete etait
// mal formee. C'est ainsi qu'un schema qui refusait tout est passe inapercu.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { AgentsComponent } from './agents.component';
import { ApiService } from '../../../core/services/api.service';

function monter(post: (url: string, body: unknown) => unknown) {
  const erreurs: string[] = [];
  const envois: unknown[] = [];
  const api = {
    get: () => of({ success: true, data: [] }),
    post: (url: string, body: unknown) => { envois.push(body); return post(url, body); },
  };
  TestBed.configureTestingModule({
    imports: [AgentsComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ApiService, useValue: api },
      { provide: ToastrService, useValue: { success() {}, error: (m: string) => erreurs.push(m), warning() {}, info() {} } },
    ],
  });
  TestBed.overrideComponent(AgentsComponent, { set: { template: '' } });
  const c = TestBed.createComponent(AgentsComponent).componentInstance;
  return { c, erreurs, envois };
}

describe('création d\'un agent d\'officine', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('envoie le rôle choisi', () => {
    const { c, envois } = monter(() => of({ success: true, data: { agent: {}, motDePasseTemporaire: 'x' } }));
    c.nouveau = { telephone: '620000111', email: '', prenom: 'A', nom: 'B', roleOfficine: 'CAISSIER' };
    c.creer();
    expect(envois[0]).toMatchObject({ roleOfficine: 'CAISSIER' });
  });

  it('affiche la raison donnée par l\'API quand elle refuse', () => {
    const { c, erreurs } = monter(() => throwError(() => ({
      status: 409, error: { success: false, error: 'Ce numero de telephone est deja utilise' },
    })));
    c.creer();
    expect(erreurs).toEqual(['Ce numero de telephone est deja utilise']);
  });
});
