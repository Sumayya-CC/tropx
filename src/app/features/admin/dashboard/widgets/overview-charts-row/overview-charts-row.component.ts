import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-overview-charts-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './overview-charts-row.component.html',
  styleUrl: './overview-charts-row.component.scss',
})
export class OverviewChartsRowComponent {
  protected readonly data = inject(AdminDashboardDataService);

  // Weekly revenue buckets for the Overview trend line.
  // Uses all orders regardless of the date-range picker —
  // always shows the last 8 weeks for context.
  weeklyRevenueBuckets = computed(() => {
    const now = new Date();
    const buckets: {
      label: string;
      revenueCents: number;
    }[] = [];

    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (w * 7) - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const label = weekStart.toLocaleDateString('en-CA', {
        month: 'short', day: 'numeric'
      });

      const revenueCents = this.data.allOrders()
        .filter(o => {
          if (o.isDeleted || o.status === 'cancelled') {
            return false;
          }
          const d = this.data.toDate(o.confirmedAt);
          return d >= weekStart && d <= weekEnd;
        })
        .reduce((sum, o) => sum + o.totalCents, 0);

      buckets.push({ label, revenueCents });
    }
    return buckets;
  });

  weeklyChartMax = computed(() => {
    const b = this.weeklyRevenueBuckets();
    return Math.max(...b.map(x => x.revenueCents), 1);
  });

  weeklyChartPolygonPoints = computed(() => {
    const buckets = this.weeklyRevenueBuckets();
    const max = this.weeklyChartMax();
    if (buckets.length === 0) return '';
    const pts = buckets.map((b, i) =>
      `${i * (700 / (buckets.length - 1))},${140 - (b.revenueCents / max) * 140}`
    ).join(' ');
    return `${pts} 700,140 0,140`;
  });

  weeklyChartPolylinePoints = computed(() => {
    const buckets = this.weeklyRevenueBuckets();
    const max = this.weeklyChartMax();
    if (buckets.length === 0) return '';
    return buckets.map((b, i) =>
      `${i * (700 / (buckets.length - 1))},${140 - (b.revenueCents / max) * 140}`
    ).join(' ');
  });
}
