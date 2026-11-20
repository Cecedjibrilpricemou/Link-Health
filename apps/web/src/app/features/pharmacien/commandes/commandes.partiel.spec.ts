// Le stock verifie a l'arrivee d'une commande, et la prise partielle.
//
// **Le defaut que ce fichier empeche de revenir** : le pharmacien repondait
// « j'ai tout » de memoire, apres avoir fouille ses rayons, et ne pouvait que
// refuser une commande dont il n'avait qu'une partie.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { CommandeView, DisponibiliteCommandeView } from '@baobaoheath/shared-types';

import { PharmacienCommandesComponent } from './commandes.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { CourseService } from '../../../core/services/course.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

const LIGNES = [
  { id: 'lo-1', libelle: 'Doliprane 500mg', quantite: 2 },
  { id: 'lo-2', libelle: 'Clamoxyl 500mg', quantite: 1 },
  { id: 'lo-3', libelle: 'Morphine 10mg', quantite: 1 },
] as CommandeView['lignes'];

const PARTIELLE: DisponibiliteCommandeView = {
  etat: 'PARTIELLE', disponibles: 2, total: 3,
  lignes: [
    { idLigneOrdonnance: 'lo-1', libelle: 'Doliprane 500mg', quantiteDemandee: 2, quantiteEnStock: 40, etat: 'DISPONIBLE', equivalents: [] },
    { idLigneOrdonnance: 'lo-2', libelle: 'Clamoxyl 500mg', quantiteDemandee: 1, quantiteEnStock: 6, etat: 'DISPONIBLE', equivalents: [] },
    {
      idLigneOrdonnance: 'lo-3', libelle: 'Morphine 10mg', quantiteDemandee: 1, quantiteEnStock: 0, etat: 'ABSENT',
      equivalents: [{ idMedicament: 'm9', libelle: 'Skenan 10mg', quantiteEnStock: 3 }],
    },
  ],
};

function appel(etat: Partial<CommandeView> = {}): CommandeView {
  return {
    id: 'cmd-1', statut: 'RECHERCHE_PHARMACIE', creeLe: '2026-11-20T08:00:00.000Z',
    numeroOrdonnance: 'OR-2026-000001', patient: { id: 'p-1', prenom: 'Fanta', nom: 'Camara' },
    lignes: LIGNES, reponses: [], disponibilite: PARTIELLE,
    ...etat,
  } as CommandeView;
}

function monter(commandes: CommandeView[]) {
  const proposerPrisePartielle = vi.fn((_id: string, _lignes: string[]) => of({ success: true, data: commandes[0] }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PharmacienCommandesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: PharmacienService,
        useValue: {
          commandesDeLaPharmacie: () => of({ success: true, data: commandes }),
          proposerPrisePartielle,
          repondreDisponibilite: vi.fn(() => of({ success: true, data: commandes[0] })),
        },
      },
      { provide: CourseService, useValue: {} },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(PharmacienCommandesComponent);
  fixture.detectChanges();
  const rendre = () => { fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };
  return { c: fixture.componentInstance, rendre, proposerPrisePartielle };
}

describe('pharmacie : le stock verifie a l arrivee de la commande', () => {
  it('dit d un coup d oeil combien de produits elle a', () => {
    const el = monter([appel()]).rendre();
    const bilan = el.querySelector('.bb-cmd__stock')!;
    expect(bilan.getAttribute('data-etat')).toBe('PARTIELLE');
    expect(bilan.textContent).toContain('2');
  });

  it('dit ligne par ligne ce qui est en stock, et ce qui manque', () => {
    const el = monter([appel()]).rendre();
    const etats = [...el.querySelectorAll('.bb-cmd__carte--appel .bb-cmd__stock-ligne')].map((e) => e.getAttribute('data-etat'));
    expect(etats).toEqual(['DISPONIBLE', 'DISPONIBLE', 'ABSENT']);
  });

  // Signale, jamais substitue : la substitution se decide avec le patient.
  it('signale un equivalent qu elle detient', () => {
    const el = monter([appel()]).rendre();
    expect(el.querySelector('.bb-cmd__equivalent')?.textContent).toContain('Skenan 10mg');
  });

  it('ne montre rien quand le stock n a pas ete verifie', () => {
    const el = monter([appel({ disponibilite: undefined })]).rendre();
    expect(el.querySelector('.bb-cmd__stock')).toBeNull();
  });
});

describe('pharmacie : proposer une partie', () => {
  it('coche d avance ce que le stock dit disponible', () => {
    const { c } = monter([appel()]);
    c.ouvrirProposition(appel());
    expect([...c.lignesChoisies()]).toEqual(['lo-1', 'lo-2']);
    expect(c.peutProposer()).toBe(true);
  });

  it('envoie les lignes cochees, dans l ordre de l ordonnance', () => {
    const { c, proposerPrisePartielle } = monter([appel()]);
    c.ouvrirProposition(appel());
    c.basculerLigne('lo-1');
    c.basculerLigne('lo-1');

    c.confirmerProposition();

    expect(proposerPrisePartielle).toHaveBeenCalledWith('cmd-1', ['lo-1', 'lo-2']);
  });

  // Rien coche : ce n'est pas une proposition. Tout coche : c'est une prise
  // complete, qui a son propre bouton.
  it('refuse une proposition vide ou complete', () => {
    const { c, proposerPrisePartielle } = monter([appel()]);
    c.ouvrirProposition(appel());
    c.basculerLigne('lo-1');
    c.basculerLigne('lo-2');
    expect(c.peutProposer()).toBe(false);

    c.basculerLigne('lo-1');
    c.basculerLigne('lo-2');
    c.basculerLigne('lo-3');
    expect(c.peutProposer()).toBe(false);

    c.confirmerProposition();
    expect(proposerPrisePartielle).not.toHaveBeenCalled();
  });

  it('n offre pas de partie sur une commande d un seul produit', () => {
    const el = monter([appel({ lignes: [LIGNES[0]!] })]).rendre();
    expect(el.querySelector('.bb-cmd__partiel')).toBeNull();
  });

  it('dit, sur la commande reservee, jusqu a quand le patient peut repondre', () => {
    const el = monter([appel({
      statut: 'ATTENTE_ACCORD_PATIENT', estLaMienne: true, disponibilite: undefined,
      propositionPartielle: {
        disponibles: [], manquants: [], proposeeLe: '2026-11-20T09:00:00.000Z',
        expireLe: '2026-11-20T11:00:00.000Z', choix: null, choixLe: null,
      },
    })]).rendre();
    const notes = [...el.querySelectorAll('.bb-cmd__carte--mienne .bb-cmd__note')].map((n) => n.textContent ?? '');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/\d{2}:\d{2}/);
  });

  it.each([['fr', fr], ['en', en]] as const)('%s porte les textes du stock et de la proposition', (_l, catalogue) => {
    const c = (catalogue as Record<string, any>)['PHARMACIEN']['COMMANDES'];
    for (const cle of ['PARTIEL', 'STOCK_COMPLETE', 'STOCK_PARTIELLE', 'STOCK_AUCUNE', 'LIGNE_DISPONIBLE',
      'LIGNE_INSUFFISANT', 'LIGNE_ABSENT', 'EQUIVALENT', 'PARTIEL_TITRE', 'PARTIEL_TEXTE', 'PARTIEL_AIDE',
      'PARTIEL_CONFIRMER', 'PARTIEL_OK', 'ATTEND_ACCORD', 'ETAT_ATTENTE_ACCORD_PATIENT']) {
      expect(c[cle], cle).toBeTruthy();
    }
  });
});
