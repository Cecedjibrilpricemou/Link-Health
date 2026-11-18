// R15 : le patient demande la correction de son identite. Ce qui compte :
// seuls les traits qui changent partent, une raison est exigee, une seule
// demande attend a la fois, et la reponse d'un refus lui est montree.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { DemandeCorrectionIdentiteView, DemanderCorrectionIdentiteDto } from '@baobaoheath/shared-types';

import { DemandeCorrectionComponent, IdentiteActuelle } from './demande-correction.component';
import { PatientService } from '../../../../core/services/patient.service';

const ACTUELLE: IdentiteActuelle = { prenom: 'Mariama', nom: 'Bah', sexe: 'F', dateNaissance: '2002-03-15' };
const RAISON = "Mon prenom est mal ecrit depuis l'inscription";
const BASE: DemandeCorrectionIdentiteView = {
  id: 'd1', statut: 'EN_ATTENTE', demande: { prenom: 'Mariame' }, justification: RAISON,
  reponse: null, creeLe: '2026-11-12T10:00:00.000Z', traiteeLe: null, traitePar: null,
};

function monter(existantes: DemandeCorrectionIdentiteView[] = []) {
  const envois: DemanderCorrectionIdentiteDto[] = [];
  TestBed.configureTestingModule({
    imports: [DemandeCorrectionComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: PatientService,
        useValue: {
          mesDemandesCorrection: () => of({ success: true, data: existantes }),
          demanderCorrection: (dto: DemanderCorrectionIdentiteDto) => {
            envois.push(dto);
            return of({ success: true, data: { ...BASE, id: 'd2', demande: { prenom: dto.prenom } } });
          },
        },
      },
      { provide: ToastrService, useValue: { success() {}, error() {} } },
    ],
  });
  const fixture = TestBed.createComponent(DemandeCorrectionComponent);
  fixture.componentRef.setInput('actuelle', ACTUELLE);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, envois };
}

describe('demande de correction d identite (patient)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('pre-remplit le formulaire avec l identite actuelle', () => {
    const { c } = monter();
    c.ouvrir();
    expect(c.form).toEqual({ ...ACTUELLE, justification: '' });
  });

  it('n envoie que les traits modifies, et la raison', () => {
    const { c, envois } = monter();
    c.ouvrir();
    c.form.prenom = ' Mariame ';
    c.form.justification = `  ${RAISON}  `;

    c.envoyer();

    expect(envois).toEqual([{ prenom: 'Mariame', justification: RAISON }]);
    expect(c.ouvert()).toBe(false);
    expect(c.derniere()?.id).toBe('d2');
  });

  it('garde le sexe et la date quand ils changent', () => {
    const { c } = monter();
    c.ouvrir();
    c.form.sexe = 'M';
    c.form.dateNaissance = '2002-03-16';
    expect(c.changements()).toEqual({ sexe: 'M', dateNaissance: '2002-03-16' });
  });

  it('sans changement, rien a envoyer', () => {
    const { c, envois } = monter();
    c.ouvrir();
    c.form.justification = RAISON;
    expect(c.peutEnvoyer()).toBe(false);
    c.envoyer();
    expect(envois).toHaveLength(0);
  });

  it('sans raison, rien a envoyer', () => {
    const { c, envois } = monter();
    c.ouvrir();
    c.form.prenom = 'Mariame';
    c.form.justification = '  court  ';
    expect(c.peutEnvoyer()).toBe(false);
    c.envoyer();
    expect(envois).toHaveLength(0);
  });

  it('une demande en attente : son statut est montre et aucune autre ne s ouvre', () => {
    const { c, el } = monter([BASE]);
    expect(el.querySelector('#correction-statut')).not.toBeNull();
    expect(el.querySelector('#correction-ouvrir')).toBeNull();

    c.ouvrir();
    c.form.nom = 'Diallo';
    c.form.justification = RAISON;
    expect(c.peutEnvoyer()).toBe(false);
  });

  it('un refus montre la reponse de l accueil, et permet une nouvelle demande', () => {
    const { el } = monter([{ ...BASE, statut: 'REFUSEE', reponse: 'Venez avec votre piece' }]);
    expect(el.querySelector('#correction-reponse')!.textContent).toContain('Venez avec votre piece');
    expect(el.querySelector('#correction-ouvrir')).not.toBeNull();
  });
});
