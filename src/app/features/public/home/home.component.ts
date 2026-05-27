import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { serverTimestamp } from '@angular/fire/firestore';
import { ContentService } from '../../../core/services/content.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { PublicNavbarComponent } from '../../../shared/components/public-navbar/public-navbar.component';
import { PublicFooterComponent } from '../../../shared/components/public-footer/public-footer.component';
import { SettingsService } from '../../../core/services/settings.service';
import { AuthService } from '../../../core/services/auth.service';
import { PortalNavbarComponent } from '../../../shared/components/portal-navbar/portal-navbar.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, LoadingSpinnerComponent, PublicNavbarComponent, PublicFooterComponent, PortalNavbarComponent],
  template: `
    @if (isCustomer()) {
      <app-portal-navbar />
    } @else {
      <app-public-navbar />
    }

    <main>
      <!-- Section 1: Hero -->
      <section id="hero" class="hero">
        <div class="hero-content">
          @if (logoUrl()) {
            <div class="hero-logo-wrapper">
              <img [src]="logoUrl()!"
                   [alt]="tradingName()"
                   class="hero-logo">
            </div>
          }
          <span class="badge-gold">
            {{ content().heroBadgeText }}
          </span>

          @if (isCustomer()) {
            <h1>
              Welcome back,<br>
              {{ customerBusinessName() }}
            </h1>
            <p class="subheadline">
              Your wholesale partner is ready. Browse our
              catalog and place your next order.
            </p>
          } @else {
            <h1>{{ content().heroHeadline }}</h1>
            <p class="subheadline">
              {{ content().heroSubheadline }}
            </p>
          }

          @if (isCustomer()) {
            <!-- Customer hero CTAs -->
            <div class="hero-welcome">
              <span class="hero-welcome-text">
                Welcome back, {{ customerFirstName() }} 👋
              </span>
              <span class="hero-business">
                {{ customerBusinessName() }}
              </span>
            </div>
            <div class="cta-group">
              <a routerLink="/portal/dashboard"
                class="btn btn-crimson lg">
                Go to Dashboard
              </a>
              <a routerLink="/portal/catalog"
                class="btn btn-ghost-white lg">
                Browse Catalog
              </a>
            </div>
          } @else {
            <!-- Guest hero CTAs -->
            <div class="cta-group">
              <a routerLink="/request-access"
                class="btn btn-crimson lg">
                {{ content().heroCtaText }}
              </a>
              <a routerLink="/login"
                class="btn btn-ghost-white lg">
                Sign In
              </a>
            </div>
          }
        </div>
        <div class="scroll-indicator" (click)="scrollToSection('why-us')">
          <span class="arrow"></span>
        </div>
      </section>

      <!-- Section 2: Why Partner With Us -->
      <section id="why-us" class="why-us section-padding">
        <div class="container">
          <div class="section-header">
            <span class="section-label">{{ content().whyUsSectionLabel }}</span>
            <h2>{{ content().whyUsSectionTitle }}</h2>
            <p class="section-subtext">{{ content().whyUsSectionSubtext }}</p>
          </div>

          <div class="features-grid">
            @for (point of content().whyPartnerPoints; track point.heading) {
              <div class="feature-card">
                <div class="card-accent"></div>
                <div class="icon-placeholder">
                  {{ point.heading[0] }}
                </div>
                <h3>{{ point.heading }}</h3>
                <p>{{ point.body }}</p>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- Section 3: How It Works -->
      <section id="how-it-works" class="how-it-works section-padding white-bg">
        <div class="container">
          <div class="section-header">
            <span class="section-label">{{ content().howItWorksSectionLabel }}</span>
            <h2>{{ content().howItWorksSectionTitle }}</h2>
          </div>

          <div class="steps-row">
            @for (step of content().howItWorksSteps; 
              track step.title; let i = $index) {
              @if (i > 0) {
                <div class="step-connector desktop-only"></div>
              }
              <div class="step">
                <div class="step-icon-wrapper">
                  <div class="step-icon" 
                    [class.red]="step.color === 'red'"
                    [class.green]="step.color === 'green'"
                    [class.gold]="step.color === 'gold'"
                    [class.blue]="step.color === 'blue'"
                    [class.purple]="step.color === 'purple'">
                    {{ i + 1 }}
                  </div>
                </div>
                <div class="step-content">
                  <h3>{{ step.title }}</h3>
                  <p>{{ step.description }}</p>
                </div>
              </div>
            }
          </div>

          <div class="steps-cta">
            <a routerLink="/request-access" class="btn btn-crimson lg">{{ content().howItWorksCtaText }}</a>
          </div>
        </div>
      </section>

      <!-- Section 4: About Us -->
      <section id="about" class="about section-padding dark-bg">
        <div class="container">
          <div class="about-grid">
            <div class="about-info">
              <span class="section-label gold">{{ content().aboutSectionLabel }}</span>
              <h2>{{ content().aboutSectionTitle }}</h2>
              <p class="about-text">{{ content().aboutText }}</p>
              
              <div class="trust-badges">
                @for (badge of content().aboutTrustBadges; track badge) {
                  <span class="badge-dark">{{ badge }}</span>
                }
              </div>
            </div>

            <div class="about-badges">
              <div class="badge-group">
                <label class="gold-text uppercase">{{ content().aboutWhatWeSupplyLabel }}</label>
                <div class="pills-grid mt-1">
                  @for (cat of content().whatWeSupply; track cat) {
                    <span class="pill-dark">{{ cat }}</span>
                  }
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      <!-- Section 5: Contact -->
      <section id="contact" class="contact section-padding">
        <div class="container">
          <div class="section-header">
            <span class="section-label">{{ content().contactSectionLabel }}</span>
            <h2>{{ content().contactSectionTitle }}</h2>
          </div>

          <div class="contact-grid">
            <!-- Form -->
            <div class="contact-form-container">
              @if (isSubmitted()) {
                <div class="success-message">
                  <span class="check">✓</span>
                  <h3>Thank you!</h3>
                  <p>We'll be in touch within 24 hours.</p>
                </div>
              } @else {
                <form [formGroup]="contactForm" (ngSubmit)="onSubmit()">
                  <div class="form-row">
                    <div class="form-group">
                      <label for="name">Full Name</label>
                      <input id="name" type="text" formControlName="name" placeholder="John Doe" />
                      @if (contactForm.get('name')?.touched && contactForm.get('name')?.errors?.['required']) {
                        <span class="error">Name is required</span>
                      }
                    </div>
                    <div class="form-group">
                      <label for="email">Email</label>
                      <input id="email" type="email" formControlName="email" placeholder="john@example.com" />
                      @if (contactForm.get('email')?.touched && contactForm.get('email')?.errors) {
                        @if (contactForm.get('email')?.errors?.['required']) {
                          <span class="error">Email is required</span>
                        } @else if (contactForm.get('email')?.errors?.['email']) {
                          <span class="error">Please enter a valid email</span>
                        }
                      }
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label for="phone">Phone (optional)</label>
                      <input id="phone" type="tel" formControlName="phone" placeholder="(519) 000-0000" />
                    </div>
                    <div class="form-group">
                      <label for="businessName">Business Name</label>
                      <input id="businessName" type="text" formControlName="businessName" placeholder="Your Store Name" />
                      @if (contactForm.get('businessName')?.touched && contactForm.get('businessName')?.errors?.['required']) {
                        <span class="error">Business name is required</span>
                      }
                    </div>
                  </div>

                  <div class="form-group">
                    <label for="message">Message</label>
                    <textarea id="message" formControlName="message" rows="4" placeholder="How can we help you?"></textarea>
                    @if (contactForm.get('message')?.touched && contactForm.get('message')?.errors?.['required']) {
                      <span class="error">Message is required</span>
                    }
                  </div>

                  <button type="submit" class="btn btn-primary-full lg" [disabled]="isSubmitting()">
                    @if (isSubmitting()) {
                      <app-loading-spinner size="sm"></app-loading-spinner>
                      <span class="ml-2">Sending...</span>
                    } @else {
                      Send Message
                    }
                  </button>
                </form>
              }
            </div>

            <!-- Info Cards -->
            <div class="contact-info">
              <div class="info-cards">
                <div class="info-card">
                  <span class="icon">📞</span>
                  <div>
                    <label>Phone</label>
                    <p>{{ settingsService.business().phone || 'Coming soon' }}</p>
                  </div>
                </div>
                <div class="info-card">
                  <span class="icon">✉️</span>
                  <div>
                    <label>Email</label>
                    <p>{{ settingsService.business().email || 'Coming soon' }}</p>
                  </div>
                </div>
                <div class="info-card">
                  <span class="icon">📍</span>
                  <div>
                    <label>Address</label>
                    <p>{{ [settingsService.business().street, 
                           settingsService.business().city, 
                           settingsService.business().province]
                          .filter(Boolean).join(', ') 
                          || content().publicContactInfo.address }}</p>
                  </div>
                </div>
                <div class="info-card">
                  <span class="icon">🕐</span>
                  <div>
                    <label>Hours</label>
                    <p>{{ content().publicContactInfo.hours }}</p>
                  </div>
                </div>
              </div>

              <div class="partner-note">
                <p>{{ content().contactPartnerNote }}</p>
                @if (!isCustomer()) {
                  <a routerLink="/request-access" class="link-red">Request Access →</a>
                }
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <app-public-footer />
  `,
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  private fb = inject(FormBuilder);
  private firestore = inject(FirestoreService);
  private title = inject(Title);
  protected content = inject(ContentService).content;
  protected readonly settingsService = inject(SettingsService);
  protected readonly Boolean = Boolean;

  private readonly authService = inject(AuthService);

  isCustomer = computed(() =>
    this.authService.currentProfile()?.role === 'customer'
  );

  isGuest = computed(() =>
    !this.authService.currentProfile()
  );

  customerFirstName = computed(() =>
    this.authService.currentProfile()?.firstName || ''
  );

  customerBusinessName = computed(() => {
    const p = this.authService.currentProfile() as any;
    return p?.businessName ||
      `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim()
      || 'Welcome';
  });
  
  logoUrl = computed(() => {
    const url = this.settingsService.business().logoUrl;
    return url && url.startsWith('http') ? url : null;
  });

  tradingName = computed(() =>
    this.settingsService.business().tradingName || 'Tropx'
  );

  isSubmitting = signal(false);
  isSubmitted = signal(false);

  contactForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    businessName: ['', Validators.required],
    message: ['', Validators.required],
  });


  serviceAreas = [
    'Ontario'
  ];

  ngOnInit() {
    this.title.setTitle('Tropx Wholesale — B2B Wholesale Distribution');
  }

  scrollToSection(id: string) {
    const element = document.getElementById(id);
    if (element) {
      const offset = 70; // Navbar height
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  }

  async onSubmit() {
    if (this.contactForm.invalid || this.isSubmitting()) {
      this.contactForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);

    try {
      const data = {
        ...this.contactForm.value,
        createdAt: serverTimestamp(),
        tenantId: 1,
        status: 'new'
      };

      await this.firestore.addDocument('contactInquiries', data);
      this.isSubmitted.set(true);
      this.contactForm.reset();
    } catch (error) {
      console.error('Error submitting contact form:', error);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
