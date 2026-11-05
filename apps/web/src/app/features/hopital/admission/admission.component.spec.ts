// Admission a l'hopital : recherche du patient, ouverture d'un episode de
// soins, creation du dossier au comptoir. Couvert jusqu'ici par les seuls
// parcours Playwright.
//
// Ce qui est verifie : pas d'episode sans motif ni en double, pas de dossier
// incomplet (il ne serait plus retrouvable), un mot de passe montre une
// seule fois, et une recherche qui ne part pas a chaque lettre.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { AdmissionComponent } from './admission.component';
import { HopitalService } from '../../../core/services/hopital.service';

const PATIENT = { id: 'p1', prenom: 'Mamadou', nom: 'Bah', telephone: '620000001', dateNaissance: '1985-04-02' };
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function monter() {
  const appels = { recherche: [] as string[], episode: [] as unknown[], dossier: [] as unknown[], navigation: [] as unknown[] };
  let reponseEpisode: Subject<unknown> | null = null;
  const hopital = {
    listerMedecins: () => of({ success: true, data: [{ id: 'm1', prenom: 'Fanta', nom: 'Camara', specialite: 'Pédiatrie' }] }),
    rechercherPatients: (q: string) => { appels.recherche.push(q); return of({ success: true, data: [PATIENT] }); },
    creerEpisode: (dto: unknown) => { appels.episode.push(dto); reponseEpisode = new Subject(); return reponseEpisode; },
    creerPatientAuComptoir: (dto: unknown) => {
      appels.dossier.push(dto);
      return of({ success: true, data: { patient: { id: 'p2', prenom: 'Kadiatou', nom: 'Sylla' }, motDePasseTemporaire: 'Tmp-123456' } });
    },
  };
  TestBed.configureTestingModule({
    imports: [AdmissionComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: HopitalService, useValue: hopital },
      { provide: Router, useValue: { navigate: (cmd: unknown) => { appels.navigation.push(cmd); return Promise.resolve(true); } } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  TestBed.overrideComponent(AdmissionComponent, { set: { template: '' } });
  // Angular appelle ngOnInit lui-meme : l'appeler a la main abonnait deux fois.
  const fixture = TestBed.createComponent(AdmissionComponent);
  fixture.detectChanges();
  const c = fixture.componentInstance;
  const repondreEpisode = () => { reponseEpisode!.next({ success: true, data: { id: 'e9', numero: 'EP-9' } }); reponseEpisode!.complete(); };
  return { c, appels, repondreEpisode };
}

describe('hôpital : admission', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('ne cherche qu’à partir de 3 caractères, une fois la saisie finie', async () => {
    const { c, appels } = monter();
    c.onRecherche('Ba');
    await attendre(350);
    expect(appels.recherche).toEqual([]);
    c.onRecherche('Bah');
    c.onRecherche('Bah M');
    await attendre(350);
    expect(appels.recherche).toEqual(['Bah M']);   // une seule requete, la derniere
    expect(c.resultats().length).toBe(1);
  });

  it('n’ouvre pas d’épisode sans motif', () => {
    const { c, appels } = monter();
    c.choisir(PATIENT as never);
    c.formulaire.motif = '  ';
    c.ouvrir();
    expect(appels.episode).toEqual([]);
  });

  it('ouvre l’épisode avec des champs propres, puis y conduit', () => {
    const { c, appels, repondreEpisode } = monter();
    c.choisir(PATIENT as never);
    c.formulaire = { motif: '  Fièvre persistante ', service: ' ', idResponsable: '', notes: 'Venu seul' };
    c.ouvrir();
    expect(appels.episode).toEqual([{ idPatient: 'p1', motif: 'Fièvre persistante', service: undefined, idResponsable: undefined, notes: 'Venu seul' }]);
    repondreEpisode();
    expect(appels.navigation).toEqual([['/hopital/episodes', 'e9']]);
  });

  it('n’ouvre pas deux épisodes sur un double clic', () => {
    const { c, appels } = monter();
    c.choisir(PATIENT as never);
    c.formulaire.motif = 'Fièvre persistante';
    c.ouvrir();
    c.ouvrir();
    expect(appels.episode.length).toBe(1);
  });

  it('reprend le numéro ou le nom tapé dans la recherche', () => {
    const a = monter();
    a.c.recherche = '620 00 00 01';
    a.c.ouvrirCreation();
    expect(a.c.nouveau.telephone).toBe('620 00 00 01');
    TestBed.resetTestingModule();
    const b = monter();
    b.c.recherche = 'Sylla';
    b.c.ouvrirCreation();
    expect(b.c.nouveau.nom).toBe('Sylla');
    expect(b.c.nouveau.telephone).toBe('');
  });

  it('refuse un dossier incomplet', () => {
    const { c, appels } = monter();
    c.nouveau = { prenom: 'Kadiatou', nom: 'Sylla', telephone: '620', email: '', dateNaissance: '1999-01-01', sexe: 'F', prefecture: 'Conakry', sousPrefecture: '' };
    expect(c.peutCreer()).toBe(false);            // telephone trop court
    c.nouveau.telephone = '620111222';
    c.nouveau.prefecture = ' ';
    expect(c.peutCreer()).toBe(false);            // prefecture manquante
    c.creerDossier();
    expect(appels.dossier).toEqual([]);
  });

  it('crée le dossier, montre le mot de passe une fois, puis retrouve le patient', async () => {
    const { c, appels } = monter();
    c.nouveau = { prenom: ' Kadiatou ', nom: 'Sylla', telephone: ' 620111222 ', email: ' ', dateNaissance: '1999-01-01', sexe: 'F', prefecture: 'Conakry', sousPrefecture: '' };
    c.creerDossier();
    expect(appels.dossier).toEqual([{
      telephone: '620111222', prenom: 'Kadiatou', nom: 'Sylla', dateNaissance: '1999-01-01', sexe: 'F',
      prefecture: 'Conakry', sousPrefecture: undefined, email: undefined,
    }]);
    expect(c.motDePasseRemis()).toEqual({ nom: 'Kadiatou Sylla', motDePasse: 'Tmp-123456' });
    c.fermerMotDePasse();
    expect(c.motDePasseRemis()).toBeNull();
    expect(c.nouveau.telephone).toBe('');          // formulaire vide pour le suivant
    await attendre(350);
    expect(appels.recherche).toEqual(['620111222']);
  });
});
