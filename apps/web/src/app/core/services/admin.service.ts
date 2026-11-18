// core/services/admin.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpResponse } from '@angular/common/http';
import type {
  AnomalieView, CompteView, CorrigerNomCompteDto, DemandeRgpdView, FileDemandesView, FiltreJournalDto,
  AgentAssureurCreeView, CreerAgentAssureurDto, PageJournalView, Role, SeuilsAnomalies, StatutDemandeRgpd, SuspensionView,
  TypeDemandeRgpd,
} from '@baobaoheath/shared-types';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { UtilisateurAdmin, DashboardStatsGlobal } from '../models/admin.model';
import type {
  AssureurView,
  CatalogueAssureursView,
  ContratAssuranceView,
  CreerAssureurDto,
  CreerContratDto,
  CreerRegleCouvertureDto,
  CreationStructureView,
  CreationPharmacieView,
  PatientContratRechercheView,
  IdentitePlateformeView,
  ParametresSystemeView,
  DossierAgrementView,
  StructureAdminView,
  StructureConseilleeView,
  StructurePubliqueView,
  StructureRefView,
  TypePieceAgrement,
  UpdateParametresSystemeDto,
} from '@baobaoheath/shared-types';
import { ApiResponse, PaginatedData } from '../models/api.model';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private api = inject(ApiService);

  getDashboardStats(): Observable<ApiResponse<DashboardStatsGlobal>> {
    return this.api.get<ApiResponse<DashboardStatsGlobal>>('/admin-structure/stats');
  }

  getUtilisateurs(page = 1, limit = 20): Observable<ApiResponse<PaginatedData<UtilisateurAdmin>>> {
    return this.api.get<ApiResponse<PaginatedData<UtilisateurAdmin>>>('/admin-structure/agents', {
      page: page.toString(),
      limit: limit.toString()
    });
  }

  createUtilisateur(payload: Record<string, unknown>): Observable<ApiResponse<UtilisateurAdmin>> {
    return this.api.post<ApiResponse<UtilisateurAdmin>>('/admin-structure/agents', payload);
  }

  getStructures(page = 1, limit = 50): Observable<ApiResponse<PaginatedData<StructureAdminView>>> {
    return this.api.get<ApiResponse<PaginatedData<StructureAdminView>>>('/admin-structure/structures', {
      page: page.toString(),
      limit: limit.toString()
    });
  }

  /**
   * Creer une structure, avec son dossier reglementaire si elle en doit un.
   *
   * **Deux corps possibles, et c'est voulu.** Sans piece, on poste du JSON
   * ordinaire : une structure publique n'a rien a produire, et l'exiger aurait
   * casse la creation des postes et centres de sante. Avec des pieces, le
   * corps devient `multipart/form-data` — et comme un corps multipart ne porte
   * que des chaines plates, l'objet (avec son `admin` imbrique) voyage dans un
   * champ `donnees` au format JSON, que le serveur remet a sa place.
   */
  createStructure(
    payload: Record<string, unknown>,
    pieces: Partial<Record<TypePieceAgrement, File>> = {},
  ): Observable<ApiResponse<CreationStructureView>> {
    const corps = this.corpsAvecPieces(payload, pieces);
    return this.api.post<ApiResponse<CreationStructureView>>('/admin-structure/structures', corps);
  }

  createPharmacie(
    payload: Record<string, unknown>,
    pieces: Partial<Record<TypePieceAgrement, File>> = {},
  ): Observable<ApiResponse<unknown>> {
    const corps = this.corpsAvecPieces(payload, pieces);
    return this.api.post<ApiResponse<unknown>>('/admin-structure/pharmacies', corps);
  }

  /**
   * Le corps a envoyer : JSON tant qu'il n'y a pas de piece, multipart sinon.
   *
   * Angular laisse le navigateur poser `Content-Type` et sa frontiere des que
   * le corps est un `FormData` : il ne faut surtout pas le fixer a la main.
   */
  private corpsAvecPieces(
    payload: Record<string, unknown>,
    pieces: Partial<Record<TypePieceAgrement, File>>,
  ): unknown {
    const entrees = Object.entries(pieces).filter(([, f]) => f instanceof File) as [string, File][];
    if (entrees.length === 0) return payload;

    const corps = new FormData();
    corps.append('donnees', JSON.stringify(payload));
    // Le nom du champ est le type de piece : c'est ainsi que le serveur le
    // reconnait, et il le valide contre son enum avant de s'en servir.
    for (const [type, fichier] of entrees) corps.append(type, fichier, fichier.name);
    return corps;
  }

  /** L'etat du dossier : ce qui est depose, ce qui manque. */
  dossierStructure(id: string): Observable<ApiResponse<DossierAgrementView>> {
    return this.api.get<ApiResponse<DossierAgrementView>>(`/admin-structure/structures/${id}/dossier`);
  }

  /**
   * Deposer ou remplacer des pieces sur une structure deja creee.
   *
   * Deux usages : completer le dossier d'une structure anterieure a la regle,
   * et **remplacer un agrement renouvele**.
   */
  deposerPieces(
    id: string,
    pieces: Partial<Record<TypePieceAgrement, File>>,
    libelles: Partial<Record<TypePieceAgrement, string>> = {},
  ): Observable<ApiResponse<DossierAgrementView>> {
    const corps = new FormData();
    for (const [type, fichier] of Object.entries(pieces)) {
      if (fichier instanceof File) corps.append(type, fichier, fichier.name);
    }
    for (const [type, libelle] of Object.entries(libelles)) {
      if (libelle) corps.append(type, libelle);
    }
    return this.api.post<ApiResponse<DossierAgrementView>>(`/admin-structure/structures/${id}/pieces`, corps);
  }

  /**
   * Le contenu d'une piece.
   *
   * Par `getBlob` et non par un simple lien : le fichier vit dans le stockage
   * prive, derriere une route authentifiee. Une URL posee dans un `href`
   * n'emporterait pas forcement le cookie, l'API ne partageant pas toujours
   * l'origine du front.
   */
  piece(id: string): Observable<Blob> {
    return this.api.getBlob(`/admin-structure/pieces/${id}`);
  }

  getPharmaciesHospitalieres(): Observable<ApiResponse<StructureAdminView[]>> {
    return this.api.get<ApiResponse<StructureAdminView[]>>('/admin-structure/pharmacies');
  }

  creerPharmacieHospitaliere(payload: Record<string, unknown>): Observable<ApiResponse<CreationPharmacieView>> {
    return this.api.post<ApiResponse<CreationPharmacieView>>('/admin-structure/pharmacies', payload);
  }

  deleteStructure(id: string): Observable<ApiResponse<void>> {
    return this.api.delete<ApiResponse<void>>(`/admin-structure/structures/${id}`);
  }

  updateStructure(id: string, payload: Record<string, unknown>): Observable<ApiResponse<StructureAdminView>> {
    return this.api.put<ApiResponse<StructureAdminView>>(`/admin-structure/structures/${id}`, payload);
  }

  getPublicStructures(): Observable<ApiResponse<StructurePubliqueView[]>> {
    return this.api.get<ApiResponse<StructurePubliqueView[]>>('/admin-structure/structures/publiques');
  }

  // ── Le carnet d'adresses de l'etablissement ───────────────────────
  //
  // **Ce n'est pas un contrat.** Le conseille n'a rien a accepter : la
  // plateforme autorise deja d'adresser une demande a n'importe quel
  // laboratoire. La declaration met en tete de liste chez les medecins de
  // l'etablissement, elle ne donne aucun droit.
  conseillees(): Observable<ApiResponse<StructureConseilleeView[]>> {
    return this.api.get<ApiResponse<StructureConseilleeView[]>>('/admin-structure/conseillees');
  }

  /** Soi-meme et les deja-conseillees en sont retires, cote serveur. */
  candidatsConseil(): Observable<ApiResponse<StructureRefView[]>> {
    return this.api.get<ApiResponse<StructureRefView[]>>('/admin-structure/conseillees/candidats');
  }

  conseiller(idStructureConseillee: string): Observable<ApiResponse<StructureConseilleeView>> {
    return this.api.post<ApiResponse<StructureConseilleeView>>('/admin-structure/conseillees', { idStructureConseillee });
  }

  retirerConseil(id: string): Observable<ApiResponse<void>> {
    return this.api.delete<ApiResponse<void>>(`/admin-structure/conseillees/${id}`);
  }

  // Parametres globaux (SUPER_ADMIN)
  // --- Assurance et tiers payant (EF-09, addendum point 5) --------------
  //
  // Tant que les echanges automatiques avec les assureurs ne sont pas
  // conventionnes (EF-09-02), c'est l'administration nationale qui saisit les
  // assureurs, leurs regles et les polices.

  getAssureurs(): Observable<ApiResponse<AssureurView[]>> {
    return this.api.get<ApiResponse<AssureurView[]>>('/assurance/assureurs');
  }

  getAssureursCatalogue(): Observable<ApiResponse<CatalogueAssureursView>> {
    return this.api.get<ApiResponse<CatalogueAssureursView>>('/assurance/assureurs/catalogue');
  }

  activerConventionAssureur(idAssureur: string): Observable<ApiResponse<void>> {
    return this.api.post<ApiResponse<void>>(`/assurance/assureurs/${idAssureur}/convention`, {});
  }

  retirerConventionAssureur(idAssureur: string): Observable<ApiResponse<void>> {
    return this.api.delete<ApiResponse<void>>(`/assurance/assureurs/${idAssureur}/convention`);
  }

  creerAssureur(payload: CreerAssureurDto): Observable<ApiResponse<AssureurView>> {
    return this.api.post<ApiResponse<AssureurView>>('/assurance/assureurs', payload);
  }

  creerAgentAssureur(idAssureur: string, payload: CreerAgentAssureurDto): Observable<ApiResponse<AgentAssureurCreeView>> {
    return this.api.post<ApiResponse<AgentAssureurCreeView>>(`/assurance/assureurs/${idAssureur}/agents`, payload);
  }

  /**
   * Une regle ne remplace pas la precedente : sa date d'effet decide, et le
   * calcul retient celle en vigueur a la date de la vente (EF-09-03).
   */
  ajouterRegleCouverture(idAssureur: string, payload: CreerRegleCouvertureDto): Observable<ApiResponse<AssureurView>> {
    return this.api.post<ApiResponse<AssureurView>>(`/assurance/assureurs/${idAssureur}/regles`, payload);
  }

  /** L'assureur envoie une liste de noms : c'est par le nom qu'on retombe. */
  rechercherPatientsPourPolice(q: string): Observable<ApiResponse<PatientContratRechercheView[]>> {
    return this.api.get<ApiResponse<PatientContratRechercheView[]>>(
      `/assurance/patients/recherche?q=${encodeURIComponent(q)}`);
  }

  contratsDuPatient(idPatient: string): Observable<ApiResponse<ContratAssuranceView[]>> {
    return this.api.get<ApiResponse<ContratAssuranceView[]>>(`/assurance/patients/${idPatient}/contrats`);
  }

  creerContrat(payload: CreerContratDto): Observable<ApiResponse<ContratAssuranceView>> {
    return this.api.post<ApiResponse<ContratAssuranceView>>('/assurance/contrats', payload);
  }

  getParametres(): Observable<ApiResponse<ParametresSystemeView>> {
    return this.api.get<ApiResponse<ParametresSystemeView>>('/admin-structure/parametres');
  }

  updateParametres(payload: UpdateParametresSystemeDto): Observable<ApiResponse<ParametresSystemeView>> {
    return this.api.put<ApiResponse<ParametresSystemeView>>('/admin-structure/parametres', payload);
  }

  /** Televerse le logo de la plateforme (Parametres > Identite) ; renvoie l'identite a jour. */
  uploadLogo(fichier: File): Observable<ApiResponse<IdentitePlateformeView>> {
    const formData = new FormData();
    formData.append('logo', fichier);
    return this.api.post<ApiResponse<IdentitePlateformeView>>('/admin-structure/parametres/logo', formData);
  }

  // Analytics
  getAnalyticsDashboard(params?: { prefecture?: string }): Observable<ApiResponse<unknown>> {
    const queryParams: Record<string, string> = {};
    if (params?.prefecture) queryParams['prefecture'] = params.prefecture;
    return this.api.get<ApiResponse<unknown>>('/analytics/dashboard', queryParams);
  }

  getAnalyticsHeatmap(): Observable<ApiResponse<unknown[]>> {
    return this.api.get<ApiResponse<unknown[]>>('/analytics/heatmap');
  }

  getAnalyticsAlertes(): Observable<ApiResponse<unknown[]>> {
    return this.api.get<ApiResponse<unknown[]>>('/analytics/alertes');
  }

  getAnalyticsTendances(): Observable<ApiResponse<unknown[]>> {
    return this.api.get<ApiResponse<unknown[]>>('/analytics/tendances');
  }

  getAnalyticsCouverture(): Observable<ApiResponse<unknown[]>> {
    return this.api.get<ApiResponse<unknown[]>>('/analytics/vaccinations/couverture');
  }

  exportAnalytics(format: string, periode: string): Observable<unknown> {
    return this.api.get<unknown>('/analytics/export', { format, periode });
  }

  // --- Journal d audit (EF-12-05) --------------------------------------
  //
  // Les criteres partent en chaine de requete et le schema cote API est
  // `.strict()` : un critere vide ne doit donc pas etre envoye, sinon il est
  // refuse en 400. On ne transmet que ce qui est renseigne.

  rechercherJournal(filtres: FiltreJournalDto): Observable<ApiResponse<PageJournalView>> {
    return this.api.get<ApiResponse<PageJournalView>>('/journal', enParametres(filtres));
  }

  /**
   * L export CSV, avec sa reponse entiere : le nom du fichier vient du
   * serveur (`Content-Disposition`), et non d un nom reconstruit ici.
   */
  exporterJournal(filtres: FiltreJournalDto): Observable<HttpResponse<Blob>> {
    return this.api.getFichier('/journal/export', enParametres(filtres));
  }

  // --- Suspension de compte (EF-12-01) ----------------------------------

  rechercherComptes(filtres: {
    q?: string; role?: Role; actifs?: boolean; page?: number; limit?: number;
  }): Observable<ApiResponse<{ comptes: CompteView[]; total: number; page: number; limit: number }>> {
    return this.api.get<ApiResponse<{ comptes: CompteView[]; total: number; page: number; limit: number }>>(
      '/comptes', enParametres(filtres)
    );
  }

  /**
   * Le motif est obligatoire cote API, et une contrainte SQL le refuse aussi :
   * l'ecran ne doit donc pas tenter d'envoyer une suspension sans explication.
   */
  suspendreCompte(id: string, motif: string): Observable<ApiResponse<SuspensionView>> {
    return this.api.post<ApiResponse<SuspensionView>>(`/comptes/${id}/suspendre`, { motif });
  }

  reactiverCompte(id: string): Observable<ApiResponse<SuspensionView>> {
    return this.api.post<ApiResponse<SuspensionView>>(`/comptes/${id}/reactiver`, {});
  }

  /**
   * EF-01-08 : l'administrateur declare avoir confronte le numero au registre
   * de l'ordre. Sans cela, le compte ne s'active pas ; ensuite, le nom est fige.
   */
  verifierOrdre(id: string, numeroOrdre: string): Observable<ApiResponse<unknown>> {
    return this.api.post<ApiResponse<unknown>>(`/comptes/${id}/verifier-ordre`, { numeroOrdre });
  }

  /** Corriger le nom d'un compte professionnel, avec un motif garde au journal. */
  corrigerNomCompte(id: string, dto: CorrigerNomCompteDto): Observable<ApiResponse<CompteView>> {
    return this.api.post<ApiResponse<CompteView>>(`/comptes/${id}/corriger-nom`, dto);
  }

  // --- Anomalies d acces (EF-12-06) -------------------------------------

  // --- Demandes d exercice de droits (EF-12-09) -------------------------
  //
  // Rien ne s execute automatiquement : ces routes enregistrent une decision
  // humaine, et la reponse ecrite est obligatoire des que la demande est close.

  demandesRgpd(filtres: { statut?: StatutDemandeRgpd; type?: TypeDemandeRgpd }):
    Observable<ApiResponse<FileDemandesView>> {
    return this.api.get<ApiResponse<FileDemandesView>>('/demandes-rgpd', enParametres(filtres));
  }

  prendreEnChargeDemande(id: string): Observable<ApiResponse<DemandeRgpdView>> {
    return this.api.post<ApiResponse<DemandeRgpdView>>(`/demandes-rgpd/${id}/prendre-en-charge`, {});
  }

  repondreDemande(id: string, satisfaite: boolean, reponse: string):
    Observable<ApiResponse<DemandeRgpdView>> {
    return this.api.post<ApiResponse<DemandeRgpdView>>(`/demandes-rgpd/${id}/repondre`, { satisfaite, reponse });
  }

  anomalies(fenetreHeures?: number): Observable<
    ApiResponse<{ anomalies: AnomalieView[]; seuils: SeuilsAnomalies; depuis: string }>
  > {
    return this.api.get<ApiResponse<{ anomalies: AnomalieView[]; seuils: SeuilsAnomalies; depuis: string }>>(
      '/journal/anomalies', fenetreHeures ? { fenetreHeures: String(fenetreHeures) } : undefined
    );
  }
}

/** Les criteres renseignes, en chaines. Les vides sont ecartes. */
// Generique sur `object` et non `Record<string, unknown>` : une interface sans
// signature d index — ce que sont nos DTO — n est pas assignable au second.
function enParametres<T extends object>(filtres: T): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(filtres)) {
    if (valeur === undefined || valeur === null || valeur === '' || valeur === false) continue;
    params[cle] = String(valeur);
  }
  return params;
}
