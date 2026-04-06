import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, throwError, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

export type UserRole = 'admin' | 'employee' | 'customer';

export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
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
  avatarFile?: File | null;
  removeAvatar?: boolean;
}

interface AuthResponseUser {
  id: number;
  username: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  role: UserRole;
}

interface AuthApiResponse {
  user: AuthResponseUser;
  accessToken: string;
}

interface AuthMeResponse {
  user: AuthResponseUser;
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

function normalizeUserRole(role: unknown): UserRole {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'admin') {
    return 'admin';
  }
  if (normalized === 'customer') {
    return 'customer';
  }
  return 'employee';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly AUTH_API_URL = `${environment.apiUrl}/auth`;
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'current_user';
  private readonly SESSION_VALIDATE_TIMEOUT_MS = 7000;
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
  private sessionResolvedSignal = signal(false);
  private sessionCheckingSignal = signal(false);
  private sessionValidation$?: Observable<User | null>;

  public currentUser = this.currentUserSignal.asReadonly();
  public sessionResolved = this.sessionResolvedSignal.asReadonly();
  public sessionChecking = this.sessionCheckingSignal.asReadonly();

  constructor(
    private http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (!this.isBrowser) {
      this.sessionResolvedSignal.set(true);
      return;
    }

    this.bootstrapStoredSession();
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
    return this.signupCustomer(data);
  }

  signupCustomer(data: SignupData): Observable<User> {
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

    const formData = new FormData();
    formData.set('fullName', data.fullName.trim());
    formData.set('email', data.email.trim().toLowerCase());
    formData.set('username', data.username.trim());

    if (data.removeAvatar) {
      formData.set('removeAvatar', 'true');
    }

    if (data.avatarFile) {
      formData.set('avatar', data.avatarFile);
    }

    return this.http
      .put<AuthApiResponse>(`${this.AUTH_API_URL}/profile`, formData)
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
            if (apiCode === 'INVALID_AVATAR_FILE') {
              return throwError(() => new Error('INVALID_AVATAR_FILE'));
            }

            if (apiCode === 'AVATAR_TOO_LARGE') {
              return throwError(() => new Error('AVATAR_TOO_LARGE'));
            }

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

  ensureSession(options: { force?: boolean } = {}): Observable<User | null> {
    if (!this.isBrowser) {
      this.currentUserSignal.set(null);
      this.sessionResolvedSignal.set(true);
      return of(null);
    }

    const token = this.getStoredToken();
    if (!token) {
      this.clearSessionState(true);
      this.sessionResolvedSignal.set(true);
      return of(null);
    }

    if (!options.force && this.currentUserSignal()) {
      this.sessionResolvedSignal.set(true);
      return of(this.currentUserSignal());
    }

    if (!options.force && this.sessionValidation$) {
      return this.sessionValidation$;
    }

    this.sessionResolvedSignal.set(false);
    this.sessionCheckingSignal.set(true);

    const request$ = this.http.get<AuthMeResponse>(`${this.AUTH_API_URL}/me`).pipe(
      timeout(this.SESSION_VALIDATE_TIMEOUT_MS),
      map(response => {
        if (token !== this.getStoredToken()) {
          return null;
        }

        return this.applyValidatedSession(response, token);
      }),
      catchError(error => this.handleSessionValidationError(error)),
      finalize(() => {
        this.sessionCheckingSignal.set(false);
        this.sessionResolvedSignal.set(true);
        this.sessionValidation$ = undefined;
      }),
      shareReplay(1)
    );

    this.sessionValidation$ = request$;
    return request$;
  }

  logout(): void {
    this.clearSessionState(true);
    this.sessionResolvedSignal.set(true);
    this.router.navigate(['/']);
  }

  isAuthenticated(): boolean {
    return !!this.currentUserSignal();
  }

  hasStoredToken(): boolean {
    return !!this.getStoredToken();
  }

  getToken(): string | null {
    return this.getStoredToken();
  }

  getDashboardRoute(user: User | null): string {
    if (!user) {
      return '/login';
    }

    if (user.role === 'admin') {
      return '/dashboard';
    }

    if (user.role === 'employee') {
      return '/employee-dashboard';
    }

    return '/';
  }

  getCurrentDashboardRoute(): string {
    return this.getDashboardRoute(this.currentUserSignal());
  }

  private applyAuthResponse(response: AuthApiResponse): User {
    if (!response?.user || !response?.accessToken) {
      throw new Error('AUTH_UNAVAILABLE');
    }

    const user = this.mapUser(response.user, String(response.accessToken));
    this.setSession(user);
    return user;
  }

  private applyValidatedSession(response: AuthMeResponse, token: string): User {
    if (!response?.user) {
      throw new Error('AUTH_UNAVAILABLE');
    }

    const user = this.mapUser(response.user, token);
    this.setSession(user);
    return user;
  }

  private mapUser(user: AuthResponseUser, token: string): User {
    return {
      id: Number(user.id),
      username: String(user.username),
      fullName: String(user.fullName || user.username || '').trim(),
      email: String(user.email || '').trim().toLowerCase(),
      avatarUrl: user.avatarUrl ? String(user.avatarUrl) : null,
      token,
      role: normalizeUserRole(user.role)
    };
  }

  private setSession(user: User): void {
    if (this.isBrowser) {
      localStorage.setItem(this.TOKEN_KEY, user.token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('username', user.username);
    }

    this.currentUserSignal.set(user);
    this.sessionResolvedSignal.set(true);
  }

  private bootstrapStoredSession(): void {
    if (!this.hasStoredToken()) {
      this.clearSessionStorage();
      this.sessionResolvedSignal.set(true);
      return;
    }

    this.ensureSession().subscribe({
      next: () => undefined,
      error: () => undefined
    });
  }

  private handleSessionValidationError(error: unknown): Observable<User | null> {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
      this.clearSessionState(true);
      return of(null);
    }

    this.currentUserSignal.set(null);
    return of(null);
  }

  private clearSessionState(clearStorage: boolean): void {
    if (clearStorage) {
      this.clearSessionStorage();
    }

    this.currentUserSignal.set(null);
    this.sessionValidation$ = undefined;
  }

  private clearSessionStorage(): void {
    if (!this.isBrowser) {
      return;
    }

    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
  }

  private getStoredToken(): string | null {
    if (!this.isBrowser) {
      return null;
    }

    return localStorage.getItem(this.TOKEN_KEY);
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
