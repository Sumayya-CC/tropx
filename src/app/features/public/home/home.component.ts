import { Component, inject, signal, HostListener, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { serverTimestamp } from '@angular/fire/firestore';
import { ContentService } from '../../../core/services/content.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, LoadingSpinnerComponent],
  template: `
    <!-- Navbar -->
    <nav class="navbar" [class.scrolled]="isScrolled()">
      <div class="nav-container">
        <div class="nav-left">
          <a (click)="scrollToTop()" class="brand">Tropx</a>
        </div>

        <div class="nav-center desktop-only">
          <a (click)="scrollToSection('why-us')">Why Us</a>
          <a (click)="scrollToSection('how-it-works')">How It Works</a>
          <a (click)="scrollToSection('about')">About</a>
          <a (click)="scrollToSection('contact')">Contact</a>
        </div>

        <div class="nav-right desktop-only">
          <a routerLink="/login" class="btn btn-ghost-white">Sign In</a>
          <a routerLink="/request-access" class="btn btn-crimson">Request Access</a>
        </div>

        <div class="nav-mobile-toggle mobile-only" (click)="isMenuOpen.set(!isMenuOpen())">
          <div class="hamburger" [class.open]="isMenuOpen()"></div>
        </div>
      </div>

      <!-- Mobile Menu -->
      @if (isMenuOpen()) {
        <div class="mobile-menu">
          <a (click)="scrollToSection('why-us'); isMenuOpen.set(false)">Why Us</a>
          <a (click)="scrollToSection('how-it-works'); isMenuOpen.set(false)">How It Works</a>
          <a (click)="scrollToSection('about'); isMenuOpen.set(false)">About</a>
          <a (click)="scrollToSection('contact'); isMenuOpen.set(false)">Contact</a>
          <hr />
          <a routerLink="/login" class="btn btn-ghost-white">Sign In</a>
          <a routerLink="/request-access" class="btn btn-crimson">Request Access</a>
        </div>
      }
    </nav>

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
                <p>Fill out our short form with your store details.</p>
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

    <!-- Footer -->
    <footer class="footer section-padding-sm dark-bg">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <h3>Tropx Wholesale</h3>
            <p class="gold-text">B2B Wholesale Distribution</p>
          </div>

          <div class="footer-links">
            <h4>Quick Links</h4>
            <ul>
              <li><a (click)="scrollToSection('why-us')">Why Us</a></li>
              <li><a (click)="scrollToSection('how-it-works')">How It Works</a></li>
              <li><a (click)="scrollToSection('about')">About</a></li>
              <li><a (click)="scrollToSection('contact')">Contact</a></li>
              <li><a routerLink="/request-access">Request Access</a></li>
              <li><a routerLink="/login">Sign In</a></li>
            </ul>
          </div>

          <div class="footer-contact">
            <h4>Contact</h4>
            <p>{{ content().publicContactInfo.email }}</p>
            <p>{{ content().publicContactInfo.phone }}</p>
          </div>
        </div>

        <div class="footer-bottom">
          <p>{{ content().footerText }}</p>
          <p>tropxwholesale.ca</p>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    :host {
      --nav-height: 70px;
      display: block;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .section-padding {
      padding: 100px 0;
    }
    .section-padding-sm {
      padding: 60px 0 20px 0;
    }

    .white-bg { background-color: var(--white); }
    .dark-bg { background-color: var(--navy-deep); color: var(--white); }
    
    /* Navbar */
    .navbar {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: var(--nav-height);
      display: flex;
      align-items: center;
      z-index: 1000;
      transition: all 0.3s ease;
      background: transparent;
    }

    .navbar.scrolled {
      background: var(--navy-deep);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }

    .nav-container {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .brand {
      color: var(--white);
      font-size: 1.5rem;
      font-weight: 800;
      cursor: pointer;
      text-decoration: none;
    }

    .nav-center {
      display: flex;
      gap: 2rem;
    }

    .nav-center a {
      color: var(--white);
      text-decoration: none;
      font-weight: 500;
      opacity: 0.8;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .nav-center a:hover {
      opacity: 1;
    }

    .nav-right {
      display: flex;
      gap: 1rem;
    }

    /* Buttons */
    .btn {
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      cursor: pointer;
    }

    .btn.lg {
      padding: 1rem 2rem;
      font-size: 1rem;
    }

    .btn-red {
      background-color: var(--red);
      color: var(--white);
    }
    .btn-red:hover {
      background-color: var(--red-dark);
      transform: translateY(-2px);
    }

    .btn-crimson {
      background-color: var(--crimson);
      color: var(--white);
    }
    .btn-crimson:hover {
      background-color: #b01030;
      transform: translateY(-2px);
    }

    .btn-ghost-white {
      background: transparent;
      border-color: var(--white);
      color: var(--white);
    }
    .btn-ghost-white:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .btn-primary-full {
      width: 100%;
      background-color: var(--navy-deep);
      color: var(--white);
    }
    .btn-primary-full:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    /* Hero */
    .hero {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      position: relative;
      color: var(--white);
      padding-top: var(--nav-height);
      background: var(--navy-deep);
      background-image: repeating-linear-gradient(
        45deg,
        rgba(26, 106, 173, 0.05) 0px,
        rgba(26, 106, 173, 0.05) 2px,
        transparent 2px,
        transparent 100px
      );
    }

    .hero-content {
      max-width: 900px;
      padding: 0 1.5rem;
    }

    .badge-gold {
      display: inline-block;
      color: var(--gold-light);
      border: 1px solid rgba(240, 192, 64, 0.3);
      padding: 0.5rem 1.25rem;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      font-size: 0.75rem;
      font-weight: 700;
      margin-bottom: 2rem;
    }

    .hero h1 {
      font-size: clamp(2.5rem, 8vw, 4.5rem);
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 1.5rem;
    }

    .subheadline {
      font-size: 1.25rem;
      opacity: 0.7;
      max-width: 600px;
      margin: 0 auto 2.5rem;
    }

    .cta-group {
      display: flex;
      gap: 1.5rem;
      justify-content: center;
    }

    .scroll-indicator {
      position: absolute;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      cursor: pointer;
    }

    .arrow {
      display: block;
      width: 24px;
      height: 24px;
      border-bottom: 3px solid var(--white);
      border-right: 3px solid var(--white);
      transform: rotate(45deg);
      animation: bounce 2s infinite;
    }

    @keyframes bounce {
      0%, 20%, 50%, 80%, 100% {transform: translateY(0) rotate(45deg);}
      40% {transform: translateY(-10px) rotate(45deg);}
      60% {transform: translateY(-5px) rotate(45deg);}
    }

    /* Section Headers */
    .section-header {
      text-align: center;
      margin-bottom: 60px;
    }

    .section-label {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--navy);
      margin-bottom: 1rem;
    }
    .section-label.gold { color: var(--gold-light); }

    .section-header h2 {
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--navy-deep);
      margin-bottom: 1rem;
    }
    .dark-bg .section-header h2 { color: var(--white); }

    .section-subtext {
      color: var(--gray);
      font-size: 1.125rem;
    }

    /* Features Grid */
    .features-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2rem;
    }

    .feature-card {
      background: var(--white);
      padding: 3rem 2rem;
      border-radius: 12px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 10px 30px var(--color-shadow);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .feature-card:hover {
      transform: translateY(-8px);
      box-shadow: 0 20px 40px rgba(22, 88, 142, 0.15);
    }

    .card-accent {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: var(--navy);
    }

    .icon-placeholder {
      width: 50px;
      height: 50px;
      background: var(--navy-deep);
      color: var(--white);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .feature-card h3 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: var(--navy-deep);
    }

    .feature-card p {
      color: var(--charcoal);
      line-height: 1.6;
    }

    /* Steps */
    .steps-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 60px;
      position: relative;
    }

    .step {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 0 1rem;
      z-index: 2;
    }

    .step-icon-wrapper {
      margin-bottom: 1.5rem;
    }

    .step-icon {
      width: 64px;
      height: 64px;
      background: var(--navy-deep);
      color: var(--white);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      font-weight: 800;
    }
    .step-icon.red { background: var(--red); }
    .step-icon.green { background: var(--green); }

    .step h3 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }

    .step p {
      color: var(--gray);
      font-size: 0.95rem;
    }

    .step-connector {
      flex: 1;
      height: 2px;
      border-top: 2px dashed var(--color-border);
      margin-top: 32px;
    }

    .steps-cta {
      text-align: center;
    }

    /* About Grid */
    .about-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4rem;
      align-items: center;
    }

    .about-text {
      font-size: 1.125rem;
      line-height: 1.7;
      opacity: 0.85;
      margin-bottom: 2.5rem;
    }

    .trust-badges {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .badge-dark {
      background: var(--navy-mid);
      color: var(--white);
      padding: 0.5rem 1rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .badge-group label {
      display: block;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.6;
      margin-bottom: 1rem;
    }

    .pills-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .pill-dark {
      background: var(--navy-mid);
      color: var(--white);
      padding: 0.5rem 1.25rem;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 500;
    }

    .pill-gold {
      background: var(--gold);
      color: var(--navy-deep);
      padding: 0.5rem 1.25rem;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .uppercase { text-transform: uppercase; }
    .mt-1 { margin-top: 1rem; }
    .mt-2 { margin-top: 2rem; }

    /* Contact Grid */
    .contact-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 4rem;
    }

    .contact-form-container {
      background: var(--white);
      padding: 3rem;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.05);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .form-group {
      margin-bottom: 1.5rem;
      display: flex;
      flex-direction: column;
    }

    .form-group label {
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: var(--navy-deep);
    }

    .form-group input, .form-group textarea {
      padding: 0.875rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-family: inherit;
      font-size: 1rem;
      transition: border-color 0.2s;
    }

    .form-group input:focus, .form-group textarea:focus {
      border-color: var(--navy);
      outline: none;
    }

    .error {
      color: var(--red);
      font-size: 0.75rem;
      margin-top: 0.25rem;
    }

    .success-message {
      text-align: center;
      padding: 2rem;
    }

    .success-message .check {
      width: 60px;
      height: 60px;
      background: var(--green);
      color: var(--white);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      margin: 0 auto 1.5rem;
    }

    .success-message h3 {
      font-size: 1.5rem;
      color: var(--navy-deep);
      margin-bottom: 0.5rem;
    }

    .success-message p {
      color: var(--gray);
    }

    .info-cards {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      margin-bottom: 3rem;
    }

    .info-card {
      display: flex;
      gap: 1.5rem;
      align-items: center;
      background: var(--white);
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 12px var(--color-shadow);
    }

    .info-card .icon {
      font-size: 1.5rem;
    }

    .info-card label {
      display: block;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--gray);
      font-weight: 700;
    }

    .info-card p {
      margin: 0;
      font-weight: 600;
      color: var(--navy-deep);
    }

    .partner-note {
      border-left: 4px solid var(--navy);
      padding-left: 1.5rem;
    }

    .partner-note p {
      font-size: 0.95rem;
      color: var(--charcoal);
      margin-bottom: 0.5rem;
    }

    .link-red {
      color: var(--red);
      text-decoration: none;
      font-weight: 700;
    }

    /* Footer */
    .footer-grid {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 4rem;
      padding-bottom: 4rem;
    }

    .footer-brand h3 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .gold-text { color: var(--gold-light); }

    .footer-links h4, .footer-contact h4 {
      font-size: 1rem;
      margin-bottom: 1.5rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .footer-links ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .footer-links li {
      margin-bottom: 0.75rem;
    }

    .footer-links a {
      color: var(--white);
      text-decoration: none;
      opacity: 0.7;
      transition: opacity 0.2s;
      cursor: pointer;
    }

    .footer-links a:hover {
      opacity: 1;
    }

    .footer-contact p {
      opacity: 0.7;
      margin-bottom: 0.5rem;
    }

    .footer-bottom {
      border-top: 1px solid rgba(26, 106, 173, 0.2);
      padding-top: 2rem;
      display: flex;
      justify-content: space-between;
      font-size: 0.875rem;
      opacity: 0.6;
    }

    /* Mobile Styles */
    .mobile-menu {
      position: absolute;
      top: var(--nav-height);
      left: 0;
      width: 100%;
      background: var(--navy-deep);
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      box-shadow: 0 10px 20px rgba(0,0,0,0.2);
    }

    .mobile-menu a {
      color: var(--white);
      text-decoration: none;
      font-size: 1.125rem;
      font-weight: 500;
    }

    .mobile-menu hr {
      border: none;
      border-top: 1px solid rgba(255,255,255,0.1);
      margin: 0;
    }

    .hamburger {
      width: 24px;
      height: 2px;
      background: var(--white);
      position: relative;
    }
    .hamburger::before, .hamburger::after {
      content: '';
      position: absolute;
      width: 24px;
      height: 2px;
      background: var(--white);
      transition: all 0.3s;
    }
    .hamburger::before { top: -8px; }
    .hamburger::after { bottom: -8px; }

    .hamburger.open { background: transparent; }
    .hamburger.open::before { transform: rotate(45deg); top: 0; }
    .hamburger.open::after { transform: rotate(-45deg); bottom: 0; }

    .desktop-only { display: flex; }
    .mobile-only { display: none; }

    @media (max-width: 768px) {
      .desktop-only { display: none; }
      .mobile-only { display: flex; }

      .section-padding { padding: 60px 0; }

      .hero h1 { font-size: 2.5rem; }
      .cta-group { flex-direction: column; }

      .steps-row { flex-direction: column; gap: 2rem; }
      .step-connector { display: none; }

      .about-grid, .contact-grid, .footer-grid {
        grid-template-columns: 1fr;
        gap: 3rem;
      }

      .form-row { grid-template-columns: 1fr; }
      .contact-form-container { padding: 1.5rem; }

      .footer-bottom { flex-direction: column; gap: 1rem; text-align: center; }
    }

    .ml-2 { margin-left: 0.5rem; }
  `],
})
export class HomeComponent implements OnInit {
  private fb = inject(FormBuilder);
  private firestore = inject(FirestoreService);
  private title = inject(Title);
  protected content = inject(ContentService).content;

  isScrolled = signal(false);
  isMenuOpen = signal(false);
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

  @HostListener('window:scroll', [])
  onWindowScroll() {
    this.isScrolled.set(window.scrollY > 30);
  }

  scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
