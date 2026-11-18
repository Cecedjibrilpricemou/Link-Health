// core/services/hopital.service.ts
// P1 — Hopital (EF-03) : appels /hopital/* (agent d'accueil) et /patients/me/episodes.
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ApiResponse } from '../models/api.model';
import { environment } from '../../../environments/environment';
import type {
  DemandeRendezVousView,
  AnnulerFusionDto,
  CandidatDoublonView,
  FusionnerDto,
  FusionView,
  IdentitePatientView,
  NiveauIdentite,
  VerifierIdentiteDto,
  CorrigerIdentiteDto,
  CorrectionIdentiteView,
  DemandeCorrectionIdentiteView,
  PresenceDuJourView,
  CreateDemandeAnalyseDto,
  CreateEpisodeDto,
  DemandeAnalyseView,
  EpisodePatientView,
  EpisodeSoinsResumeView,
  EpisodeSoinsView,
  ExamenView,
  OrientationDto,
  PatientRechercheView,
  PersonneRefView,
  ChoixLaboratoiresView,
  StructureRefView,
  TableauDeBordHopitalView,
  UpdateEpisodeDto,
} from '@baobaoheath/shared-types';

export interface PageEpisodes { items: EpisodeSoinsResumeView[]; total: number; page: number; limit: number }
export type MedecinRefView = PersonneRefView & { specialite: string | null };

@Injectable({ providedIn: 'root' })
export class HopitalService {
  private api = inject(ApiService);

  tableauDeBord(): Observable<ApiResponse<TableauDeBordHopitalView>> {
    return this.api.get<ApiResponse<TableauDeBordHopitalView>>('/hopital/tableau-de-bord');
  }

  rechercherPatients(q: string): Observable<ApiResponse<PatientRechercheView[]>> {
    return this.api.get<ApiResponse<PatientRechercheView[]>>('/hopital/patients/recherche', { q });
  }

  listerEpisodes(params: { statut?: string; q?: string; page?: number; limit?: number }): Observable<ApiResponse<PageEpisodes>> {
    const query: Record<string, string> = {};
    if (params.statut) query['statut'] = params.statut;
    if (params.q) query['q'] = params.q;
    if (params.page) query['page'] = String(params.page);
    if (params.limit) query['limit'] = String(params.limit);
    return this.api.get<ApiResponse<PageEpisodes>>('/hopital/episodes', query);
  }

  getEpisode(id: string): Observable<ApiResponse<EpisodeSoinsView>> {
    return this.api.get<ApiResponse<EpisodeSoinsView>>(`/hopital/episodes/${id}`);
  }

  creerEpisode(dto: CreateEpisodeDto): Observable<ApiResponse<EpisodeSoinsView>> {
    return this.api.post<ApiResponse<EpisodeSoinsView>>('/hopital/episodes', dto);
  }

  modifierEpisode(id: string, dto: UpdateEpisodeDto): Observable<ApiResponse<EpisodeSoinsView>> {
    return this.api.patch<ApiResponse<EpisodeSoinsView>>(`/hopital/episodes/${id}`, dto);
  }

  cloturerEpisode(id: string): Observable<ApiResponse<EpisodeSoinsView>> {
    return this.api.post<ApiResponse<EpisodeSoinsView>>(`/hopital/episodes/${id}/cloturer`, {});
  }

  annulerEpisode(id: string): Observable<ApiResponse<EpisodeSoinsView>> {
    return this.api.post<ApiResponse<EpisodeSoinsView>>(`/hopital/episodes/${id}/annuler`, {});
  }

  /** Demandes a distance que personne ne vise : l'accueil les oriente. */
  demandesAOrienter(): Observable<ApiResponse<DemandeRendezVousView[]>> {
    return this.api.get<ApiResponse<DemandeRendezVousView[]>>('/hopital/demandes');
  }

  orienterDemande(id: string, idMedecin: string): Observable<ApiResponse<DemandeRendezVousView>> {
    return this.api.post<ApiResponse<DemandeRendezVousView>>(`/hopital/demandes/${id}/orienter`, { idMedecin });
  }

  /** Les patients attendus aujourd'hui (addendum, point 2). */
  presencesDuJour(jour?: string): Observable<ApiResponse<PresenceDuJourView[]>> {
    return this.api.get<ApiResponse<PresenceDuJourView[]>>('/hopital/presences', jour ? { jour } : undefined);
  }

  /** L'assistante pointe l'arrivee : c'est la que l'attente commence. */
  pointerPresence(idRendezVous: string): Observable<ApiResponse<PresenceDuJourView>> {
    return this.api.post<ApiResponse<PresenceDuJourView>>(`/hopital/rendez-vous/${idRendezVous}/presence`, {});
  }

  orienter(id: string, dto: OrientationDto): Observable<ApiResponse<EpisodeSoinsView>> {
    return this.api.post<ApiResponse<EpisodeSoinsView>>(`/hopital/episodes/${id}/orientation`, dto);
  }

  /**
   * Ouvrir la consultation de cette visite.
   *
   * Le patient et le motif viennent de l'episode : rien a envoyer. Si une
   * consultation y est deja ouverte, l'API rend celle-la plutot que d'en
   * creer une seconde.
   */
  ouvrirConsultation(idEpisode: string): Observable<ApiResponse<{ id: string }>> {
    return this.api.post<ApiResponse<{ id: string }>>(`/hopital/episodes/${idEpisode}/consultation`, {});
  }

  creerDemandeAnalyse(idEpisode: string, dto: CreateDemandeAnalyseDto): Observable<ApiResponse<DemandeAnalyseView>> {
    return this.api.post<ApiResponse<DemandeAnalyseView>>(`/hopital/episodes/${idEpisode}/demandes-analyse`, dto);
  }

  annulerDemande(id: string, motif: string): Observable<ApiResponse<DemandeAnalyseView>> {
    return this.api.post<ApiResponse<DemandeAnalyseView>>(`/hopital/demandes-analyse/${id}/annuler`, { motif });
  }

  listerExamens(): Observable<ApiResponse<ExamenView[]>> {
    return this.api.get<ApiResponse<ExamenView[]>>('/hopital/examens');
  }

  /**
   * Les laboratoires proposes au medecin, groupes et couverture chiffree.
   *
   * `idsExamens` peut etre vide : la liste se rend alors sans couverture, ce
   * qui est le cas a l'ouverture de l'ecran, avant toute selection.
   */
  choixLaboratoires(idsExamens: string[], toutLePays = false): Observable<ApiResponse<ChoixLaboratoiresView>> {
    const params: Record<string, string | string[]> = {};
    if (idsExamens.length > 0) params['examens'] = idsExamens;
    if (toutLePays) params['toutLePays'] = 'true';
    return this.api.get<ApiResponse<ChoixLaboratoiresView>>('/hopital/laboratoires', params);
  }

  listerMedecins(): Observable<ApiResponse<MedecinRefView[]>> {
    return this.api.get<ApiResponse<MedecinRefView[]>>('/hopital/medecins');
  }

  /** Bon d'examen : page HTML servie par l'API, ouverte dans un onglet (les cookies de session suivent). */
  ouvrirBonExamen(idDemande: string, cotePatient = false): void {
    const chemin = cotePatient ? `/patients/me/demandes-analyse/${idDemande}/document` : `/hopital/demandes-analyse/${idDemande}/document`;
    window.open(`${environment.apiUrl}${chemin}`, '_blank', 'noopener');
  }

  // ── Patient ──────────────────────────────────────────────────────
  mesEpisodes(): Observable<ApiResponse<EpisodePatientView[]>> {
    return this.api.get<ApiResponse<EpisodePatientView[]>>('/patients/me/episodes');
  }

  /**
   * Creer le dossier d'un patient au comptoir (EF-03-01).
   *
   * **L'accueil ne part plus sur la page publique d'inscription** : elle est
   * faite pour quelqu'un qui s'inscrit seul chez lui, et l'agent y perdait
   * l'admission en cours.
   *
   * Le mot de passe temporaire n'est rendu qu'une fois, pour etre remis.
   */
  creerPatientAuComptoir(dto: {
    telephone: string; prenom: string; nom: string;
    dateNaissance: string; sexe: 'M' | 'F';
    prefecture: string; sousPrefecture?: string; email?: string;
  }): Observable<ApiResponse<{
    patient: { id: string; prenom: string; nom: string };
    motDePasseTemporaire: string;
  }>> {
    return this.api.post<ApiResponse<{
      patient: { id: string; prenom: string; nom: string };
      motDePasseTemporaire: string;
    }>>('/hopital/patients', dto);
  }

  // --- Identito-vigilance (EF-01-04/10) ---------------------------------
  //
  // Verifier une identite ouvre le tiers payant. Cela ne conditionne pas les
  // soins : un patient a l'identite provisoire est recu et suivi normalement.

  identites(filtres: { q?: string; niveau?: NiveauIdentite }): Observable<ApiResponse<IdentitePatientView[]>> {
    const params: Record<string, string> = {};
    if (filtres.q) params['q'] = filtres.q;
    if (filtres.niveau) params['niveau'] = filtres.niveau;
    return this.api.get<ApiResponse<IdentitePatientView[]>>('/identites', params);
  }

  verifierIdentite(id: string, dto: VerifierIdentiteDto): Observable<ApiResponse<IdentitePatientView>> {
    return this.api.post<ApiResponse<IdentitePatientView>>(`/identites/${id}/verifier`, dto);
  }

  /** R15 : corriger sexe, date de naissance, prenom ou nom, avec un motif. */
  corrigerIdentite(id: string, dto: CorrigerIdentiteDto): Observable<ApiResponse<IdentitePatientView>> {
    return this.api.post<ApiResponse<IdentitePatientView>>(`/identites/${id}/corriger`, dto);
  }

  corrections(id: string): Observable<ApiResponse<CorrectionIdentiteView[]>> {
    return this.api.get<ApiResponse<CorrectionIdentiteView[]>>(`/identites/${id}/corrections`);
  }

  /** R15 : les demandes de correction envoyees par les patients du perimetre. */
  demandesCorrection(): Observable<ApiResponse<DemandeCorrectionIdentiteView[]>> {
    return this.api.get<ApiResponse<DemandeCorrectionIdentiteView[]>>('/identites/demandes-correction');
  }

  accepterDemandeCorrection(id: string, motif: string): Observable<ApiResponse<DemandeCorrectionIdentiteView>> {
    return this.api.post<ApiResponse<DemandeCorrectionIdentiteView>>(`/identites/demandes-correction/${id}/accepter`, { motif });
  }

  refuserDemandeCorrection(id: string, reponse: string): Observable<ApiResponse<DemandeCorrectionIdentiteView>> {
    return this.api.post<ApiResponse<DemandeCorrectionIdentiteView>>(`/identites/demandes-correction/${id}/refuser`, { reponse });
  }

  /**
   * Les dossiers qui pourraient etre la meme personne (EF-01-05).
   *
   * **Appele a la demande, pas pour chaque ligne.** Dix lignes affichees
   * feraient dix requetes a l'ouverture de l'ecran, dont neuf pour rien.
   */
  doublons(id: string): Observable<ApiResponse<CandidatDoublonView[]>> {
    return this.api.get<ApiResponse<CandidatDoublonView[]>>(`/identites/${id}/doublons`);
  }

  // --- Fusion de dossiers (EF-01-06) ------------------------------------
  //
  // **Reservee a ADMIN_STRUCTURE** cote API. L'ecran ne montre le bouton qu'a
  // ce role : proposer une action qu'on n'a pas le droit de faire est une
  // facon de mentir a l'utilisateur.

  /** `id` est le dossier **qui survit**. */
  fusionner(id: string, dto: FusionnerDto): Observable<ApiResponse<FusionView>> {
    return this.api.post<ApiResponse<FusionView>>(`/identites/${id}/fusionner`, dto);
  }

  annulerFusion(idFusion: string, dto: AnnulerFusionDto): Observable<ApiResponse<FusionView>> {
    return this.api.post<ApiResponse<FusionView>>(`/identites/fusions/${idFusion}/annuler`, dto);
  }

  fusions(id: string): Observable<ApiResponse<FusionView[]>> {
    return this.api.get<ApiResponse<FusionView[]>>(`/identites/${id}/fusions`);
  }
}
