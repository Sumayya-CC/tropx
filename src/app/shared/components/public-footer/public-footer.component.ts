import { Component, inject, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ContentService } from '../../../core/services/content.service';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="footer section-padding-sm dark-bg">
      <div class="container">
        <div class="footer-grid" [class.has-social]="hasSocialLinks()">
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

          @if (hasSocialLinks()) {
            <div class="footer-social">
              <h4>Follow Us</h4>
              <div class="social-icons">
                @if (socialMedia()?.facebook) {
                  <a [href]="socialMedia()?.facebook" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                  </a>
                }
                @if (socialMedia()?.instagram) {
                  <a [href]="socialMedia()?.instagram" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                  </a>
                }
                @if (socialMedia()?.whatsapp) {
                  <a [href]="socialMedia()?.whatsapp" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                  </a>
                }
                @if (socialMedia()?.youtube) {
                  <a [href]="socialMedia()?.youtube" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17z"></path><path d="m10 15 5-3-5-3z"></path></svg>
                  </a>
                }
                @if (socialMedia()?.tiktok) {
                  <a [href]="socialMedia()?.tiktok" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path></svg>
                  </a>
                }
              </div>
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
  private settingsService = inject(SettingsService);

  protected socialMedia = computed(() => this.settingsService.business().socialMedia);
  protected hasSocialLinks = computed(() => {
    const sm = this.socialMedia();
    return !!(sm && (sm.facebook || sm.instagram || sm.whatsapp || sm.youtube || sm.tiktok));
  });

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
