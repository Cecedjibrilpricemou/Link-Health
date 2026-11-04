// core/guards/role.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Role } from '../models/user.model';
import { accueilDuRole } from '../navigation/accueil-par-role';

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const router      = inject(Router);

  const allowedRoles: Role[] = route.data?.['roles'] ?? [];
  const userRole = authService.userRole();

  // Pas de restriction de rôle → accès libre
  if (allowedRoles.length === 0) return true;

  // Rôle autorisé → accès accordé
  if (userRole && allowedRoles.includes(userRole)) return true;

  // Rôle non autorisé → rediriger vers la bonne page selon le rôle
  const redirectUrl = accueilDuRole(userRole) ?? '/unauthorized';
  router.navigate([redirectUrl]);
  return false;
};