import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { serverTimestamp } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { PublicNavbarComponent } from '../../../shared/components/public-navbar/public-navbar.component';
import { PublicFooterComponent } from '../../../shared/components/public-footer/public-footer.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

const BUSINESS_TYPES = [
  'Convenience Store', 'Gas Station', 'Grocery Store',
  'Corner Store', 'Pharmacy', 'Restaurant / Café',
  'Online Retailer', 'Wholesale Buyer', 'Other'
];

const PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' }
];

@Component({
  selector: 'app-request-access',
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

    <div class="request-access-page">
      <header class="page-header">
        <span class="label-join">JOIN OUR NETWORK</span>
        <h1>Request Wholesale Access</h1>
        <p class="subtext">
          Fill in your details below and we'll review 
          your application within 24 hours.
        </p>
      </header>

      <div class="form-container">
        <div class="form-card">
          @if (isSubmitted()) {
            <div class="success-state">
              <div class="check-icon"></div>
              <h2>Application Submitted!</h2>
              <p>
                Thank you, <b>{{ submittedBusinessName }}</b>! We've received your 
                application and will review it within 24 hours. 
                You'll hear from us at <b>{{ submittedEmail }}</b>.
              </p>
              <a routerLink="/" class="btn-home">Back to Home</a>
            </div>
          } @else {
            <form [formGroup]="accessForm" (ngSubmit)="onSubmit()">
              <!-- Row 1 -->
              <div class="form-row">
                <div class="form-group">
                  <label for="businessName">Business Name</label>
                  <input 
                    id="businessName" 
                    type="text" 
                    formControlName="businessName" 
                    placeholder="Your Store or Company Name"
                    [class.error]="isInvalid('businessName')"
                  />
                  @if (isInvalid('businessName')) {
                    <span class="error-text">Business name is required</span>
                  }
                </div>
                <div class="form-group">
                  <label for="businessType">Business Type</label>
                  <select 
                    id="businessType" 
                    formControlName="businessType"
                    [class.error]="isInvalid('businessType')"
                  >
                    <option value="">Select business type</option>
                    @for (type of businessTypes; track type) {
                      <option [value]="type">{{ type }}</option>
                    }
                  </select>
                  @if (isInvalid('businessType')) {
                    <span class="error-text">Please select a business type</span>
                  }
                </div>
              </div>

              <!-- Row 2 -->
              <div class="form-row">
                <div class="form-group">
                  <label for="ownerName">Owner / Contact Name</label>
                  <input 
                    id="ownerName" 
                    type="text" 
                    formControlName="ownerName" 
                    placeholder="Full name"
                    [class.error]="isInvalid('ownerName')"
                  />
                  @if (isInvalid('ownerName')) {
                    <span class="error-text">Contact name is required</span>
                  }
                </div>
                <div class="form-group">
                  <label for="phone">Phone Number</label>
                  <input 
                    id="phone" 
                    type="tel" 
                    formControlName="phone" 
                    placeholder="(519) 000-0000"
                    [class.error]="isInvalid('phone')"
                  />
                  @if (isInvalid('phone')) {
                    <span class="error-text">Valid phone number is required (min 10 digits)</span>
                  }
                </div>
              </div>

              <!-- Row 3 -->
              <div class="form-group full-width">
                <label for="email">Email Address</label>
                <input 
                  id="email" 
                  type="email" 
                  formControlName="email" 
                  placeholder="business@example.com"
                  [class.error]="isInvalid('email')"
                />
                @if (isInvalid('email')) {
                  @if (accessForm.get('email')?.errors?.['required']) {
                    <span class="error-text">Email address is required</span>
                  } @else {
                    <span class="error-text">Please enter a valid email address</span>
                  }
                }
              </div>

              <!-- Row 4 -->
              <div class="form-group full-width">
                <label for="street">Street Address</label>
                <input 
                  id="street" 
                  type="text" 
                  formControlName="street" 
                  placeholder="123 Main Street"
                  [class.error]="isInvalid('street')"
                />
                @if (isInvalid('street')) {
                  <span class="error-text">Street address is required</span>
                }
              </div>

              <!-- Row 5 -->
              <div class="form-row three-cols">
                <div class="form-group">
                  <label for="city">City</label>
                  <input 
                    id="city" 
                    type="text" 
                    formControlName="city" 
                    placeholder="Kitchener"
                    [class.error]="isInvalid('city')"
                  />
                  @if (isInvalid('city')) {
                    <span class="error-text">City is required</span>
                  }
                </div>
                <div class="form-group">
                  <label for="province">Province</label>
                  <select 
                    id="province" 
                    formControlName="province"
                    [class.error]="isInvalid('province')"
                  >
                    <option value="">Province</option>
                    @for (prov of provinces; track prov.code) {
                      <option [value]="prov.code">{{ prov.name }}</option>
                    }
                  </select>
                  @if (isInvalid('province')) {
                    <span class="error-text">Required</span>
                  }
                </div>
                <div class="form-group">
                  <label for="postalCode">Postal Code</label>
                  <input 
                    id="postalCode" 
                    type="text" 
                    formControlName="postalCode" 
                    placeholder="N2G 1A1"
                    [class.error]="isInvalid('postalCode')"
                  />
                  @if (isInvalid('postalCode')) {
                    <span class="error-text">Invalid</span>
                  }
                </div>
              </div>

              <!-- Row 6 -->
              <div class="form-group full-width">
                <label for="message">Message / Additional Info (optional)</label>
                <textarea 
                  id="message" 
                  formControlName="message" 
                  rows="3" 
                  placeholder="Tell us about your business, what products you're interested in, or any questions you have."
                ></textarea>
              </div>

              <button type="submit" class="btn-submit" [disabled]="isSubmitting()">
                @if (isSubmitting()) {
                  <app-loading-spinner size="sm" />
                  <span>Submitting...</span>
                } @else {
                  <span>Submit Application</span>
                }
              </button>
            </form>
          }
        </div>
      </div>

      <div class="auth-footer">
        <p>
          Already have an account? 
          <a routerLink="/login" class="link-signin">Sign In →</a>
        </p>
      </div>
    </div>

    <app-public-footer />
  `,
  styleUrl: './request-access.component.scss'
})
export class RequestAccessComponent {
  private fb = inject(FormBuilder);
  private firestore = inject(FirestoreService);
  private title = inject(Title);
  private router = inject(Router);

  businessTypes = BUSINESS_TYPES;
  provinces = PROVINCES;

  isSubmitting = signal(false);
  isSubmitted = signal(false);
  submittedBusinessName = '';
  submittedEmail = '';

  accessForm = this.fb.group({
    businessName: ['', Validators.required],
    businessType: ['', Validators.required],
    ownerName: ['', Validators.required],
    phone: ['', [Validators.required, Validators.pattern(/\d{10,}/)]],
    email: ['', [Validators.required, Validators.email]],
    street: ['', Validators.required],
    city: ['', Validators.required],
    province: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/)]],
    message: ['']
  });

  constructor() {
    this.title.setTitle('Request Wholesale Access — Tropx Wholesale');
  }

  isInvalid(controlName: string): boolean {
    const control = this.accessForm.get(controlName);
    return !!(control && control.invalid && (control.touched || control.dirty));
  }

  async onSubmit() {
    if (this.accessForm.invalid || this.isSubmitting()) {
      this.accessForm.markAllAsTouched();
      this.scrollToFirstError();
      return;
    }

    this.isSubmitting.set(true);

    try {
      const val = this.accessForm.value;
      const data = {
        businessName: val.businessName,
        businessType: val.businessType,
        ownerName: val.ownerName,
        phone: val.phone,
        email: val.email,
        address: {
          street: val.street,
          city: val.city,
          province: val.province,
          postalCode: val.postalCode?.toUpperCase()
        },
        message: val.message || '',
        status: 'pending',
        submittedAt: serverTimestamp(),
        tenantId: 1,
        isDeleted: false
      };

      await this.firestore.addDocument('accessRequests', data);
      
      this.submittedBusinessName = val.businessName || '';
      this.submittedEmail = val.email || '';
      this.isSubmitted.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Error submitting application:', error);
      // Fallback if submission fails
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private scrollToFirstError() {
    const firstInvalidControl = document.querySelector('.ng-invalid[formControlName]');
    if (firstInvalidControl) {
      firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (firstInvalidControl as HTMLElement).focus();
    }
  }
}
