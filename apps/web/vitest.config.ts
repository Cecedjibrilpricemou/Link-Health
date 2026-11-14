import { defineConfig } from 'vitest/config';

/**
 * Le delai d'un test, et rien d'autre.
 *
 * Vitest laisse 5 secondes a un test par defaut. C'est large pour une
 * fonction pure, et trop court ici : monter un composant Angular dans jsdom
 * demande deja plusieurs secondes, et la suite tourne en parallele sur
 * plusieurs coeurs. Sous charge — la CI, ou un poste ou tourne aussi le
 * serveur de developpement — des tests parfaitement sains depassaient les 5
 * secondes et tombaient au hasard : `settings.pays`, `settings.reglages`,
 * `stocks`, `geographie`, `livreurs`, jamais les memes d'une execution a
 * l'autre. Un echec different a chaque passage n'est pas une regression,
 * c'est un chronometre mal regle.
 *
 * 20 secondes laissent la marge necessaire sans masquer une vraie boucle
 * infinie, qui depasserait de toute facon.
 *
 * Le reste de la configuration reste celle du builder Angular : ce fichier ne
 * declare ni environnement, ni fichiers de test, ni plugins.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
