// Delivrance d'une ordonnance au comptoir : l'ecran qui remet un medicament
// a un patient. Il n'etait couvert que par les parcours Playwright.
//
// Ce qui est verifie ici : ce qui protege le patient (allergie, motif d'un
// refus ou d'une substitution, produit substitue different du prescrit) et
// ce qui protege la caisse (quantite restante, pas de double envoi).
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { OrdonnancesComponent } from './ordonnances.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';

const PATIENT = { id: 'p1', prenom: 'Aïssatou', nom: 'Diallo', qrCode: 'QR-1', dateNaissance: '1990-01-01' };
const AMOX = { id: 'amox', libelle: 'Amoxicilline 500 mg', dci: 'amoxicilline', nomCommercial: null, prixUnitaireGnf: 5000 };
const ligne = (extra: Record<string, unknown> = {}) => ({
  id: 'l1', medicament: AMOX, quantite: 10, resteAServir: 7, alerteAllergie: false, ...extra,
});
const ORDONNANCE = { id: 'o1', numero: 'ORD-1', lignes: [ligne()] };

function monter() {
  const appels: Record<string, unknown[]> = {
    scan: [], delivrer: [], substituer: [], refuser: [], verifier: [],
  };
  let reponseDelivrance: Subject<unknown> | null = null;
  const reseau = { lent: false };
  const pharma = {
    getMedicaments: () => of({ success: true, data: [AMOX, { id: 'clam', libelle: 'Clamoxyl 500 mg', dci: 'amoxicilline' }] }),
    getOrdonnancesEnAttente: () => of({ success: true, data: [] }),
    scanQrCode: (qr: string) => {
      appels['scan'].push(qr);
      return reseau.lent ? new Subject() : of({ success: true, data: { patient: PATIENT, ordonnances: [ORDONNANCE] } });
    },
    delivrerOrdonnance: (id: string, dto: unknown) => {
      appels['delivrer'].push({ id, dto });
      reponseDelivrance = new Subject();
      return reponseDelivrance;
    },
    substituerLigne: (id: string, dto: unknown) => { appels['substituer'].push({ id, dto }); return of({ success: true }); },
    refuserLigne: (id: string, motif: string) => { appels['refuser'].push({ id, motif }); return of({ success: true }); },
    verifierOrdonnance: (dto: unknown) => {
      appels['verifier'].push(dto);
      const bon = (dto as { codeVerification: string }).codeVerification === 'BON';
      return of({ success: true, data: bon ? { valide: true, patient: PATIENT, ordonnance: ORDONNANCE } : { valide: false } });
    },
    renouvelerOrdonnance: () => of({ success: true }),
  };
  TestBed.configureTestingModule({
    imports: [OrdonnancesComponent],
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: PharmacienService, useValue: pharma }],
  });
  TestBed.overrideComponent(OrdonnancesComponent, { set: { template: '' } });
  // Angular appelle ngOnInit lui-meme : l'appeler a la main abonnait deux fois.
  const fixture = TestBed.createComponent(OrdonnancesComponent);
  fixture.detectChanges();
  const c = fixture.componentInstance;
  const repondre = (data: unknown) => { reponseDelivrance!.next({ success: true, data }); reponseDelivrance!.complete(); };
  return { c, appels, repondre, reseau };
}

describe('ordonnances pharmacien : délivrance au comptoir', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('préremplit ce qu’il reste à servir, pas la quantité prescrite', () => {
    const { c } = monter();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    expect(c.quantiteDelivree).toBe(7);
  });

  it('refuse de délivrer une ligne en alerte d’allergie', () => {
    const { c, appels } = monter();
    c.selectionner(ORDONNANCE as never, ligne({ alerteAllergie: true }) as never);
    expect(c.peutValider()).toBe(false);
    c.valider();
    expect(appels['delivrer']).toEqual([]);
  });

  it('délivre avec le mode de paiement et la quantité choisis', () => {
    const { c, appels } = monter();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    c.modePaiement = 'ORANGE_MONEY';
    c.quantiteDelivree = 3;
    c.valider();
    expect(appels['delivrer']).toEqual([{ id: 'l1', dto: { modePaiement: 'ORANGE_MONEY', quantiteDelivree: 3 } }]);
  });

  it('n’envoie pas deux fois la même délivrance (double clic)', () => {
    const { c, appels } = monter();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    c.valider();
    c.valider();
    expect(appels['delivrer'].length).toBe(1);
  });

  it('après la délivrance, relit le patient sans vider l’écran', () => {
    const { c, appels, repondre, reseau } = monter();
    c.qrCode = 'QR-1';
    c.scan();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    c.valider();
    expect(c.patient()).not.toBeNull();          // pendant l'envoi
    reseau.lent = true;                          // la relecture prend du temps
    repondre({ montantGnf: 35000 });
    expect(appels['scan']).toEqual(['QR-1', 'QR-1']);
    // Pendant la relecture, le patient et le message de confirmation restent :
    // un ecran vide une fraction de seconde effacait la confirmation.
    expect(c.patient()).not.toBeNull();
    expect(c.ordonnances().length).toBe(1);
    expect(c.selected()).toBeNull();
    expect(c.successMessage()).not.toBe('');
  });

  it('un refus exige un motif d’au moins 5 caractères', () => {
    const { c, appels } = monter();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    c.choisirGeste('REFUSER');
    c.motif.set('non');
    expect(c.peutValider()).toBe(false);
    c.valider();
    expect(appels['refuser']).toEqual([]);
    c.motif.set('  Rupture chez le grossiste  ');
    c.valider();
    expect(appels['refuser']).toEqual([{ id: 'l1', motif: 'Rupture chez le grossiste' }]);
  });

  it('une substitution exige un produit et un motif', () => {
    const { c, appels } = monter();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    c.choisirGeste('SUBSTITUER');
    c.motif.set('Équivalent disponible');
    expect(c.peutValider()).toBe(false);          // pas de produit choisi
    c.idSubstitut.set('clam');
    c.quantiteDelivree = 7;
    c.valider();
    expect(appels['substituer']).toEqual([{ id: 'l1', dto: { idMedicamentDelivre: 'clam', quantiteDelivree: 7, motif: 'Équivalent disponible' } }]);
  });

  it('ne propose jamais le produit prescrit comme substitut', () => {
    const { c } = monter();
    c.selectionner(ORDONNANCE as never, ligne() as never);
    expect(c.optionsSubstituts().map((o) => o.valeur)).toEqual(['clam']);
  });

  it('un numéro avec un mauvais code n’ouvre aucun dossier', () => {
    const { c } = monter();
    c.numeroSaisi = 'ORD-1';
    c.codeSaisi = 'FAUX';
    c.verifier();
    c.ouvrirDepuisVerification();
    expect(c.patient()).toBeNull();
    c.codeSaisi = 'BON';
    c.verifier();
    c.ouvrirDepuisVerification();
    expect(c.patient()?.id).toBe('p1');
  });

  it('affiche l’erreur de l’API quand la délivrance est refusée', () => {
    const { c } = monter();
    const pharma = TestBed.inject(PharmacienService) as unknown as { delivrerOrdonnance: unknown };
    pharma.delivrerOrdonnance = () => throwError(() => ({ error: { error: 'Stock insuffisant' } }));
    c.selectionner(ORDONNANCE as never, ligne() as never);
    c.valider();
    expect(c.errorMessage()).toBe('Stock insuffisant');
    expect(c.isDelivering()).toBe(false);
  });
});
