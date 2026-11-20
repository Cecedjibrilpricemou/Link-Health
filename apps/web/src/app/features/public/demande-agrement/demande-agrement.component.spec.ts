// Le formulaire public de demande de rattachement, une fois raccorde.
//
// Ce qui est verifie ici tient a trois promesses faites au candidat :
//   - le numero affiche est celui du serveur, jamais un numero fabrique par
//     l'ecran, qui ne servirait a rien au telephone ;
//   - un hopital public ne voit ni RCCM ni arrete d'exploitation, et son
//     dossier n'en porte pas ;
//   - une erreur ne lui fait pas perdre sa saisie ni ses fichiers ;
//   - une compagnie d'assurance arrive par la tuile de l'accueil sur un
//     formulaire deja regle, propose son code, et ne declare pas d'arrete
//     d'exploitation.
//
// Les doubles **filtrent sur leurs arguments**. Un double qui repond la meme
// chose quelle que soit la question ne teste pas l'appel, il teste la question
// qu'on lui a posee : c'est ainsi qu'un filtre casse passe inapercu.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import type { PiecesAttenduesView, TypePieceAgrement } from '@baobaoheath/shared-types';

import { DemandeAgrementComponent } from './demande-agrement.component';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';
import { ThemeService } from '../../../shared/services/theme.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(key: string): string { return key; }
}

/** Ce que le serveur repond : quatre pieces au prive, trois a l'hopital public. */
const ATTENDUES: PiecesAttenduesView[] = [
  {
    type: 'PHARMACIE',
    demandable: true,
    estPublique: false,
    pieces: [
      { type: 'AGREMENT_CREATION', libelle: "l'agrément de création" },
      { type: 'AGREMENT_EXPLOITATION', libelle: "l'agrément d'exploitation" },
      { type: 'DIPLOME_RESPONSABLE', libelle: 'le diplôme légalisé du responsable' },
      { type: 'INSCRIPTION_ORDRE', libelle: "l'attestation d'inscription à l'ordre professionnel" },
    ],
  },
  {
    type: 'CHU',
    demandable: true,
    estPublique: true,
    pieces: [
      { type: 'AGREMENT_CREATION', libelle: "l'acte de création de l'établissement" },
      { type: 'DIPLOME_RESPONSABLE', libelle: 'le diplôme légalisé du responsable' },
      { type: 'INSCRIPTION_ORDRE', libelle: "l'attestation d'inscription à l'ordre professionnel" },
    ],
  },
  {
    type: 'ASSURANCE',
    demandable: true,
    estPublique: false,
    pieces: [
      { type: 'AGREMENT_ASSURANCE', libelle: "l'agrément de la Banque Centrale" },
      { type: 'EXTRAIT_RCCM', libelle: "l'extrait RCCM" },
      { type: 'PIECE_IDENTITE_RESPONSABLE', libelle: "la carte d'identité ou le passeport du responsable" },
      { type: 'CERTIFICAT_RESIDENCE_RESPONSABLE', libelle: 'le certificat de résidence du responsable' },
    ],
  },
  // Le serveur rend aussi les types que l'administration cree elle-meme : le
  // formulaire public ne doit pas les proposer.
  {
    type: 'POSTE',
    demandable: false,
    estPublique: true,
    pieces: [
      { type: 'AGREMENT_CREATION', libelle: "l'acte de création de l'établissement" },
      { type: 'DIPLOME_RESPONSABLE', libelle: 'le diplôme légalisé du responsable' },
    ],
  },
];

/** Le referentiel : les communes dependent vraiment de la prefecture demandee. */
const COMMUNES: Record<string, string[]> = {
  Conakry: ['Dixinn', 'Matam', 'Ratoma'],
  Kankan: ['Kankan-Centre'],
};

function pdf(nom: string): File {
  return new File(['%PDF-1.4'], nom, { type: 'application/pdf' });
}

function monter(options: {
  depot?: ReturnType<typeof of>;
  piecesAttendues?: ReturnType<typeof of>;
  /** Le `?type=` de l'adresse, comme le pose la tuile de l'accueil. */
  typeDemande?: string;
} = {}) {
  // Les deux parametres sont declares pour que le dossier envoye soit
  // inspectable : sans eux, le double n'en garde aucune trace.
  const deposer = vi.fn((_dto: unknown, _pieces: unknown) =>
    options.depot
      ?? of({ success: true, data: { numero: 'DA-2026-0042', statut: 'RECUE', deposeLe: '2026-11-18T10:00:00.000Z' } }),
  );

  const service = {
    piecesAttendues: () => options.piecesAttendues ?? of({ success: true, data: ATTENDUES }),
    deposer,
  };

  const geo = {
    chargerConfiguration: () => of(null),
    nomsSuggeres: (role: string, dans?: string) =>
      of(role === 'elargissement' ? Object.keys(COMMUNES) : (COMMUNES[dans ?? ''] ?? [])),
  };

  TestBed.configureTestingModule({
    imports: [DemandeAgrementComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(options.typeDemande ? { type: options.typeDemande } : {}),
          },
        },
      },
      { provide: DemandeAgrementService, useValue: service },
      { provide: GeographieService, useValue: geo },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ThemeService, useValue: { isDark: signal(false), toggle() {} } },
      {
        provide: PlateformeService,
        useValue: {
          nom: signal('OmniCare'),
          logoUrl: signal(''),
          copyright: () => 'OmniCare',
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(DemandeAgrementComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, deposer };
}

function remplir(component: DemandeAgrementComponent, type = 'PHARMACIE'): void {
  component.formulaire.set({
    type,
    nom: 'Pharmacie de Ratoma',
    prefecture: 'Conakry',
    commune: 'Ratoma',
    quartier: 'Kipé',
    adresse: 'Route de Kipé',
    telephone: '620000001',
    rccm: 'GN.TCC.2026.A.1',
    numeroAgrementCreation: 'ARR/2026/01',
    numeroAgrementExploitation: 'ARR/2026/02',
    lieuAutorise: 'Kipé, Ratoma',
    codeAssureur: '',
    modeEchange: '',
    responsable: {
      prenom: 'Awa',
      nom: 'Bah',
      telephone: '620000002',
      email: 'awa@example.com',
    },
  });
}

/** Une compagnie d'assurance, saisie comme le ferait son responsable. */
function remplirCompagnie(component: DemandeAgrementComponent, code = 'sunu'): void {
  remplir(component, 'ASSURANCE');
  component.formulaire.update((f) => ({
    ...f,
    nom: 'Sunu Assurances',
    numeroAgrementCreation: 'D/2009/CAM/LOA/07',
    // Saisi avant de changer de type : il ne doit pas partir.
    numeroAgrementExploitation: 'ARR/2026/02',
    codeAssureur: code,
    modeEchange: 'PORTAIL',
  }));
}

describe('demande publique de rattachement', () => {
  beforeEach(() => TestBed.resetTestingModule());

  /**
   * Un poste de sante produit lui aussi un dossier, mais il ne se demande
   * pas : l'administration le cree. Le proposer ferait deposer un dossier que
   * l'API refuserait, apres le temps de televersement de deux PDF.
   */
  it('ne propose que les types qui se demandent', () => {
    const { component } = monter();

    expect(component.typesProposes()).toEqual(['PHARMACIE', 'CHU', 'ASSURANCE']);
    expect(component.typesProposes()).not.toContain('POSTE');
  });

  it('tient du serveur la liste des pieces et leurs libelles', () => {
    const { component } = monter();

    expect(component.requisesImposees()).toEqual([
      'AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
    ] as TypePieceAgrement[]);
    expect(component.libellesImposes()['AGREMENT_CREATION']).toContain('agrément de création');
  });

  it("n'exige que trois pieces d'un hopital public, et nomme la premiere « acte de creation »", () => {
    const { component } = monter();
    component.modifierChamp('type', 'CHU');

    expect(component.estPublique()).toBe(true);
    expect(component.requisesImposees()).toEqual([
      'AGREMENT_CREATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
    ] as TypePieceAgrement[]);
    expect(component.libellesImposes()['AGREMENT_CREATION']).toContain('acte de création');
  });

  it('masque le RCCM et l arrete d exploitation pour un hopital public', () => {
    const { fixture, component } = monter();

    expect(fixture.nativeElement.querySelector('#demande-rccm')).not.toBeNull();
    component.modifierChamp('type', 'CHU');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#demande-rccm')).toBeNull();
    expect(fixture.nativeElement.querySelector('#demande-exploitation')).toBeNull();
    // La reference de l'acte reste demandee : c'est la seule preuve d'un CHU.
    expect(fixture.nativeElement.querySelector('#demande-creation')).not.toBeNull();
  });

  it('prend les communes au referentiel, selon la prefecture choisie', () => {
    const { component } = monter();

    expect(component.prefectures()).toEqual(['Conakry', 'Kankan']);

    component.changerPrefecture('Kankan');
    expect(component.communes()).toEqual(['Kankan-Centre']);

    component.changerPrefecture('Conakry');
    expect(component.communes()).toEqual(['Dixinn', 'Matam', 'Ratoma']);
  });

  it('vide la commune quand la prefecture change', () => {
    const { component } = monter();
    remplir(component);

    component.changerPrefecture('Kankan');
    expect(component.formulaire().commune).toBe('');
  });

  it("refuse l'envoi tant qu'une piece manque", () => {
    const { component, deposer } = monter();
    remplir(component);
    component.piecesCompletes.set(false);

    component.envoyer();

    expect(deposer).not.toHaveBeenCalled();
    expect(component.confirmation()).toBeNull();
  });

  it('affiche le numero de dossier rendu par le serveur', () => {
    const { fixture, component } = monter();
    remplir(component);
    component.pieces.set({ AGREMENT_CREATION: pdf('creation.pdf') });
    component.piecesCompletes.set(true);

    component.envoyer();
    fixture.detectChanges();

    expect(component.confirmation()).toBe('DA-2026-0042');
    const bloc = fixture.nativeElement.querySelector('.demande-agrement__confirmation') as HTMLElement;
    expect(bloc).not.toBeNull();
    expect(bloc.textContent).toContain('DA-2026-0042');
  });

  it("n'envoie ni RCCM ni arrete d'exploitation pour un hopital public", () => {
    const { component, deposer } = monter();
    remplir(component, 'CHU');
    component.piecesCompletes.set(true);

    component.envoyer();

    const dossier = deposer.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(dossier['rccm']).toBeUndefined();
    expect(dossier['numeroAgrementExploitation']).toBeUndefined();
    expect(dossier['numeroAgrementCreation']).toBe('ARR/2026/01');
  });

  it("affiche le message du serveur et garde la saisie quand l'envoi echoue", () => {
    const { fixture, component } = monter({
      depot: throwError(() => ({ error: { error: 'Dossier incomplet : il manque le diplôme.' } })),
    });
    remplir(component);
    component.pieces.set({ AGREMENT_CREATION: pdf('creation.pdf') });
    component.piecesCompletes.set(true);

    component.envoyer();
    fixture.detectChanges();

    expect(component.erreur()).toContain('il manque le diplôme');
    expect(component.confirmation()).toBeNull();
    // Rien n'est efface : sur un reseau lent, tout reprendre se paie en abandon.
    expect(component.formulaire().nom).toBe('Pharmacie de Ratoma');
    expect(component.pieces()['AGREMENT_CREATION']).toBeDefined();
    expect(component.envoi()).toBe(false);
  });

  // ── Une compagnie d'assurance ─────────────────────────────────

  it('arrive deja regle sur l assurance depuis la tuile de l accueil', () => {
    const { component } = monter({ typeDemande: 'ASSURANCE' });

    expect(component.formulaire().type).toBe('ASSURANCE');
    expect(component.requisesImposees()).toEqual([
      'AGREMENT_ASSURANCE', 'EXTRAIT_RCCM', 'PIECE_IDENTITE_RESPONSABLE', 'CERTIFICAT_RESIDENCE_RESPONSABLE',
    ] as TypePieceAgrement[]);
  });

  it('ignore un type d adresse qui ne se demande pas', () => {
    const { component } = monter({ typeDemande: 'POSTE' });
    expect(component.formulaire().type).toBe('PHARMACIE');
  });

  it('demande le code et le mode d echange, sans arrete d exploitation', () => {
    const { fixture } = monter({ typeDemande: 'ASSURANCE' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('#demande-code')).not.toBeNull();
    expect(el.querySelector('#demande-mode')).not.toBeNull();
    expect(el.querySelector('#demande-exploitation')).toBeNull();
    expect(el.querySelector('#demande-rccm')).not.toBeNull();
    expect(el.querySelector('#demande-lieu')).not.toBeNull();
    expect(el.textContent).toContain('AGREMENT.BCRG_LABEL');
  });

  it('envoie le code en majuscules et le mode, sans arrete d exploitation', () => {
    const { component, deposer } = monter({ typeDemande: 'ASSURANCE' });
    remplirCompagnie(component);
    component.piecesCompletes.set(true);

    component.envoyer();

    const dossier = deposer.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(dossier['type']).toBe('ASSURANCE');
    expect(dossier['codeAssureur']).toBe('SUNU');
    expect(dossier['modeEchange']).toBe('PORTAIL');
    expect(dossier['numeroAgrementExploitation']).toBeUndefined();
    expect(dossier['numeroAgrementCreation']).toBe('D/2009/CAM/LOA/07');
  });

  it('bloque l envoi sur un code mal forme, et le dit', () => {
    const { fixture, component, deposer } = monter({ typeDemande: 'ASSURANCE' });
    remplirCompagnie(component, 'SU NU');
    component.piecesCompletes.set(true);
    fixture.detectChanges();

    expect(component.formulaireValide()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('PUBLIC.STRUCTURE_REQUEST.CODE_INVALID');
    component.envoyer();
    expect(deposer).not.toHaveBeenCalled();
  });

  it('n envoie pas de code pour un autre type', () => {
    const { component, deposer } = monter();
    remplir(component);
    component.formulaire.update((f) => ({ ...f, codeAssureur: 'SUNU', modeEchange: 'API' }));
    component.piecesCompletes.set(true);

    component.envoyer();

    const dossier = deposer.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(dossier['codeAssureur']).toBeUndefined();
    expect(dossier['modeEchange']).toBeUndefined();
  });

  it("previent quand la liste des pieces n'a pas pu etre chargee", () => {
    const { component } = monter({ piecesAttendues: throwError(() => new Error('coupure')) });

    expect(component.erreur()).toBe('PUBLIC.STRUCTURE_REQUEST.PIECES_UNAVAILABLE');
    expect(component.requisesImposees()).toBeNull();
  });
});
