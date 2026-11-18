// R1 : apres le delai final sans aucune offre, la course passe « sans motard ».
// Rien n'est decide pour le patient : il relance la recherche, ou va chercher
// sa commande a la pharmacie.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { CommandeView } from '@baobaoheath/shared-types';

import { PatientCommandesComponent } from './commandes.component';
import { PatientService } from '../../../core/services/patient.service';
import { CourseService } from '../../../core/services/course.service';

function commande(etat: Partial<CommandeView> = {}): CommandeView {
  return {
    id: 'cmd-1', statut: 'PRETE_POUR_LIVRAISON', modeRemise: 'LIVRAISON',
    idCourse: 'course-1', statutCourse: 'SANS_MOTARD',
    creeLe: '2026-11-12T08:00:00.000Z', numeroOrdonnance: 'OR-2026-000001',
    pharmacie: { id: 'ph-1', nom: 'Pharmacie Nounie', quartier: 'Kipe' },
    lignes: [], reponses: [],
    ...etat,
  } as CommandeView;
}

function monter(commandes: CommandeView[]) {
  const appels = { relancer: [] as string[], chargements: 0 };
  TestBed.configureTestingModule({
    imports: [PatientCommandesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: PatientService,
        useValue: { mesCommandes: () => { appels.chargements++; return of({ success: true, data: commandes }); } },
      },
      {
        provide: CourseService,
        useValue: {
          offresCommande: () => of({ success: true, data: [] }),
          relancer: (id: string) => { appels.relancer.push(id); return of({ success: true, data: {} }); },
        },
      },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(PatientCommandesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, appels };
}

const section = (el: HTMLElement) => el.querySelector('section[aria-label="Aucun livreur disponible"]');

describe('patient : course sans livreur apres le delai final', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('propose de relancer ou d aller chercher, sans choisir a sa place', () => {
    const { el } = monter([commande()]);
    const boutons = section(el)!.querySelectorAll('button');
    expect(boutons.length).toBe(2);
  });

  it('relancer rouvre la course et recharge la liste', () => {
    const { el, appels } = monter([commande()]);
    (section(el)!.querySelectorAll('button')[0] as HTMLButtonElement).click();
    expect(appels.relancer).toEqual(['course-1']);
    expect(appels.chargements).toBe(2);
  });

  it('aller chercher passe par la confirmation avec motif, comme avant', () => {
    const { c, el, appels } = monter([commande()]);
    (section(el)!.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(c.renonceLivraison()?.id).toBe('cmd-1');
    expect(appels.relancer).toEqual([]);
  });

  it('n apparait pas tant que l appel est ouvert', () => {
    const { el } = monter([commande({ statutCourse: 'APPEL_OFFRES' })]);
    expect(section(el)).toBeNull();
  });

  it('n apparait plus une fois la commande repassee au retrait', () => {
    const { el } = monter([commande({ statut: 'PRETE_POUR_RETRAIT', modeRemise: 'RETRAIT_PHARMACIE' })]);
    expect(section(el)).toBeNull();
  });
});
