// L'etiquette de l'espace du praticien.
//
// Le medecin et la sage-femme partagent les memes ecrans. Chaque page portait
// en tete « Médecin » : une sage-femme y lisait un metier qui n'est pas le
// sien. L'etiquette suit desormais le role du compte connecte.
import { computed, inject, type Signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

/** La cle i18n de l'etiquette : a appeler dans un contexte d'injection. */
export function roleDeLEspace(): Signal<string> {
  const auth = inject(AuthService);
  return computed(() => (auth.currentUser()?.role === 'SAGE_FEMME' ? 'ROLE.SAGE_FEMME' : 'MEDECIN.ROLE'));
}
