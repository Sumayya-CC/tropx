import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-financials-charts-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './financials-charts-row.component.html',
  styleUrl: './financials-charts-row.component.scss',
})
export class FinancialsChartsRowComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  // ── CHARTS ───────────────────────────────────────────
  chartBuckets = computed(() => {
    const range = this.data.dateRange();
    const diffDays = Math.ceil(
      (range.to.getTime() - range.from.getTime()) /
      86400000
    );

    let buckets: {
      label: string;
      from: Date;
      to: Date;
      revenue: number;
      collected: number;
    }[] = [];

    if (diffDays <= 1) {
      for (let h = 0; h < 24; h++) {
        const from = new Date(range.from);
        from.setHours(h, 0, 0, 0);
        const to = new Date(range.from);
        to.setHours(h, 59, 59, 999);
        buckets.push({
          label: `${h}:00`, from, to,
          revenue: 0, collected: 0
        });
      }
    } else if (diffDays <= 31) {
      const cur = new Date(range.from);
      cur.setHours(0, 0, 0, 0);
      while (cur <= range.to) {
        const from = new Date(cur);
        const to = new Date(cur);
        to.setHours(23, 59, 59, 999);
        buckets.push({
          label: from.toLocaleDateString('en-CA', {
            month: 'short', day: 'numeric'
          }),
          from, to, revenue: 0, collected: 0
        });
        cur.setDate(cur.getDate() + 1);
      }
    } else if (diffDays <= 90) {
      const cur = new Date(range.from);
      cur.setHours(0, 0, 0, 0);
      while (cur <= range.to) {
        const from = new Date(cur);
        const to = new Date(cur);
        to.setDate(to.getDate() + 6);
        to.setHours(23, 59, 59, 999);
        if (to > range.to) to.setTime(range.to.getTime());
        buckets.push({
          label: from.toLocaleDateString('en-CA', {
            month: 'short', day: 'numeric'
          }),
          from, to, revenue: 0, collected: 0
        });
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      const cur = new Date(
        range.from.getFullYear(),
        range.from.getMonth(), 1
      );
      while (cur <= range.to) {
        const from = new Date(cur);
        const to = new Date(
          cur.getFullYear(),
          cur.getMonth() + 1, 0, 23, 59, 59
        );
        buckets.push({
          label: from.toLocaleDateString('en-CA', {
            month: 'short', year: '2-digit'
          }),
          from, to, revenue: 0, collected: 0
        });
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    for (const o of this.data.allOrders()) {
      if (o.isDeleted || o.status === 'cancelled') continue;
      const d = this.data.toDate(o.confirmedAt);
      const b = buckets.find(x => d >= x.from && d <= x.to);
      if (b) b.revenue += o.totalCents;
    }
    for (const p of this.data.allPayments()) {
      if (p.isDeleted) continue;
      const d = new Date(p.receivedDate + 'T00:00:00');
      const b = buckets.find(x => d >= x.from && d <= x.to);
      if (b) b.collected += p.amountCents;
    }

    return buckets;
  });

  getChartMax(): number {
    const b = this.chartBuckets();
    return Math.max(
      ...b.map(x => Math.max(x.revenue, x.collected)), 1
    );
  }

  paymentMethodBreakdown = computed(() => {
    const p = this.data.periodPayments();
    return {
      cash: p.filter(x => x.method === 'cash')
        .reduce((s, x) => s + x.amountCents, 0),
      etransfer: p.filter(x => x.method === 'e_transfer')
        .reduce((s, x) => s + x.amountCents, 0),
      cheque: p.filter(x => x.method === 'cheque')
        .reduce((s, x) => s + x.amountCents, 0),
      other: p.filter(x => x.method === 'other')
        .reduce((s, x) => s + x.amountCents, 0),
    };
  });

  getMethodBars() {
    const pm = this.paymentMethodBreakdown();
    return [
      {
        label: 'Cash', value: pm.cash,
        color: 'var(--green)'
      },
      {
        label: 'E-Transfer', value: pm.etransfer,
        color: 'var(--navy)'
      },
      {
        label: 'Cheque', value: pm.cheque,
        color: 'var(--gold)'
      },
      {
        label: 'Other', value: pm.other,
        color: 'var(--gray)'
      },
    ];
  }
}
