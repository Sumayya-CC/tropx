import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PublicNavbarComponent } from '../../../shared/components/public-navbar/public-navbar.component';
import { PublicFooterComponent } from '../../../shared/components/public-footer/public-footer.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PublicNavbarComponent,
    PublicFooterComponent,
    LoadingSpinnerComponent
  ],
  template: `
    <app-public-navbar />

    <div class="forgot-password-page">
      <header class="page-header">
        <span class="label-recovery">ACCOUNT RECOVERY</span>
        <h1>Forgot your password?</h1>
        <p class="subtext">
          Enter your email address and we'll send you 
          a link to reset your password.
        </p>
      </header>

      <div class="form-container">
        <div class="form-card">
          @if (isSubmitted()) {
            <div class="success-state">
              <div class="email-icon-wrapper">
                <span class="email-icon">✉️</span>
              </div>
              <h2>Check your email</h2>
              <p class="body-text">
                We've sent a password reset link to <b>{{ submittedEmail() }}</b>. 
                Check your inbox and follow the instructions.
              </p>
              <p class="note">
                Didn't receive it? Check your spam folder 
                or try again.
              </p>
              
              <button class="btn-ghost" (click)="onReset()">
                Try a different email
              </button>

              <div class="auth-footer">
                <a routerLink="/login" class="link-back">← Back to Sign In</a>
              </div>
            </div>
          } @else {
            <form [formGroup]="resetForm" (ngSubmit)="onSubmit()">
              <div class="form-group">
                <label for="email">Email Address</label>
                <input 
                  id="email" 
                  type="email" 
                  formControlName="email" 
                  placeholder="Enter your email"
                  [class.error]="isInvalid('email') || errorMessage()"
                  autocomplete="email"
                />
                @if (isInvalid('email')) {
                  <span class="error-text">Please enter a valid email address</span>
                }
                @if (errorMessage()) {
                  <span class="error-text">{{ errorMessage() }}</span>
                }
              </div>

              <button type="submit" class="btn-submit" [disabled]="isSubmitting()">
                @if (isSubmitting()) {
                  <app-loading-spinner size="sm" />
                  <span>Sending Link...</span>
                } @else {
                  <span>Send Reset Link</span>
                }
              </button>

              <div class="auth-footer">
                <a routerLink="/login" class="link-back">← Back to Sign In</a>
              </div>
            </form>
          }
        </div>
      </div>
    </div>

    <app-public-footer />
  `,
  styleUrl: './forgot-password.component.scss'
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private title = inject(Title);

  isSubmitting = signal(false);
  isSubmitted = signal(false);
  errorMessage = signal<string | null>(null);
  submittedEmail = signal('');

  resetForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  constructor() {
    this.title.setTitle('Forgot Password — Tropx Wholesale');
  }

  isInvalid(controlName: string): boolean {
    const control = this.resetForm.get(controlName);
    return !!(control && control.invalid && (control.touched || control.dirty));
  }

  async onSubmit() {
    if (this.resetForm.invalid || this.isSubmitting()) {
      this.resetForm.markAllAsTouched();
      return;
    }

    const email = this.resetForm.get('email')?.value?.trim();
    if (!email) return;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.auth.resetPassword(email);
      this.submittedEmail.set(email);
      this.isSubmitted.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      console.error('Password reset error:', error);
      
      // auth/user-not-found is handled by still showing success state for security
      if (error.code === 'auth/user-not-found') {
        this.submittedEmail.set(email);
        this.isSubmitted.set(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (error.code === 'auth/too-many-requests') {
        this.errorMessage.set('Too many attempts. Please try again later.');
      } else {
        this.errorMessage.set('Something went wrong. Please try again.');
      }
    } finally {
      this.isSubmitting.set(false);
    }
  }

  onReset() {
    this.isSubmitted.set(false);
    this.errorMessage.set(null);
    this.resetForm.reset();
  }
}
