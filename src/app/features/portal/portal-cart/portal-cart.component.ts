import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { PortalService } from '../../../core/services/portal.service';
import { SettingsService } from '../../../core/services/settings.service';
import { ToastService } from '../../../shared/services/toast.service';

@Component({
  selector: 'app-portal-cart',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './portal-cart.component.html',
  styleUrl: './portal-cart.component.scss'
})
export class PortalCartComponent {
  protected readonly portal = inject(PortalService);
  protected readonly settingsService = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly functions = inject(Functions);

  deliveryType = signal<'delivery' | 'pickup'>('delivery');
  notes = signal('');
  isPlacingOrder = signal(false);
  showQtyDropdown = signal<string | null>(null);
  quickQtys = [5, 10, 20, 30, 50, 100];

  couponCodesInput = signal('');
  couponPreview = signal<{ codes: string[]; subtotalCents: number; valid: boolean; discountCents: number; message: string } | null>(null);
  isValidatingCoupons = signal(false);

  hasQuickQtys(item: any): boolean {
    const behavior = this.getEffectiveOutOfStockBehavior(item);
    if (behavior === 'allow_backorder') return true;
    return this.quickQtys.some(q => q <= (item.stock ?? 0));
  }

  @HostListener('document:click')
  closeDropdown() {
    this.showQtyDropdown.set(null);
  }

  constructor() {
    effect(() => {
      const opts = this.deliveryOptionsAvailable();
      if (opts === 'pickup_only') {
        this.deliveryType.set('pickup');
      } else if (opts === 'delivery_only') {
        this.deliveryType.set('delivery');
      }
    }, { allowSignalWrites: true });
  }

  taxRatePercent = computed(() =>
    this.settingsService.ordering().defaultTaxRatePercent || 13
  );

  couponCodes = computed(() =>
    [...new Set(this.couponCodesInput().split(',').map(c => c.trim().toUpperCase()).filter(Boolean))]
  );

  // Last-previewed discount, valid only while it still matches the current
  // code list + cart subtotal — editing the codes or the cart after
  // "Apply" invalidates it back to 0 rather than showing a stale number.
  // Advisory only: real enforcement + redemption happens server-side at
  // placeOrder commit, same as every other cart validation here.
  couponDiscountCents = computed(() => {
    const preview = this.couponPreview();
    if (!preview) return 0;
    const codes = this.couponCodes();
    const sameCodes = preview.codes.length === codes.length && preview.codes.every((c, i) => c === codes[i]);
    if (!sameCodes || preview.subtotalCents !== this.portal.cartSubtotalCents()) return 0;
    return preview.valid ? preview.discountCents : 0;
  });

  // Discount-before-tax, matching computeOrderTotals server-side exactly
  // (functions/src/staff-transactions-shared.ts) — HST must be computed on
  // the discounted subtotal, never on the gross subtotal with the coupon
  // subtracted afterward. Subtracting the coupon from a post-tax total
  // would silently overcharge HST on the pre-discount amount.
  taxableCents = computed(() =>
    Math.max(0, this.portal.cartSubtotalCents() - this.couponDiscountCents())
  );

  taxCents = computed(() =>
    Math.round(this.taxableCents() * this.taxRatePercent() / 100)
  );

  totalCents = computed(() =>
    this.taxableCents() + this.taxCents()
  );

  async applyCoupons() {
    const codes = this.couponCodes();
    if (codes.length === 0) {
      this.couponPreview.set(null);
      return;
    }
    this.isValidatingCoupons.set(true);
    try {
      const callable = httpsCallable<
        { couponCodes: string[]; subtotalCents: number },
        { valid: boolean; discountCents: number; message: string }
      >(this.functions, 'validateCoupon');
      const res = await callable({
        couponCodes: codes,
        subtotalCents: this.portal.cartSubtotalCents(),
      });
      this.couponPreview.set({ codes, subtotalCents: this.portal.cartSubtotalCents(), ...res.data });
      if (!res.data.valid) {
        this.toast.error(res.data.message || 'One or more coupon codes are invalid');
      }
    } catch (err: any) {
      this.couponPreview.set(null);
      this.toast.error(err?.message || 'Could not check coupon codes right now');
    } finally {
      this.isValidatingCoupons.set(false);
    }
  }

  removeCoupons() {
    this.couponCodesInput.set('');
    this.couponPreview.set(null);
  }

  orderingSettings = computed(() =>
    this.settingsService.ordering()
  );

  closureActive = computed(() =>
    this.orderingSettings().closureActive
  );

  deliveryOptionsAvailable = computed(() =>
    this.orderingSettings().deliveryOptions
  );

  selectedDeliveryType = this.deliveryType;

  minimumOrderMet = computed(() => {
    const settings = this.orderingSettings();
    if (!settings.minimumOrderEnabled) return true;

    const items = this.portal.cartItems();
    const minVal = settings.minimumOrderValue ?? 0;

    if (settings.minimumOrderScope === 'cart') {
      if (settings.minimumOrderType === 'quantity') {
        const totalQty = items.reduce(
          (sum, i) => sum + i.quantity, 0
        );
        return totalQty >= minVal;
      } else {
        const totalCents = items.reduce(
          (sum, i) =>
            sum + (i.priceCents * i.quantity), 0
        );
        return totalCents >= minVal;
      }
    } else {
      // per_product — every line item must meet
      // the minimum individually
      return items.every(i => {
        if (settings.minimumOrderType === 'quantity') {
          return i.quantity >= minVal;
        } else {
          return (i.priceCents * i.quantity) >= minVal;
        }
      });
    }
  });

  minimumOrderMessage = computed(() => {
    const settings = this.orderingSettings();
    if (!settings.minimumOrderEnabled) return '';
    if (this.minimumOrderMet()) return '';

    const minVal = settings.minimumOrderValue ?? 0;
    const value = settings.minimumOrderType ===
      'quantity' ? minVal :
      (minVal / 100).toFixed(2);

    if (settings.minimumOrderScope === 'cart') {
      return settings.minimumOrderType === 'quantity'
        ? `Minimum order is ${value} units total.`
        : `Minimum order is $${value}.`;
    } else {
      return settings.minimumOrderType === 'quantity'
        ? `Each product requires a minimum of ${value} units.`
        : `Each product requires a minimum order of $${value}.`;
    }
  });

  getEffectiveOutOfStockBehavior(item: any): 'hide' | 'show_disabled' | 'allow_backorder' {
    if (item.outOfStockBehaviorOverride != null) {
      return item.outOfStockBehaviorOverride;
    }
    return this.orderingSettings().outOfStockBehavior || 'show_disabled';
  }

  isBackordered(item: any): boolean {
    return item.quantity > (item.stock ?? 0);
  }

  hasAnyBackorderedItems = computed(() => {
    return this.portal.cartItems().some(i =>
      this.isBackordered(i) && this.getEffectiveOutOfStockBehavior(i) === 'allow_backorder'
    );
  });

  canPlaceOrder = computed(() => {
    if (this.portal.cartItems().length === 0) return false;
    if (this.closureActive()) return false;
    if (!this.minimumOrderMet()) return false;

    // Hard block if any item is backordered but backorder is not allowed for that item
    const hasInvalidBackorder = this.portal.cartItems().some(i =>
      this.isBackordered(i) && this.getEffectiveOutOfStockBehavior(i) !== 'allow_backorder'
    );
    if (hasInvalidBackorder) return false;

    return true;
  });

  async placeOrder() {
    if (this.portal.cartItems().length === 0) return;

    this.isPlacingOrder.set(true);
    try {
      const orderId = await this.portal.placeOrder(
        this.deliveryType(),
        this.notes(),
        this.settingsService,
        this.couponCodes()
      );
      this.toast.success('Order placed successfully!');
      // Brief delay to allow Firestore to sync the new
      // order doc before the detail page opens a listener
      // on it — avoids a transient permission error on
      // the first read of a freshly created document.
      await new Promise(resolve => setTimeout(resolve, 800));
      this.router.navigate(['/portal/orders', orderId]);
    } catch (err: any) {
      console.error('Order placement error:', err);
      this.toast.error(
        err.message || 'Failed to place order'
      );
    } finally {
      this.isPlacingOrder.set(false);
    }
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }
}
