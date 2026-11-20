// « Accès à mon dossier » : le patient répond aux médecins.
//
// Ce que ce fichier tient :
//   - les demandes en attente viennent en tête, avec Accepter et Refuser ;
//   - un accord se retire après confirmation, jamais d'un seul clic ;
//   - après un refus ou un retrait, on peut encore accorder ;
//   - un accord expiré ne propose plus rien ;
//   - la réponse remplace la ligne sans recharger la page.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { AutorisationAccesDossierView, StatutAutorisationAcces } from '@baobaoheath/shared-types';

import { AccesDossierComponent } from './acces-dossier.component';
import { PatientService } from '../../../core/services/patient.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string {
    return p ? `${cle} ${JSON.stringify(p)}` : cle;
  }
}

function aut(id: string, statut: StatutAutorisationAcces): AutorisationAccesDossierView {
  return {
    id, statut, medecin: `Dr ${id}`, structure: 'Hôpital Donka', rendezVousLe: '2026-11-22T09:00:00Z',
    demandeeLe: '2026-11-18T08:00:00Z', decideeLe: null, retireeLe: null, expireLe: null,
  };
}

function monter(liste: AutorisationAccesDossierView[], confirme = true) {
  const repondreAccesDossier = vi.fn((id: string, geste: string) => {
    const statut = ({ accorder: 'ACCORDEE', refuser: 'REFUSEE', retirer: 'RETIREE' } as const)[geste as 'accorder'];
    return of({ success: true, data: { ...liste.find((a) => a.id === id)!, statut } });
  });
  const open = vi.fn(() => ({ afterClosed: () => of(confirme) }));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AccesDossierComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PatientService, useValue: { mesAccesDossier: () => of({ success: true, data: liste }), repondreAccesDossier } },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  // MatDialogModule fournit son propre MatDialog : on le remplace la ou il est.
  TestBed.overrideProvider(MatDialog, { useValue: { open } });
  const fixture = TestBed.createComponent(AccesDossierComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, repondreAccesDossier, open };
}

const cartes = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.bb-acces__carte'));
const boutons = (carte: HTMLElement) => Array.from(carte.querySelectorAll<HTMLButtonElement>('button'));
const libelles = (carte: HTMLElement) => boutons(carte).map((b) => b.textContent?.trim());

describe('acces a mon dossier', () => {
  it('rien encore : le dit, sans carte', () => {
    const { el } = monter([]);
    expect(cartes(el)).toHaveLength(0);
    expect(el.querySelector('.bb-acces__vide')).not.toBeNull();
  });

  it('les demandes en attente en tete, avec accepter et refuser', () => {
    const { el } = monter([aut('a', 'DEMANDEE'), aut('b', 'ACCORDEE')]);
    const [premiere] = cartes(el);
    expect(premiere!.classList).toContain('bb-acces__carte--attente');
    expect(libelles(premiere!)).toEqual(['PATIENT.ACCES_DOSSIER.ACCORDER', 'PATIENT.ACCES_DOSSIER.REFUSER']);
  });

  it('accepter : la reponse remplace la ligne', () => {
    const { el, fixture, repondreAccesDossier } = monter([aut('a', 'DEMANDEE')]);
    boutons(cartes(el)[0]!)[0]!.click();
    fixture.detectChanges();
    expect(repondreAccesDossier).toHaveBeenCalledWith('a', 'accorder');
    const [carte] = cartes(el);
    expect(carte!.querySelector('.bb-acces__statut')?.getAttribute('data-statut')).toBe('ACCORDEE');
    expect(libelles(carte!)).toEqual(['PATIENT.ACCES_DOSSIER.RETIRER']);
  });

  it('refuser', () => {
    const { el, repondreAccesDossier } = monter([aut('a', 'DEMANDEE')]);
    boutons(cartes(el)[0]!)[1]!.click();
    expect(repondreAccesDossier).toHaveBeenCalledWith('a', 'refuser');
  });

  it('retirer demande confirmation', () => {
    const annule = monter([aut('a', 'ACCORDEE')], false);
    boutons(cartes(annule.el)[0]!)[0]!.click();
    expect(annule.open).toHaveBeenCalledTimes(1);
    expect(annule.repondreAccesDossier).not.toHaveBeenCalled();

    const confirme = monter([aut('a', 'ACCORDEE')], true);
    boutons(cartes(confirme.el)[0]!)[0]!.click();
    expect(confirme.repondreAccesDossier).toHaveBeenCalledWith('a', 'retirer');
  });

  it('apres un refus ou un retrait, on peut encore accorder ; expire, plus rien', () => {
    const { el } = monter([aut('r', 'REFUSEE'), aut('t', 'RETIREE'), aut('x', 'EXPIREE')]);
    const [refus, retrait, expire] = cartes(el);
    expect(libelles(refus!)).toEqual(['PATIENT.ACCES_DOSSIER.REACCORDER']);
    expect(libelles(retrait!)).toEqual(['PATIENT.ACCES_DOSSIER.REACCORDER']);
    expect(boutons(expire!)).toHaveLength(0);
  });
});
