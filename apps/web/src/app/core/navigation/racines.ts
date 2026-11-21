// core/navigation/racines.ts — ou vivent les ecrans de l'accueil et du laboratoire.
//
// **Un ecran, deux espaces.** Les ecrans de l'accueil et du laboratoire
// servent leur personnel (/hopital, /laboratoire) et aussi le directeur de
// l'etablissement, dans ce meme espace - y compris le laboratoire d'un
// hopital, qu'il suit sous /hopital/laboratoire. Leurs liens internes partent
// de cette racine au lieu d'un chemin ecrit en dur : sans elle, un clic le
// ferait basculer dans l'espace d'un autre metier.
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
