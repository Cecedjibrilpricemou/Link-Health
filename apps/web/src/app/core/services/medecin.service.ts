// core/services/medecin.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Patient } from '../models/patient.model';
import { Consultation } from '../models/asc.model';
import { MedecinStats, OrdonnanceCreationPayload } from '../models/medecin.model';
import { ApiResponse } from '../models/api.model';
import type {
  DemandeAnalyseView,
  LibererResultatsDto,
  AccepterDemandeRendezVousDto,
  DemandeRendezVousView,
  ValiderConsultationDto,
  FixerRendezVousDto,
  OrientationMedecinView,
  RendezVousMedecinView,
  ResultatALibererView,
  ReferencementATraiterView,
  ReferralStatus,
  RepondreReferencementDto,
  EtatAccesDossierView,
  HistoriquePatientView,
} from '@baobaoheath/shared-types';

@Injectable({ providedIn: 'root' })
export class MedecinService {
  private api = inject(ApiService);

  getPatientDossier(idPatient: string): Observable<ApiResponse<Patient>> {
    return this.api.get<ApiResponse<Patient>>(`/patients/${idPatient}`);
  }

  // ── L'historique du patient, sur son accord ──────────────────────
  /** Ou en est l'acces : accorde, demande, refuse... et si l'on peut relancer. */
  getAccesDossier(idPatient: string): Observable<ApiResponse<EtatAccesDossierView>> {
    return this.api.get<ApiResponse<EtatAccesDossierView>>(`/medecin/patients/${idPatient}/acces`);
  }

  /** Relancer une demande restee sans reponse : une fois par jour au plus. */
  relancerAccesDossier(idPatient: string): Observable<ApiResponse<EtatAccesDossierView>> {
    return this.api.post<ApiResponse<EtatAccesDossierView>>(`/medecin/patients/${idPatient}/acces/relancer`, {});
  }

  /** L'historique, une fois accorde (ou en bris de glace). */
  getHistoriquePatient(idPatient: string): Observable<ApiResponse<HistoriquePatientView>> {
    return this.api.get<ApiResponse<HistoriquePatientView>>(`/medecin/patients/${idPatient}/historique`);
  }

  /** Les resultats valides que le patient ne voit pas encore (addendum 2026-09-28). */
  getResultatsALiberer(): Observable<ApiResponse<ResultatALibererView[]>> {
    return this.api.get<ApiResponse<ResultatALibererView[]>>('/medecin/resultats');
  }

  /** Ouvre l'acces au patient, avec une explication en langage clair. */
  libererResultats(idDemande: string, commentaire?: string): Observable<ApiResponse<DemandeAnalyseView>> {
    const payload: LibererResultatsDto = commentaire ? { commentaire } : {};
    return this.api.post<ApiResponse<DemandeAnalyseView>>(`/medecin/resultats/${idDemande}/liberer`, payload);
  }

  // ── Demandes de rendez-vous a distance (addendum, point 6) ──────

  mesDemandesRendezVous(): Observable<ApiResponse<DemandeRendezVousView[]>> {
    return this.api.get<ApiResponse<DemandeRendezVousView[]>>('/medecin/demandes');
  }

  /** Accepter, c'est fixer l'heure — ce geste ouvre la visite. */
  accepterDemandeRendezVous(id: string, dto: AccepterDemandeRendezVousDto): Observable<ApiResponse<DemandeRendezVousView>> {
    return this.api.post<ApiResponse<DemandeRendezVousView>>(`/medecin/demandes/${id}/accepter`, dto);
  }

  /** Un refus sans explication est un mur : le motif est obligatoire. */
  refuserDemandeRendezVous(id: string, motif: string): Observable<ApiResponse<DemandeRendezVousView>> {
    return this.api.post<ApiResponse<DemandeRendezVousView>>(`/medecin/demandes/${id}/refuser`, { motif });
  }

  /** Le medecin pose le creneau : l'accueil ne propose plus d'heure. */
  fixerRendezVous(idEpisode: string, dto: FixerRendezVousDto): Observable<ApiResponse<RendezVousMedecinView>> {
    return this.api.post<ApiResponse<RendezVousMedecinView>>(`/medecin/orientations/${idEpisode}/rendez-vous`, dto);
  }

  /** L'agenda, du plus proche au plus lointain. */
  getAgenda(params: { du?: string; au?: string } = {}): Observable<ApiResponse<RendezVousMedecinView[]>> {
    const q: Record<string, string> = {};
    if (params.du) q['du'] = params.du;
    if (params.au) q['au'] = params.au;
    return this.api.get<ApiResponse<RendezVousMedecinView[]>>('/medecin/rendez-vous', q);
  }

  changerStatutRendezVous(id: string, statut: 'EN_CONSULTATION' | 'TERMINE' | 'ABSENT'): Observable<ApiResponse<RendezVousMedecinView>> {
    return this.api.patch<ApiResponse<RendezVousMedecinView>>(`/medecin/rendez-vous/${id}/statut`, { statut });
  }

  /** Les patients que l'accueil a orientes vers ce medecin (EF-03-05). */
  getOrientations(): Observable<ApiResponse<OrientationMedecinView[]>> {
    return this.api.get<ApiResponse<OrientationMedecinView[]>>('/medecin/orientations');
  }

  // L'API renvoie { success, data: [], meta } a plat (pas de PaginatedData).
  getReferencements(page = 1, limit = 20, statut?: ReferralStatus): Observable<ApiResponse<ReferencementATraiterView[]>> {
    const params: Record<string, string> = { page: page.toString(), limit: limit.toString() };
    if (statut) params['statut'] = statut;
    return this.api.get<ApiResponse<ReferencementATraiterView[]>>('/medecin/referencements', params);
  }

  repondreReferencement(id: string, payload: RepondreReferencementDto): Observable<ApiResponse<ReferencementATraiterView>> {
    return this.api.put<ApiResponse<ReferencementATraiterView>>(`/medecin/referencements/${id}/repondre`, payload);
  }

  validerConsultation(idConsultation: string, payload: ValiderConsultationDto): Observable<ApiResponse<Consultation>> {
    return this.api.put<ApiResponse<Consultation>>(`/medecin/consultations/${idConsultation}/valider`, payload);
  }

  creerOrdonnance(idConsultation: string, payload: OrdonnanceCreationPayload): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>(`/consultations/${idConsultation}/ordonnances`, payload);
  }

  getStats(): Observable<ApiResponse<MedecinStats>> {
    return this.api.get<ApiResponse<MedecinStats>>('/medecin/dashboard');
  }

  getDashboard(): Observable<ApiResponse<MedecinStats>> {
    return this.api.get<ApiResponse<MedecinStats>>('/medecin/dashboard');
  }

  getConsultations(): Observable<ApiResponse<Consultation[]>> {
    return this.api.get<ApiResponse<Consultation[]>>('/medecin/consultations');
  }

  getConsultationsRecentes(): Observable<ApiResponse<Consultation[]>> {
    return this.api.get<ApiResponse<Consultation[]>>('/medecin/consultations', { limit: '5' });
  }

  getMessages(): Observable<ApiResponse<unknown[]>> {
    return this.api.get<ApiResponse<unknown[]>>('/medecin/messages');
  }

  sendMessage(payload: { idDestinataire: string; contenu: string }): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>('/medecin/messages', payload);
  }
}
