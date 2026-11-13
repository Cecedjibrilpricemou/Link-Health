// core/services/pharmacien.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { PharmacieStock, MedicamentInfo, OrdonnanceDelivrance, DelivrancePayload } from '../models/pharmacien.model';
import { ApiResponse } from '../models/api.model';
import type {
  DefinirHorairesDto,
  HorairesOfficineView,
  CommandeView,
  AnnulerVenteDto,
  CreateProduitOfficineDto,
  UpdateProduitOfficineDto,
  CategorieProduit,
  CarteAssuranceVerifieeView,
  PriseEnChargeView,
  ApprovisionnementView,
  CreerVenteDto,
  TableauDeBordOfficineView,
  VenteComptoirView,
  CreerApprovisionnementDto,
  LotStockView,
  PeremptionProcheView,
  OrdonnanceEnAttenteView,
  VerificationOrdonnanceView,
  VerifierOrdonnanceDto,
  SessionCaisseView,
  RapportCaisseView,
  AjusterLotStockDto,
  AjustementLotStockView,
  MouvementStockView,
} from '@baobaoheath/shared-types';

@Injectable({ providedIn: 'root' })
export class PharmacienService {
  private api = inject(ApiService);

  /** Ordonnances en attente des patients de la prefecture de la pharmacie. */
  getOrdonnancesEnAttente(): Observable<ApiResponse<OrdonnanceEnAttenteView[]>> {
    return this.api.get<ApiResponse<OrdonnanceEnAttenteView[]>>('/pharmacien/ordonnances');
  }

  scanQrCode(code: string): Observable<ApiResponse<OrdonnanceDelivrance>> {
    return this.api.get<ApiResponse<OrdonnanceDelivrance>>(`/pharmacien/scan/${code}`);
  }

  /**
   * EF-07-01 : controle d'une ordonnance papier, sans le QR du patient. La
   * reponse peut etre un refus motive (non signee, expiree, deja servie) : ce
   * n'est pas une erreur HTTP, le comptoir doit l'afficher tel quel.
   */
  verifierOrdonnance(dto: VerifierOrdonnanceDto): Observable<ApiResponse<VerificationOrdonnanceView>> {
    return this.api.post<ApiResponse<VerificationOrdonnanceView>>('/pharmacien/ordonnances/verifier', dto);
  }

  /**
   * Substituer un produit (EF-07-04).
   *
   * Le motif part avec : c'est le prescripteur qui le lira, et une
   * substitution muette est une modification de traitement decidee par
   * quelqu'un qui n'a pas vu le patient.
   */
  substituerLigne(
    idLigne: string,
    payload: { idMedicamentDelivre: string; quantiteDelivree?: number; motif: string },
  ): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>(`/pharmacien/ordonnances/${idLigne}/substituer`, payload);
  }

  /** Refuser une ligne (EF-07-05). Rien ne sort du stock, et on dit pourquoi. */
  refuserLigne(idLigne: string, motif: string): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>(`/pharmacien/ordonnances/${idLigne}/refuser`, { motif });
  }

  delivrerOrdonnance(idOrdonnance: string, payload: DelivrancePayload): Observable<ApiResponse<OrdonnanceDelivrance>> {
    return this.api.post<ApiResponse<OrdonnanceDelivrance>>(`/pharmacien/ordonnances/${idOrdonnance}/delivrer`, payload);
  }

  /**
   * EF-05-09 : ouvrir le cycle suivant. Le numero et le code ne changent pas —
   * c'est le meme papier que le patient represente.
   */
  renouvelerOrdonnance(idOrdonnance: string): Observable<ApiResponse<{ statut: string; renouvellementsRestants: number }>> {
    return this.api.post<ApiResponse<{ statut: string; renouvellementsRestants: number }>>(
      `/pharmacien/ordonnances/${idOrdonnance}/renouveler`, {}
    );
  }

  getStocks(): Observable<ApiResponse<PharmacieStock[]>> {
    return this.api.get<ApiResponse<PharmacieStock[]>>('/pharmacien/stocks');
  }

  /**
   * Le catalogue, pas le stock. L'API rend des medicaments a plat ; cette
   * methode annoncait `PharmacieStock[]` jusqu'au 2026-09-30, et tout
   * appelant qui lisait `m.medicament` recevait `undefined` sans erreur.
   */
  getMedicaments(): Observable<ApiResponse<MedicamentInfo[]>> {
    return this.api.get<ApiResponse<MedicamentInfo[]>>('/pharmacien/medicaments');
  }

  creerProduitOfficine(dto: CreateProduitOfficineDto): Observable<ApiResponse<MedicamentInfo>> {
    return this.api.post<ApiResponse<MedicamentInfo>>('/pharmacien/catalogue-local', dto);
  }

  modifierProduitOfficine(id: string, dto: UpdateProduitOfficineDto): Observable<ApiResponse<MedicamentInfo>> {
    return this.api.patch<ApiResponse<MedicamentInfo>>(`/pharmacien/catalogue-local/${id}`, dto);
  }

  desactiverProduitOfficine(id: string): Observable<ApiResponse<void>> {
    return this.api.delete<ApiResponse<void>>(`/pharmacien/catalogue-local/${id}`);
  }

  reapprovisionner(payload: Record<string, unknown>): Observable<ApiResponse<PharmacieStock>> {
    return this.api.post<ApiResponse<PharmacieStock>>('/pharmacien/stocks/reapprovisionner', payload);
  }

  ajusterLotStock(idLot: string, dto: AjusterLotStockDto): Observable<ApiResponse<AjustementLotStockView>> {
    return this.api.post<ApiResponse<AjustementLotStockView>>(
      `/pharmacien/stocks/lots/${idLot}/ajuster`, dto);
  }

  getMouvementsStock(limite = 100): Observable<ApiResponse<MouvementStockView[]>> {
    return this.api.get<ApiResponse<MouvementStockView[]>>(
      '/pharmacien/stocks/mouvements', { limite: String(limite) });
  }

  // ── Approvisionnement et peremptions (addendum, points 1.3 et 1.4) ──

  /** Enregistre une facture : chaque ligne devient un lot. */
  enregistrerApprovisionnement(dto: CreerApprovisionnementDto): Observable<ApiResponse<ApprovisionnementView>> {
    return this.api.post<ApiResponse<ApprovisionnementView>>('/pharmacien/approvisionnements', dto);
  }

  getApprovisionnements(): Observable<ApiResponse<ApprovisionnementView[]>> {
    return this.api.get<ApiResponse<ApprovisionnementView[]>>('/pharmacien/approvisionnements');
  }

  /** Les horaires de l'officine, avec l'etat d'ouverture du moment. */
  getHoraires(): Observable<ApiResponse<HorairesOfficineView>> {
    return this.api.get<ApiResponse<HorairesOfficineView>>('/pharmacien/horaires');
  }

  /** Reserve au titulaire : le public s'en sert pour se deplacer. */
  definirHoraires(dto: DefinirHorairesDto): Observable<ApiResponse<HorairesOfficineView>> {
    return this.api.put<ApiResponse<HorairesOfficineView>>('/pharmacien/horaires', dto);
  }

  /** Les lots qui approchent de leur date, ou l'ont depassee. */
  getPeremptions(jours?: number): Observable<ApiResponse<PeremptionProcheView[]>> {
    return this.api.get<ApiResponse<PeremptionProcheView[]>>(
      '/pharmacien/peremptions', jours ? { jours: String(jours) } : undefined);
  }

  /** Les lots d'un produit, du plus proche de sa peremption au plus lointain. */
  getLots(idMedicament: string): Observable<ApiResponse<LotStockView[]>> {
    return this.api.get<ApiResponse<LotStockView[]>>(`/pharmacien/medicaments/${idMedicament}/lots`);
  }

  // ── Vente au comptoir et tableau de bord (addendum, points 1.1 et 1.2) ──

  /** Enregistre une vente. Payee sur place : il n'y a pas d'etat intermediaire. */
  enregistrerVente(dto: CreerVenteDto): Observable<ApiResponse<VenteComptoirView>> {
    return this.api.post<ApiResponse<VenteComptoirView>>('/pharmacien/ventes', dto);
  }

  /**
   * Où en est le paiement du client ?
   *
   * Le serveur interroge la passerelle au passage : le pharmacien a le client
   * devant lui et ne peut pas attendre un rappel qui peut ne jamais arriver.
   */
  rafraichirPaiement(idVente: string): Observable<ApiResponse<VenteComptoirView>> {
    return this.api.get<ApiResponse<VenteComptoirView>>(`/pharmacien/ventes/${idVente}/paiement`);
  }

  getVentes(limite?: number): Observable<ApiResponse<VenteComptoirView[]>> {
    return this.api.get<ApiResponse<VenteComptoirView[]>>(
      '/pharmacien/ventes', limite ? { limite: String(limite) } : undefined);
  }

  getSessionCaisse(): Observable<ApiResponse<SessionCaisseView | null>> {
    return this.api.get<ApiResponse<SessionCaisseView | null>>('/pharmacien/caisse/session');
  }

  ouvrirSessionCaisse(montantOuvertureGnf: number): Observable<ApiResponse<SessionCaisseView>> {
    return this.api.post<ApiResponse<SessionCaisseView>>('/pharmacien/caisse/sessions', { montantOuvertureGnf });
  }

  cloturerSessionCaisse(
    id: string,
    dto: { montantCompteGnf: number; motifEcart?: string },
  ): Observable<ApiResponse<SessionCaisseView>> {
    return this.api.post<ApiResponse<SessionCaisseView>>(`/pharmacien/caisse/sessions/${id}/cloturer`, dto);
  }

  getRapportCaisse(periode: 'JOUR' | 'MOIS' | 'ANNEE'): Observable<ApiResponse<RapportCaisseView>> {
    return this.api.get<ApiResponse<RapportCaisseView>>('/pharmacien/caisse/rapport', { periode });
  }

  /**
   * Annule une erreur de saisie et remet les lots en stock. Ce n'est pas un
   * retour client : EF-07-11 l'interdit.
   */
  annulerVente(idVente: string, dto: AnnulerVenteDto): Observable<ApiResponse<VenteComptoirView>> {
    return this.api.post<ApiResponse<VenteComptoirView>>(`/pharmacien/ventes/${idVente}/annuler`, dto);
  }

  // --- P6 / EF-07 : l'appel aux pharmacies du quartier ------------------

  /** La file du comptoir : les appels du quartier, et ce qu'on a pris. */
  commandesDeLaPharmacie(): Observable<ApiResponse<CommandeView[]>> {
    return this.api.get<ApiResponse<CommandeView[]>>('/commandes/pharmacie');
  }

  /**
   * Répondre à un appel.
   *
   * `true` tente de prendre la commande : l'attribution est atomique côté
   * serveur, un seul gagnant. Un 409 veut dire qu'une autre officine a été
   * plus rapide — ce n'est pas une panne.
   */
  repondreDisponibilite(idCommande: string, aTousLesProduits: boolean): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(
      `/commandes/${idCommande}/disponibilite`, { aTousLesProduits });
  }

  /** Rendre une commande prise par erreur : le verrou se rouvre. */
  retirerPriseEnCharge(idCommande: string, motif: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/retirer`, { motif });
  }

  // --- P6 / EF-07-02 : du panier chiffré à la remise ---------------------
  //
  // Chaque geste a son appel, et un seul. Le serveur refuse tout passage
  // qu'il n'attend pas — c'est un 409, pas une panne : quelqu'un est passé
  // avant, ou l'écran a une version périmée de la commande.

  /**
   * Chiffrer le panier aux prix de l'officine.
   *
   * Aucun montant n'est envoyé : les prix sont lus du stock côté serveur,
   * à la règle du comptoir (référence + marge). Un prix qui vient du
   * navigateur est un prix qu'on peut changer.
   */
  chiffrerCommande(idCommande: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/chiffrer`, {});
  }

  /** L'officine commence à préparer le sachet. */
  preparerCommande(idCommande: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/preparer`, {});
  }

  /** Le sachet est prêt. C'est le mode choisi par le patient qui décide de la suite. */
  commandePrete(idCommande: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/prete`, {});
  }

  /** Remettre les produits — au patient, ou au livreur. */
  remettreCommande(idCommande: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/remettre`, {});
  }

  /**
   * Encaisser le panier au comptoir.
   *
   * Les especes ne passent par aucune passerelle. La reference est le numero
   * de recu, ce qui permet de rapprocher la caisse plus tard.
   */
  encaisserCommande(idCommande: string, referenceOperateur: string): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>(
      `/commandes/${idCommande}/encaisser`, { referenceOperateur });
  }

  /** Annuler, avec un motif. Le remboursement, lui, se fait au comptoir. */
  annulerCommande(idCommande: string, motif: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/annuler`, { motif });
  }

  getTableauDeBord(): Observable<ApiResponse<TableauDeBordOfficineView>> {
    return this.api.get<ApiResponse<TableauDeBordOfficineView>>('/pharmacien/tableau-de-bord');
  }

  // ── Assurance et tiers payant (EF-09, addendum point 5) ──────────────

  /**
   * Controle sur la carte d'assurance scannee : seule la couverture de ce
   * beneficiaire est recherchee. La reponse est enregistree cote API, refus
   * compris : c'est elle qui justifiera le tiers payant.
   */
  verifierCarteAssurance(jetonCarte: string): Observable<ApiResponse<CarteAssuranceVerifieeView>> {
    return this.api.post<ApiResponse<CarteAssuranceVerifieeView>>('/assurance/cartes/verifier', { jetonCarte });
  }

  /** La photo de la carte verifiee, a comparer a la personne au comptoir. */
  photoCarteAssurance(jetonCarte: string): Observable<Blob> {
    return this.api.postBlob('/assurance/cartes/photo', { jetonCarte });
  }

  /**
   * Chiffre la prise en charge **sans rien enregistrer**, pour la montrer
   * avant le paiement : un reste a charge sans explication se conteste au
   * comptoir.
   */
  simulerPriseEnCharge(
    jetonCarteAssurance: string,
    lignes: { idMedicament: string; libelle: string; categorie: CategorieProduit; montantGnf: number }[],
    montantNetGnf: number
  ): Observable<ApiResponse<PriseEnChargeView>> {
    return this.api.post<ApiResponse<PriseEnChargeView>>('/assurance/simulation', {
      jetonCarteAssurance, lignes, montantNetGnf,
    });
  }

  getAgents(): Observable<ApiResponse<unknown[]>> {
    return this.api.get<ApiResponse<unknown[]>>('/pharmacien/agents');
  }

  createAgent(payload: Record<string, unknown>): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>('/pharmacien/agents', payload);
  }
}
