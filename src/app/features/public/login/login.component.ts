import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, filter, take, timeout } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { AppUser } from '../../../core/models/user.model';
import { ToastService } from '../../../shared/services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LoadingSpinnerComponent],
  template: `
    <div class="login-container">
      <!-- Left Panel: Branding -->
      <div class="branding-panel">
        <div class="pattern-overlay"></div>
        <div class="branding-content">
          <div class="logo-area">
            <h1 class="company-name">Tropx</h1>
            <p class="tagline">Premium Wholesale Distribution</p>
          </div>
        </div>
      </div>

      <!-- Right Panel: Form -->
      <div class="form-panel">
        <header class="mobile-header">
          <h1 class="company-name">Tropx</h1>
        </header>

        <main class="form-content">
          <div class="login-card card">
            <div class="card-header">
              <h2>Welcome back</h2>
              <p>Sign in to your account</p>
            </div>

            @if (globalError()) {
              <div class="alert alert-danger">
                {{ globalError() }}
              </div>
            }

            <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="login-form">
              <!-- Email Field -->
              <div class="form-group">
                <label for="email">Email address</label>
                <input
                  type="email"
                  id="email"
                  formControlName="email"
                  placeholder="name@company.com"
                  [class.error]="isFieldInvalid('email')"
                />
                @if (isFieldInvalid('email')) {
                  <span class="field-error">Please enter a valid email</span>
                }
              </div>

              <!-- Password Field -->
              <div class="form-group">
                <label for="password">Password</label>
                <div class="password-input-wrapper">
                  <input
                    [type]="showPassword() ? 'text' : 'password'"
                    id="password"
                    formControlName="password"
                    placeholder="••••••••"
                    [class.error]="isFieldInvalid('password')"
                  />
                  <button
                    type="button"
                    class="toggle-password"
                    (click)="showPassword.set(!showPassword())"
                    aria-label="Toggle password visibility"
                  >
                    @if (showPassword()) {
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    } @else {
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    }
                  </button>
                </div>
                @if (isFieldInvalid('password')) {
                  <span class="field-error">Password is required</span>
                }
              </div>

              <button type="submit" class="btn btn-primary full-width" [disabled]="isLoading()">
                @if (isLoading()) {
                  <app-loading-spinner size="sm" class="spinner-margin"></app-loading-spinner>
                  <span>Signing in...</span>
                } @else {
                  <span>Sign in</span>
                }
              </button>
            </form>

            <div class="divider">
              <span>or</span>
            </div>

            <div class="footer-links">
              <a routerLink="/forgot-password" class="link-forgot">Forgot your password?</a>
              <a routerLink="/request-access" class="link-request">Request wholesale access &rarr;</a>
            </div>
          </div>
        </main>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100vh;
    }

    .login-container {
      display: flex;
      height: 100%;
    }

    /* Left Panel Styles */
    .branding-panel {
      display: none;
      width: 40%;
      background-color: var(--navy-deep);
      position: relative;
      overflow: hidden;

      @media (min-width: 1024px) {
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }

    .pattern-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      opacity: 0.1;
      background-image: 
        radial-gradient(circle at 20% 30%, var(--navy-mid) 0%, transparent 40%),
        radial-gradient(circle at 80% 70%, var(--navy-mid) 0%, transparent 40%);
      pointer-events: none;
    }

    .branding-content {
      position: relative;
      z-index: 1;
      text-align: center;
    }

    .company-name {
      font-size: 4rem;
      font-weight: 800;
      color: var(--white);
      margin: 0;
      letter-spacing: -0.02em;
    }

    .tagline {
      color: var(--gold-light);
      font-size: 1.25rem;
      font-weight: 500;
      margin-top: 0.5rem;
    }

    /* Right Panel Styles */
    .form-panel {
      flex: 1;
      background-color: var(--cream);
      display: flex;
      flex-direction: column;
    }

    .mobile-header {
      padding: 1.5rem;
      text-align: center;

      @media (min-width: 1024px) {
        display: none;
      }

      .company-name {
        font-size: 2rem;
        color: var(--navy-deep);
      }
    }

    .form-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .login-card {
      width: 100%;
      max-width: 440px;
      padding: 2.5rem;
    }

    .card-header {
      margin-bottom: 2rem;
      text-align: center;

      h2 {
        color: var(--navy-deep);
        font-size: 1.75rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
      }

      p {
        color: var(--gray);
        margin: 0;
      }
    }

    .login-form {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--navy-deep);
      }

      input {
        padding: 0.75rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background-color: var(--white);
        font-size: 1rem;
        transition: all 0.2s;

        &:focus {
          border-color: var(--navy);
          box-shadow: 0 0 0 3px rgba(22, 88, 142, 0.1);
        }

        &.error {
          border-color: var(--red);
        }
      }
    }

    .password-input-wrapper {
      position: relative;
      display: flex;

      input {
        width: 100%;
        padding-right: 3rem;
      }

      .toggle-password {
        position: absolute;
        right: 0.5rem;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: var(--gray);
        cursor: pointer;
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          color: var(--navy);
        }
      }
    }

    .field-error {
      font-size: 0.75rem;
      color: var(--red);
      font-weight: 500;
    }

    .alert {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .alert-danger {
      background-color: rgba(231, 34, 46, 0.1);
      color: var(--red);
      border: 1px solid rgba(231, 34, 46, 0.2);
    }

    .full-width {
      width: 100%;
    }

    .spinner-margin {
      margin-right: 0.75rem;
    }

    .divider {
      position: relative;
      text-align: center;
      margin: 2rem 0;

      &::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1px;
        background-color: var(--color-border);
      }

      span {
        position: relative;
        background-color: var(--white);
        padding: 0 1rem;
        color: var(--gray);
        font-size: 0.875rem;
      }
    }

    .footer-links {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      text-align: center;

      a {
        text-decoration: none;
        font-size: 0.875rem;
        transition: all 0.2s;
      }

      .link-forgot {
        color: var(--navy);
        &:hover { color: var(--red); }
      }

      .link-request {
        color: var(--navy);
        font-weight: 700;
        &:hover { color: var(--red); }
      }
    }
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly firestore = inject(FirestoreService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  isLoading = signal(false);
  showPassword = signal(false);
  globalError = signal<string | null>(null);
  submitted = signal(false);

  isFieldInvalid(field: string): boolean {
    const control = this.loginForm.get(field);
    return !!(this.submitted() && control && control.invalid);
  }

  async onSubmit() {
    this.submitted.set(true);
    this.globalError.set(null);

    if (this.loginForm.invalid) return;

    this.isLoading.set(true);
    const { email, password } = this.loginForm.value;

    try {
      const userCredential = await this.auth.login(email, password);
      const uid = userCredential.user.uid;

      // Read profile from Firestore to check role and status
      // We use filter/take/timeout to ensure we wait for a valid profile emission
      const profile = await firstValueFrom(
        this.firestore.getDocument<AppUser>(`users/${uid}`).pipe(
          filter(p => p !== null && p.role !== undefined && p.role !== null),
          take(1),
          timeout(5000)
        )
      ).catch(() => null);

      if (!profile) {
        await this.auth.logout();
        this.toast.error('Account setup incomplete. Contact support.');
        return;
      }

      if (profile.status === 'suspended') {
        await this.auth.logout();
        this.toast.error('Your account has been suspended. Contact support.');
        return;
      }

      // Role-based navigation
      if (['admin', 'manager', 'sales_rep', 'warehouse'].includes(profile.role)) {
        this.toast.success(`Welcome back, ${profile.firstName} ${profile.lastName}!`);
        await this.router.navigate(['/admin/dashboard']);
      } else if (profile.role === 'customer') {
        this.toast.success(`Welcome back, ${profile.firstName} ${profile.lastName}!`);
        await this.router.navigate(['/customer/dashboard']);
      } else {
        await this.auth.logout();
        this.toast.error('Unknown role. Contact support.');
      }
    } catch (error: any) {
      this.handleAuthError(error.code || error.message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private handleAuthError(code: string) {
    let message = 'An unexpected error occurred. Please try again.';


    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        message = 'Incorrect email or password';
        break;
      case 'auth/too-many-requests':
        message = 'Too many attempts. Please try again later.';
        break;
      case 'auth/user-disabled':
        message = 'Your account has been suspended. Contact support.';
        break;
    }

    this.globalError.set(message);
    this.toast.error(message);
  }
}
