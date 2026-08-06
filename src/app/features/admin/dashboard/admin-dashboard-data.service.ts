import { Injectable, inject, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';

import { FirestoreService } from '../../../core/services/firestore.service';
import { SettingsService } from '../../../core/services/settings.service';
import { Order } from '../../../core/models/order.model';
import { Payment } from '../../../core/models/payment.model';
import { Return } from '../../../core/models/return.model';
import { Customer } from '../../../core/models/customer.model';
import { Product } from '../../../core/models/product.model';
import { Shop } from '../../../core/models/shop.model';

export type DatePreset = 'today' | 'week' | 'month' | 'days30' | 'months3' | 'months6' | 'year' | 'custom';

// Shared state for the admin dashboard's 5 tabs (Overview/Financials/
// Orders/Products/Field Ops): the 8 raw Firestore streams every tab reads
// from, the date-range picker state, and the computeds more than one
// consumer reuses (periodOrders/prevPeriodOrders/periodPayments/
// prevPeriodPayments/periodReturns, orderStatusBreakdown, periodAnalytics,
// actionItems, lowStockProducts, shopHealthSummary, pipelineSummary).
//
// That last group (periodAnalytics onward) wasn't in the original D1 scope
// — discovered during D2 that the persistent tab bar (rendered regardless
// of active tab) reads badge counts off these same computeds, so they're
// genuinely shared between the shell chrome and whichever tab's widget
// also uses them, not tab-local. Same "multiple independent consumers ==
// shared state" reasoning the plan already used for periodOrders etc.
//
// Deliberately still lean beyond this — chart bucket math, aging report,
// topCustomers/topProducts, healthTabData, etc. stay local computeds
// inside whichever widget owns them, reading off these signals. Mirrors
// SettingsService's own shape (a service exposing live signals, consumed
// directly by many components) rather than accumulating every tab's
// presentation logic here.
@Injectable({ providedIn: 'root' })
export class AdminDashboardDataService {
  private readonly firestore = inject(FirestoreService);
  private readonly settingsService = inject(SettingsService);

  private orders$ = this.firestore.getCollection<Order>(
    'orders', where('tenantId', '==', 1)
  );
  private payments$ = this.firestore.getCollection<Payment>(
    'payments', where('tenantId', '==', 1)
  );
  private customers$ = this.firestore.getCollection<Customer>(
    'customers', where('tenantId', '==', 1)
  );
  private products$ = this.firestore.getCollection<Product>(
    'products', where('tenantId', '==', 1)
  );
  private returns$ = this.firestore.getCollection<Return>(
    'returns', where('tenantId', '==', 1)
  );
  private shops$ = this.firestore.getCollection<Shop>(
    'shops', where('tenantId', '==', 1)
  );
  private accessRequests$ = this.firestore.getCollection<any>(
    'accessRequests', where('tenantId', '==', 1)
  );
  private reconciliationLog$ = this.firestore.getCollection<any>(
    'reconciliationLog',
    where('tenantId', '==', 1),
    where('status', '==', 'needs_review')
  );

  allOrders = toSignal(this.orders$, { initialValue: [] as Order[] });
  allPayments = toSignal(this.payments$, { initialValue: [] as Payment[] });
  allCustomers = toSignal(this.customers$, { initialValue: [] as Customer[] });
  allProducts = toSignal(this.products$, { initialValue: [] as Product[] });
  allReturns = toSignal(this.returns$, { initialValue: [] as Return[] });
  allShops = toSignal(this.shops$, { initialValue: [] as Shop[] });
  allAccessRequests = toSignal(this.accessRequests$, { initialValue: [] as any[] });
  needsReviewDiscrepancies = toSignal(this.reconciliationLog$, { initialValue: [] as any[] });

  // Date range
  selectedPreset = signal<DatePreset>('days30');
  customFrom = signal('');
  customTo = signal('');

  dateRange = computed((): { from: Date; to: Date } => {
    const now = new Date();
    const today = new Date(
      now.getFullYear(), now.getMonth(), now.getDate()
    );
    const todayEnd = new Date(
      now.getFullYear(), now.getMonth(),
      now.getDate(), 23, 59, 59
    );

    switch (this.selectedPreset()) {
      case 'today':
        return { from: today, to: todayEnd };
      case 'week': {
        const dow = today.getDay();
        const mon = new Date(today);
        mon.setDate(
          today.getDate() - (dow === 0 ? 6 : dow - 1)
        );
        return { from: mon, to: todayEnd };
      }
      case 'month':
        return {
          from: new Date(
            now.getFullYear(), now.getMonth(), 1
          ),
          to: todayEnd
        };
      case 'days30': {
        const from = new Date(today);
        from.setDate(from.getDate() - 30);
        return { from, to: todayEnd };
      }
      case 'months3': {
        const from = new Date(today);
        from.setMonth(from.getMonth() - 3);
        return { from, to: todayEnd };
      }
      case 'months6': {
        const from = new Date(today);
        from.setMonth(from.getMonth() - 6);
        return { from, to: todayEnd };
      }
      case 'year':
        return {
          from: new Date(now.getFullYear(), 0, 1),
          to: todayEnd
        };
      case 'custom': {
        const from = this.customFrom()
          ? new Date(this.customFrom() + 'T00:00:00') : today;
        const to = this.customTo()
          ? new Date(this.customTo() + 'T23:59:59')
          : todayEnd;
        return { from, to };
      }
      default:
        return { from: today, to: todayEnd };
    }
  });

  previousDateRange = computed((): { from: Date; to: Date } => {
    const cur = this.dateRange();
    const dur = cur.to.getTime() - cur.from.getTime();
    return {
      from: new Date(cur.from.getTime() - dur),
      to: new Date(cur.from.getTime() - 1)
    };
  });

  toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  }

  inRange(
    date: Date,
    range: { from: Date; to: Date }
  ): boolean {
    return date >= range.from && date <= range.to;
  }

  // ── PERIOD FILTERS ───────────────────────────────────
  periodOrders = computed(() => {
    const range = this.dateRange();
    return this.allOrders().filter(o =>
      !o.isDeleted &&
      o.status !== 'cancelled' &&
      this.inRange(this.toDate(o.confirmedAt), range)
    );
  });

  prevPeriodOrders = computed(() => {
    const range = this.previousDateRange();
    return this.allOrders().filter(o =>
      !o.isDeleted &&
      o.status !== 'cancelled' &&
      this.inRange(this.toDate(o.confirmedAt), range)
    );
  });

  periodPayments = computed(() => {
    const range = this.dateRange();
    return this.allPayments().filter(p =>
      !p.isDeleted &&
      this.inRange(new Date(p.receivedDate + 'T00:00:00'), range)
    );
  });

  prevPeriodPayments = computed(() => {
    const range = this.previousDateRange();
    return this.allPayments().filter(p =>
      !p.isDeleted &&
      this.inRange(new Date(p.receivedDate + 'T00:00:00'), range)
    );
  });

  periodReturns = computed(() => {
    const range = this.dateRange();
    return this.allReturns().filter(r =>
      !r.isDeleted &&
      this.inRange(this.toDate(r.createdAt), range)
    );
  });

  // ── ORDERS TAB (shared with Overview) ────────────────
  orderStatusBreakdown = computed(() => {
    const o = this.periodOrders();
    const cancelled = this.allOrders().filter(x =>
      !x.isDeleted &&
      x.status === 'cancelled' &&
      this.inRange(
        this.toDate(x.confirmedAt), this.dateRange()
      )
    ).length;
    return {
      confirmed: o.filter(
        x => x.status === 'confirmed'
      ).length,
      preparing: o.filter(
        x => x.status === 'preparing'
      ).length,
      outForDelivery: o.filter(
        x => x.status === 'out_for_delivery'
      ).length,
      delivered: o.filter(
        x => x.status === 'delivered'
      ).length,
      cancelled
    };
  });

  // ── FINANCIALS (shared with Overview's revenue KPI) ──
  periodAnalytics = computed(() => {
    const orders = this.periodOrders();
    const prev = this.prevPeriodOrders();
    const payments = this.periodPayments();
    const prevPayments = this.prevPeriodPayments();

    const revenue = orders.reduce(
      (s, o) => s + o.totalCents, 0
    );
    const prevRevenue = prev.reduce(
      (s, o) => s + o.totalCents, 0
    );
    const collected = payments.reduce(
      (s, p) => s + p.amountCents, 0
    );
    const prevCollected = prevPayments.reduce(
      (s, p) => s + p.amountCents, 0
    );
    const marginCents = orders.reduce(
      (s, o) => s + (o.marginCents || 0), 0
    );
    const marginPct = revenue > 0
      ? Math.round((marginCents / revenue) * 100) : 0;
    const prevMarginCents = prev.reduce(
      (s, o) => s + (o.marginCents || 0), 0
    );
    const prevMarginPct = prevRevenue > 0
      ? Math.round((prevMarginCents / prevRevenue) * 100)
      : 0;
    const taxCollected = orders.reduce(
      (s, o) => s + (o.taxCents || 0), 0
    );

    return {
      ordersCount: orders.length,
      prevOrdersCount: prev.length,
      revenue, prevRevenue,
      collected, prevCollected,
      marginPct, prevMarginPct,
      taxCollected
    };
  });

  // ── PRODUCTS TAB (shared with Overview's KPI + tab badge,
  //    and Overview's Needs Attention via actionItems below) ──
  lowStockProducts = computed(() =>
    this.allProducts()
      .filter(p =>
        !p.isDeleted &&
        p.active &&
        p.stock <= (p.lowStockThreshold || 5)
      )
      .sort((a, b) => a.stock - b.stock)
  );

  // ── ACTION REQUIRED (shell tab badges + Overview's Needs
  //    Attention + Financials' aging-report-adjacent usage) ──
  actionItems = computed(() => {
    const overdueDays = this.settingsService
      .ordering().overdueAfterDays || 30;
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - overdueDays);

    // New orders = customer-placed orders still sitting in
    // 'confirmed' (not yet actioned into preparing/delivery).
    // Admin-created orders are excluded — you already know
    // about orders you keyed in yourself.
    const newOrders = this.allOrders()
      .filter(o =>
        !o.isDeleted &&
        o.status === 'confirmed' &&
        o.source === 'customer_portal'
      )
      .sort((a, b) =>
        this.toDate(b.confirmedAt).getTime() -
        this.toDate(a.confirmedAt).getTime()
      );

    const newOrdersTotal = newOrders.reduce(
      (sum, o) => sum + (o.totalCents || 0), 0
    );

    const overdueOrders = this.allOrders().filter(o =>
      !o.isDeleted &&
      o.status !== 'cancelled' &&
      o.status !== 'delivered' &&
      (o.balanceCents || 0) > 0 &&
      this.toDate(o.confirmedAt) < threshold
    );
    // Note: 'preparing' is intentionally included in overdue
    // since it still has an outstanding balance.

    const pendingReturns = this.allReturns()
      .filter(r => !r.isDeleted && r.status === 'pending');

    const lowStockProducts = this.lowStockProducts();

    const pendingAccessRequests = this.allAccessRequests()
      .filter(r => r.status === 'pending')
      .sort((a: any, b: any) => {
        const at = a.submittedAt?.toDate?.() ??
          new Date(a.submittedAt ?? 0);
        const bt = b.submittedAt?.toDate?.() ??
          new Date(b.submittedAt ?? 0);
        return bt.getTime() - at.getTime();
      });

    const overdueTotalBalance = overdueOrders.reduce(
      (sum, o) => sum + (o.balanceCents || 0), 0
    );

    return {
      newOrders,
      newOrdersTotal,
      overdueOrders,
      overdueTotalBalance,
      pendingReturns,
      lowStockProducts,
      pendingAccessRequests,
      hasItems:
        newOrders.length > 0 ||
        overdueOrders.length > 0 ||
        pendingReturns.length > 0 ||
        lowStockProducts.length > 0 ||
        pendingAccessRequests.length > 0,
      totalCount:
        newOrders.length +
        overdueOrders.length +
        pendingReturns.length +
        lowStockProducts.length +
        pendingAccessRequests.length,
    };
  });

  // ── FIELD OPS TAB (shared with the tab badge) ────────
  shopHealthSummary = computed(() => {
    const shops = this.allShops().filter(s => !s.isDeleted);
    const bands: Record<string, number> = { healthy:0, watch:0, at_risk:0, warm:0, cooling:0, cold:0, unknown:0 };
    const attention: { shop: Shop; days: number | null; kind: string }[] = [];
    for (const s of shops) {
      const band = s.healthBand || 'unknown';
      bands[band] = (bands[band] || 0) + 1;
      if (band === 'at_risk' || band === 'cold') {
        attention.push({ shop: s, days: s.healthDays ?? null, kind: s.healthKind || 'prospect' });
      }
    }
    attention.sort((a,b) => (b.days ?? 0) - (a.days ?? 0));
    return {
      customers: { healthy: bands['healthy'], watch: bands['watch'], at_risk: bands['at_risk'] },
      prospects: { warm: bands['warm'], cooling: bands['cooling'], cold: bands['cold'] },
      needsAttention: attention.slice(0, 8),
      needsAttentionCount: attention.length,
    };
  });

  private pipelineShops = computed(() => this.allShops().filter(s => !s.isDeleted && s.status === 'prospect'));
  pipelineSummary = computed(() => {
    const ps = this.pipelineShops();
    const stuck = ps.filter(s => s.pipelineStuck).length;
    const ready = ps.filter(s => s.pipelineStage === 'opened').length;
    const overdueFollowUps = ps.filter(s => {
      const v: any = s.nextActionDate; if (!v) return false;
      const d = v?.toDate ? v.toDate() : new Date(v);
      const today = new Date(); today.setHours(0,0,0,0);
      const t = new Date(d); t.setHours(0,0,0,0);
      return t <= today;
    });
    const stuckList = ps.filter(s => s.pipelineStuck)
      .sort((a,b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0)).slice(0, 8);
    return { active: ps.length, stuck, ready, overdueCount: overdueFollowUps.length, stuckList, overdueList: overdueFollowUps.slice(0,8) };
  });
}
