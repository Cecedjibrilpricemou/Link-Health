// core/guards/directeur.guard.ts — le directeur, toujours dans le bon espace.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { DirecteurService } from '../services/directeur.service';
import { espaceDuDirecteur, traduireAncienneAdresse } from '../navigation/menu-directeur';

/**
 * Les anciennes adresses `/admin-structure/...` : traduites vers l'ecran
 * equivalent de l'espace de l'etablissement. Un favori ou un lien recu par
 * courriel continue de mener au bon endroit.
 */
export const ancienneAdresseDirecteurGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  return inject(DirecteurService).structure().pipe(
    map((s) => router.parseUrl(traduireAncienneAdresse(state.url, s.type))),
  );
};

/**
 * Le directeur d'un laboratoire travaille dans `/laboratoire`, celui d'un
 * hopital ou d'un centre dans `/hopital` : une adresse de l'autre espace le
 * ramene a son pilotage. Le personnel n'est pas concerne.
 */
export const espaceDirecteurGuard = (espace: '/hopital' | '/laboratoire'): CanActivateFn => () => {
  if (inject(AuthService).currentUser()?.role !== 'ADMIN_STRUCTURE') return true;
  const router = inject(Router);
  return inject(DirecteurService).structure().pipe(
    map((s) => {
      // Structure illisible : on laisse entrer, le menu dira l'echec.
      if (s.illisible) return true;
      const sien = espaceDuDirecteur(s.type);
      return sien === espace ? true : router.parseUrl(`${sien}/pilotage`);
    }),
  );
};
