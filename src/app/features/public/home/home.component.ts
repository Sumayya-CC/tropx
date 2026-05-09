import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { serverTimestamp } from '@angular/fire/firestore';
import { ContentService } from '../../../core/services/content.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { PublicNavbarComponent } from '../../../shared/components/public-navbar/public-navbar.component';
import { PublicFooterComponent } from '../../../shared/components/public-footer/public-footer.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, LoadingSpinnerComponent, PublicNavbarComponent, PublicFooterComponent],
  template: `
    <app-public-navbar />

    <main>
      <!-- Section 1: Hero -->
      <section id="hero" class="hero">
        <div class="hero-content">
          <span class="badge-gold">Wholesale Distribution</span>
          <h1>{{ content().heroHeadline }}</h1>
          <p class="subheadline">{{ content().heroSubheadline }}</p>
          <div class="cta-group">
            <a routerLink="/request-access" class="btn btn-crimson lg">{{ content().heroCtaText }}</a>
            <a routerLink="/login" class="btn btn-ghost-white lg">Sign In</a>
          </div>
        </div>
        <div class="scroll-indicator" (click)="scrollToSection('why-us')">
          <span class="arrow"></span>
        </div>
      </section>

      <!-- Section 2: Why Partner With Us -->
      <section id="why-us" class="why-us section-padding">
        <div class="container">
          <div class="section-header">
            <span class="section-label">Why Choose Tropx</span>
            <h2>Why Partner With Us?</h2>
            <p class="section-subtext">The supply partner built for growing retail businesses.</p>
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
            <span class="section-label">Simple Process</span>
            <h2>Getting Started Is Simple</h2>
          </div>

          <div class="steps-row">
            <div class="step">
              <div class="step-icon-wrapper">
                <div class="step-icon">1</div>
              </div>
              <div class="step-content">
                <h3>Request Access</h3>
                <p>Fill out our short form with your business details.</p>
              </div>
            </div>

            <div class="step-connector desktop-only"></div>

            <div class="step">
              <div class="step-icon-wrapper">
                <div class="step-icon red">2</div>
              </div>
              <div class="step-content">
                <h3>Get Approved</h3>
                <p>We review applications within 24 hours.</p>
              </div>
            </div>

            <div class="step-connector desktop-only"></div>

            <div class="step">
              <div class="step-icon-wrapper">
                <div class="step-icon green">3</div>
              </div>
              <div class="step-content">
                <h3>Start Ordering</h3>
                <p>Log in and browse our full catalog anytime.</p>
              </div>
            </div>
          </div>

          <div class="steps-cta">
            <a routerLink="/request-access" class="btn btn-crimson lg">Request Access Now</a>
          </div>
        </div>
      </section>

      <!-- Section 4: About Us -->
      <section id="about" class="about section-padding dark-bg">
        <div class="container">
          <div class="about-grid">
            <div class="about-info">
              <span class="section-label gold">About Tropx</span>
              <h2>A Canadian Wholesale Distributor You Can Trust</h2>
              <p class="about-text">{{ content().aboutText }}</p>
              
              <div class="trust-badges">
                <span class="badge-dark">CBCA Incorporated</span>
                <span class="badge-dark">Ontario</span>
              </div>
            </div>

            <div class="about-badges">
              <div class="badge-group">
                <label class="gold-text uppercase">What We Supply</label>
                <div class="pills-grid mt-1">
                  @for (cat of categories; track cat) {
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
            <span class="section-label">Get In Touch</span>
            <h2>Contact Us</h2>
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
                    <p>{{ content().publicContactInfo.phone || 'Coming soon' }}</p>
                  </div>
                </div>
                <div class="info-card">
                  <span class="icon">✉️</span>
                  <div>
                    <label>Email</label>
                    <p>{{ content().publicContactInfo.email || 'Coming soon' }}</p>
                  </div>
                </div>
                <div class="info-card">
                  <span class="icon">📍</span>
                  <div>
                    <label>Address</label>
                    <p>{{ content().publicContactInfo.address }}</p>
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
                <p>Looking to become a wholesale partner? Use our Request Access form for faster onboarding.</p>
                <a routerLink="/request-access" class="link-red">Request Access →</a>
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

  isSubmitting = signal(false);
  isSubmitted = signal(false);

  contactForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    businessName: ['', Validators.required],
    message: ['', Validators.required],
  });

  categories = [
    'General Merchandise', 'Food & Beverages', 
    'Snacks & Confectionery', 'Household Products',
    'Imported Goods', 'Personal Care',
    'Seasonal Items', 'And More...'
  ];

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
