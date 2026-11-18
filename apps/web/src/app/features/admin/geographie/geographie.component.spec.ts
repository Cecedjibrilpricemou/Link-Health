// Ecran du referentiel geographique (M1). Ce qui compte :
// - les niveaux et leurs noms viennent du pays installe, pas du code ;
// - on parcourt l'arbre niveau par niveau, et on ajoute au bon endroit ;
// - le voisinage s'edite et s'envoie par identifiants ;
// - un lieu saisi hors liste s'ajoute sous sa zone, quand elle est connue.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { ConfigurationGeoView, LieuGeoView } from '@baobaoheath/shared-types';

import { GeographieComponent } from './geographie.component';
import { ApiService } from '../../../core/services/api.service';

const GUINEE: ConfigurationGeoView = {
  code: 'GN', nom: 'Guinée', indicatifTelephone: '+224',
  niveaux: [
    { code: 'region', libelles: { fr: 'Région', en: 'Region' } },
    { code: 'prefecture', libelles: { fr: 'Préfecture', en: 'Prefecture' } },
    { code: 'commune', libelles: { fr: 'Commune', en: 'Commune' } },
  ],
  niveauBase: 'commune', niveauElargissement: 'prefecture', jeuDeDepartDisponible: true,
};

const lieu = (id: string, niveau: string, nom: string, idParent: string | null, extra: Partial<LieuGeoView> = {}): LieuGeoView =>
  ({ id, niveau, nom, idParent, parent: null, voisins: [], aValider: false, ...extra });

const REGION = lieu('r-cky', 'region', 'Conakry', null, { aValider: true });
const PREF = lieu('p-cky', 'prefecture', 'Conakry', 'r-cky', { parent: 'Conakry' });
const RATOMA = lieu('c-ratoma', 'commune', 'Ratoma', 'p-cky', { voisins: [{ id: 'c-dixinn', nom: 'Dixinn' }] });
const DIXINN = lieu('c-dixinn', 'commune', 'Dixinn', 'p-cky');
const COYAH = lieu('c-coyah', 'commune', 'Coyah-Centre', 'p-coyah', { parent: 'Coyah' });

function monter(config: ConfigurationGeoView = GUINEE, hors = [{ zone: 'Conakry', lieu: 'Kassa', patients: 3, structures: 0, livreurs: 1, total: 4 }]) {
  const appels = { get: [] as { url: string; params?: Record<string, string> }[], post: [] as { url: string; body: unknown }[], put: [] as { url: string; body: unknown }[] };
  const api = {
    get: (url: string, params?: Record<string, string>) => {
      appels.get.push({ url, params });
      if (url === '/geographie/configuration') return of({ success: true, data: config });
      if (url === '/geographie/hors-referentiel') return of({ success: true, data: hors });
      if (params?.['parent'] === 'r-cky') return of({ success: true, data: [PREF] });
      if (params?.['parent'] === 'p-cky') return of({ success: true, data: [RATOMA, DIXINN] });
      if (params?.['niveau'] === 'region') return of({ success: true, data: [REGION] });
      if (params?.['niveau'] === 'prefecture') return of({ success: true, data: [PREF] });
      if (params?.['niveau'] === 'commune') return of({ success: true, data: [RATOMA, DIXINN, COYAH] });
      return of({ success: true, data: [] });
    },
    post: (url: string, body: unknown) => {
      appels.post.push({ url, body });
      return of({ success: true, data: url.endsWith('jeu-de-depart') ? { crees: 55, dejaPresents: 0 } : lieu('nouveau', 'x', 'x', null) });
    },
    put: (url: string, body: unknown) => { appels.put.push({ url, body }); return of({ success: true, data: RATOMA }); },
  };
  TestBed.configureTestingModule({
    imports: [GeographieComponent],
    providers: [provideZonelessChangeDetection(), { provide: ApiService, useValue: api }],
  });
  const fixture = TestBed.createComponent(GeographieComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = () => { fixture.detectChanges(); return el; };
  const boutons = (texte: string) => [...el.querySelectorAll('button')].filter((b) => b.textContent?.includes(texte));
  return { c: fixture.componentInstance, el, rendre, appels, boutons };
}

describe('referentiel geographique : ecran', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('affiche le decoupage du pays installe et le niveau le plus large', () => {
    const { el } = monter();
    expect(el.querySelector('.bb-page-head__sub')!.textContent).toContain('Région › Préfecture › Commune');
    expect(el.querySelector('.geo__list-head h2')!.textContent).toContain('Région');
    expect(el.querySelector('.geo__lieux')!.textContent).toContain('Conakry');
  });

  it('suit le decoupage d un autre pays, sans rien supposer', () => {
    const { el } = monter({
      ...GUINEE, code: 'NG', nom: 'Nigeria', jeuDeDepartDisponible: false,
      niveaux: [{ code: 'state', libelles: { fr: 'État' } }, { code: 'lga', libelles: { fr: 'LGA' } }],
      niveauBase: 'lga', niveauElargissement: 'state',
    }, []);
    expect(el.querySelector('.bb-page-head__sub')!.textContent).toContain('État › LGA');
    // Pas de jeu de depart pour ce pays : pas de bouton.
    expect(el.querySelector('#geo-jeu')).toBeNull();
  });

  it('descend dans l arbre par parent, et remonte par le fil d Ariane', () => {
    const { c, el, rendre, appels } = monter();
    c.ouvrir(REGION);
    rendre();
    expect(appels.get.at(-1)!.params).toEqual({ parent: 'r-cky' });
    expect(el.querySelector('.geo__list-head h2')!.textContent).toContain('Préfecture');

    c.ouvrir(PREF);
    rendre();
    expect(el.querySelector('.geo__list-head h2')!.textContent).toContain('Commune');
    // Au niveau le plus fin, on ne descend plus.
    expect(el.querySelector('.geo__lieu-nom--lien')).toBeNull();

    el.querySelectorAll<HTMLButtonElement>('.geo__miette')[0]!.click();
    rendre();
    expect(c.chemin()).toEqual([]);
    expect(el.querySelector('.geo__list-head h2')!.textContent).toContain('Région');
  });

  it('ajoute au niveau affiche, sous le lieu ouvert', () => {
    const { c, rendre, appels } = monter();
    c.ouvrir(REGION); c.ouvrir(PREF); rendre();

    c.nouveauNom.set('  Kassa ');
    c.ajouter();

    expect(appels.post).toContainEqual({ url: '/geographie/lieux', body: { niveau: 'commune', nom: 'Kassa', idParent: 'p-cky' } });
  });

  it('au niveau le plus large, ajoute sans parent', () => {
    const { c, appels } = monter();
    c.nouveauNom.set('Boké');
    c.ajouter();
    expect(appels.post).toContainEqual({ url: '/geographie/lieux', body: { niveau: 'region', nom: 'Boké', idParent: undefined } });
  });

  it('confirme une donnee de depart', () => {
    const { el, rendre, appels, boutons } = monter();
    expect(el.querySelector('.geo__badge--a-valider')).not.toBeNull();

    boutons('Confirmer')[0]!.click();
    rendre();

    expect(appels.put).toContainEqual({ url: '/geographie/lieux/r-cky', body: { aValider: false } });
    expect(el.querySelector('.geo__badge--a-valider')).toBeNull();
  });

  it('edite le voisinage : le meme parent d abord, puis envoie les identifiants', () => {
    const { c, el, rendre, appels } = monter();
    c.ouvrir(REGION); c.ouvrir(PREF); rendre();

    c.editerVoisins(RATOMA);
    rendre();
    const puces = [...el.querySelectorAll<HTMLButtonElement>('.geo__puce')];
    // Dixinn (meme prefecture) avant Coyah-Centre, deja coche.
    expect(puces.map((p) => p.textContent!.trim().split(' ')[0])).toEqual(['Dixinn', 'Coyah-Centre']);
    expect(puces[0]!.getAttribute('aria-pressed')).toBe('true');

    puces[1]!.click();
    rendre();
    c.enregistrerVoisins();

    expect(appels.put).toContainEqual({ url: '/geographie/lieux/c-ratoma', body: { voisins: ['c-dixinn', 'c-coyah'] } });
  });

  it('charge le jeu de depart', () => {
    const { el, appels } = monter();
    el.querySelector<HTMLButtonElement>('#geo-jeu')!.click();
    expect(appels.post).toContainEqual({ url: '/geographie/jeu-de-depart', body: {} });
  });

  it('ajoute un lieu saisi hors liste sous sa zone connue', () => {
    const { el, rendre, appels } = monter();
    rendre();
    const ligne = el.querySelector('.geo__table tbody tr')!;
    expect(ligne.textContent).toContain('Kassa');

    ligne.querySelector<HTMLButtonElement>('button')!.click();

    expect(appels.post).toContainEqual({ url: '/geographie/lieux', body: { niveau: 'commune', nom: 'Kassa', idParent: 'p-cky' } });
  });

  it('une zone inconnue du referentiel renvoie vers l arbre, sans ajout direct', () => {
    const { el, rendre } = monter(GUINEE, [{ zone: 'Atlantis', lieu: 'Nulle-Part', patients: 1, structures: 0, livreurs: 0, total: 1 }]);
    rendre();
    const ligne = el.querySelector('.geo__table tbody tr')!;
    expect(ligne.querySelector('button')).toBeNull();
    expect(ligne.textContent).toContain("À ajouter depuis l'arbre");
  });
});
