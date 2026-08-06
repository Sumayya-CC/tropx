import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { SettingsService } from '../../../../../core/services/settings.service';
import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-aging-report-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aging-report-card.component.html',
  styleUrl: './aging-report-card.component.scss',
})
export class AgingReportCardComponent {
  protected readonly data = inject(AdminDashboardDataService);
  protected readonly settingsService = inject(SettingsService);

  protected readonly formatCurrency = centsToDisplay;

  agingReport = computed(() => {
    const days = this.settingsService
      .ordering().overdueAfterDays || 30;
    const now = new Date();
    const unpaid = this.data.allOrders().filter(o =>
      !o.isDeleted &&
      o.status !== 'cancelled' &&
      (o.balanceCents || 0) > 0
    );
    const b = {
      current: { orders: [] as any[], total: 0 },
      tier1: { orders: [] as any[], total: 0 },
      tier2: { orders: [] as any[], total: 0 },
      tier3: { orders: [] as any[], total: 0 },
    };
    for (const o of unpaid) {
      const age = Math.floor(
        (now.getTime() -
          this.data.toDate(o.confirmedAt).getTime()) /
        86400000
      );
      const bal = o.balanceCents || 0;
      if (age <= days) {
        b.current.orders.push(o);
        b.current.total += bal;
      } else if (age <= days * 2) {
        b.tier1.orders.push(o);
        b.tier1.total += bal;
      } else if (age <= days * 3) {
        b.tier2.orders.push(o);
        b.tier2.total += bal;
      } else {
        b.tier3.orders.push(o);
        b.tier3.total += bal;
      }
    }
    return b;
  });
}
