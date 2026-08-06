import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { SettingsService } from '../../../../../core/services/settings.service';
import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { ORDER_STATUS_COLORS, OrderStatus } from '../../../../../core/models/order.model';
import { StatusBadgeComponent } from '../../../../../shared/components/status-badge/status-badge.component';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-overdue-invoices-card',
  standalone: true,
  imports: [CommonModule, RouterModule, StatusBadgeComponent],
  templateUrl: './overdue-invoices-card.component.html',
  styleUrl: './overdue-invoices-card.component.scss',
})
export class OverdueInvoicesCardComponent {
  protected readonly data = inject(AdminDashboardDataService);
  protected readonly settingsService = inject(SettingsService);

  protected readonly formatCurrency = centsToDisplay;

  sortedOverdueOrders = computed(() => {
    return [...this.data.actionItems().overdueOrders].sort((a, b) => {
      const at = a.confirmedAt?.seconds ?? 0;
      const bt = b.confirmedAt?.seconds ?? 0;
      return at - bt;
    });
  });

  getOrderAgeDays(order: any): number {
    const confirmed = this.data.toDate(order.confirmedAt);
    return Math.floor(
      (new Date().getTime() - confirmed.getTime()) /
      86400000
    );
  }

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
