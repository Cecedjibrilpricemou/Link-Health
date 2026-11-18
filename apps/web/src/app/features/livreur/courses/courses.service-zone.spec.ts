// Ecran du livreur (M4) : le bouton « en service » et ses communes desservies.
//
// Ce qui compte : un motard voit tout de suite s'il recoit des courses, ne
// peut pas envoyer d'offre hors service, et regle sa zone sans pouvoir y
// mettre sa propre commune, un doublon, ni plus de cinq communes.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import type { CourseLivreurView, LivreurZoneView } from '@baobaoheath/shared-types';

import { LivreurCoursesComponent } from './courses.component';
import { CourseService } from '../../../core/services/course.service';

const ZONE: LivreurZoneView = {
  prefecture: 'Conakry', commune: 'Ratoma', quartier: 'Kipé',
  communesDesservies: ['Dixinn'], enService: false, enServiceDepuis: null, estActif: true,
};

const COURSE = {
  id: 'course-1', numero: 'LV-2026-000001', statut: 'APPEL_OFFRES', quartier: 'Kipé', prefecture: 'Conakry',
  prixGnf: null, delaiAnnonceMinutes: null, creeeLe: '2026-11-11T09:00:00.000Z',
  attribueeLe: null, remiseLe: null, livreeLe: null, pharmacie: { id: 'ph-1', nom: 'Pharmacie Nounie' },
} as CourseLivreurView;

function monter(zone: LivreurZoneView | null = ZONE) {
  const appels = { service: [] as boolean[], communes: [] as string[][], chargements: 0 };
  const service = {
    profilLivreur: () => of({ success: true, data: zone }),
    coursesOuvertes: () => { appels.chargements++; return of({ success: true, data: [COURSE] }); },
    definirEnService: (enService: boolean) => {
      appels.service.push(enService);
      return of({ success: true, data: { ...(zone as LivreurZoneView), enService } });
    },
    definirCommunes: (communes: string[]) => {
      appels.communes.push(communes);
      return of({ success: true, data: { ...(zone as LivreurZoneView), communesDesservies: communes } });
    },
    proposer: () => of({ success: true, data: {} }),
  };
  TestBed.configureTestingModule({
    imports: [LivreurCoursesComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: CourseService, useValue: service },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(LivreurCoursesComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, appels };
}

describe('livreur : disponibilite et zone', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('affiche hors service, et passer en service appelle l API puis recharge les courses', () => {
    const { el, rendre, appels } = monter();
    const bandeau = el.querySelector('.bb-service')!;
    expect(bandeau.classList).not.toContain('bb-service--actif');

    const avant = appels.chargements;
    el.querySelector<HTMLButtonElement>('.bb-service__bouton')!.click();
    rendre();

    expect(appels.service).toEqual([true]);
    expect(el.querySelector('.bb-service')!.classList).toContain('bb-service--actif');
    expect(appels.chargements).toBe(avant + 1);
  });

  it('un compte suspendu hors service ne peut pas passer en service', () => {
    const { el } = monter({ ...ZONE, estActif: false });
    expect(el.querySelector<HTMLButtonElement>('.bb-service__bouton')!.disabled).toBe(true);
    expect(el.querySelector('.bb-service__alerte')).not.toBeNull();
  });

  it('hors service, aucune offre ne peut etre envoyee ; en service, oui', () => {
    const { c } = monter();
    c.modifier('course-1', 'prixGnf', '15000');
    c.modifier('course-1', 'delaiMinutes', '20');
    expect(c.peutEnvoyer(COURSE)).toBe(false);

    c.zone.set({ ...ZONE, enService: true });
    expect(c.peutEnvoyer(COURSE)).toBe(true);
  });

  it('sans profil connu, l API garde le dernier mot', () => {
    const { c } = monter(null);
    c.modifier('course-1', 'prixGnf', '15000');
    c.modifier('course-1', 'delaiMinutes', '20');
    expect(c.peutEnvoyer(COURSE)).toBe(true);
  });

  it('ajoute une commune, ignore sa propre commune et les doublons', () => {
    const { c } = monter();
    for (const saisie of [' Matam ', 'ratoma', 'DIXINN', 'Kaloum']) {
      c.nouvelleCommune.set(saisie);
      c.ajouterCommune();
    }
    expect(c.communes()).toEqual(['Dixinn', 'Matam', 'Kaloum']);
    expect(c.nouvelleCommune()).toBe('');
  });

  it('s arrete a cinq communes', () => {
    const { c } = monter({ ...ZONE, communesDesservies: [] });
    for (const commune of ['Dixinn', 'Matam', 'Kaloum', 'Matoto', 'Sonfonia', 'Lambanyi']) {
      c.nouvelleCommune.set(commune);
      c.ajouterCommune();
    }
    expect(c.communes()).toHaveLength(5);
    expect(c.communes()).not.toContain('Lambanyi');
  });

  it('enregistre la zone seulement si elle a change, puis recharge les courses', () => {
    const { c, appels } = monter();
    expect(c.communesModifiees()).toBe(false);
    c.enregistrerCommunes();
    expect(appels.communes).toEqual([]);

    c.retirerCommune('Dixinn');
    c.nouvelleCommune.set('Matam');
    c.ajouterCommune();
    const avant = appels.chargements;
    c.enregistrerCommunes();

    expect(appels.communes).toEqual([['Matam']]);
    expect(c.communesModifiees()).toBe(false);
    expect(appels.chargements).toBe(avant + 1);
  });
});
