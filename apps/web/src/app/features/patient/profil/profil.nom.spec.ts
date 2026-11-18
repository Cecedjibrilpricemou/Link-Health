// R15 : une fois l'identite verifiee sur piece, le patient voit son nom mais
// ne le change plus ici. Et vider un champ est une reponse : le groupe
// sanguin ou les allergies partent meme vides.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { of } from 'rxjs';

import { ProfilComponent } from './profil.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { PatientService } from '../../../core/services/patient.service';
import type { Patient } from '../../../core/models/patient.model';

function monter(profil: Partial<Patient>) {
  const envois: unknown[] = [];
  TestBed.configureTestingModule({
    imports: [ProfilComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ApiService, useValue: { get: () => of({ success: true, data: [] }) } },
      { provide: AuthService, useValue: { currentUser: signal(null) } },
      {
        provide: PatientService,
        useValue: {
          getMe: () => of({ success: true, data: { id: 'p1', ...profil } }),
          updateMe: (payload: unknown) => { envois.push(payload); return of({ success: true, data: {} }); },
        },
      },
    ],
  });
  TestBed.overrideComponent(ProfilComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(ProfilComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, envois };
}

const UTILISATEUR = { prenom: 'Awa', nom: 'Diallo', telephone: '620000001' };

describe('profil patient : nom et champs vidables', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('verrouille le nom d une identite verifiee et ne l envoie pas', () => {
    const { c, envois } = monter({ niveauIdentite: 'VERIFIEE', utilisateur: UTILISATEUR, groupeSanguin: 'O+' });
    expect(c.nomVerrouille()).toBe(true);
    c.enableEdit();
    c.formData.nom = 'Camara';

    c.saveProfil();

    expect(envois[0]).not.toHaveProperty('nom');
    expect(envois[0]).not.toHaveProperty('prenom');
  });

  it('laisse un patient provisoire changer son nom, pre-rempli depuis son compte', () => {
    const { c, envois } = monter({ niveauIdentite: 'PROVISOIRE', utilisateur: UTILISATEUR });
    expect(c.nomVerrouille()).toBe(false);
    c.enableEdit();
    expect(c.formData.prenom).toBe('Awa');
    c.formData.nom = 'Camara';

    c.saveProfil();

    expect(envois[0]).toMatchObject({ prenom: 'Awa', nom: 'Camara' });
  });

  it('envoie le groupe sanguin et les listes meme vides', () => {
    const { c, envois } = monter({ niveauIdentite: 'PROVISOIRE', utilisateur: UTILISATEUR, groupeSanguin: 'O+', allergies: ['Arachide'] });
    c.enableEdit();
    c.formData.groupeSanguin = '';
    c.formData.allergies = [];

    c.saveProfil();

    expect(envois[0]).toMatchObject({ groupeSanguin: '', allergies: [], maladiesChroniques: [] });
  });
});
