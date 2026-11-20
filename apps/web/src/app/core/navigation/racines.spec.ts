// Les ecrans de l'accueil et du laboratoire, dans l'interface de
// l'administrateur.
//
// Ce que ce fichier tient :
//   - un lien d'un ecran partage reste dans l'espace ou l'on est : l'accueil
//     chez l'accueil, l'administration chez l'administration ;
//   - l'administrateur suit une analyse sans pouvoir la saisir, la valider ni
//     en imprimer les valeurs.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';

import { RACINE_ACCUEIL, RACINE_LABO } from './racines';
import { EpisodesComponent } from '../../features/hopital/episodes/episodes.component';
import { LaboDemandeDetailComponent } from '../../features/laboratoire/demande-detail/demande-detail.component';
import { HopitalService } from '../services/hopital.service';
import { LaboratoireService } from '../services/laboratoire.service';
import { AuthService } from '../services/auth.service';
import { I18nService } from '../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string): string { return cle; }
}

const EPISODE = {
  id: 'ep-1', numero: 'EP-2026-000001', statut: 'EN_COURS', motif: 'Fièvre', service: null, responsable: null,
  ouvertLe: '2026-11-20T08:00:00Z', ouvertPar: { prenom: 'K', nom: 'T' }, nbDemandesAnalyse: 0,
  patient: { id: 'p', prenom: 'Awa', nom: 'Diallo' },
};

function monterEpisodes(racine?: string) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [EpisodesComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: HopitalService, useValue: { listerEpisodes: () => of({ success: true, data: { items: [EPISODE], total: 1, page: 1, limit: 20 } }) } },
      { provide: ToastrService, useValue: { error: vi.fn() } },
      { provide: I18nService, useClass: I18nMaquette },
      ...(racine ? [{ provide: RACINE_ACCUEIL, useValue: racine }] : []),
    ],
  });
  const f = TestBed.createComponent(EpisodesComponent);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('un ecran partage garde ses liens dans son espace', () => {
  it('chez l accueil : /hopital', () => {
    const el = monterEpisodes();
    expect(el.querySelector('a.bb-hop-item')?.getAttribute('href')).toBe('/hopital/episodes/ep-1');
  });

  it('chez l administrateur : son interface, sans basculer dans celle de l accueil', () => {
    const el = monterEpisodes('/admin-structure/accueil');
    expect(el.querySelector('a.bb-hop-item')?.getAttribute('href')).toBe('/admin-structure/accueil/episodes/ep-1');
    expect([...el.querySelectorAll('a')].some((a) => a.getAttribute('href')?.startsWith('/hopital'))).toBe(false);
  });
});

// ── Le laboratoire, vu par l'administrateur ──────────────────────────

function demande(statut: string) {
  return {
    id: 'da-1', numero: 'DA-2026-000001', statut, urgence: 'ROUTINE', numeroEpisode: 'EP-1',
    prescripteur: { prenom: 'F', nom: 'C' }, patient: { id: 'p', prenom: 'Awa', nom: 'Diallo' },
    laboratoire: { id: 'l', nom: 'Labo' }, indicationClinique: null, consignesPatient: null,
    creneauPrelevement: null, preleveeLe: null, lieuPrelevement: null, echantillons: [],
    commentaireLaboratoire: null, motifAnnulation: null, alerteCritiqueEnAttente: false,
    creeLe: '2026-11-20T08:00:00Z',
    lignes: [{ id: 'l1', commentaire: null, examen: { id: 'e', libelle: 'Hémoglobine', codeLoinc: '718-7', specimen: 'SANG', unite: 'g/dL' }, resultat: null }],
  };
}

function monterDetail(role: string, statut: string) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LaboDemandeDetailComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'da-1' } } } },
      { provide: LaboratoireService, useValue: { getDemande: () => of({ success: true, data: demande(statut) }) } },
      { provide: AuthService, useValue: { currentUser: signal({ role }) } },
      { provide: ToastrService, useValue: { error: vi.fn(), success: vi.fn() } },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: RACINE_LABO, useValue: '/admin-structure/laboratoire' },
    ],
  });
  const f = TestBed.createComponent(LaboDemandeDetailComponent);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

const texte = (el: HTMLElement) => el.textContent ?? '';

describe('l administrateur suit une analyse sans la produire', () => {
  for (const statut of ['PRELEVEE', 'EN_ANALYSE', 'VALIDEE']) {
    it(`${statut} : ni saisie, ni validation, ni compte rendu`, () => {
      const el = monterDetail('ADMIN_STRUCTURE', statut);
      expect(texte(el)).not.toContain('LABO.DETAIL.SAISIE_SUBMIT');
      expect(texte(el)).not.toContain('LABO.DETAIL.ACTION_VALIDER');
      expect(texte(el)).not.toMatch(/LABO\.DETAIL\.ACTION_CR/);
      expect(el.querySelector('input[matInput], input[type=number]')).toBeNull();
    });
  }

  it('le laborantin, lui, garde ses gestes', () => {
    const el = monterDetail('TECHNICIEN_LABO', 'PRELEVEE');
    expect(texte(el)).toMatch(/LABO\.DETAIL\.ACTION_CR_BROUILLON/);
    expect(texte(el)).toContain('LABO.DETAIL.SAISIE_SUBMIT');
  });

  it('le retour a la file reste dans l interface de l administrateur', () => {
    const el = monterDetail('ADMIN_STRUCTURE', 'RECUE');
    expect(el.querySelector('a.bb-hop-back')?.getAttribute('href')).toBe('/admin-structure/laboratoire/demandes');
  });
});
