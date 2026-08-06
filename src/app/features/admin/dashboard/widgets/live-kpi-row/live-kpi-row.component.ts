import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { NotificationService } from '../../../../../core/services/notification.service';
import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-live-kpi-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './live-kpi-row.component.html',
  styleUrl: './live-kpi-row.component.scss',
})
export class LiveKpiRowComponent {
  protected readonly data = inject(AdminDashboardDataService);
  private readonly notificationService = inject(NotificationService);

  protected readonly formatCurrency = centsToDisplay;

  // ── LIVE KPIs (always current) ──────────────────────
  liveKpis = computed(() => {
    const customers = this.data.allCustomers()
      .filter(c => !c.isDeleted);
    const activeCustomers = customers
      .filter(c => c.status === 'active').length;

    // Compute outstanding from live order balanceCents
    // (source of truth) not the denormalized counter
    // which can drift. Mirrors the aging report exactly.
    const outstandingBalance = this.data.allOrders()
      .filter(o =>
        !o.isDeleted &&
        o.status !== 'cancelled' &&
        (o.balanceCents || 0) > 0
      )
      .reduce((sum, o) => sum + (o.balanceCents || 0), 0);

    const pendingReturns = this.notificationService
      .pendingReturnsCount();
    const lowStockItems = this.notificationService
      .lowStockCount();

    return {
      outstandingBalance,
      activeCustomers,
      pendingReturns,
      lowStockItems
    };
  });
}
