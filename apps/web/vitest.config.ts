import { defineConfig } from 'vitest/config';

/**
 * Deux reglages du lanceur de tests, et rien d'autre.
 *
 * **`isolate`** — chaque fichier de test doit partir d'un registre de modules
 * neuf. Sans cela, plusieurs fichiers se partagent le meme, et un module deja
 * charge par un autre fichier echappe au `vi.mock` du fichier courant. Le
 * symptome etait deroutant : le spec de la carte simulait Leaflet, le
 * composant utilisait le vrai, et les compteurs de la simulation restaient a
 * zero — « expected to be called 2 times, but got 0 times ». Vert quand le
 * fichier tournait seul, rouge une fois sur deux dans la suite complete,
 * selon l'ordre dans lequel les fichiers tombaient sur un meme processus.
 *
 * Le prix est reel : la suite passe d'environ 25 a 60 secondes. Un test qui
 * ment coute plus cher.
 *
 * **`testTimeout`** — Vitest laisse 5 secondes a un test. C'est large pour une
 * fonction pure, et trop court ici : monter un composant Angular dans jsdom
 * en demande plusieurs, et la suite tourne en parallele. Sous charge, des
 * tests parfaitement sains depassaient les 5 secondes et tombaient au
 * hasard — `settings.pays`, `settings.reglages`, `stocks`, `geographie`,
 * `livreurs`, jamais les memes. 20 secondes laissent la marge sans masquer
 * une boucle infinie, qui depasserait de toute facon.
 *
 * Le reste reste la configuration du builder Angular : ce fichier ne declare
 * ni environnement, ni fichiers de test, ni plugins.
 */
export default defineConfig({
  test: {
    isolate: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
