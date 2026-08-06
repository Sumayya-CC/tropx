import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-top-customers-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './top-customers-card.component.html',
  styleUrl: './top-customers-card.component.scss',
})
export class TopCustomersCardComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  topCustomers = computed(() => {
    const map = new Map<string, any>();
    for (const o of this.data.periodOrders()) {
      const cur = map.get(o.customerId) || {
        customerId: o.customerId,
        customerName: o.customerName,
        ordersCount: 0,
        revenue: 0,
        collected: 0,
        balance: 0
      };
      cur.ordersCount++;
      cur.revenue += o.totalCents;
      cur.collected += o.amountPaidCents || 0;
      cur.balance += o.balanceCents || 0;
      map.set(o.customerId, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  });
}
