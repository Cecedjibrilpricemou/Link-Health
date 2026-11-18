// Maquette non raccordée : le branchement viendra après.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DemandesAgrementComponent } from './demandes-agrement.component';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(key: string): string { return key; }
}

function monter() {
  TestBed.configureTestingModule({
    imports: [DemandesAgrementComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });
  const fixture = TestBed.createComponent(DemandesAgrementComponent);
  return { fixture, component: fixture.componentInstance };
}

describe('maquette admin des demandes d’agrément', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('filtre la liste par état', () => {
    const { fixture, component } = monter();
    component.filtreEtat.set('RECUE');
    fixture.detectChanges();

    const lignes = fixture.nativeElement.querySelectorAll('.bb-demandes__item');
    expect(lignes.length).toBe(2);
    expect([...lignes].every((ligne: HTMLElement) =>
      ligne.querySelector('.bb-demandes__state')?.getAttribute('data-state') === 'RECUE',
    )).toBe(true);
  });

  it('ne permet pas de refuser sans motif', () => {
    const { fixture, component } = monter();
    const id = component.demandes()[0]!.id;
    component.ouvrirDemande(id);
    component.ouvrirSaisieMotif();
    component.refuser();
    fixture.detectChanges();

    expect(component.demandes().find((demande) => demande.id === id)?.etat).toBe('RECUE');
    expect(component.erreurMotif()).toBe(true);
  });

  it('chaque action place la demande dans l’état attendu', () => {
    const { fixture, component } = monter();
    const ids = component.demandes().map((demande) => demande.id);
    fixture.detectChanges();

    component.ouvrirDemande(ids[0]!);
    component.mettreEnAnalyse();
    expect(component.demandes().find((demande) => demande.id === ids[0])?.etat).toBe('EN_ANALYSE');

    component.ouvrirDemande(ids[1]!);
    component.valider();
    expect(component.demandes().find((demande) => demande.id === ids[1])?.etat).toBe('VALIDEE');

    component.ouvrirDemande(ids[2]!);
    component.motifRefus.set('Pièce illisible');
    component.refuser();
    expect(component.demandes().find((demande) => demande.id === ids[2])?.etat).toBe('REFUSEE');
  });
});
