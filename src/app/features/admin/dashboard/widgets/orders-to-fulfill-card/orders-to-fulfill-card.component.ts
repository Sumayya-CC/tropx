import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS, OrderStatus } from '../../../../../core/models/order.model';
import { StatusBadgeComponent } from '../../../../../shared/components/status-badge/status-badge.component';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-orders-to-fulfill-card',
  standalone: true,
  imports: [CommonModule, RouterModule, StatusBadgeComponent],
  templateUrl: './orders-to-fulfill-card.component.html',
  styleUrl: './orders-to-fulfill-card.component.scss',
})
export class OrdersToFulfillCardComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  // ── DELIVERY SCHEDULE ────────────────────────────────
  ordersToFulfill = computed(() => {
    const now = new Date();
    const today = new Date(
      now.getFullYear(), now.getMonth(), now.getDate()
    );

    return this.data.allOrders()
      .filter(o =>
        !o.isDeleted &&
        (o.status === 'confirmed' ||
          o.status === 'preparing')
      )
      .map(o => ({
        ...o,
        deliveryDate: o.expectedDeliveryDate
          ? this.data.toDate(o.expectedDeliveryDate)
          : null,
        isDelayed: o.expectedDeliveryDate
          ? this.data.toDate(o.expectedDeliveryDate) < today
          : false,
        isPortal: o.source === 'customer_portal',
      }))
      .sort((a, b) => {
        // Delayed first, then by delivery date,
        // then unscheduled by confirmed date.
        if (a.isDelayed && !b.isDelayed) return -1;
        if (!a.isDelayed && b.isDelayed) return 1;
        if (a.deliveryDate && b.deliveryDate) {
          return a.deliveryDate.getTime() -
            b.deliveryDate.getTime();
        }
        if (a.deliveryDate) return -1;
        if (b.deliveryDate) return 1;
        return this.data.toDate(b.confirmedAt).getTime() -
          this.data.toDate(a.confirmedAt).getTime();
      });
  });

  delayedOrdersCount = computed(() =>
    this.ordersToFulfill().filter(o => o.isDelayed).length
  );

  formatShortDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric'
    });
  }

  getOrderStatusColor(status: string): string {
    return ORDER_STATUS_COLORS[status as OrderStatus] || 'info';
  }

  getStatusLabel(status: string): string {
    return ORDER_STATUS_LABELS[status as OrderStatus] || status;
  }
}
