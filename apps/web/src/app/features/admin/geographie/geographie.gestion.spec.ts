// R7 : renommer et supprimer un lieu depuis l'ecran du referentiel. Ce qui
// compte : l'admin voit d'abord ce qui porte le nom ; renommer envoie le nom
// nettoye ; supprimer n'est possible qu'a un lieu que plus rien n'utilise, et
// tant que le compte n'est pas arrive, non plus.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject, of } from 'rxjs';
import type { ConfigurationGeoView, LieuGeoView, UtilisationLieuGeoView } from '@baobaoheath/shared-types';

import { GeographieComponent } from './geographie.component';
import { ApiService } from '../../../core/services/api.service';

const GUINEE: ConfigurationGeoView = {
  code: 'GN', nom: 'Guinée', indicatifTelephone: '+224',
  niveaux: [
    { code: 'region', libelles: { fr: 'Région' } },
    { code: 'prefecture', libelles: { fr: 'Préfecture' } },
    { code: 'commune', libelles: { fr: 'Commune' } },
  ],
  niveauBase: 'commune', niveauElargissement: 'prefecture', jeuDeDepartDisponible: false,
};
const RATOMAH: LieuGeoView = { id: 'c-ratomah', niveau: 'commune', nom: 'Ratomah', idParent: 'p-cky', parent: 'Conakry', voisins: [], aValider: false };
const LIBRE: UtilisationLieuGeoView = { enfants: 0, structures: 0, patients: 0, motards: 0, appelsEnCours: 0 };

function monter(utilisation: UtilisationLieuGeoView | Subject<unknown> = LIBRE) {
  const appels = { post: [] as { url: string; body: unknown }[], delete: [] as string[], get: [] as string[] };
  const api = {
    get: (url: string) => {
      appels.get.push(url);
      if (url === '/geographie/configuration') return of({ success: true, data: GUINEE });
      if (url.endsWith('/utilisation')) return utilisation instanceof Subject ? utilisation : of({ success: true, data: utilisation });
      return of({ success: true, data: [] });
    },
    post: (url: string, body: unknown) => {
      appels.post.push({ url, body });
      return of({ success: true, data: { lieu: { ...RATOMAH, nom: 'Ratoma' }, renommes: { structures: 3, patients: 40, motards: 2, appelsEnCours: 1 } } });
    },
    put: () => of({ success: true }),
    delete: (url: string) => { appels.delete.push(url); return of({ success: true }); },
  };
  TestBed.configureTestingModule({
    imports: [GeographieComponent],
    providers: [provideZonelessChangeDetection(), { provide: ApiService, useValue: api }],
  });
  const fixture = TestBed.createComponent(GeographieComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  return { c: fixture.componentInstance, el, rendre, appels };
}

describe('referentiel geographique : renommer et supprimer', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('montre ce qui porte le nom avant tout', () => {
    const { c, el, rendre, appels } = monter({ ...LIBRE, structures: 3, patients: 40 });
    c.ouvrirGestion(RATOMAH, 'renommer');
    rendre();

    expect(appels.get).toContain('/geographie/lieux/c-ratomah/utilisation');
    expect(el.querySelector('#geo-utilisation')).not.toBeNull();
    expect(c.gestion()!.utilisation).toEqual({ ...LIBRE, structures: 3, patients: 40 });
  });

  it('renomme avec le nom nettoye, puis ferme le panneau', () => {
    const { c, appels } = monter();
    c.ouvrirGestion(RATOMAH, 'renommer');
    c.saisirNom('  Ratoma  ');

    c.confirmerRenommage();

    expect(appels.post).toEqual([{ url: '/geographie/lieux/c-ratomah/renommer', body: { nom: 'Ratoma' } }]);
    expect(c.gestion()).toBeNull();
    expect(c.succes()).not.toBe('');
  });

  it('un nom vide ou inchange ne part pas', () => {
    const { c, appels } = monter();
    c.ouvrirGestion(RATOMAH, 'renommer');
    c.saisirNom('   ');
    expect(c.peutRenommer()).toBe(false);
    c.confirmerRenommage();
    c.saisirNom('Ratomah');
    expect(c.peutRenommer()).toBe(false);
    c.confirmerRenommage();
    expect(appels.post).toHaveLength(0);
  });

  it('supprime un lieu inutilise', () => {
    const { c, appels } = monter();
    c.ouvrirGestion(RATOMAH, 'supprimer');
    expect(c.peutSupprimer()).toBe(true);

    c.confirmerSuppression();

    expect(appels.delete).toEqual(['/geographie/lieux/c-ratomah']);
    expect(c.gestion()).toBeNull();
  });

  it.each<[string, Partial<UtilisationLieuGeoView>]>([
    ['des lieux rattaches', { enfants: 1 }],
    ['une structure', { structures: 1 }],
    ['un patient', { patients: 1 }],
    ['un motard', { motards: 1 }],
    ['un appel en cours', { appelsEnCours: 1 }],
  ])('refuse de supprimer un lieu qui porte encore %s, et le dit', (_quoi, u) => {
    const { c, el, rendre, appels } = monter({ ...LIBRE, ...u });
    c.ouvrirGestion(RATOMAH, 'supprimer');
    rendre();

    expect(c.peutSupprimer()).toBe(false);
    expect(el.querySelector('#geo-suppression-bloquee')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('#geo-supprimer')!.disabled).toBe(true);
    c.confirmerSuppression();
    expect(appels.delete).toHaveLength(0);
  });

  it('tant que le compte n est pas arrive, la suppression reste fermee', () => {
    const { c, appels } = monter(new Subject());
    c.ouvrirGestion(RATOMAH, 'supprimer');

    expect(c.peutSupprimer()).toBe(false);
    c.confirmerSuppression();
    expect(appels.delete).toHaveLength(0);
  });

  it('ouvrir le voisinage ferme le panneau de gestion', () => {
    const { c } = monter();
    c.ouvrirGestion(RATOMAH, 'renommer');
    c.editerVoisins(RATOMAH);
    expect(c.gestion()).toBeNull();
  });
});
