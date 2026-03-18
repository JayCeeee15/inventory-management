import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, UserRole } from '../services/auth.service';

export const roleGuard = (allowedRoles: UserRole[]): CanActivateFn => {
  return () => {
    const router = inject(Router);
    const authService = inject(AuthService);
    const currentUser = authService.currentUser();

    if (currentUser && allowedRoles.includes(currentUser.role)) {
      return true;
    }

    return router.parseUrl(authService.getCurrentDashboardRoute());
  };
};
