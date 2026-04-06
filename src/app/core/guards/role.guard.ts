import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService, UserRole } from '../services/auth.service';

export const roleGuard = (allowedRoles: UserRole[]): CanActivateFn => {
  return () => {
    const router = inject(Router);
    const authService = inject(AuthService);

    return authService.ensureSession().pipe(
      map(currentUser => {
        if (currentUser && allowedRoles.includes(currentUser.role)) {
          return true;
        }

        return router.parseUrl(authService.getDashboardRoute(currentUser));
      }),
      catchError(() => of(router.parseUrl('/login')))
    );
  };
};
