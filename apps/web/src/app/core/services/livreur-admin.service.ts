import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ApiResponse,
  CreationLivreurView,
  CreerLivreurDto,
  LivreurAdminView,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';
import { corpsDossierLivreur, type TypePieceLivreur } from './candidature-livreur.service';

@Injectable({ providedIn: 'root' })
export class LivreurAdminService {
  private readonly api = inject(ApiService);

  lister(): Observable<ApiResponse<LivreurAdminView[]>> {
    return this.api.get<ApiResponse<LivreurAdminView[]>>('/comptes/livreurs');
  }

  /**
   * Creer un livreur **avec ses six pieces** : le meme dossier que celui du
   * motard qui candidate, enregistre d'emblee comme valide.
   */
  creer(
    dto: CreerLivreurDto,
    pieces: Partial<Record<TypePieceLivreur, File>>,
  ): Observable<ApiResponse<CreationLivreurView>> {
    return this.api.post<ApiResponse<CreationLivreurView>>('/comptes/livreurs', corpsDossierLivreur(dto, pieces));
  }

  definirActivite(id: string, estActif: boolean): Observable<ApiResponse<LivreurAdminView>> {
    return this.api.patch<ApiResponse<LivreurAdminView>>(`/comptes/livreurs/${id}/activite`, { estActif });
  }
}
