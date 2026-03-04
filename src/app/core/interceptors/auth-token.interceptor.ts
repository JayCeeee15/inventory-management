import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  if (req.headers.has('Authorization')) {
    return next(req);
  }

  if (/\/auth\/(login|signup)$/i.test(req.url)) {
    return next(req);
  }

  const hasWindow = typeof window !== 'undefined';
  const token = hasWindow ? localStorage.getItem('auth_token') : null;

  if (!token) {
    return next(req);
  }

  const authorizedReq = req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });

  return next(authorizedReq);
};
