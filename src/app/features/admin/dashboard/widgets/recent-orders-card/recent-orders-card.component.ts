import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { ORDER_STATUS_COLORS, OrderStatus } from '../../../../../core/models/order.model';
import { StatusBadgeComponent } from '../../../../../shared/components/status-badge/status-badge.component';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-recent-orders-card',
  standalone: true,
  imports: [CommonModule, RouterModule, StatusBadgeComponent],
  templateUrl: './recent-orders-card.component.html',
})
export class RecentOrdersCardComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  recentOrdersFull = computed(() =>
    this.data.periodOrders()
      .sort((a, b) =>
        this.data.toDate(b.confirmedAt).getTime() -
        this.data.toDate(a.confirmedAt).getTime()
      )
      .slice(0, 20)
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
}
