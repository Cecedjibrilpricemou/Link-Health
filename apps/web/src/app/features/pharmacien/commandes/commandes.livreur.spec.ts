// Le motard au comptoir : la pharmacie voit sa photo, son nom et son numero
// avant de scanner son QR, pour reconnaitre la personne que le patient a
// choisie.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { CommandeView, LivreurAttribueView } from '@baobaoheath/shared-types';

import { PharmacienCommandesComponent } from './commandes.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { CourseService } from '../../../core/services/course.service';

const MOTARD: LivreurAttribueView = {
  prenom: 'Ibrahima', nom: 'Keïta', telephone: '620100016', photoUrl: '/uploads/avatars/motard.jpg',
};

function commande(etat: Partial<CommandeView> = {}): CommandeView {
  return {
    id: 'cmd-1', statut: 'PRETE_POUR_LIVRAISON', modeRemise: 'LIVRAISON',
    idCourse: 'course-1', statutCourse: 'ATTRIBUEE',
    creeLe: '2026-11-06T08:00:00.000Z', numeroOrdonnance: 'OR-2026-000001',
    patient: { id: 'p-1', prenom: 'Fanta', nom: 'Camara' },
    lignes: [], reponses: [], estLaMienne: true,
    ...etat,
  } as CommandeView;
}

function monter(commandes: CommandeView[]) {
  TestBed.configureTestingModule({
    imports: [PharmacienCommandesComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PharmacienService, useValue: { commandesDeLaPharmacie: () => of({ success: true, data: commandes }) } },
      { provide: CourseService, useValue: {} },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(PharmacienCommandesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('pharmacie : le motard attendu au comptoir', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('montre la photo, le nom et le numero du motard choisi', () => {
    const { el } = monter([commande({ livreur: MOTARD })]);
    const carte = el.querySelector('.bb-cmd__livreur')!;
    expect(carte).not.toBeNull();
    expect(carte.querySelector('img')?.getAttribute('src')).toContain('/uploads/avatars/motard.jpg');
    expect(carte.textContent).toContain('Ibrahima Keïta');
    expect(carte.querySelector('a')?.getAttribute('href')).toBe('tel:620100016');
  });

  it('montre les initiales et demande de verifier nom et numero quand il n a pas de photo', () => {
    const { el } = monter([commande({ livreur: { ...MOTARD, photoUrl: null } })]);
    const carte = el.querySelector('.bb-cmd__livreur')!;
    expect(carte.querySelector('img')).toBeNull();
    expect(carte.textContent).toContain('IK');
    expect(carte.querySelector('.bb-cmd__livreur-aide')?.textContent?.trim()).toBeTruthy();
  });

  it('ne montre rien tant qu aucun motard n est choisi', () => {
    const { el } = monter([commande({ statutCourse: 'APPEL_OFFRES' })]);
    expect(el.querySelector('.bb-cmd__livreur')).toBeNull();
  });

  it('garde le motard visible apres la remise, sans la consigne de verification', () => {
    const { el } = monter([commande({ statut: 'RETIREE', statutCourse: 'EN_COURS', livreur: MOTARD })]);
    const carte = el.querySelector('.bb-cmd__livreur')!;
    expect(carte.textContent).toContain('Ibrahima Keïta');
    expect(carte.querySelector('.bb-cmd__livreur-aide')).toBeNull();
  });
});
