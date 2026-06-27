import { Component, inject, OnInit, signal, HostListener, effect, computed } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../../../core/services/auth.service';
import { filter } from 'rxjs/operators';
import { SettingsService } from '../../../core/services/settings.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ToastService } from '../../../shared/services/toast.service';
import { InventoryBootstrapService } from '../../../core/services/inventory-bootstrap.service';

interface NavItem {
  label: string;
  route: string;
  icon: SafeHtml;
  permission: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

import { FullNamePipe, OwnerFullNamePipe } from '../../../shared/pipes/full-name.pipe';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterModule, FullNamePipe, OwnerFullNamePipe],
  template: `
    <div class="admin-layout" [class.collapsed]="isCollapsed()" [class.mobile-open]="isMobileOpen()">
      @if (isMobileOpen()) {
        <div class="mobile-overlay" (click)="closeMobile()"></div>
      }

      <aside class="sidebar">
        <div class="sidebar-top">
          @if (!isCollapsed()) {
            <div class="brand-expanded">
              @if (businessSettings().logoUrl) {
                <img [src]="businessSettings().logoUrl" 
                     alt="Logo"
                     class="sidebar-logo">
              } @else {
                <span class="logo-text">
                  {{ businessSettings().tradingName || 'Tropx' }}
                </span>
              }
            </div>
          } @else {
            <div class="brand-collapsed">
              @if (businessSettings().logoUrl) {
                <img [src]="businessSettings().logoUrl"
                     alt="Logo" 
                     class="sidebar-logo-collapsed">
              } @else {
                {{ (businessSettings().tradingName || 'T')[0] }}
              }
            </div>
          }
          <button class="collapse-toggle" (click)="toggleCollapse()" [attr.title]="isCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'">
            @if (isCollapsed()) {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polyline points="9 18 15 12 9 6"></polyline></svg>
            } @else {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polyline points="15 18 9 12 15 6"></polyline></svg>
            }
          </button>
        </div>

        <div class="sidebar-nav">
          @for (section of sections; track section.label) {
            @if (hasVisibleItems(section)) {
              <div class="nav-section">
                @if (!isCollapsed()) {
                  <div class="section-label">{{ section.label }}</div>
                }
                @for (item of section.items; track item.route) {
                  @if (hasPermission(item.permission)) {
                    <a [routerLink]="item.route" 
                       class="nav-item" 
                       [class.active]="currentRoute() === item.route"
                       (click)="closeMobile()"
                       [attr.title]="isCollapsed() ? item.label : null">
                      <span class="icon-wrapper" [innerHTML]="item.icon"></span>
                      @if (!isCollapsed()) {
                        <span class="nav-label">{{ item.label }}</span>
                      }
                      <!-- Badge for Returns -->
                      @if (item.route === '/admin/returns' && 
                           pendingReturns() > 0) {
                        <span class="nav-badge">
                          {{ pendingReturns() > 99 ? '99+' : pendingReturns() }}
                        </span>
                      }
                      <!-- Badge for Orders (overdue) -->
                      @if (item.route === '/admin/orders' && 
                           overdueOrders() > 0) {
                        <span class="nav-badge orange">
                          {{ overdueOrders() > 99 ? '99+' : overdueOrders() }}
                        </span>
                      }
                      <!-- Dot for Products (low stock) -->
                      @if (item.route === '/admin/products' && 
                           lowStock() > 0) {
                        <span class="nav-badge">
                          {{ lowStock() > 99 ? '99+' : lowStock() }}
                        </span>
                      }
                      <!-- Badge for Access Requests -->
                      @if (item.route === '/admin/access-requests' &&
                           pendingAccessRequests() > 0) {
                        <span class="nav-badge">
                          {{ pendingAccessRequests() > 99 
                            ? '99+' : pendingAccessRequests() }}
                        </span>
                      }
                    </a>
                  }
                }
              </div>
            }
          }
        </div>

        <div class="sidebar-bottom">
          <div class="user-profile">
            <div class="avatar">{{ initials() }}</div>
            @if (!isCollapsed()) {
              <div class="user-info">
                <div class="user-name">{{ userProfile() | fullName }}</div>
                <div class="user-role">{{ userProfile()?.role }}</div>
                @if (userProfile()?.role === 'sales_rep') {
                  <div class="service-area">Area Assigned</div>
                }
              </div>
            }
          </div>
          <button class="logout-btn" (click)="logout()" [attr.title]="isCollapsed() ? 'Logout' : null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            @if (!isCollapsed()) {
              <span>Logout</span>
            }
          </button>
        </div>
      </aside>

      <div class="main-wrapper">
        @if (closureActive()) {
          <div class="closure-banner">
            Store closure is active — customers cannot place orders
            <a routerLink="/admin/settings">Settings</a>
          </div>
        }
        <header class="top-header">
          <div class="header-left">
            <button class="mobile-toggle" (click)="toggleMobile()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <h1 class="page-title">{{ pageTitle() }}</h1>
          </div>
          <div class="header-right">
            <div class="notification-wrapper">
              <button class="bell-btn"
                [class.has-notifications]="
                  totalNotificationCount() > 0"
                (click)="toggleNotifications();
                  $event.stopPropagation()">
                <svg viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round" class="icon">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3
                    9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                @if (totalNotificationCount() > 0) {
                  <span class="bell-badge">
                    {{ totalNotificationCount() > 99
                      ? '99+' : totalNotificationCount() }}
                  </span>
                }
              </button>

              @if (showNotifications()) {
                <div class="notifications-panel"
                  (click)="$event.stopPropagation()">

                  <div class="notif-header">
                    <span class="notif-title">
                      Notifications
                    </span>
                    @if (totalNotificationCount() > 0) {
                      <span class="notif-count-badge">
                        {{ totalNotificationCount() }}
                      </span>
                    }
                  </div>

                  @if (totalNotificationCount() === 0) {
                    <div class="notif-empty">
                      <svg xmlns="http://www.w3.org/2000/svg"
                        width="28" height="28"
                        viewBox="0 0 24 24" fill="none"
                        stroke="currentColor"
                        stroke-width="1.5">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3
                          9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                      </svg>
                      <p>All caught up!</p>
                    </div>
                  } @else {
                    <div class="notif-body">

                      <!-- Overdue Invoices -->
                      @if (overdueOrders() > 0) {
                        <div class="notif-section">
                          <div class="notif-section-header">
                            <span class="notif-dot red"></span>
                            <span class="notif-section-label">
                              Overdue Invoices
                            </span>
                            <span class="notif-section-count">
                              {{ overdueOrders() }}
                            </span>
                          </div>
                          @for (order of overdueOrdersList();
                            track order.id) {
                            <a [routerLink]="[
                              '/admin/orders', order.id]"
                              class="notif-item"
                              (click)="showNotifications
                                .set(false)">
                              <div class="notif-item-main">
                                <span class="notif-item-title">
                                  {{ order.orderNumber }}
                                </span>
                                <span class="notif-item-sub">
                                  {{ order.customerName }}
                                </span>
                              </div>
                              <span class="notif-item-value red">
                                \${{ ((order.balanceCents || 0) / 100).toFixed(2) }}
                              </span>
                            </a>
                          }
                          @if (overdueOrders() > 5) {
                            <a routerLink="/admin/orders"
                              class="notif-see-all"
                              (click)="showNotifications
                                .set(false)">
                              View all {{ overdueOrders() }}
                              overdue →
                            </a>
                          }
                        </div>
                      }

                      <!-- Pending Returns -->
                      @if (pendingReturns() > 0) {
                        <div class="notif-section">
                          <div class="notif-section-header">
                            <span class="notif-dot gold"></span>
                            <span class="notif-section-label">
                              Pending Returns
                            </span>
                            <span class="notif-section-count">
                              {{ pendingReturns() }}
                            </span>
                          </div>
                          @for (ret of pendingReturnsList();
                            track ret.id) {
                            <a routerLink="/admin/returns"
                              class="notif-item"
                              (click)="showNotifications
                                .set(false)">
                              <div class="notif-item-main">
                                <span class="notif-item-title">
                                  {{ ret.returnNumber }}
                                </span>
                                <span class="notif-item-sub">
                                  {{ ret.customerName }}
                                </span>
                              </div>
                              <span class="notif-item-value">
                                \${{ ((ret.amountCents || 0) / 100).toFixed(2) }}
                              </span>
                            </a>
                          }
                          @if (pendingReturns() > 5) {
                            <a routerLink="/admin/returns"
                              class="notif-see-all"
                              (click)="showNotifications
                                .set(false)">
                              View all {{ pendingReturns() }}
                              returns →
                            </a>
                          }
                        </div>
                      }

                      <!-- Low Stock -->
                      @if (lowStock() > 0) {
                        <div class="notif-section">
                          <div class="notif-section-header">
                            <span class="notif-dot red"></span>
                            <span class="notif-section-label">
                              Low Stock
                            </span>
                            <span class="notif-section-count">
                              {{ lowStock() }}
                            </span>
                          </div>
                          @for (product of lowStockList();
                            track product.id) {
                            <a [routerLink]="[
                              '/admin/products', product.id]"
                              class="notif-item"
                              (click)="showNotifications
                                .set(false)">
                              <div class="notif-item-main">
                                <span class="notif-item-title">
                                  {{ product.name }}
                                </span>
                                <span class="notif-item-sub">
                                  {{ product.sku }}
                                </span>
                              </div>
                              <span class="notif-item-value"
                                [class.red]="product.stock === 0"
                                [class.gold]="product.stock > 0">
                                {{ product.stock === 0
                                  ? 'Out'
                                  : product.stock + ' left' }}
                              </span>
                            </a>
                          }
                          @if (lowStock() > 5) {
                            <a routerLink="/admin/products"
                              class="notif-see-all"
                              (click)="showNotifications
                                .set(false)">
                              View all {{ lowStock() }}
                              products →
                            </a>
                          }
                        </div>
                      }

                      <!-- Pending Access Requests -->
                      @if (pendingAccessRequests() > 0) {
                        <div class="notif-section">
                          <div class="notif-section-header">
                            <span class="notif-dot navy"></span>
                            <span class="notif-section-label">
                              Access Requests
                            </span>
                            <span class="notif-section-count">
                              {{ pendingAccessRequests() }}
                            </span>
                          </div>
                          @for (req of
                            pendingAccessRequestsList();
                            track req.id) {
                            <a routerLink="/admin/access-requests"
                              class="notif-item"
                              (click)="showNotifications
                                .set(false)">
                              <div class="notif-item-main">
                                <span class="notif-item-title">
                                  {{ req.businessName ||
                                     (req | ownerFullName) }}
                                </span>
                                <span class="notif-item-sub">
                                  {{ req.email }}
                                </span>
                              </div>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14" height="14"
                                viewBox="0 0 24 24" fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                class="notif-arrow">
                                <polyline
                                  points="9 18 15 12 9 6"/>
                              </svg>
                            </a>
                          }
                          @if (pendingAccessRequests() > 3) {
                            <a routerLink="/admin/access-requests"
                              class="notif-see-all"
                              (click)="showNotifications
                                .set(false)">
                              View all
                              {{ pendingAccessRequests() }}
                              requests →
                            </a>
                          }
                        </div>
                      }

                    </div>
                  }

                  <div class="notif-footer">
                    <a routerLink="/admin/dashboard"
                      class="notif-footer-link"
                      (click)="showNotifications.set(false)">
                      View Dashboard →
                    </a>
                  </div>

                </div>
              }
            </div>
            <div class="divider"></div>
            <div class="user-menu" (click)="toggleDropdown()">
              <div class="avatar-small">{{ initials() }}</div>
              <span class="mobile-name">{{ userProfile()?.firstName }}</span>
              @if (dropdownOpen()) {
                <div class="dropdown-menu">
                  <a routerLink="/admin/profile"
                     class="dropdown-item"
                     (click)="dropdownOpen.set(false)">
                    My Profile
                  </a>
                  <button class="dropdown-item"
                          (click)="openPasswordReset()"
                          [disabled]="isSendingReset()">
                    Change Password
                  </button>
                  @if (authService.isAdmin()) {
                    <a routerLink="/admin/settings" class="dropdown-item">Settings</a>
                  }
                  <div class="dropdown-divider"></div>
                  <a class="dropdown-item" (click)="logout()">Logout</a>
                </div>
              }
            </div>
          </div>
        </header>

        <main class="content-area">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>

    @if (showPasswordModal()) {
      <div class="pw-modal-overlay"
        (click)="showPasswordModal.set(false)">
        <div class="pw-modal"
          (click)="$event.stopPropagation()">

          <div class="pw-modal-header">
            <div class="pw-modal-icon">
              <svg xmlns="http://www.w3.org/2000/svg"
                width="24" height="24"
                viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18"
                  height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div class="pw-modal-header-text">
              <h3>Change Password</h3>
              <p>
                A reset link will be sent to your
                email address.
              </p>
            </div>
            <button class="pw-modal-close"
              (click)="showPasswordModal.set(false)">
              <svg xmlns="http://www.w3.org/2000/svg"
                width="18" height="18"
                viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div class="pw-modal-body">
            <div class="pw-email-row">
              <svg xmlns="http://www.w3.org/2000/svg"
                width="16" height="16"
                viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12
                  c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6
                  c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <span class="pw-email">
                {{ userProfile()?.email }}
              </span>
            </div>
            <p class="pw-note">
              The link expires in 1 hour. Check your
              spam folder if you don't see it.
            </p>
          </div>

          <div class="pw-modal-footer">
            <button class="pw-btn-cancel"
              (click)="showPasswordModal.set(false)"
              [disabled]="isSendingReset()">
              Cancel
            </button>
            <button class="pw-btn-send"
              (click)="confirmPasswordReset()"
              [disabled]="isSendingReset()">
              @if (isSendingReset()) {
                Sending...
              } @else {
                Send Reset Email
              }
            </button>
          </div>

        </div>
      </div>
    }
  `,
  styleUrl: './admin-shell.component.scss'
})
export class AdminShellComponent implements OnInit {
  authService = inject(AuthService);
  router = inject(Router);
  settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly inventoryBootstrap = inject(InventoryBootstrapService);
  private readonly sanitizer = inject(DomSanitizer);

  private svg(raw: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(raw);
  }

  isSendingReset = signal(false);
  showPasswordModal = signal(false);
  showNotifications = signal(false);

  toggleNotifications() {
    this.showNotifications.update(v => !v);
    if (this.showNotifications()) {
      this.dropdownOpen.set(false);
    }
  }

  totalNotificationCount = computed(() =>
    this.overdueOrders() +
    this.pendingReturns() +
    this.lowStock() +
    this.pendingAccessRequests()
  );

  overdueOrdersList = computed(() =>
    this.notificationService.overdueOrdersList?.()
    ?? []
  );

  pendingReturnsList = computed(() =>
    this.notificationService.pendingReturnsList?.()
    ?? []
  );

  lowStockList = computed(() =>
    this.notificationService.lowStockList?.()
    ?? []
  );

  pendingAccessRequestsList = computed(() =>
    this.notificationService.pendingAccessRequestsList?.()
    ?? []
  );

  openPasswordReset() {
    this.dropdownOpen.set(false);
    this.showPasswordModal.set(true);
  }

  async confirmPasswordReset() {
    const email = this.userProfile()?.email || '';
    if (!email) return;

    this.isSendingReset.set(true);
    try {
      await this.authService.sendPasswordResetEmail(email);
      this.showPasswordModal.set(false);
      this.toast.success(`Password reset email sent to ${email}`);
    } catch (err) {
      console.error('Password reset error:', err);
      this.toast.error('Failed to send reset email');
    } finally {
      this.isSendingReset.set(false);
    }
  }


  businessSettings = computed(() => this.settingsService.business());
  closureActive = computed(() => this.settingsService.ordering().closureActive ?? false);

  private readonly notificationService = inject(NotificationService);

  pendingReturns = computed(() =>
    this.notificationService.pendingReturnsCount()
  );
  overdueOrders = computed(() =>
    this.notificationService.overdueOrdersCount()
  );
  lowStock = computed(() =>
    this.notificationService.lowStockCount()
  );
  pendingAccessRequests = computed(() =>
    this.notificationService.pendingAccessRequestsCount()
  );

  isCollapsed = signal<boolean>(false);
  isMobileOpen = signal<boolean>(false);
  currentRoute = signal<string>('');
  pageTitle = signal<string>('Dashboard');
  dropdownOpen = signal<boolean>(false);

  userProfile = computed(() => this.authService.currentProfile());
  initials = computed(() => {
    const p = this.userProfile();
    if (!p) return '??';
    return ((p.firstName?.[0] || '') + (p.lastName?.[0] || '')).toUpperCase();
  });

  sections: NavSection[] = [
    {
      label: 'OVERVIEW',
      items: [
        { label: 'Dashboard', route: '/admin/dashboard', permission: 'viewDashboard', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>') }
      ]
    },
    {
      label: 'CATALOG',
      items: [
        { label: 'Products', route: '/admin/products', permission: 'viewProducts', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>') },
        { label: 'Categories', route: '/admin/categories', permission: 'editProducts', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>') },
        { label: 'Brands', route: '/admin/brands', permission: 'editProducts', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>') }
      ]
    },
    {
      label: 'CUSTOMERS',
      items: [
        { label: 'Customers', route: '/admin/customers', permission: 'viewCustomers', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>') },
        { label: 'Service Areas', route: '/admin/service-areas', permission: 'manageCustomers', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>') },
        { label: 'Access Requests', route: '/admin/access-requests', permission: 'approveAccess', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>') }
      ]
    },
    {
      label: 'ORDERS',
      items: [
        { label: 'Orders', route: '/admin/orders', permission: 'viewOrders', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>') },
        { label: 'Payments', route: '/admin/payments', permission: 'viewPayments', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>') },
        { label: 'Returns', route: '/admin/returns', permission: 'viewPayments', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>') }
      ]
    },
    {
      label: 'INVENTORY',
      items: [
        { label: 'Stock Adjustments', route: '/admin/stock-adjustments', permission: 'adjustStock', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>') }
      ]
    },
    {
      label: 'PURCHASING',
      items: [
        { label: 'Suppliers', route: '/admin/suppliers', permission: 'viewProducts', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>') },
        { label: 'Purchase Orders', route: '/admin/purchase-orders', permission: 'viewProducts', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>') }
      ]
    },
    {
      label: 'ADMIN',
      items: [
        { label: 'Employees', route: '/admin/employees', permission: 'manageEmployees', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline></svg>') },
        { label: 'Settings', route: '/admin/settings', permission: 'manageSettings', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>') },
        { label: 'Content', route: '/admin/content', permission: 'manageSettings', icon: this.svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>') }
      ]
    }
  ];

  constructor() {
    effect(() => {
      const savedState = localStorage.getItem('adminSidebarCollapsed');
      if (savedState) {
        this.isCollapsed.set(savedState === 'true');
      }
    });

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.currentRoute.set(event.urlAfterRedirects.split('?')[0]);
      this.updatePageTitle();
    });
  }

  ngOnInit() {
    this.currentRoute.set(this.router.url.split('?')[0]);
    this.updatePageTitle();
    this.inventoryBootstrap.bootstrap();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.user-menu')) {
      this.dropdownOpen.set(false);
    }
    if (!target.closest('.notification-wrapper')) {
      this.showNotifications.set(false);
    }
  }

  updatePageTitle() {
    const activeRoute = this.router.routerState.root;
    let title = 'Dashboard';
    let route = activeRoute;
    while (route.firstChild) {
      route = route.firstChild;
      if (route.snapshot.data['title']) {
        title = route.snapshot.data['title'];
      }
    }
    this.pageTitle.set(title);
  }

  hasPermission(permission: string): boolean {
    if (permission === 'manageEmployees' || permission === 'manageSettings') {
      return this.authService.isAdmin();
    }
    return this.authService.hasPermission(permission);
  }

  hasVisibleItems(section: NavSection): boolean {
    return section.items.some(item => this.hasPermission(item.permission));
  }

  toggleCollapse() {
    const state = !this.isCollapsed();
    this.isCollapsed.set(state);
    localStorage.setItem('adminSidebarCollapsed', String(state));
  }

  toggleMobile() {
    this.isMobileOpen.update(v => !v);
  }

  closeMobile() {
    this.isMobileOpen.set(false);
  }

  toggleDropdown() {
    this.dropdownOpen.update(v => !v);
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
