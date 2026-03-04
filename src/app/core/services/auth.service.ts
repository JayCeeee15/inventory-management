import { Injectable, Inject, PLATFORM_ID, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, throwError, timeout } from 'rxjs';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

export type UserRole = 'admin' | 'employee';

export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  token: string;
  role: UserRole;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SignupData {
  fullName: string;
  email: string;
  username: string;
  password: string;
}

export interface ProfileUpdateInput {
  fullName: string;
  email: string;
  username: string;
}

interface AuthResponseUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
}

interface AuthApiResponse {
  user: AuthResponseUser;
  accessToken: string;
}

interface AuthHealthResponse {
  status?: string;
  service?: string;
  database?: string;
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

interface FallbackUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  password: string;
  token: string;
  role: UserRole;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly AUTH_API_URL = `${environment.apiUrl}/auth`;
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'current_user';
  private readonly isBrowser: boolean;

  private readonly FALLBACK_USERS: FallbackUser[] = [
    {
      id: 1,
      username: 'admin',
      fullName: 'System Administrator',
      email: 'admin@hospital.local',
      password: 'admin123',
      token: 'fallback-token-admin',
      role: 'admin'
    },
    {
      id: 2,
      username: 'user',
      fullName: 'Hospital Staff',
      email: 'user@hospital.local',
      password: 'user123',
      token: 'fallback-token-user',
      role: 'employee'
    }
  ];

  private currentUserSignal = signal<User | null>(null);
  public currentUser = this.currentUserSignal.asReadonly();

  constructor(
    private http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.loadStoredUser();
  }

  login(credentials: LoginCredentials): Observable<User> {
    const username = credentials.username.trim();

    if (environment.allowFallbackAuth) {
      const fallback = this.FALLBACK_USERS.find(
        user => user.username === username && user.password === credentials.password
      );

      if (fallback) {
        const user: User = {
          id: fallback.id,
          username: fallback.username,
          fullName: fallback.fullName,
          email: fallback.email,
          token: fallback.token,
          role: fallback.role
        };
        this.setSession(user);
        return of(user);
      }
    }

    return this.http
      .post<AuthApiResponse>(`${this.AUTH_API_URL}/login`, {
        username,
        password: credentials.password
      })
      .pipe(
        timeout(7000),
        map(response => this.applyAuthResponse(response)),
        catchError(error => this.handleAuthError(error, true))
      );
  }

  signupEmployee(data: SignupData): Observable<User> {
    if (!this.isBrowser) {
      return throwError(() => new Error('AUTH_UNAVAILABLE'));
    }

    return this.http
      .post<AuthApiResponse>(`${this.AUTH_API_URL}/signup`, {
        fullName: data.fullName.trim(),
        email: data.email.trim().toLowerCase(),
        username: data.username.trim(),
        password: data.password
      })
      .pipe(
        timeout(7000),
        map(response => this.applyAuthResponse(response)),
        catchError(error => this.handleAuthError(error, false))
      );
  }

  updateProfile(data: ProfileUpdateInput): Observable<User> {
    if (!this.isBrowser) {
      return throwError(() => new Error('AUTH_UNAVAILABLE'));
    }

    return this.http
      .put<AuthApiResponse>(`${this.AUTH_API_URL}/profile`, {
        fullName: data.fullName.trim(),
        email: data.email.trim().toLowerCase(),
        username: data.username.trim()
      })
      .pipe(
        timeout(7000),
        map(response => this.applyAuthResponse(response)),
        catchError(error => {
          if (!(error instanceof HttpErrorResponse)) {
            return throwError(() => new Error('AUTH_UNAVAILABLE'));
          }

          const errorBody = (error.error || {}) as ApiErrorPayload;
          const apiCode = String(errorBody.error || '').toUpperCase();

          if (error.status === 409 && apiCode === 'USERNAME_EXISTS') {
            return throwError(() => new Error('USERNAME_EXISTS'));
          }

          if (error.status === 409 && apiCode === 'EMAIL_EXISTS') {
            return throwError(() => new Error('EMAIL_EXISTS'));
          }

          if (error.status === 400) {
            return throwError(() => new Error('INVALID_PROFILE'));
          }

          return throwError(() => new Error('AUTH_UNAVAILABLE'));
        })
      );
  }

  checkAuthApiHealth(): Observable<boolean> {
    if (!this.isBrowser) {
      return of(false);
    }

    return this.http.get<AuthHealthResponse>(`${environment.apiUrl}/health`).pipe(
      timeout(3500),
      map(response => response?.status === 'ok' && response?.database === 'connected'),
      catchError(() => of(false))
    );
  }

  logout(): void {
    if (this.isBrowser) {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('username');
    }

    this.currentUserSignal.set(null);
    this.router.navigate(['/']);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getToken(): string | null {
    if (!this.isBrowser) {
      return null;
    }

    return localStorage.getItem(this.TOKEN_KEY);
  }

  getDashboardRoute(user: User | null): string {
    if (!user) {
      return '/login';
    }

    return user.role === 'admin' ? '/dashboard' : '/employee-dashboard';
  }

  getCurrentDashboardRoute(): string {
    return this.getDashboardRoute(this.currentUserSignal());
  }

  private applyAuthResponse(response: AuthApiResponse): User {
    if (!response?.user || !response?.accessToken) {
      throw new Error('AUTH_UNAVAILABLE');
    }

    const user: User = {
      id: Number(response.user.id),
      username: String(response.user.username),
      fullName: String(response.user.fullName || response.user.username || '').trim(),
      email: String(response.user.email || '').trim().toLowerCase(),
      token: String(response.accessToken),
      role: response.user.role === 'admin' ? 'admin' : 'employee'
    };

    this.setSession(user);
    return user;
  }

  private setSession(user: User): void {
    if (this.isBrowser) {
      localStorage.setItem(this.TOKEN_KEY, user.token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('username', user.username);
    }

    this.currentUserSignal.set(user);
  }

  private loadStoredUser(): void {
    if (!this.isBrowser) {
      return;
    }

    const userStr = localStorage.getItem(this.USER_KEY);
    const token = localStorage.getItem(this.TOKEN_KEY);

    if (!userStr || !token) {
      return;
    }

    try {
      const parsedUser = JSON.parse(userStr) as Partial<User>;

      const user: User = {
        id: Number(parsedUser.id ?? 0),
        username: String(parsedUser.username ?? ''),
        fullName: String(parsedUser.fullName ?? parsedUser.username ?? '').trim(),
        email: String(parsedUser.email ?? '').trim().toLowerCase(),
        token: String(token),
        role: parsedUser.role === 'admin' ? 'admin' : 'employee'
      };

      if (user.id && user.username && user.token) {
        this.currentUserSignal.set(user);
      }
    } catch (error) {
      console.error('Failed to parse stored user', error);
    }
  }

  private handleAuthError(error: unknown, isLoginRequest: boolean): Observable<never> {
    if (
      error instanceof Error &&
      ['INVALID_CREDENTIALS', 'USERNAME_EXISTS', 'TOO_MANY_ATTEMPTS'].includes(error.message)
    ) {
      return throwError(() => error);
    }

    if (!(error instanceof HttpErrorResponse)) {
      return throwError(() => new Error('AUTH_UNAVAILABLE'));
    }

    const errorBody = (error.error || {}) as ApiErrorPayload;
    const apiCode = String(errorBody.error || '').toUpperCase();

    if (isLoginRequest) {
      if (error.status === 401 || apiCode === 'INVALID_CREDENTIALS') {
        return throwError(() => new Error('INVALID_CREDENTIALS'));
      }

      if (error.status === 429 || apiCode === 'TOO_MANY_ATTEMPTS') {
        return throwError(() => new Error('TOO_MANY_ATTEMPTS'));
      }

      return throwError(() => new Error('AUTH_UNAVAILABLE'));
    }

    if (error.status === 409 && (apiCode === 'USERNAME_EXISTS' || apiCode === 'EMAIL_EXISTS')) {
      return throwError(() => new Error('USERNAME_EXISTS'));
    }

    if (error.status === 400) {
      return throwError(() => new Error('INVALID_SIGNUP'));
    }

    return throwError(() => new Error('AUTH_UNAVAILABLE'));
  }
}
