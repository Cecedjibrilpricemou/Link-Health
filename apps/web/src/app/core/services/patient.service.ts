// core/services/patient.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AdressePatientView,
  DefinirAdresseDto,
  CommandeView,
  FactureView,
  ModeRemise,
  PayerCommandeDto,
  CreerDemandeRendezVousDto, DemandeRendezVousView, CarteAssuranceView } from '@baobaoheath/shared-types';
import { ApiService } from './api.service';
import { Patient, PatientCreatePayload, PatientUpdatePayload, Consultation } from '../models/patient.model';
import { ApiResponse, PaginatedData } from '../models/api.model';

@Injectable({ providedIn: 'root' })
export class PatientService {

  /**
   * Les cartes d'assurance du patient connecte (lot assurance). Le QR de
   * chaque carte porte un jeton opaque ; c'est le comptoir qui le verifie.
   */
  mesCartesAssurance(): Observable<ApiResponse<CarteAssuranceView[]>> {
    return this.api.get<ApiResponse<CarteAssuranceView[]>>('/assurance/mes-cartes');
  }

  /** La photo d'une de ses cartes : le jeton voyage dans le corps, pas dans l'URL. */
  photoCarteAssurance(jetonCarte: string): Observable<Blob> {
    return this.api.postBlob('/assurance/mes-cartes/photo', { jetonCarte });
  }

  // ── Prise de rendez-vous a distance (addendum, point 6) ──────────
  // Le patient demande depuis chez lui ; le medecin repond en fixant l'heure.

  mesDemandesRendezVous(): Observable<ApiResponse<DemandeRendezVousView[]>> {
    return this.api.get<ApiResponse<DemandeRendezVousView[]>>('/patients/me/demandes-rendez-vous');
  }

  creerDemandeRendezVous(dto: CreerDemandeRendezVousDto): Observable<ApiResponse<DemandeRendezVousView>> {
    return this.api.post<ApiResponse<DemandeRendezVousView>>('/patients/me/demandes-rendez-vous', dto);
  }

  annulerDemandeRendezVous(id: string): Observable<ApiResponse<DemandeRendezVousView>> {
    return this.api.post<ApiResponse<DemandeRendezVousView>>(`/patients/me/demandes-rendez-vous/${id}/annuler`, {});
  }

  private api = inject(ApiService);

  createPatient(payload: PatientCreatePayload): Observable<ApiResponse<{ patient: Patient }>> {
    return this.api.post<ApiResponse<{ patient: Patient }>>('/patients', payload);
  }

  getMe(): Observable<ApiResponse<Patient>> {
    return this.api.get<ApiResponse<Patient>>('/patients/me');
  }

  updateMe(payload: PatientUpdatePayload): Observable<ApiResponse<Patient>> {
    return this.api.put<ApiResponse<Patient>>('/patients/me', payload);
  }

  /** M3 : l'adresse qui decide a quelles pharmacies part son ordonnance, et ou livrer. */
  monAdresse(): Observable<ApiResponse<AdressePatientView>> {
    return this.api.get<ApiResponse<AdressePatientView>>('/patients/me/adresse');
  }

  definirAdresse(dto: DefinirAdresseDto): Observable<ApiResponse<AdressePatientView>> {
    return this.api.put<ApiResponse<AdressePatientView>>('/patients/me/adresse', dto);
  }

  /** Le code PIN qui ouvre le dossier par USSD ; le mot de passe du compte est exige. */
  definirPinUssd(pin: string, motDePasse: string): Observable<ApiResponse<void>> {
    return this.api.put<ApiResponse<void>>('/patients/me/pin-ussd', { pin, motDePasse });
  }

  setStructurePreferee(idStructure: string | null): Observable<ApiResponse<Patient>> {
    return this.api.put<ApiResponse<Patient>>('/patients/me/structure', { idStructure });
  }

  exportDossier(): Observable<Blob> {
    return this.api.getBlob('/patients/me/export');
  }

  getPatients(page = 1, limit = 20, prefecture?: string, search?: string): Observable<ApiResponse<PaginatedData<Patient>>> {
    const params: Record<string, string> = { page: page.toString(), limit: limit.toString() };
    if (prefecture) params['prefecture'] = prefecture;
    if (search) params['search'] = search;
    return this.api.get<ApiResponse<PaginatedData<Patient>>>('/patients', params);
  }

  // L'API renvoie { success, data: Consultation[], meta } : `data` est un
  // tableau, pas une enveloppe paginee.
  getMyConsultations(limit = 5): Observable<ApiResponse<Consultation[]>> {
    return this.api.get<ApiResponse<Consultation[]>>('/patients/me/consultations', { limit: limit.toString() });
  }

  getPatientByQr(qrCode: string): Observable<ApiResponse<Patient>> {
    return this.api.get<ApiResponse<Patient>>(`/patients/qr/${qrCode}`);
  }

  getPatientById(id: string): Observable<ApiResponse<Patient>> {
    return this.api.get<ApiResponse<Patient>>(`/patients/${id}`);
  }

  // --- P6 / EF-07 : la commande en pharmacie ---------------------------

  /**
   * Les commandes du patient.
   *
   * Il n'avait aucun moyen de les voir : l'appel partait, une pharmacie
   * prenait, et c'est pourtant à lui de dire comment être servi.
   */
  mesCommandes(): Observable<ApiResponse<CommandeView[]>> {
    return this.api.get<ApiResponse<CommandeView[]>>('/commandes/mes-commandes');
  }

  /** Retrait ou livraison. **Le retrait n'est pas un repli.** */
  choisirModeRemise(idCommande: string, mode: ModeRemise): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/mode-remise`, { mode });
  }

  /**
   * Payer le panier de la commande.
   *
   * **Aucun montant n'est envoyé.** Il est figé en base au chiffrage par
   * l'officine ; un montant qui part du navigateur est un montant qu'on peut
   * baisser. Ce qui revient est la facture, avec son lien de paiement — et
   * c'est le rappel de la passerelle qui fera avancer la commande, pas cet
   * appel.
   */
  payerCommande(idCommande: string, dto: PayerCommandeDto): Observable<ApiResponse<FactureView>> {
    return this.api.post<ApiResponse<FactureView>>(`/commandes/${idCommande}/payer`, dto);
  }

  /** Renoncer, avec un motif. */
  annulerCommande(idCommande: string, motif: string): Observable<ApiResponse<CommandeView>> {
    return this.api.post<ApiResponse<CommandeView>>(`/commandes/${idCommande}/annuler`, { motif });
  }
}
