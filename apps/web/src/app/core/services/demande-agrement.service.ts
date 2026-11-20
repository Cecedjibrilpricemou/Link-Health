// core/services/demande-agrement.service.ts
// Les demandes de rattachement : le depot par un etablissement sans compte, et
// leur examen par l'administration nationale.
//
// **Les deux premieres methodes sont publiques** - aucune session n'est
// requise, et c'est tout l'objet de cette porte : un etablissement qui n'est
// pas encore sur la plateforme n'a pas de compte pour demander a y entrer.
//
// Le contenu d'une piece ne passe pas par ici : il se lit par
// `AdminService.piece(id)`, qui existait deja et verifie les droits. En
// ajouter une seconde lecture aurait dedouble la regle d'acces.
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  ApiResponse,
  DemandeAgrementListeView,
  DemandeAgrementView,
  DepotDemandeView,
  PiecesAttenduesView,
  TypePieceAgrement,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';

/** Ce que le formulaire envoie, hors fichiers. */
export interface DepotDemandeDto {
  type: string;
  nom: string;
  prefecture: string;
  commune: string;
  quartier?: string;
  adresse: string;
  telephone: string;
  rccm?: string;
  numeroAgrementCreation?: string;
  numeroAgrementExploitation?: string;
  lieuAutorise?: string;
  /** Assurance seulement : le code propose pour les cartes des assures. */
  codeAssureur?: string;
  modeEchange?: 'MANUEL' | 'PORTAIL' | 'API';
  responsable: {
    prenom: string;
    nom: string;
    telephone: string;
    email: string;
  };
}

@Injectable({ providedIn: 'root' })
export class DemandeAgrementService {
  private readonly api = inject(ApiService);

  /**
   * Les pieces exigees, par type d'etablissement.
   *
   * L'ecran lit cette liste au lieu de la recopier : le jour ou
   * l'administration exigera une piece de plus, le formulaire la reclamera
   * sans qu'une ligne change ici.
   */
  piecesAttendues(): Observable<ApiResponse<PiecesAttenduesView[]>> {
    return this.api.get<ApiResponse<PiecesAttenduesView[]>>('/demandes-agrement/pieces-attendues');
  }

  /** Deposer un dossier, pieces comprises. */
  deposer(
    dto: DepotDemandeDto,
    pieces: Partial<Record<TypePieceAgrement, File>>,
  ): Observable<ApiResponse<DepotDemandeView>> {
    return this.api.post<ApiResponse<DepotDemandeView>>('/demandes-agrement', this.corps(dto, pieces));
  }

  /**
   * Le corps multipart, forme comme celui de `AdminService`.
   *
   * Angular laisse le navigateur poser `Content-Type` et sa frontiere des que
   * le corps est un `FormData` : il ne faut surtout pas le fixer a la main.
   * Le nom du champ est le type de piece - c'est ainsi que le serveur la
   * reconnait, et il le valide contre son enum avant de s'en servir.
   */
  private corps(dto: DepotDemandeDto, pieces: Partial<Record<TypePieceAgrement, File>>): FormData {
    const corps = new FormData();
    corps.append('donnees', JSON.stringify(dto));
    for (const [type, fichier] of Object.entries(pieces)) {
      if (fichier instanceof File) corps.append(type, fichier, fichier.name);
    }
    return corps;
  }

  // ── L'examen, pour l'administration nationale ──────────────────

  /** La liste, filtrable par etat. Sans filtre, tout. */
  lister(statut?: string): Observable<ApiResponse<DemandeAgrementListeView[]>> {
    const params = statut && statut !== 'TOUTES' ? { statut } : undefined;
    return this.api.get<ApiResponse<DemandeAgrementListeView[]>>('/demandes-agrement', params);
  }

  detail(id: string): Observable<ApiResponse<DemandeAgrementView>> {
    return this.api.get<ApiResponse<DemandeAgrementView>>(`/demandes-agrement/${id}`);
  }

  /** Mettre en cours de verification. Le motif part tel quel au candidat. */
  mettreEnAnalyse(id: string, motif: string): Observable<ApiResponse<DemandeAgrementView>> {
    return this.api.post<ApiResponse<DemandeAgrementView>>(`/demandes-agrement/${id}/analyse`, { motif });
  }

  /**
   * Valider, avec un motif : la structure et le compte de son responsable
   * naissent cote serveur - et pour une assurance, la compagnie, au code
   * corrige si `codeAssureur` est donne. Le mot de passe temporaire part par
   * courriel au responsable, il ne revient **jamais** dans cette reponse.
   */
  valider(id: string, motif: string, codeAssureur?: string): Observable<ApiResponse<DemandeAgrementView>> {
    return this.api.post<ApiResponse<DemandeAgrementView>>(
      `/demandes-agrement/${id}/validation`,
      codeAssureur ? { motif, codeAssureur } : { motif },
    );
  }

  /** Refuser. Le motif est obligatoire et parvient tel quel au candidat. */
  refuser(id: string, motif: string): Observable<ApiResponse<DemandeAgrementView>> {
    return this.api.post<ApiResponse<DemandeAgrementView>>(`/demandes-agrement/${id}/refus`, { motif });
  }
}
