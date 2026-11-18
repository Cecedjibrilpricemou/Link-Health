// Maquette non raccordée : le branchement viendra après.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TypePieceAgrement } from '@baobaoheath/shared-types';

import { DemandeAgrementComponent } from './demande-agrement.component';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';
import { ThemeService } from '../../../shared/services/theme.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(key: string): string { return key; }
}

const TYPES_ATTENDUS: TypePieceAgrement[] = [
  'AGREMENT_CREATION',
  'AGREMENT_EXPLOITATION',
  'DIPLOME_RESPONSABLE',
  'INSCRIPTION_ORDRE',
];

function formulaireComplet(component: DemandeAgrementComponent): void {
  component.formulaire.set({
    type: 'PHARMACIE',
    nom: 'Pharmacie de Ratoma',
    prefecture: 'Conakry',
    commune: 'Ratoma',
    quartier: 'Kipé',
    adresse: 'Route de Kipé',
    telephone: '+224620000001',
    rccm: 'GN.TCC.2026.A.1',
    numeroAgrementCreation: 'ARR/2026/01',
    numeroAgrementExploitation: 'ARR/2026/02',
    lieuAutorise: 'Kipé, Ratoma',
    responsable: {
      prenom: 'Awa',
      nom: 'Bah',
      telephone: '+224620000002',
      email: 'awa@example.com',
    },
  });
}

function monter() {
  TestBed.configureTestingModule({
    imports: [DemandeAgrementComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ThemeService, useValue: { isDark: signal(false), toggle() {} } },
      {
        provide: PlateformeService,
        useValue: {
          nom: signal('KÈNÈYA'),
          logoUrl: signal(''),
          copyright: () => 'KÈNÈYA',
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(DemandeAgrementComponent);
  return { fixture, component: fixture.componentInstance };
}

describe('maquette de demande de rattachement', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('refuse l’envoi tant qu’une pièce attendue manque', () => {
    const { fixture, component } = monter();
    formulaireComplet(component);
    component.pieces.set({
      AGREMENT_CREATION: new File(['pdf'], 'creation.pdf', { type: 'application/pdf' }),
      AGREMENT_EXPLOITATION: new File(['pdf'], 'exploitation.pdf', { type: 'application/pdf' }),
      DIPLOME_RESPONSABLE: new File(['pdf'], 'diplome.pdf', { type: 'application/pdf' }),
    });
    component.piecesCompletes.set(false);

    component.envoyer();
    fixture.detectChanges();

    expect(component.confirmation()).toBeNull();
    expect(fixture.nativeElement.querySelector('.demande-agrement__confirmation')).toBeNull();
  });

  it('affiche la confirmation et un numéro local quand le dossier est complet', () => {
    const { fixture, component } = monter();
    formulaireComplet(component);
    component.pieces.set(Object.fromEntries(
      TYPES_ATTENDUS.map((type) => [
        type,
        new File(['pdf'], `${type.toLowerCase()}.pdf`, { type: 'application/pdf' }),
      ]),
    ) as Partial<Record<TypePieceAgrement, File>>);
    component.piecesCompletes.set(true);

    component.envoyer();
    fixture.detectChanges();

    const confirmation = fixture.nativeElement.querySelector('.demande-agrement__confirmation') as HTMLElement;
    expect(confirmation).not.toBeNull();
    expect(confirmation.textContent).toContain(component.confirmation());
    expect(component.confirmation()).toMatch(/^DA-\d{4}-\d{4}$/);
    expect(confirmation.textContent).toContain('PUBLIC.STRUCTURE_REQUEST.NOT_SENT');
  });
});
