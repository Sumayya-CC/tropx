import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ContentService } from '../../../core/services/content.service';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="footer section-padding-sm dark-bg">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <h3>Tropx Wholesale</h3>
            <p class="gold-text">{{ content().footerTagline }}</p>
          </div>

          <div class="footer-links">
            <h4>Quick Links</h4>
            <ul>
              <li><a (click)="navigateToSection('why-us')">Why Us</a></li>
              <li><a (click)="navigateToSection('how-it-works')">How It Works</a></li>
              <li><a (click)="navigateToSection('about')">About</a></li>
              <li><a (click)="navigateToSection('contact')">Contact</a></li>
              <li><a routerLink="/request-access">Request Access</a></li>
              <li><a routerLink="/login">Sign In</a></li>
            </ul>
          </div>

          @if (content().publicContactInfo.email || content().publicContactInfo.phone) {
            <div class="footer-contact">
              <h4>Contact</h4>
              @if (content().publicContactInfo.email) {
                <p>{{ content().publicContactInfo.email }}</p>
              }
              @if (content().publicContactInfo.phone) {
                <p>{{ content().publicContactInfo.phone }}</p>
              }
            </div>
          }
        </div>

        <div class="footer-bottom">
          <p>{{ content().footerText }}</p>
          <p>tropxwholesale.ca</p>
        </div>
      </div>
    </footer>
  `,
  styleUrl: './public-footer.component.scss'
})
export class PublicFooterComponent {
  private router = inject(Router);
  protected content = inject(ContentService).content;

  navigateToSection(sectionId: string) {
    if (this.router.url === '/') {
      this.scrollToSection(sectionId);
    } else {
      this.router.navigate(['/'], { fragment: sectionId });
      setTimeout(() => this.scrollToSection(sectionId), 100);
    }
  }

  private scrollToSection(id: string) {
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
}
