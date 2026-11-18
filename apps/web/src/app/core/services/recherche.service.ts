// core/services/recherche.service.ts
// A1, A2 et A3 : la recherche publique de produits et d'officines.
//
// Aucun jeton n'est requis : ces pages sont ouvertes a tout le monde, et
// c'est exactement ce qu'on veut d'une recherche de medicament.
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ApiResponse,
  PharmacieDetailView,
  RechercheProduitsView,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class RechercheService {
  private readonly api = inject(ApiService);

  produits(
    q: string,
    prefecture?: string,
    commune?: string,
  ): Observable<ApiResponse<RechercheProduitsView>> {
    const params: Record<string, string> = { q };
    const p = (prefecture ?? '').trim();
    const c = (commune ?? '').trim();
    if (p) params['prefecture'] = p;
    if (c) params['commune'] = c;
    return this.api.get<ApiResponse<RechercheProduitsView>>('/recherche/produits', params);
  }

  /** Une officine et son rayon ; `q` y cherche un produit precis. */
  pharmacie(id: string, q?: string): Observable<ApiResponse<PharmacieDetailView>> {
    const params: Record<string, string> = {};
    const terme = (q ?? '').trim();
    if (terme) params['q'] = terme;
    return this.api.get<ApiResponse<PharmacieDetailView>>(
      `/recherche/pharmacies/${encodeURIComponent(id)}`,
      params,
    );
  }
}
