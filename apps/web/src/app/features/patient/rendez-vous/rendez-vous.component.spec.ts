// Demande de rendez-vous : l'etablissement du dossier est propose d'office.
//
// Le champ affichait « — Établissement de mon dossier — » sans dire lequel :
// le patient ne savait pas ou partirait sa demande. Il voit maintenant son
// etablissement, deja choisi, et peut en prendre un autre. Sans
// etablissement au dossier, il doit en choisir un avant d'envoyer.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { RendezVousComponent } from './rendez-vous.component';
import { PatientService } from '../../../core/services/patient.service';
import { AdminService } from '../../../core/services/admin.service';

const ETABLISSEMENTS = [
  { id: 'cs1', nom: 'Centre de santé de Matoto', prefecture: 'Conakry', type: 'CENTRE' },
  { id: 'chu', nom: 'Hôpital Donka', prefecture: 'Conakry', type: 'CHU' },
  { id: 'mam', nom: 'Hôpital régional de Mamou', prefecture: 'Mamou', type: 'HOPITAL_REG' },
];

function monter(idStructurePreferee: string | null) {
  const envois: { idStructure?: string; motif: string }[] = [];
  const patient = {
    mesDemandesRendezVous: () => of({ success: true, data: [] }),
    getMe: () => of({ success: true, data: { idStructurePreferee } }),
    creerDemandeRendezVous: (dto: { idStructure?: string; motif: string }) => { envois.push(dto); return of({ success: true, data: {} }); },
  };
  TestBed.configureTestingModule({
    imports: [RendezVousComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PatientService, useValue: patient },
      { provide: AdminService, useValue: { getPublicStructures: () => of({ success: true, data: ETABLISSEMENTS }) } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(RendezVousComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  const ouvrir = async () => {
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Demander'))!.click();
    await rendre();
  };
  const champ = () => el.querySelector<HTMLInputElement>('#rdv-structure')!;
  const saisirMotif = async (texte: string) => {
    const t = el.querySelector<HTMLTextAreaElement>('#rdv-motif')!;
    t.value = texte;
    t.dispatchEvent(new Event('input'));
    await rendre();
  };
  const boutonEnvoyer = () => [...el.querySelectorAll<HTMLButtonElement>('.bb-rdvp__actions button')].at(-1)!;
  return { el, rendre, ouvrir, champ, saisirMotif, boutonEnvoyer, envois, c: fixture.componentInstance };
}

describe('demande de rendez-vous : établissement par défaut', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('montre l’établissement du dossier, déjà choisi', async () => {
    const { ouvrir, champ, el, rendre } = monter('chu');
    await ouvrir();
    await rendre();
    expect(champ().value).toBe('Hôpital Donka');
    expect(el.querySelector('#rdv-structure-aide')!.textContent).toContain('Hôpital Donka');
  });

  it('le met en tête de liste avec la mention « Mon établissement »', async () => {
    const { ouvrir, champ, el, rendre } = monter('chu');
    await ouvrir();
    await rendre();
    champ().click();
    await rendre();
    const premiere = el.querySelector('#rdv-structure-liste [role="option"]')!;
    expect(premiere.textContent).toContain('Hôpital Donka');
    expect(premiere.textContent).toContain('Mon établissement');
  });

  it('sans rien changer, la demande part dans cet établissement', async () => {
    const { ouvrir, saisirMotif, boutonEnvoyer, envois, rendre } = monter('chu');
    await ouvrir();
    await rendre();
    await saisirMotif('Fièvre depuis trois jours');
    boutonEnvoyer().click();
    expect(envois).toEqual([{ motif: 'Fièvre depuis trois jours', idStructure: 'chu' }]);
  });

  it('sans établissement au dossier : il faut en choisir un avant d’envoyer', async () => {
    const { ouvrir, champ, saisirMotif, boutonEnvoyer, el, rendre } = monter(null);
    await ouvrir();
    await rendre();
    await saisirMotif('Fièvre depuis trois jours');
    expect(champ().value).toBe('');
    expect(el.querySelector('#rdv-structure-aide')!.textContent).toMatch(/choisissez/i);
    expect(boutonEnvoyer().disabled).toBe(true);
  });

  it('même appelé directement, l’envoi refuse une demande sans établissement', async () => {
    const { ouvrir, saisirMotif, envois, c, rendre } = monter(null);
    await ouvrir();
    await rendre();
    await saisirMotif('Fièvre depuis trois jours');
    c.envoyer();
    expect(envois).toEqual([]);
  });

  it('un établissement du dossier fermé n’est pas proposé d’office', async () => {
    const { ouvrir, champ, boutonEnvoyer, saisirMotif, rendre } = monter('ferme');
    await ouvrir();
    await rendre();
    await saisirMotif('Fièvre depuis trois jours');
    expect(champ().value).toBe('');
    expect(boutonEnvoyer().disabled).toBe(true);
  });
});
