// core/navigation/racines.ts — ou vivent les ecrans de l'accueil et du laboratoire.
//
// **Un ecran, deux espaces.** Les ecrans de l'accueil et du laboratoire
// servent leur personnel (/hopital, /laboratoire) et aussi l'administrateur
// de la structure, dans sa propre interface (/admin-structure/accueil,
// /admin-structure/laboratoire). Leurs liens internes partent de cette racine
// au lieu d'un chemin ecrit en dur : sans elle, un clic de l'administrateur
// le ferait basculer dans l'interface d'un autre metier.
//
// Les routes de l'administrateur fournissent leur propre valeur ; partout
// ailleurs, c'est celle du metier.
import { InjectionToken } from '@angular/core';

export const RACINE_ACCUEIL = new InjectionToken<string>('RACINE_ACCUEIL', {
  providedIn: 'root',
  factory: () => '/hopital',
});

export const RACINE_LABO = new InjectionToken<string>('RACINE_LABO', {
  providedIn: 'root',
  factory: () => '/laboratoire',
});
