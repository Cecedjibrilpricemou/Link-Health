// core/services/directeur.service.ts — la structure du directeur, lue une fois.
//
// Son type dit dans quel espace il travaille (accueil ou laboratoire) et quels
// menus il voit ; `hospitaliere` ouvre Pharmacies et Assurances. La reponse
// est gardee tant que le meme compte est connecte : la coquille, les gardes
// et le menu la lisent tous. Un autre compte sur le meme poste relit la
// sienne.
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import type { TypeStructure } from '@baobaoheath/shared-types';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export interface StructureDuDirecteur {
  type: TypeStructure | null;
  hospitaliere: boolean;
  /** Vrai si la structure n'a pas pu etre lue : le menu le dit. */
  illisible: boolean;
}

@Injectable({ providedIn: 'root' })
export class DirecteurService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private cache: { pour: string; reponse$: Observable<StructureDuDirecteur> } | null = null;

  structure(): Observable<StructureDuDirecteur> {
    const pour = this.auth.currentUser()?.id ?? '';
    if (this.cache?.pour !== pour) {
      const reponse$ = this.api.get<{ data?: { hospitaliere?: boolean; type?: TypeStructure } }>('/admin-structure/ma-structure').pipe(
        map((r) => ({ type: r.data?.type ?? null, hospitaliere: r.data?.hospitaliere === true, illisible: false })),
        // Une lecture en echec n'est pas gardee : la suivante reessaie.
        catchError(() => { this.cache = null; return of({ type: null, hospitaliere: false, illisible: true }); }),
        shareReplay(1),
      );
      this.cache = { pour, reponse$ };
    }
    return this.cache.reponse$;
  }
}
