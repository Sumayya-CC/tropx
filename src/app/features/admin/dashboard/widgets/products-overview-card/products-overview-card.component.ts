import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-products-overview-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './products-overview-card.component.html',
  styleUrl: './products-overview-card.component.scss',
})
export class ProductsOverviewCardComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  topProducts = computed(() => {
    const map = new Map<string, any>();
    for (const o of this.data.periodOrders()) {
      for (const item of o.items) {
        const cur = map.get(item.productId) || {
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          unitsSold: 0,
          revenue: 0
        };
        cur.unitsSold += item.quantity;
        cur.revenue += item.lineTotalCents;
        map.set(item.productId, cur);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  });
}
