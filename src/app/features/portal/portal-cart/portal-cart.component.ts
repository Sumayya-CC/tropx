import { Component, inject, signal, computed } from '@angular/core';
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
