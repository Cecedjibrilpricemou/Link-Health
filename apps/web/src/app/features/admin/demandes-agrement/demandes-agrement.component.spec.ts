// L'ecran d'examen des demandes de rattachement, une fois raccorde.
//
// Les promesses verifiees ici :
//   - le filtre par etat part **au serveur**, il ne trie pas une liste deja
//     recue ;
//   - un dossier incomplet ne peut pas etre valide ;
//   - **aucune action ne part sans motif explicite** - mise en verification,
//     validation, refus : le motif est envoye au candidat ;
//   - l'ecran dit si le courriel est parti, et l'historique aussi ;
//   - pour une assurance, le code propose peut etre corrige avant de valider ;
//   - un dossier deja decide n'offre plus aucune action, parce que le serveur
//     la refuserait.
//
// Le double du service **filtre reellement** sur le statut demande : un double
// qui rend toujours la meme liste ne testerait pas l'appel, il testerait la
// question qu'on lui a posee.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';
import type { DemandeAgrementListeView, DemandeAgrementView } from '@baobaoheath/shared-types';

import { DemandesAgrementComponent } from './demandes-agrement.component';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import { I18nService } from '../../../shared/services/i18n.service';

const MOTIF = 'Les pièces sont lisibles et les références concordent.';

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
    codeAssureur: null,
    modeEchange: null,
    historique: [],
    deposeLe: '2026-11-12T09:00:00.000Z',
    ...surcharge,
  };
}

/** Une ligne d'historique, telle que le serveur la rend apres une action. */
function evenement(action: 'MISE_EN_VERIFICATION' | 'VALIDATION' | 'REFUS', emailEnvoye: boolean) {
  return {
    id: `e-${action}`, action, motif: MOTIF, emailEnvoye,
    auteur: 'Fanta Camara', creeLe: '2026-11-20T09:00:00.000Z',
  };
}

/** Ouvrir le dossier, choisir l'action, ecrire le motif. */
function preparer(
  component: DemandesAgrementComponent,
  action: 'ANALYSE' | 'VALIDATION' | 'REFUS',
  motif = MOTIF,
): void {
  component.ouvrirDemande('d1');
  component.ouvrirAction(action);
  component.motif.set(motif);
}

function monter(options: {
  detail?: DemandeAgrementView;
  /** La reponse du serveur a une action : un echec, ou un dossier rendu. */
  decision?: Observable<unknown>;
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
  const valider = vi.fn((_id: string, _motif: string, _code?: string) =>
    options.decision ?? of({
      success: true,
      data: { ...vu, statut: 'VALIDEE' as const, historique: [evenement('VALIDATION', true)] },
    }),
  );
  const refuser = vi.fn((_id: string, _motif: string) =>
    options.decision ?? of({
      success: true,
      data: { ...vu, statut: 'REFUSEE' as const, historique: [evenement('REFUS', true)] },
    }),
  );
  const mettreEnAnalyse = vi.fn((_id: string, _motif: string) =>
    options.decision ?? of({
      success: true,
      data: { ...vu, statut: 'EN_ANALYSE' as const, historique: [evenement('MISE_EN_VERIFICATION', true)] },
    }),
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

  it('valide avec son motif, reprend le dossier rendu par le serveur et recharge la liste', () => {
    const { component, appels } = monter();
    preparer(component, 'VALIDATION');

    component.confirmer();

    // Une pharmacie n'a pas de code : rien d'autre que le motif ne part.
    expect(appels.valider).toHaveBeenCalledWith('d1', MOTIF, undefined);
    expect(component.demandeOuverte()?.statut).toBe('VALIDEE');
    expect(component.succes()).toBe(
      'ADMIN.AGREMENT_REQUESTS.DONE_VALIDATED ADMIN.AGREMENT_REQUESTS.EMAIL_SENT',
    );
    expect(component.avertissement()).toBeNull();
    expect(component.actionOuverte()).toBeNull();
    // Deux fois : au demarrage, puis apres la decision.
    expect(appels.lister).toHaveBeenCalledTimes(2);
  });

  it('ne valide pas sans motif explicite', () => {
    const { component, appels } = monter();
    preparer(component, 'VALIDATION', 'ok');

    component.confirmer();

    expect(appels.valider).not.toHaveBeenCalled();
    expect(component.erreurMotif()).toBe(true);
  });

  it('met en cours de verification avec son motif, et l action reste possible ensuite', () => {
    const { fixture, component, appels } = monter({ detail: dossier({ statut: 'EN_ANALYSE' }) });
    preparer(component, 'ANALYSE', `  ${MOTIF}  `);

    component.confirmer();
    fixture.detectChanges();

    expect(appels.mettreEnAnalyse).toHaveBeenCalledWith('d1', MOTIF);
    // Le geste se repete : une piece illisible, puis une reference a confirmer.
    const bouton = fixture.nativeElement.querySelector('.bb-demandes__analyse') as HTMLButtonElement;
    expect(bouton.disabled).toBe(false);
  });

  it('dit que le courriel n est pas parti, sans cacher que la decision est prise', () => {
    const { fixture, component } = monter({
      decision: of({
        success: true,
        data: { ...dossier(), statut: 'VALIDEE' as const, historique: [evenement('VALIDATION', false)] },
      }),
    });
    preparer(component, 'VALIDATION');

    component.confirmer();
    fixture.detectChanges();

    expect(component.succes()).toBe('ADMIN.AGREMENT_REQUESTS.DONE_VALIDATED');
    expect(component.avertissement()).toBe('ADMIN.AGREMENT_REQUESTS.EMAIL_NOT_SENT');
    expect(fixture.nativeElement.querySelector('.bb-demandes__history-mail--echec')).not.toBeNull();
  });

  it('ouvre une saisie par action, avec le libelle de cette action', () => {
    const { fixture, component } = monter();
    component.ouvrirDemande('d1');

    for (const action of ['ANALYSE', 'VALIDATION', 'REFUS'] as const) {
      component.ouvrirAction(action);
      fixture.detectChanges();
      const confirmer = fixture.nativeElement.querySelector('.bb-demandes__confirm') as HTMLButtonElement;
      expect(confirmer.textContent).toContain(`ADMIN.AGREMENT_REQUESTS.CONFIRM_${action}`);
      // Rien ne part tant que le motif n'est pas ecrit.
      expect(confirmer.disabled).toBe(true);
    }
    component.annulerAction();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bb-demandes__reason')).toBeNull();
  });

  it('montre l historique, chaque motif et le sort de son courriel', () => {
    const { fixture, component } = monter({
      detail: dossier({
        statut: 'EN_ANALYSE',
        historique: [evenement('MISE_EN_VERIFICATION', true), { ...evenement('REFUS', false), id: 'e2' }],
      }),
    });
    component.ouvrirDemande('d1');
    fixture.detectChanges();

    const lignes = fixture.nativeElement.querySelectorAll('.bb-demandes__history li');
    expect(lignes.length).toBe(2);
    expect(lignes[0].textContent).toContain(MOTIF);
    expect(lignes[0].textContent).toContain('HISTORY_EMAIL_SENT');
    expect(lignes[1].querySelector('.bb-demandes__history-mail--echec')).not.toBeNull();
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
    preparer(component, 'REFUS', 'non');

    component.confirmer();

    expect(appels.refuser).not.toHaveBeenCalled();
    expect(component.erreurMotif()).toBe(true);
  });

  it('transmet le motif tel quel quand il est explicite', () => {
    const { component, appels } = monter();
    preparer(component, 'REFUS', "  L'agrément d'exploitation est expiré.  ");

    component.confirmer();

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
    preparer(component, 'VALIDATION');

    component.confirmer();

    expect(component.erreur()).toContain('déjà été validé');
    expect(component.action()).toBe(false);
    // Le motif reste en place : l'agent n'a pas a le reecrire.
    expect(component.motif()).toBe(MOTIF);
  });
});

describe('examen d une demande d assurance', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    URL.createObjectURL = vi.fn(() => 'blob:apercu');
    URL.revokeObjectURL = vi.fn();
  });

  const assurance = () => dossier({
    type: 'ASSURANCE', nom: 'Sunu Assurances', numeroAgrementCreation: 'D/2009/CAM/LOA/07',
    numeroAgrementExploitation: null, codeAssureur: 'SUNU', modeEchange: 'PORTAIL',
  });

  it('montre le code propose et la reference BCRG, sans arrete d exploitation', () => {
    const { fixture, component } = monter({ detail: assurance() });
    component.ouvrirDemande('d1');
    fixture.detectChanges();

    const texte = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(fixture.nativeElement.querySelector('.bb-demandes__code')?.textContent).toContain('SUNU');
    expect(texte).toContain('AGREMENT.BCRG_LABEL');
    expect(texte).not.toContain('AGREMENT.EXPLOITATION_LABEL');
  });

  it('pre-remplit le code a la validation, et ne l envoie que s il est corrige', () => {
    const { fixture, component, appels } = monter({ detail: assurance() });
    preparer(component, 'VALIDATION');
    fixture.detectChanges();

    const champ = fixture.nativeElement.querySelector('#demande-code') as HTMLInputElement;
    expect(champ).not.toBeNull();
    expect(component.codeCorrige()).toBe('SUNU');

    component.confirmer();
    expect(appels.valider).toHaveBeenLastCalledWith('d1', MOTIF, undefined);
  });

  it('envoie le code corrige, en majuscules', () => {
    const { component, appels } = monter({ detail: assurance() });
    preparer(component, 'VALIDATION');
    component.codeCorrige.set('sunu-gn');

    component.confirmer();

    expect(appels.valider).toHaveBeenCalledWith('d1', MOTIF, 'SUNU-GN');
  });

  it('bloque la validation sur un code mal forme', () => {
    const { fixture, component, appels } = monter({ detail: assurance() });
    preparer(component, 'VALIDATION');
    component.codeCorrige.set('SU NU');
    fixture.detectChanges();

    const confirmer = fixture.nativeElement.querySelector('.bb-demandes__confirm') as HTMLButtonElement;
    expect(confirmer.disabled).toBe(true);
    component.confirmer();
    expect(appels.valider).not.toHaveBeenCalled();
  });

  it('ne demande pas de code pour mettre en verification ou refuser', () => {
    const { fixture, component } = monter({ detail: assurance() });
    preparer(component, 'ANALYSE');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#demande-code')).toBeNull();
  });
});
