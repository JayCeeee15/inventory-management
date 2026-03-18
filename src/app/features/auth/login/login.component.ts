import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize, switchMap, timer } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService, User } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly submitDelayMs = 700;
  private readonly healthCheckIntervalMs = 10000;
  private healthCheckSub?: Subscription;

  hidePassword = true;
  isLoading = false;
  errorMessage = '';
  apiStatus: 'checking' | 'online' | 'offline' = 'checking';
  loginForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(3)]]
    });
  }

  ngOnInit(): void {
    this.startHealthMonitoring();
  }

  ngOnDestroy(): void {
    this.healthCheckSub?.unsubscribe();
  }

  get isApiOnline(): boolean {
    return this.apiStatus === 'online';
  }

  get apiStatusLabel(): string {
    if (this.apiStatus === 'online') {
      return 'Auth API online';
    }

    if (this.apiStatus === 'offline') {
      return 'Auth API offline';
    }

    return 'Checking Auth API...';
  }

  onSubmit(): void {
    if (this.loginForm.invalid || this.isLoading) {
      return;
    }

    if (!this.isApiOnline) {
      this.errorMessage = 'Auth API is offline. Please wait for reconnection.';
      return;
    }

    const { username, password } = this.loginForm.getRawValue();

    if (!username || !password) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    timer(this.submitDelayMs)
      .pipe(
        switchMap(() => this.authService.login({ username, password })),
        finalize(() => (this.isLoading = false))
      )
      .subscribe({
        next: (user: User) => this.router.navigate([this.authService.getDashboardRoute(user)]),
        error: (error: Error) => {
          if (error?.message === 'TOO_MANY_ATTEMPTS') {
            this.errorMessage = 'Too many failed login attempts. Please wait and try again.';
            return;
          }

          if (error?.message === 'AUTH_UNAVAILABLE') {
            this.errorMessage = 'Auth server unreachable. Check API and MySQL connection.';
            return;
          }

          this.errorMessage = 'Invalid credentials. Use admin/admin123 or user/user123';
        }
      });
  }

  private startHealthMonitoring(): void {
    this.healthCheckSub = timer(0, this.healthCheckIntervalMs)
      .pipe(switchMap(() => this.authService.checkAuthApiHealth()))
      .subscribe({
        next: isOnline => {
          this.apiStatus = isOnline ? 'online' : 'offline';

          if (
            isOnline &&
            (this.errorMessage.includes('Auth API is offline') ||
              this.errorMessage.includes('Auth server unreachable'))
          ) {
            this.errorMessage = '';
          }
        },
        error: () => {
          this.apiStatus = 'offline';
        }
      });
  }
}
