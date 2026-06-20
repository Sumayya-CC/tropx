import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
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

  deliveryType = signal<'delivery' | 'pickup'>('delivery');
  notes = signal('');
  isPlacingOrder = signal(false);

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

  taxCents = computed(() =>
    Math.round(
      this.portal.cartSubtotalCents() *
      this.taxRatePercent() / 100
    )
  );

  totalCents = computed(() =>
    this.portal.cartSubtotalCents() + this.taxCents()
  );

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
        this.settingsService
      );
      this.toast.success('Order placed successfully!');
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
