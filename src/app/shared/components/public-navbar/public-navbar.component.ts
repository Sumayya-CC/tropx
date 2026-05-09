import { Component, inject, signal, HostListener } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-public-navbar',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="navbar" [class.scrolled]="!isHome() || isScrolled()">
      <div class="nav-container">
        <div class="nav-left">
          <a (click)="scrollToTop()" class="brand">Tropx</a>
        </div>

        <div class="nav-center desktop-only">
          <a (click)="navigateToSection('why-us')">Why Us</a>
          <a (click)="navigateToSection('how-it-works')">How It Works</a>
          <a (click)="navigateToSection('about')">About</a>
          <a (click)="navigateToSection('contact')">Contact</a>
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
          <a (click)="navigateToSection('why-us'); isMenuOpen.set(false)">Why Us</a>
          <a (click)="navigateToSection('how-it-works'); isMenuOpen.set(false)">How It Works</a>
          <a (click)="navigateToSection('about'); isMenuOpen.set(false)">About</a>
          <a (click)="navigateToSection('contact'); isMenuOpen.set(false)">Contact</a>
          <hr />
          <a routerLink="/login" class="btn btn-ghost-white">Sign In</a>
          <a routerLink="/request-access" class="btn btn-crimson">Request Access</a>
        </div>
      }
    </nav>
  `,
  styleUrl: './public-navbar.component.scss'
})
export class PublicNavbarComponent {
  private router = inject(Router);
  
  isScrolled = signal(false);
  isMenuOpen = signal(false);
  isHome = signal(true);

  constructor() {
    // Initial check
    this.isHome.set(this.router.url === '/');

    // Watch for route changes
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntilDestroyed()
    ).subscribe((event: any) => {
      this.isHome.set(event.urlAfterRedirects === '/');
    });
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    this.isScrolled.set(window.scrollY > 30);
  }

  scrollToTop() {
    if (this.router.url === '/' || this.router.url === '/#hero') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      this.router.navigate(['/']);
    }
  }

  navigateToSection(sectionId: string) {
    if (this.router.url === '/') {
      this.scrollToSection(sectionId);
    } else {
      this.router.navigate(['/'], { fragment: sectionId });
      // Small timeout to allow navigation to complete before scrolling
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
