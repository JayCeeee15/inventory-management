import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  return authService.ensureSession().pipe(
    map(user => (user ? true : router.parseUrl('/login'))),
    catchError(() => of(router.parseUrl('/login')))
  );
};
