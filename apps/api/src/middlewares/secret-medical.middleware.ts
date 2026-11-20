// Le secret medical, pour ceux qui ne soignent pas.
//
// **L'administrateur d'une structure dirige tout, sauf le soin.** Il voit les
// admissions, les rendez-vous, les episodes, l'avancement des analyses ; il ne
// lit ni les resultats, ni les commentaires du laboratoire ou du medecin. Meme
// regle pour l'agent d'accueil (addendum du 2026-09-28).
//
// **Au seul endroit ou toutes les reponses passent.** Masquer ecran par ecran
// laisse tot ou tard une reponse ouverte : une fiche d'episode, un tableau de
// bord, le retour d'une reception d'echantillon portent eux aussi les lignes
// et leurs valeurs. Pose sur un routeur, ce filtre les retire de toute reponse
// JSON, quelle que soit la route.
import type { NextFunction, Response } from 'express';
import type { Role } from '../config/generated/client/client';
import type { AuthRequest } from './auth.middleware';

/** Les champs qui portent le contenu d'une analyse, et non son avancement. */
const CHAMPS_CLINIQUES = ['commentaireLaboratoire', 'commentaireMedecin', 'libereePar'] as const;

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(v instanceof Date);
}

/**
 * Une copie sans valeurs d'analyse : toute ligne qui porte un `resultat` le
 * perd, et l'objet qui porte ces lignes perd ses commentaires cliniques. Le
 * reste - examens demandes, statuts, dates, laboratoire - est garde : c'est ce
 * dont l'accueil et l'administration ont besoin pour faire avancer le parcours.
 */
export function masquerValeursAnalyse<T>(donnees: T): T {
  if (Array.isArray(donnees)) return donnees.map((d) => masquerValeursAnalyse(d)) as T;
  if (!estObjet(donnees)) return donnees;

  const copie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(donnees)) copie[cle] = masquerValeursAnalyse(valeur);

  const lignes = copie['lignes'];
  if (Array.isArray(lignes) && lignes.some((l) => estObjet(l) && 'resultat' in l)) {
    copie['lignes'] = lignes.map((l) => (estObjet(l) && 'resultat' in l ? { ...l, resultat: null } : l));
    for (const champ of CHAMPS_CLINIQUES) if (champ in copie) copie[champ] = null;
    // « Un resultat critique attend » dit deja quelque chose du patient : ce
    // n'est pas l'avancement de son parcours, c'est son etat.
    if ('alerteCritiqueEnAttente' in copie) copie['alerteCritiqueEnAttente'] = false;
  }
  return copie as T;
}

/** Le filtre, pour les roles donnes : leurs reponses JSON passent sans valeurs. */
export function sansValeursDAnalysePour(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.user && roles.includes(req.user.role as Role)) {
      const envoyer = res.json.bind(res);
      res.json = ((corps: unknown) => envoyer(masquerValeursAnalyse(corps))) as Response['json'];
    }
    next();
  };
}
