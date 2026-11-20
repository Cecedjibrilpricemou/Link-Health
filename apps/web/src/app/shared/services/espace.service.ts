// shared/services/espace.service.ts — ce que l'interface affiche en tete.
//
// **La structure, pas la plateforme.** Le personnel voit le nom et le logo de
// son etablissement ; le patient, ceux de sa structure par defaut, pour la
// lui rappeler. Seule l'administration de la plateforme garde son nom.
//
// Sans structure (un patient qui n'en a pas encore, un livreur), un libelle
// neutre : « Mon espace santé », « Espace livreur ».
import { Injectable, computed, inject } from '@angular/core';
import type { Role } from '@baobaoheath/shared-types';

import { AuthService } from '../../core/services/auth.service';
import { I18nService } from './i18n.service';
import { urlMedia } from '../utils/url-media';
import { monogramme } from '../utils/monogramme';

/** L'administration de la plateforme : elle garde le nom de la plateforme. */
export const ROLES_PLATEFORME: readonly Role[] = ['SUPER_ADMIN', 'ADMIN_NATIONAL', 'ADMIN_REGIONAL'];

export interface EspaceAffiche {
  nom: string;
  /** L'adresse du logo, prete a afficher ; vide : monogramme ou icone. */
  logo: string;
  /** Les initiales, quand l'espace est une structure sans logo. */
  monogramme: string;
  /** L'icone d'un espace sans structure (`pi-heart`...). */
  icone: string;
  /** `true` : c'est une structure, et non un libelle neutre. */
  estStructure: boolean;
}

@Injectable({ providedIn: 'root' })
export class EspaceService {
  private auth = inject(AuthService);
  private i18n = inject(I18nService);

  /** `null` : la plateforme (administration, ou personne de connecte). */
  readonly espace = computed<EspaceAffiche | null>(() => {
    const u = this.auth.currentUser();
    if (!u || ROLES_PLATEFORME.includes(u.role)) return null;
    const s = u.structure;
    if (s) {
      return { nom: s.nom, logo: urlMedia(s.logoUrl), monogramme: monogramme(s.nom), icone: '', estStructure: true };
    }
    // La langue lue ici fait recalculer le libelle quand elle change.
    this.i18n.lang();
    const neutre = u.role === 'PATIENT'
      ? { cle: 'ESPACE.PATIENT', icone: 'pi-heart' }
      : u.role === 'LIVREUR'
        ? { cle: 'ESPACE.LIVREUR', icone: 'pi-send' }
        : { cle: 'ESPACE.PROFESSIONNEL', icone: 'pi-building' };
    return { nom: this.i18n.t(neutre.cle), logo: '', monogramme: '', icone: neutre.icone, estStructure: false };
  });
}
