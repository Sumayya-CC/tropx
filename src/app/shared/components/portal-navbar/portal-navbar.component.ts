import { Component, inject, signal, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PortalService } from '../../../core/services/portal.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-portal-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './portal-navbar.component.html',
  styleUrl: './portal-navbar.component.scss'
})
export class PortalNavbarComponent {
  protected readonly portal = inject(PortalService);
  protected readonly auth = inject(AuthService);
  protected readonly router = inject(Router);

  mobileMenuOpen = signal(false);
  showAccountMenu = signal(false);
  isScrolled = signal(false);

  @HostListener('window:scroll')
  onScroll() {
    this.isScrolled.set(window.scrollY > 10);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.account-menu-wrapper')) {
      this.showAccountMenu.set(false);
    }
    if (!target.closest('.mobile-menu-wrapper') &&
        !target.closest('.hamburger-btn')) {
      this.mobileMenuOpen.set(false);
    }
  }

  async signOut() {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }
}
