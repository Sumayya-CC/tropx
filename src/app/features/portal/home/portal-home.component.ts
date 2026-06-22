import { Component, inject, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { PortalService } from '../../../core/services/portal.service';
import { SettingsService } from '../../../core/services/settings.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../../shared/services/toast.service';

@Component({
  selector: 'app-portal-home',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './portal-home.component.html',
  styleUrl: './portal-home.component.scss'
})
export class PortalHomeComponent implements OnInit, OnDestroy {
  protected readonly portal = inject(PortalService);
  protected readonly settingsService = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  homeSearchQuery = signal('');

  galleryIndex = signal(0);
  galleryPaused = signal(false);
  private galleryTimer: any = null;

  bannerIndex = signal(0);
  bannerPaused = signal(false);
  private bannerTimer: any = null;

  ngOnInit() {
    this.startGalleryTimer();
    this.startBannerTimer();
  }

  ngOnDestroy() {
    this.stopGalleryTimer();
    this.stopBannerTimer();
  }

  private startGalleryTimer() {
    this.stopGalleryTimer();
    this.galleryTimer = setInterval(() => {
      if (!this.galleryPaused()) {
        const images = this.storefront().galleryImages;
        if (images.length > 3) {
          const max = Math.max(0, images.length - 3);
          this.galleryIndex.update(i => i >= max ? 0 : i + 1);
        }
      }
    }, 4000);
  }

  private stopGalleryTimer() {
    if (this.galleryTimer) {
      clearInterval(this.galleryTimer);
      this.galleryTimer = null;
    }
  }

  galleryPrev() {
    const images = this.storefront().galleryImages;
    const max = Math.max(0, images.length - 3);
    this.galleryIndex.update(i => i <= 0 ? max : i - 1);
  }

  galleryNext() {
    const images = this.storefront().galleryImages;
    const max = Math.max(0, images.length - 3);
    this.galleryIndex.update(i => i >= max ? 0 : i + 1);
  }

  galleryGoTo(index: number) {
    this.galleryIndex.set(index);
  }

  // Resolve product details for a slide's product list
  getSlideProducts(slide: any): any[] {
    return slide.products
      .map((sp: any) => {
        const product = this.portal.allProducts()
          .find((p: any) => p.id === sp.productId);
        return product ? { ...product, showPrice: sp.showPrice } : null;
      })
      .filter(Boolean);
  }

  bannerNext() {
    const slides = this.storefront().featuredBannerSlides;
    this.bannerIndex.update(i => (i + 1) % slides.length);
  }

  bannerPrev() {
    const slides = this.storefront().featuredBannerSlides;
    this.bannerIndex.update(i =>
      (i - 1 + slides.length) % slides.length
    );
  }

  bannerGoTo(index: number) {
    this.bannerIndex.set(index);
  }

  private startBannerTimer() {
    this.stopBannerTimer();
    const sf = this.storefront();
    if (!sf.featuredBannerAutoAdvance) return;
    const interval = (sf.featuredBannerIntervalSeconds ?? 5) * 1000;
    this.bannerTimer = setInterval(() => {
      if (!this.bannerPaused()) {
        const slides = this.storefront().featuredBannerSlides;
        if (slides.length > 1) {
          this.bannerIndex.update(i => (i + 1) % slides.length);
        }
      }
    }, interval);
  }

  private stopBannerTimer() {
    if (this.bannerTimer) {
      clearInterval(this.bannerTimer);
      this.bannerTimer = null;
    }
  }

  submitSearch() {
    const q = this.homeSearchQuery().trim();
    this.router.navigate(['/portal/catalog'], {
      queryParams: q ? { search: q } : {},
    });
  }

  greeting = computed(() => {
    const h = new Date().getHours();
    const name = this.portal.customerProfile()?.firstName || '';
    const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    return `Good ${time}${name ? ', ' + name : ''}`;
  });

  storefront = this.settingsService.storefront;

  // Quantity inputs per product, for "Add" steppers on cards
  qtyInputs = signal<Record<string, number>>({});

  getQty(productId: string): number {
    return this.qtyInputs()[productId] || 1;
  }

  setQty(productId: string, qty: number) {
    const product = this.portal.allProducts().find((p: any) => p.id === productId);
    if (!product) return;
    const behavior = this.getEffectiveOutOfStockBehavior(product);
    const allowBackorder = behavior === 'allow_backorder';
    const clamped = allowBackorder
      ? Math.max(1, qty)
      : Math.max(1, Math.min(qty, product.stock || 0));
    this.qtyInputs.update(q => ({ ...q, [productId]: clamped }));
  }

  getCartQty(productId: string): number {
    return this.portal.cartItems().find(i => i.productId === productId)?.quantity ?? 0;
  }

  isInCart(productId: string): boolean {
    return this.portal.cartItems().some(i => i.productId === productId);
  }

  getEffectiveOutOfStockBehavior(product: any): 'hide' | 'show_disabled' | 'allow_backorder' {
    if (product.outOfStockBehaviorOverride != null) {
      return product.outOfStockBehaviorOverride;
    }
    return this.settingsService.ordering().outOfStockBehavior || 'show_disabled';
  }

  addToCart(product: any) {
    const behavior = this.getEffectiveOutOfStockBehavior(product);
    if (product.stock <= 0 && behavior !== 'allow_backorder') return;
    const qty = this.getQty(product.id);
    this.portal.addToCart(product, qty);
    // Reset qty input after adding
    this.qtyInputs.update(q => ({
      ...q,
      [product.id]: 1
    }));
    this.toast.success(`${product.name} ×${qty} added to cart`);
  }

  increment(product: any) {
    const current = this.getCartQty(product.id);
    const behavior = this.getEffectiveOutOfStockBehavior(product);
    const allowBackorder = behavior === 'allow_backorder';
    if (!allowBackorder && current >= product.stock) return;
    this.portal.updateCartQty(product.id, current + 1);
  }

  decrement(product: any) {
    const current = this.getCartQty(product.id);
    if (current <= 1) {
      this.portal.removeFromCart(product.id);
    } else {
      this.portal.updateCartQty(product.id, current - 1);
    }
  }


  // New arrivals: isFeaturedNew flag OR createdAt within newArrivalsAutoDays
  newArrivals = computed(() => {
    const sf = this.storefront();
    if (!sf.newArrivalsEnabled) return [];

    const days = sf.newArrivalsAutoDays ?? 14;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    return this.portal.allProducts()
      .filter((p: any) => !p.isDeleted && p.active)
      .filter((p: any) => {
        if (p.stock <= 0) {
          const behavior = this.getEffectiveOutOfStockBehavior(p);
          if (behavior === 'hide') return false;
        }
        if (p.isFeaturedNew) return true;
        const createdMs = this.toMillis(p.createdAt);
        return createdMs !== null && createdMs >= cutoffMs;
      })
      .slice(0, 8);
  });

  private toMillis(ts: any): number | null {
    if (!ts) return null;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds) return ts.seconds * 1000;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // Load categories dynamically from Firestore
  private categories$ = this.firestore
    .getCollection<{ id: string; name: string }>(
      'categories',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    );

  categories = toSignal(this.categories$,
    { initialValue: [] as { id: string; name: string }[] }
  );

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  getProductInitial(name: string): string {
    return (name || '?').charAt(0).toUpperCase();
  }

  getStockStatus(product: any): {
    label: string;
    class: string;
  } {
    if (product.stock <= 0) {
      return { label: 'Out of Stock', class: 'out' };
    }

    const settings = this.settingsService.ordering();
    const threshold = settings.lowStockCustomerThreshold ?? 5;
    const isLowStock = product.stock <= threshold;

    if (isLowStock && settings.lowStockVisibility !== 'none') {
      if (settings.lowStockVisibility === 'vague') {
        return { label: 'Low Stock', class: 'low' };
      } else {
        return { label: `Only ${product.stock} left`, class: 'low' };
      }
    }

    return { label: 'In Stock', class: 'in' };
  }

  submittedNotifications = signal<Record<string, boolean>>({});

  async requestStockNotification(product: any) {
    const customerId = this.portal.customerId();
    const profile = this.portal.customerProfile();
    if (!customerId || !profile) {
      this.toast.error('You must be logged in to request notification.');
      return;
    }

    try {
      const docData = {
        customerId,
        customerName: `${profile.firstName} ${profile.lastName}`.trim() || 'Customer',
        customerEmail: profile.email,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        createdAt: new Date(),
        status: 'pending' as const,
        notifiedAt: null,
      };

      await this.firestore.addDocument('stockNotificationRequests', docData);
      this.submittedNotifications.update(prev => ({
        ...prev,
        [product.id]: true
      }));
      this.toast.success('We will notify you when this item is restocked.');
    } catch (e) {
      console.error(e);
      this.toast.error('Failed to submit notification request.');
    }
  }

  showQtyDropdown = signal<string | null>(null);
  quickQtys = [5, 10, 20, 30, 50, 100];

  toggleQtyDropdown(productId: string) {
    this.showQtyDropdown.update(current =>
      current === productId ? null : productId
    );
  }

  selectQuickQty(productId: string, qty: number) {
    this.setQty(productId, qty);
    this.showQtyDropdown.set(null);
  }

  hasQuickQtys(product: any): boolean {
    const behavior = this.getEffectiveOutOfStockBehavior(product);
    if (behavior === 'allow_backorder') return true;
    return this.quickQtys.some(q => q <= product.stock);
  }
}
