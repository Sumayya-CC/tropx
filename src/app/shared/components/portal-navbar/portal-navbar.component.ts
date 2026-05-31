import { Component, inject, signal, HostListener, computed } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PortalService } from '../../../core/services/portal.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';

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
  private readonly toast = inject(ToastService);

  logoUrl = computed(() =>
    this.portal.customerDoc()?.logoUrl || null
  );

  showPasswordResetConfirm = signal(false);
  isSendingReset = signal(false);

  openPasswordReset() {
    this.showAccountMenu.set(false);
    this.showPasswordResetConfirm.set(true);
  }

  async confirmPasswordReset() {
    const email = this.portal.customerProfile()?.email;
    if (!email) return;

    this.isSendingReset.set(true);
    try {
      await this.auth.sendPasswordResetEmail(email);
      this.showPasswordResetConfirm.set(false);
      this.toast.success(
        `Password reset email sent to ${email}`
      );
    } catch (err) {
      console.error('Password reset error:', err);
      this.toast.error('Failed to send reset email');
    } finally {
      this.isSendingReset.set(false);
    }
  }

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
