// Caisse : ce qui touche a l'argent. Le verrouillage du panier sans session
// a son propre test (caisse.component.spec.ts).
//
// Montant juste, jamais plus que le stock, pas de vente reglementee sans
// ordonnance, pas de double encaissement, pas de cloture avec un ecart non
// explique, et une annulation que seul le titulaire peut forcer.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { CaisseComponent } from './caisse.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';

const SESSION = {
  id: 's1', statut: 'OUVERTE', montantOuvertureGnf: 50000, montantTheoriqueGnf: 87035,
  montantEspecesEncaisseGnf: 0, montantOrangeMoneyGnf: 0, montantMtnMomoGnf: 0, montantCompteGnf: null, ecartGnf: null,
  motifEcart: null, nombreVentesPayees: 0, nombreVentesEnAttente: 0, nombreVentesAnnulees: 0,
  ouverteLe: new Date().toISOString(), clotureeLe: null, utilisateur: { prenom: 'Mariama', nom: 'Bah' },
};
const stock = (id: string, prix: number, marge: number, quantite: number, reglemente = false) => ({
  id: 's-' + id, quantite, seuilAlerte: 2, unite: 'boite', margeGnf: marge,
  medicament: { id, libelle: id.toUpperCase(), prixUnitaireGnf: prix, estReglemente: reglemente, dci: null, nomCommercial: null },
});
const STOCKS = [stock('para', 5000, 500, 10), stock('morph', 20000, 0, 3, true)];
const VENTE = { id: 'v1', numero: 'V-1', statut: 'PAYEE', montantPatientGnf: 11000 };

function monter() {
  const appels: Record<string, unknown[]> = { vente: [], stocks: [], annulation: [], cloture: [] };
  let reponseVente: Subject<unknown> | null = null;
  let refusAnnulation = true;
  const pharma = {
    getStocks: () => { appels['stocks'].push(1); return of({ success: true, data: STOCKS }); },
    getVentes: () => of({ success: true, data: [] }),
    getSessionCaisse: () => of({ success: true, data: SESSION }),
    enregistrerVente: (dto: unknown) => { appels['vente'].push(dto); reponseVente = new Subject(); return reponseVente; },
    annulerVente: (id: string, dto: { autorisationTitulaire?: unknown }) => {
      appels['annulation'].push(dto);
      // La premiere tentative d'un agent est refusee : il faut le titulaire.
      if (refusAnnulation && !dto.autorisationTitulaire) return throwError(() => ({ status: 403, error: { error: 'Titulaire requis' } }));
      return of({ success: true });
    },
    cloturerSessionCaisse: (id: string, dto: unknown) => { appels['cloture'].push(dto); return of({ success: true, data: SESSION }); },
  };
  TestBed.configureTestingModule({
    imports: [CaisseComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PharmacienService, useValue: pharma },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  TestBed.overrideComponent(CaisseComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(CaisseComponent);
  fixture.detectChanges();
  const c = fixture.componentInstance;
  const panier = (...lignes: [string, number][]) => {
    lignes.forEach(([id, q], i) => {
      if (i > 0) c.ajouterLigne();
      c.lignes()[i].idMedicament.set(id);
      c.lignes()[i].quantite.set(q);
    });
  };
  const repondreVente = (data: unknown) => { reponseVente!.next({ success: true, data }); reponseVente!.complete(); };
  return { c, appels, panier, repondreVente, autoriserSansTitulaire: () => { refusAnnulation = false; } };
}

describe('caisse : montants et encaissement', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('calcule le montant : (prix de référence + marge) × quantité', () => {
    const { c, panier } = monter();
    panier(['para', 2], ['morph', 1]);
    expect(c.montantBrut()).toBe((5000 + 500) * 2 + 20000);
  });

  it('ne vend pas plus que le stock', () => {
    const { c, panier, appels } = monter();
    panier(['para', 11]);
    expect(c.depassements()).toEqual(['PARA (10 en stock)']);
    expect(c.peutEncaisser()).toBe(false);
    c.encaisser();
    expect(appels['vente']).toEqual([]);
  });

  it('le mobile money exige le numéro de l’opérateur', () => {
    const { c, panier, appels } = monter();
    panier(['para', 1]);
    c.modePaiement.set('ORANGE_MONEY');
    expect(c.peutEncaisser()).toBe(false);
    c.numeroOperateur.set(' 620000111 ');
    c.encaisser();
    expect(appels['vente']).toEqual([{ lignes: [{ idMedicament: 'para', quantite: 1 }], modePaiement: 'ORANGE_MONEY', numeroOperateur: '620000111' }]);
  });

  it('un produit réglementé ne sort pas sans ordonnance', () => {
    const { c, panier, appels } = monter();
    panier(['morph', 1]);
    expect(c.exigentOrdonnance()).toEqual(['MORPH']);
    expect(c.peutEncaisser()).toBe(false);
    c.idOrdonnance.set('ord-42');
    c.encaisser();
    expect(appels['vente']).toEqual([expect.objectContaining({ idOrdonnance: 'ord-42' })]);
  });

  it('n’encaisse pas deux fois sur un double clic', () => {
    const { c, panier, appels } = monter();
    panier(['para', 1]);
    c.encaisser();
    c.encaisser();
    expect(appels['vente'].length).toBe(1);
  });

  it('relit le stock après la vente et vide le panier', () => {
    const { c, panier, appels, repondreVente } = monter();
    panier(['para', 2]);
    const lectures = appels['stocks'].length;
    c.encaisser();
    repondreVente(VENTE);
    expect(appels['stocks'].length).toBe(lectures + 1);
    expect(c.lignes().length).toBe(1);
    expect(c.lignes()[0].idMedicament()).toBe('');
  });

  it('une vente mobile en attente montre le paiement à faire, pas un succès', () => {
    const { c, panier, repondreVente } = monter();
    panier(['para', 2]);
    c.modePaiement.set('MTN_MOMO');
    c.numeroOperateur.set('664000222');
    c.encaisser();
    repondreVente({ ...VENTE, statut: 'EN_ATTENTE', urlPaiement: 'https://paiement.example/v1' });
    expect(c.attente()?.id).toBe('v1');
    expect(c.montantAPayer()).toBe(11000);
  });
});

describe('caisse : clôture et annulation', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('clôture sans motif quand le compte est juste, en exige un en cas d’écart', () => {
    const { c } = monter();
    c.clotureMontant.set(87035);
    expect(c.peutCloturer()).toBe(true);
    c.clotureMontant.set(85000);
    expect(c.peutCloturer()).toBe(false);
    c.motifEcart.set('Rendu de monnaie erroné');
    expect(c.peutCloturer()).toBe(true);
  });

  it('une annulation exige un motif', () => {
    const { c, appels } = monter();
    c.demanderAnnulation(VENTE as never);
    c.motifAnnulation.set('non');
    c.confirmerAnnulation();
    expect(appels['annulation']).toEqual([]);
  });

  it('refusée à l’agent, elle demande le titulaire, puis efface son mot de passe', () => {
    const { c, appels } = monter();
    c.demanderAnnulation(VENTE as never);
    c.motifAnnulation.set('Erreur de produit');
    c.confirmerAnnulation();
    expect(c.validationTitulaireRequise()).toBe(true);   // 403 -> titulaire
    c.confirmerAnnulation();                             // sans identifiants
    expect(appels['annulation'].length).toBe(1);
    c.telephoneTitulaire.set(' 620000999 ');
    c.motDePasseTitulaire.set('Secret-Titulaire-1');
    c.confirmerAnnulation();
    expect(appels['annulation'][1]).toEqual({
      motif: 'Erreur de produit',
      autorisationTitulaire: { telephone: '620000999', motDePasse: 'Secret-Titulaire-1' },
    });
    expect(c.motDePasseTitulaire()).toBe('');
    expect(c.annulationVente()).toBeNull();
  });
});
