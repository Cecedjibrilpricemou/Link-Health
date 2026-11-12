// core/services/recherche.service.ts
// A1 : la recherche publique de produits.
//
// Aucun jeton n'est requis : la page est ouverte a tout le monde, et c'est
// exactement ce qu'on veut d'une recherche de medicament.
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ApiResponse, RechercheProduitsView } from '@baobaoheath/shared-types';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class RechercheService {
  private readonly api = inject(ApiService);

  produits(
    q: string,
    prefecture: string,
    commune?: string,
  ): Observable<ApiResponse<RechercheProduitsView>> {
    const params: Record<string, string> = { q, prefecture };
    const c = (commune ?? '').trim();
    if (c) params['commune'] = c;
    return this.api.get<ApiResponse<RechercheProduitsView>>('/recherche/produits', params);
  }
}
