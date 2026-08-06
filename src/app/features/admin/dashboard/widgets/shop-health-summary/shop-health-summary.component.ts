import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { Shop } from '../../../../../core/models/shop.model';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-shop-health-summary',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './shop-health-summary.component.html',
})
export class ShopHealthSummaryComponent {
  protected readonly data = inject(AdminDashboardDataService);

  healthTabData = computed(() => {
    const shops = this.data.allShops().filter(s => !s.isDeleted);
    const customers = shops.filter(s => s.healthKind === 'customer');
    const prospects = shops.filter(s => s.healthKind === 'prospect');
    const byBand = (list: Shop[], band: string) => list.filter(s => (s.healthBand||'unknown') === band)
      .sort((a,b) => (b.healthDays ?? 0) - (a.healthDays ?? 0));
    return {
      atRisk: byBand(customers, 'at_risk'),
      watch: byBand(customers, 'watch'),
      cold: byBand(prospects, 'cold'),
      cooling: byBand(prospects, 'cooling'),
    };
  });
}
