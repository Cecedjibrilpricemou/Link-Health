// Les fichiers televerses (photos de profil, logos), servis sous /uploads sans
// authentification, sur l'origine de l'API.
//
// **Un fichier servi ici ne doit jamais pouvoir executer de script.** Les logos
// acceptent le SVG, qui peut contenir du JavaScript : ouvert directement a
// l'adresse de l'API, il s'executerait sur son origine. La politique de
// contenu `sandbox` et `default-src 'none'` l'en empechent ; `nosniff` interdit
// au navigateur de deviner un autre type que celui annonce.
//
// Une image affichee par une balise <img> n'est pas concernee par ces
// en-tetes : les ecrans du site continuent de l'afficher normalement.
import type { NextFunction, Request, Response } from 'express';

/** Aucun script, aucune ressource externe ; le style en ligne reste permis pour le rendu des SVG. */
export const CSP_FICHIERS_PUBLICS = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function entetesFichiersPublics(_req: Request, res: Response, next: NextFunction): void {
  // Le site (localhost:4200, ou le domaine du front) affiche ces images
  // depuis l'origine de l'API : sans CORP explicite, helmet() les bloque.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', CSP_FICHIERS_PUBLICS);
  next();
}

/** Ni fichier cache (.env, .git...), ni liste de dossier, ni redirection. */
export const OPTIONS_FICHIERS_PUBLICS = { dotfiles: 'deny', index: false, redirect: false } as const;
