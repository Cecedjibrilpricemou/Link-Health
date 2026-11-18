// core/services/paiement.service.ts
//
// **Les factures se typaient avec `montant`, `devise` et `methode`** — trois
// champs que l'API n'a jamais rendus. Rien ne s'affichait de faux parce que
// rien ne les affichait, mais le contrat mentait. `FactureView` est ce que
// l'API rend vraiment.
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ADeReglerView, FactureView, ModePaiement } from '@baobaoheath/shared-types';
import { ApiService } from './api.service';
import { ApiResponse } from '../models/api.model';
import { environment } from '../../../environments/environment';

/** La réponse paginée de l'historique. */
export interface PageFactures {
  success: boolean;
  data: FactureView[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

@Injectable({ providedIn: 'root' })
export class PaiementService {
  private api = inject(ApiService);

  /**
   * Ouvre un paiement pour une consultation.
   *
   * La réponse porte `urlPaiement` : c'est la page de la passerelle, vers
   * laquelle il faut envoyer le patient. Une facture déjà ouverte est
   * réutilisée côté serveur, elle n'est pas dupliquée.
   */
  ouvrirPaiement(payload: {
    idConsultation: string;
    montantGnf: number;
    modePaiement: ModePaiement;
    numeroOperateur?: string;
  }): Observable<ApiResponse<FactureView>> {
    return this.api.post<ApiResponse<FactureView>>('/paiements', payload);
  }

  /**
   * Ce qui reste dû.
   *
   * **Part des consultations, pas des factures.** Rien ne facture
   * automatiquement : la facture naît quand le paiement s'ouvre. Une liste
   * bâtie sur les seules factures laisserait invisible tout ce qui n'a jamais
   * été payé.
   */
  aRegler(): Observable<ApiResponse<ADeReglerView[]>> {
    return this.api.get<ApiResponse<ADeReglerView[]>>('/paiements/a-regler');
  }

  getHistorique(): Observable<PageFactures> {
    return this.api.get<PageFactures>('/paiements/historique');
  }

  /**
   * Relit l'état d'une facture.
   *
   * **Le serveur interroge la passerelle au passage** quand l'issue n'est pas
   * encore connue : un rappel peut ne jamais arriver, et sans cette relecture
   * un patient qui a payé resterait débiteur.
   */
  getStatut(id: string): Observable<ApiResponse<FactureView>> {
    return this.api.get<ApiResponse<FactureView>>(`/paiements/${id}/statut`);
  }

  annulerPaiement(id: string): Observable<ApiResponse<FactureView>> {
    return this.api.post<ApiResponse<FactureView>>(`/paiements/${id}/annuler`, {});
  }

  urlRecu(idFacture: string): string {
    return `${environment.apiUrl}/paiements/factures/${idFacture}/recu`;
  }
}
