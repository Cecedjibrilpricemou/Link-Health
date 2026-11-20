// Le patient devant une proposition partielle.
//
// Une pharmacie n'a qu'une partie des produits et le propose. Le patient voit
// ce qu'elle a, ce qui manque, et jusqu'a quand repondre ; il choisit
// d'accepter et de faire chercher le reste ailleurs, d'accepter seul, ou de
// refuser. Rien n'est servi ni paye sans sa reponse.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { CommandeView, PropositionPartielleView } from '@baobaoheath/shared-types';

import { PatientCommandesComponent } from './commandes.component';
import { PatientService } from '../../../core/services/patient.service';
import { CourseService } from '../../../core/services/course.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

const PROPOSITION: PropositionPartielleView = {
  disponibles: [
    { idLigneOrdonnance: 'lo-1', libelle: 'Doliprane 500mg', quantite: 2 },
    { idLigneOrdonnance: 'lo-2', libelle: 'Clamoxyl 500mg', quantite: 1 },
  ],
  manquants: [{ idLigneOrdonnance: 'lo-3', libelle: 'Morphine 10mg', quantite: 1 }],
  proposeeLe: '2026-11-20T09:00:00.000Z',
  expireLe: '2026-11-20T11:00:00.000Z',
  choix: null,
  choixLe: null,
};

function commande(etat: Partial<CommandeView> = {}): CommandeView {
  return {
    id: 'cmd-1', statut: 'ATTENTE_ACCORD_PATIENT', creeLe: '2026-11-20T08:00:00.000Z',
    numeroOrdonnance: 'OR-2026-000001', patient: { id: 'p', prenom: 'Fanta', nom: 'Camara' },
    pharmacie: { id: 'ph-1', nom: 'Pharmacie Nounie', quartier: 'Kipe' },
    lignes: [], reponses: [], propositionPartielle: PROPOSITION,
    ...etat,
  } as CommandeView;
}

function monter(commandes: CommandeView[]) {
  const repondrePropositionPartielle = vi.fn((_id: string, _r: string) => of({ success: true, data: commandes[0] }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PatientCommandesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: PatientService,
        useValue: { mesCommandes: () => of({ success: true, data: commandes }), repondrePropositionPartielle },
      },
      { provide: CourseService, useValue: { offresCommande: () => of({ success: true, data: [] }) } },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(PatientCommandesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, repondrePropositionPartielle };
}

describe('patient : une pharmacie propose une partie', () => {
  it('montre ce qui est disponible, ce qui manque, et l heure limite', () => {
    const { el } = monter([commande()]);
    const bloc = el.querySelector('.bb-cmd__partiel')!;

    expect(bloc).not.toBeNull();
    expect(bloc.textContent).toContain('Pharmacie Nounie');
    const listes = bloc.querySelectorAll('.bb-cmd__lignes');
    expect(listes[0]!.textContent).toContain('Doliprane 500mg');
    expect(listes[0]!.textContent).toContain('Clamoxyl 500mg');
    expect(listes[1]!.textContent).toContain('Morphine 10mg');
    expect(bloc.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it.each(['ACCEPTER_ET_RELANCER', 'ACCEPTER_SEUL', 'REFUSER'] as const)('transmet le choix %s', (reponse) => {
    const { el, repondrePropositionPartielle } = monter([commande()]);
    (el.querySelector(`[data-reponse="${reponse}"]`) as HTMLButtonElement).click();
    expect(repondrePropositionPartielle).toHaveBeenCalledWith('cmd-1', reponse);
  });

  it('ne montre pas la liste habituelle par-dessus la proposition', () => {
    const { el } = monter([commande({ lignes: [{ id: 'lo-1', libelle: 'Doliprane 500mg', quantite: 2 }] as CommandeView['lignes'] })]);
    const carte = el.querySelector('.bb-cmd__carte--mienne')!;
    // Les seules listes de la carte sont celles de la proposition.
    expect(carte.querySelectorAll('.bb-cmd__lignes').length).toBe(2);
  });

  // Trouve a l'essai reel : le choix retrait / livraison s'affichait avant
  // l'accord, alors que le serveur le refuse tant que le patient n'a pas repondu.
  it('ne demande ni le mode de remise ni le compte de boites avant la reponse', () => {
    const { el } = monter([commande()]);
    const carte = el.querySelector('.bb-cmd__carte--mienne')!;
    expect(carte.querySelector('.bb-cmd__question')).toBeNull();
    expect(carte.querySelector('.bb-cmd__boites')).toBeNull();
  });

  it('rappelle, une fois accepte, combien de produits manquent et ce qu il en advient', () => {
    const { el } = monter([commande({
      statut: 'PRISE_EN_CHARGE', propositionPartielle: { ...PROPOSITION, choix: 'ACCEPTE_ET_RELANCE' },
    })]);
    expect(el.querySelector('.bb-cmd__partiel')).toBeNull();
    expect(el.textContent).toMatch(/1 produit/);
  });

  it('nomme la commande d origine d un reliquat', () => {
    const { el } = monter([commande({
      statut: 'RECHERCHE_PHARMACIE', propositionPartielle: null, numeroCommandeOrigine: 'CM-2026-000001',
    })]);
    expect(el.querySelector('.bb-cmd__reliquat')?.textContent).toContain('CM-2026-000001');
  });

  it('dit pourquoi une commande cherche encore apres un delai depasse', () => {
    const { el } = monter([commande({
      statut: 'RECHERCHE_PHARMACIE', propositionPartielle: { ...PROPOSITION, choix: 'EXPIRE' },
    })]);
    expect(el.textContent).toContain((fr as Record<string, any>)['PATIENT']['COMMANDES']['PARTIEL_RETOUR_EXPIRE']);
  });

  it.each([['fr', fr], ['en', en]] as const)('%s porte les textes de la proposition', (_l, catalogue) => {
    const c = (catalogue as Record<string, any>)['PATIENT']['COMMANDES'];
    for (const cle of ['ETAT_ATTENTE_ACCORD_PATIENT', 'UNE_PARTIE', 'RELIQUAT', 'PARTIEL_TITRE', 'PARTIEL_DISPONIBLES',
      'PARTIEL_MANQUANTS', 'PARTIEL_DELAI', 'PARTIEL_ACCEPTER_RELANCER', 'PARTIEL_ACCEPTER_SEUL', 'PARTIEL_REFUSER',
      'PARTIEL_RELANCE_NOTE', 'PARTIEL_SEUL_NOTE']) {
      expect(c[cle], cle).toBeTruthy();
    }
  });
});
