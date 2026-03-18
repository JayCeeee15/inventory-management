import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize, switchMap, timer } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css']
})
export class SignupComponent {
  private readonly submitDelayMs = 700;
  submitted = false;
  loading = false;
  errorMessage = '';
  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      fullName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  onSubmit(): void {
    if (this.form.invalid || this.loading) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    if (!value.fullName || !value.email || !value.username || !value.password) {
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    timer(this.submitDelayMs)
      .pipe(
        switchMap(() =>
          this.authService.signupCustomer({
            fullName: value.fullName,
            email: value.email,
            username: value.username,
            password: value.password
          })
        ),
        finalize(() => (this.loading = false))
      )
      .subscribe({
        next: user => {
          this.submitted = true;
          this.router.navigate([this.authService.getDashboardRoute(user)]);
        },
        error: (error: Error) => {
          if (error.message === 'USERNAME_EXISTS') {
            this.errorMessage = 'Username already exists. Choose another username.';
            return;
          }
          if (error.message === 'INVALID_SIGNUP') {
            this.errorMessage = 'Please provide a valid full name, email, username, and password.';
            return;
          }

          if (error.message === 'AUTH_UNAVAILABLE') {
            this.errorMessage = 'Auth server unavailable. Please try again later.';
            return;
          }

          this.errorMessage = 'Failed to create customer account.';
        }
      });
  }
}
