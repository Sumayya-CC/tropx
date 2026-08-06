import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-needs-attention-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './needs-attention-card.component.html',
  styleUrl: './needs-attention-card.component.scss',
})
export class NeedsAttentionCardComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  // ── ACTION REQUIRED ──────────────────────────────────
  // Reconciliation discrepancies frozen for manual review —
  // highest-priority integrity alert.
  reconciliationAlert = computed(() => {
    const items = this.data.needsReviewDiscrepancies();
    const count = items.length;
    const totalAbsDelta = items.reduce(
      (sum, r) => sum + Math.abs(r.maxAbsDelta || 0), 0
    );
    return { count, totalAbsDelta, hasItems: count > 0 };
  });

  // ── BACKORDERS SUMMARY ───────────────────────────────
  backorderSummary = computed(() => {
    const orders = this.data.allOrders().filter(o =>
      !o.isDeleted && o.hasBackorder &&
      o.status !== 'cancelled' && o.status !== 'delivered');
    const byProduct = new Map<string, { productName: string; units: number; orders: Set<string> }>();
    let totalUnits = 0;
    for (const o of orders) {
      for (const it of (o.items || []) as any[]) {
        const bq = it.backorderedQty || 0;
        if (bq <= 0) continue;
        totalUnits += bq;
        const cur = byProduct.get(it.productId) || { productName: it.productName, units: 0, orders: new Set<string>() };
        cur.units += bq; cur.orders.add(o.id);
        byProduct.set(it.productId, cur);
      }
    }
    const products = Array.from(byProduct.entries())
      .map(([productId, v]) => ({ productId, productName: v.productName, units: v.units, orderCount: v.orders.size }))
      .sort((a, b) => b.units - a.units);
    return { totalUnits, orderCount: orders.length, products };
  });
}
