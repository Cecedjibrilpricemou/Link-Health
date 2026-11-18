// L'ecran d'examen des demandes de rattachement, une fois raccorde.
//
// Quatre promesses verifiees ici :
//   - le filtre par etat part **au serveur**, il ne trie pas une liste deja
//     recue ;
//   - un dossier incomplet ne peut pas etre valide ;
//   - un refus sans motif explicite ne part pas ;
//   - un dossier deja decide n'offre plus aucune action, parce que le serveur
//     la refuserait.
//
// Le double du service **filtre reellement** sur le statut demande : un double
// qui rend toujours la meme liste ne testerait pas l'appel, il testerait la
// question qu'on lui a posee.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import type { DemandeAgrementListeView, DemandeAgrementView } from '@baobaoheath/shared-types';

import { DemandesAgrementComponent } from './demandes-agrement.component';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(key: string): string { return key; }
}

const LISTE: DemandeAgrementListeView[] = [
  {
    id: 'd1', numero: 'DA-2026-0041', statut: 'RECUE', type: 'PHARMACIE',
    nom: 'Pharmacie du Marché', prefecture: 'Conakry', commune: 'Matam',
    quartier: 'Madina', telephone: '620000101', deposeLe: '2026-11-12T09:00:00.000Z',
    responsable: 'Mamadou Barry', nombrePieces: 4,
  },
  {
    id: 'd2', numero: 'DA-2026-0040', statut: 'VALIDEE', type: 'CHU',
    nom: 'CHU de Donka', prefecture: 'Conakry', commune: 'Dixinn',
    quartier: null, telephone: '620000201', deposeLe: '2026-11-10T09:00:00.000Z',
    responsable: 'Fatoumata Camara', nombrePieces: 3,
  },
];

function dossier(surcharge: Partial<DemandeAgrementView> = {}): DemandeAgrementView {
  return {
    id: 'd1',
    numero: 'DA-2026-0041',
    statut: 'RECUE',
    type: 'PHARMACIE',
    nom: 'Pharmacie du Marché',
    prefecture: 'Conakry',
    commune: 'Matam',
    quartier: 'Madina',
    adresse: 'Avenue de la République',
    telephone: '620000101',
    rccm: 'GN.TCC.2026.A.041',
    numeroAgrementCreation: 'ARR/2026/041',
    numeroAgrementExploitation: 'ARR/2026/141',
    lieuAutorise: 'Madina, Matam',
    estHopitalPublic: false,
    responsable: {
      prenom: 'Mamadou', nom: 'Barry',
      telephone: '620000102', email: 'm.barry@example.gn',
    },
    pieces: [
      {
        id: 'p1', type: 'AGREMENT_CREATION', libelle: "l'agrément de création",
        taille: 2048, deposeLe: '2026-11-12T09:00:00.000Z',
      },
    ],
    manquantes: [],
    complet: true,
    motifRefus: null,
    examineLe: null,
    examinePar: null,
    idStructureCreee: null,
    deposeLe: '2026-11-12T09:00:00.000Z',
    ...surcharge,
  };
}

function monter(options: {
  detail?: DemandeAgrementView;
  decision?: ReturnType<typeof of>;
} = {}) {
  // Le double filtre comme la vraie API : sans filtre, tout ; avec un statut,
  // les seuls dossiers de ce statut.
  const lister = vi.fn((statut?: string) =>
    of({
      success: true,
      data: statut && statut !== 'TOUTES' ? LISTE.filter((d) => d.statut === statut) : LISTE,
    }),
  );

  const vu = options.detail ?? dossier();
  const detail = vi.fn((_id: string) => of({ success: true, data: vu }));
  const valider = vi.fn((_id: string) =>
    options.decision ?? of({ success: true, data: { ...vu, statut: 'VALIDEE' as const } }),
  );
  const refuser = vi.fn((_id: string, _motif: string) =>
    options.decision ?? of({ success: true, data: { ...vu, statut: 'REFUSEE' as const } }),
  );
  const mettreEnAnalyse = vi.fn((_id: string) =>
    of({ success: true, data: { ...vu, statut: 'EN_ANALYSE' as const } }),
  );
  const piece = vi.fn((_id: string) => of(new Blob(['%PDF-1.4'], { type: 'application/pdf' })));

  TestBed.configureTestingModule({
    imports: [DemandesAgrementComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: DemandeAgrementService,
        useValue: { lister, detail, valider, refuser, mettreEnAnalyse },
      },
      { provide: AdminService, useValue: { piece } },
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });

  const fixture = TestBed.createComponent(DemandesAgrementComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    appels: { lister, detail, valider, refuser, mettreEnAnalyse, piece },
  };
}

describe('examen des demandes de rattachement', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // jsdom ne fournit pas ces deux fonctions : l'apercu d'une piece les
    // utilise pour ne jamais exposer d'adresse devinable.
    URL.createObjectURL = vi.fn(() => 'blob:apercu');
    URL.revokeObjectURL = vi.fn();
  });

  it('charge les dossiers au demarrage, sans filtre', () => {
    const { component, appels } = monter();

    expect(appels.lister).toHaveBeenCalledWith('TOUTES');
    expect(component.demandes().length).toBe(2);
  });

  it('fait filtrer le serveur, et non la liste deja recue', () => {
    const { component, appels } = monter();

    component.changerFiltre('VALIDEE');

    expect(appels.lister).toHaveBeenLastCalledWith('VALIDEE');
    expect(component.demandes().map((d) => d.numero)).toEqual(['DA-2026-0040']);
  });

  it('charge le dossier entier a l ouverture', () => {
    const { component, appels } = monter();

    component.ouvrirDemande('d1');

    expect(appels.detail).toHaveBeenCalledWith('d1');
    expect(component.demandeOuverte()?.numero).toBe('DA-2026-0041');
  });

  it('valide, reprend le dossier rendu par le serveur et recharge la liste', () => {
    const { component, appels } = monter();
    component.ouvrirDemande('d1');

    component.valider();

    expect(appels.valider).toHaveBeenCalledWith('d1');
    expect(component.demandeOuverte()?.statut).toBe('VALIDEE');
    expect(component.succes()).toBe('ADMIN.AGREMENT_REQUESTS.DONE_VALIDATED');
    // Deux fois : au demarrage, puis apres la decision.
    expect(appels.lister).toHaveBeenCalledTimes(2);
  });

  it("n'offre plus d'action sur un dossier deja decide", () => {
    const { fixture, component } = monter({ detail: dossier({ statut: 'VALIDEE' }) });
    component.ouvrirDemande('d1');
    fixture.detectChanges();

    expect(component.decidable()).toBe(false);
    expect(fixture.nativeElement.querySelector('.bb-demandes__validate')).toBeNull();
    expect(fixture.nativeElement.querySelector('.bb-demandes__decided')).not.toBeNull();
  });

  it('interdit de valider un dossier incomplet', () => {
    const { fixture, component } = monter({
      detail: dossier({
        complet: false,
        manquantes: [{ type: 'INSCRIPTION_ORDRE', libelle: "l'attestation d'inscription à l'ordre" }],
      }),
    });
    component.ouvrirDemande('d1');
    fixture.detectChanges();

    const bouton = fixture.nativeElement.querySelector('.bb-demandes__validate') as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.bb-demandes__missing')).not.toBeNull();
  });

  it('refuse de transmettre un motif trop court', () => {
    const { component, appels } = monter();
    component.ouvrirDemande('d1');
    component.ouvrirSaisieMotif();
    component.motifRefus.set('non');

    component.refuser();

    expect(appels.refuser).not.toHaveBeenCalled();
    expect(component.erreurMotif()).toBe(true);
  });

  it('transmet le motif tel quel quand il est explicite', () => {
    const { component, appels } = monter();
    component.ouvrirDemande('d1');
    component.ouvrirSaisieMotif();
    component.motifRefus.set("  L'agrément d'exploitation est expiré.  ");

    component.refuser();

    expect(appels.refuser).toHaveBeenCalledWith('d1', "L'agrément d'exploitation est expiré.");
    expect(component.demandeOuverte()?.statut).toBe('REFUSEE');
  });

  it('charge une piece par une requete authentifiee, et libere son adresse ensuite', () => {
    const { component, appels } = monter();
    component.ouvrirDemande('d1');

    component.consulterPiece(component.demandeOuverte()!.pieces[0]!);
    expect(appels.piece).toHaveBeenCalledWith('p1');
    expect(component.apercu()).not.toBeNull();

    component.fermerApercu();
    expect(component.apercu()).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:apercu');
  });

  it('affiche le message du serveur quand une decision echoue', () => {
    const { component } = monter({
      decision: throwError(() => ({ error: { error: 'Le dossier DA-2026-0041 a déjà été validé.' } })),
    });
    component.ouvrirDemande('d1');

    component.valider();

    expect(component.erreur()).toContain('déjà été validé');
    expect(component.action()).toBe(false);
  });
});
