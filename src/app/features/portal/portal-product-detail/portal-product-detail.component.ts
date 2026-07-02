import { Component, inject, signal, computed, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { PortalService } from '../../../core/services/portal.service';
import { ToastService } from '../../../shared/services/toast.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { SettingsService } from '../../../core/services/settings.service';
import { where } from '@angular/fire/firestore';

@Component({
  selector: 'app-portal-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './portal-product-detail.component.html',
  styleUrl: './portal-product-detail.component.scss'
})
export class PortalProductDetailComponent implements OnInit {
  protected readonly portal = inject(PortalService);
  protected readonly settingsService = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly firestoreService = inject(FirestoreService);

  productId = signal<string>('');
  product = signal<any>(null);
  isLoading = signal(true);
  quantity = signal(1);
  submittedNotifications = signal<Record<string, boolean>>({});
  showQtyDropdown = signal(false);
  isHoveringQty = signal(false);

  shouldShowQtyDropdown = computed(() =>
    (this.isHoveringQty() || this.showQtyDropdown()) &&
    this.hasQuickQtys()
  );

  quickQtys = [5, 10, 20, 30, 50, 100];

  hasQuickQtys(): boolean {
    const p = this.product();
    if (!p) return false;
    const behavior = this.getEffectiveOutOfStockBehavior(p);
    if (behavior === 'allow_backorder') return true;
    return this.quickQtys.some(q => q <= p.stock);
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.showQtyDropdown.set(false);
    this.isHoveringQty.set(false);
  }

  onStepperButtonClick() {
    // On touch devices, hover doesn't exist.
    // Tapping + or − toggles the quick select.
    if (!this.isHoveringQty()) {
      this.showQtyDropdown.set(!this.showQtyDropdown());
    }
  }

  getEffectiveOutOfStockBehavior(product: any): 'hide' | 'show_disabled' | 'allow_backorder' {
    if (!product) return 'show_disabled';
    if (product.outOfStockBehaviorOverride != null) {
      return product.outOfStockBehaviorOverride;
    }
    return this.settingsService.ordering().outOfStockBehavior || 'show_disabled';
  }

  // Related products (same category)
  relatedProducts = computed(() => {
    const p = this.product();
    if (!p) return [];
    return this.portal.allProducts()
      .filter((x: any) =>
        x.id !== p.id &&
        x.categoryId === p.categoryId &&
        (x.stock > 0 || this.getEffectiveOutOfStockBehavior(x) !== 'hide')
      )
      .slice(0, 4);
  });

  cartQty = computed(() =>
    this.portal.cartItems()
      .find(i => i.productId === this.productId())
      ?.quantity ?? 0
  );

  isInCart = computed(() =>
    this.portal.cartItems()
      .some(i => i.productId === this.productId())
  );

  stockStatus = computed(() => {
    const p = this.product();
    if (!p) return { label: '', class: '' };
    
    const behavior = this.getEffectiveOutOfStockBehavior(p);
    if (p.stock <= 0) {
      if (behavior === 'allow_backorder') {
        return { label: 'Backorder Available', class: 'in' };
      }
      return { label: 'Out of Stock', class: 'out' };
    }

    const settings = this.settingsService.ordering();
    const threshold = settings.lowStockCustomerThreshold ?? 5;
    const isLowStock = p.stock <= threshold;

    if (isLowStock && settings.lowStockVisibility !== 'none') {
      if (settings.lowStockVisibility === 'vague') {
        return { label: 'Low Stock', class: 'low' };
      } else {
        return {
          label: `Only ${p.stock} units left`,
          class: 'low'
        };
      }
    }

    if (settings.lowStockVisibility === 'none') {
      return {
        label: 'In Stock',
        class: 'in'
      };
    }

    return {
      label: `In Stock (${p.stock} available)`,
      class: 'in'
    };
  });

  marginPercent = computed(() => 0);
  // Portal never shows margin

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/portal/catalog']);
      return;
    }
    this.productId.set(id);

    // Try to find in already-loaded products first
    const cached = this.portal.allProducts()
      .find((p: any) => p.id === id);
    if (cached) {
      this.product.set(cached);
      this.isLoading.set(false);
      // Set initial quantity
      const cartItem = this.portal.cartItems()
        .find(i => i.productId === id);
      if (cartItem) {
        this.quantity.set(cartItem.quantity);
      }
    } else {
      // Load from Firestore directly
      this.firestoreService
        .getDocument<any>(`products/${id}`)
        .subscribe(p => {
          if (!p || p.isDeleted || !p.active) {
            this.toast.error('Product not found');
            this.router.navigate(['/portal/catalog']);
            return;
          }
          this.product.set(p);
          this.isLoading.set(false);
        });
    }
  }

  incrementQty() {
    const p = this.product();
    if (!p) return;
    const behavior = this.getEffectiveOutOfStockBehavior(p);
    if (behavior === 'allow_backorder' || this.quantity() < p.stock) {
      this.quantity.update(q => q + 1);
    }
  }

  decrementQty() {
    if (this.quantity() > 1) {
      this.quantity.update(q => q - 1);
    }
  }

  addToCart() {
    const p = this.product();
    if (!p) return;
    const behavior = this.getEffectiveOutOfStockBehavior(p);
    if (p.stock <= 0 && behavior !== 'allow_backorder') return;
    this.portal.addToCart(p, this.quantity());
    this.toast.success(
      `${p.name} added to cart`
    );
  }

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

      await this.firestoreService.addDocument('stockNotificationRequests', docData);
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

  updateCartQty(qty: number) {
    if (qty <= 0) {
      this.portal.removeFromCart(this.productId());
    } else {
      this.portal.updateCartQty(
        this.productId(), qty
      );
    }
  }

  removeFromCart() {
    this.portal.removeFromCart(this.productId());
    this.toast.success('Removed from cart');
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  getProductInitial(name: string): string {
    return (name || '?').charAt(0).toUpperCase();
  }
}
