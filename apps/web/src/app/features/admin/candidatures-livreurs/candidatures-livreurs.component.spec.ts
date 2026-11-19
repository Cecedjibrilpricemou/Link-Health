// L'examen des candidatures de motards livreurs.
//
// Ce que ce fichier empeche de revenir :
//   - un mot de passe qui disparait avant que l'agent l'ait note. Sans email,
//     c'est le seul moyen pour le livreur d'entrer : une touche Echap ne doit
//     pas le lui faire perdre ;
//   - un mot de passe affiche alors qu'il est parti par courriel ;
//   - une action proposee sur un dossier deja decide, que le serveur
//     refuserait ;
//   - un refus sans motif, que le candidat ne saurait pas corriger.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type {
  CandidatureLivreurListeView,
  CandidatureLivreurView,
} from '@baobaoheath/shared-types';

import { CandidaturesLivreursComponent } from './candidatures-livreurs.component';
import { CandidatureLivreurService } from '../../../core/services/candidature-livreur.service';
import { GeographieService } from '../../../core/services/geographie.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

const LIGNE: CandidatureLivreurListeView = {
  id: 'cand-1', numero: 'DL-2026-0001', statut: 'RECUE', prenom: 'Mamadou', nom: 'Diallo',
  telephone: '620100099', prefecture: 'Conakry', commune: 'Dixinn', quartier: 'Donka',
  deposeParAdministration: false, nombrePieces: 6, deposeLe: '2026-11-20T08:00:00.000Z',
};

function dossier(sur: Partial<CandidatureLivreurView> = {}): CandidatureLivreurView {
  return {
    id: 'cand-1', numero: 'DL-2026-0001', statut: 'RECUE', deposeParAdministration: false,
    prenom: 'Mamadou', nom: 'Diallo', dateNaissance: '1995-04-12', age: 31, sexe: 'M',
    telephone: '620100099', email: null, prefecture: 'Conakry', commune: 'Dixinn', quartier: 'Donka',
    pieces: [
      { id: 'p-1', type: 'CNI_RECTO', typeMime: 'image/jpeg', taille: 1000, deposeLe: '2026-11-20T08:00:00.000Z' },
      { id: 'p-2', type: 'CARTE_GRISE', typeMime: 'application/pdf', taille: 1000, deposeLe: '2026-11-20T08:00:00.000Z' },
    ],
    manquantes: [], complet: true, motifRefus: null, examineLe: null, examinePar: null,
    idLivreurCree: null, deposeLe: '2026-11-20T08:00:00.000Z',
    ...sur,
  };
}

function monter(options: { ouvert?: CandidatureLivreurView; motDePasse?: string | null } = {}) {
  const ouvert = options.ouvert ?? dossier();
  const valide = dossier({ statut: 'VALIDEE', idLivreurCree: 'livreur-1' });
  const service = {
    lister: vi.fn(() => of({ success: true, data: [LIGNE] })),
    detail: vi.fn(() => of({ success: true, data: ouvert })),
    piece: vi.fn(() => of(new Blob(['x'], { type: 'image/jpeg' }))),
    mettreEnAnalyse: vi.fn(() => of({ success: true, data: dossier({ statut: 'EN_ANALYSE' }) })),
    valider: vi.fn(() => of({
      success: true,
      data: { candidature: valide, motDePasseTemporaire: options.motDePasse ?? null },
    })),
    refuser: vi.fn((_id: string, motif: string) => of({
      success: true, data: dossier({ statut: 'REFUSEE', motifRefus: motif }),
    })),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CandidaturesLivreursComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: CandidatureLivreurService, useValue: service },
      {
        provide: GeographieService,
        useValue: {
          chargerConfiguration: () => of(null),
          libelle: (role: string) => (role === 'base' ? 'Commune' : 'Préfecture'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CandidaturesLivreursComponent);
  fixture.detectChanges();
  const rendre = () => { fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };
  return { c: fixture.componentInstance, rendre, service };
}

describe('examen des candidatures de livreurs', () => {
  it('liste les dossiers recus', () => {
    const { rendre, service } = monter();
    expect(service.lister).toHaveBeenCalledWith('TOUTES');
    expect(rendre().textContent).toContain('DL-2026-0001');
  });

  it('filtre par le serveur, pas sur la liste deja recue', () => {
    const { c, service } = monter();
    c.changerFiltre('RECUE');
    expect(service.lister).toHaveBeenLastCalledWith('RECUE');
  });

  it('ouvre le dossier complet, pieces comprises', () => {
    const { c, rendre } = monter();
    c.ouvrirCandidature('cand-1');
    const el = rendre();
    expect(el.querySelectorAll('.bb-demandes__pieces li')).toHaveLength(2);
    // Une photo et un PDF ne portent pas la meme icone.
    expect(el.querySelector('.bb-demandes__pieces .pi-image')).not.toBeNull();
    expect(el.querySelector('.bb-demandes__pieces .pi-file-pdf')).not.toBeNull();
  });

  it('montre le mot de passe a communiquer, et le garde apres fermeture du dossier', () => {
    const { c, rendre } = monter({ motDePasse: 'Temp-Mdp-9' });
    c.ouvrirCandidature('cand-1');
    c.valider();

    c.echapper();

    expect(c.candidatureOuverte()).toBeNull();
    expect(rendre().querySelector('.bb-demandes__password code')?.textContent).toBe('Temp-Mdp-9');
    c.ignorerMotDePasse();
    expect(rendre().querySelector('.bb-demandes__password')).toBeNull();
  });

  it('ne montre aucun mot de passe quand il est parti par courriel', () => {
    const { c, rendre } = monter({ motDePasse: null });
    c.ouvrirCandidature('cand-1');
    c.valider();

    expect(rendre().querySelector('.bb-demandes__password')).toBeNull();
    expect(c.succes()).toContain('DL-2026-0001');
  });

  it('ne propose plus aucune action sur un dossier decide', () => {
    const { c, rendre } = monter({ ouvert: dossier({ statut: 'VALIDEE' }) });
    c.ouvrirCandidature('cand-1');
    const el = rendre();
    expect(el.querySelector('.bb-demandes__validate')).toBeNull();
    expect(el.querySelector('.bb-demandes__decided')).not.toBeNull();
  });

  it('ne valide pas un dossier incomplet', () => {
    const { c, rendre } = monter({ ouvert: dossier({ complet: false, manquantes: ['PERMIS_CONDUIRE'] }) });
    c.ouvrirCandidature('cand-1');
    expect(rendre().querySelector<HTMLButtonElement>('.bb-demandes__validate')?.disabled).toBe(true);
  });

  it('exige un motif explicite pour refuser', () => {
    const { c, service } = monter();
    c.ouvrirCandidature('cand-1');
    c.ouvrirSaisieMotif();
    c.motifRefus.set('non');

    c.refuser();

    expect(service.refuser).not.toHaveBeenCalled();
    expect(c.erreurMotif()).toBe(true);

    c.motifRefus.set('Le permis de conduire est illisible.');
    c.refuser();
    expect(service.refuser).toHaveBeenCalledWith('cand-1', 'Le permis de conduire est illisible.');
    expect(c.candidatureOuverte()?.statut).toBe('REFUSEE');
  });

  it.each([['fr', fr], ['en', en]] as const)('%s porte toutes les cles de l ecran', (_langue, catalogue) => {
    const admin = (catalogue as Record<string, any>)['ADMIN'];
    expect(admin['NAV_LIVREUR_REQUESTS']).toBeTruthy();
    for (const cle of [
      'TITLE', 'SUBTITLE', 'FILTER', 'COUNT', 'EMPTY', 'OPEN', 'IDENTITY', 'BY_ADMINISTRATION',
      'PASSWORD_TITLE', 'LOAD_ERROR', 'PIECE_ERROR', 'DECISION_ERROR', 'DONE_ANALYSIS',
      'DONE_VALIDATED_EMAIL', 'DONE_VALIDATED_SHOWN', 'DONE_REFUSED', 'DONE_REFUSED_EMAIL',
    ]) {
      expect(admin['LIVREUR_REQUESTS'][cle]).toBeTruthy();
    }
  });
});
