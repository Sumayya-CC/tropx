import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';

import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { NotificationService } from '../../../core/services/notification.service';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

import { Order } from '../../../core/models/order.model';
import { Payment } from '../../../core/models/payment.model';
import { Return } from '../../../core/models/return.model';
import { Customer } from '../../../core/models/customer.model';
import { Product } from '../../../core/models/product.model';

import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

type DatePreset = 'today' | 'week' | 'month' | 'days30' | 'months3' | 'months6' | 'year' | 'custom';

import { OwnerFullNamePipe } from '../../../shared/pipes/full-name.pipe';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    StatusBadgeComponent,
    LoadingSpinnerComponent,
    OwnerFullNamePipe
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss'
})
export class AdminDashboardComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly authService = inject(AuthService);
  protected readonly settingsService = inject(SettingsService);
  private readonly notificationService = inject(NotificationService);
  protected readonly router = inject(Router);

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
  allAccessRequests = toSignal(this.accessRequests$, { initialValue: [] as any[] });
  needsReviewDiscrepancies = toSignal(this.reconciliationLog$, { initialValue: [] as any[] });

  expandedActions = signal<Set<string>>(new Set());

  toggleAction(key: string) {
    this.expandedActions.update(set => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  isExpanded(key: string): boolean {
    return this.expandedActions().has(key);
  }

  isLoading = computed(() => !this.authService.currentProfile());
  isAdmin = computed(() => this.authService.isAdmin());
  userFirstName = computed(() =>
    this.authService.currentProfile()?.firstName || ''
  );

  // Tabs
  activeTab = signal<'overview' | 'financials' | 'orders' | 'products'>('overview');

  // Date range
  selectedPreset = signal<DatePreset>('days30');
  customFrom = signal('');
  customTo = signal('');
  showDateDropdown = signal(false);
  today = new Date().toISOString().split('T')[0];

  presets = [
    { value: 'today' as DatePreset, label: 'Today' },
    { value: 'week' as DatePreset, label: 'This Week' },
    { value: 'month' as DatePreset, label: 'This Month' },
    { value: 'days30' as DatePreset, label: 'Last 30 Days' },
    { value: 'months3' as DatePreset, label: 'Last 3 Months' },
    { value: 'months6' as DatePreset, label: 'Last 6 Months' },
    { value: 'year' as DatePreset, label: 'This Year' },
    { value: 'custom' as DatePreset, label: 'Custom Range' },
  ];

  selectedPresetLabel = computed(() =>
    this.presets.find(
      p => p.value === this.selectedPreset()
    )?.label || 'This Month'
  );

  selectPreset(preset: DatePreset) {
    this.selectedPreset.set(preset);
    if (preset !== 'custom') {
      this.showDateDropdown.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.date-range-dropdown')) {
      this.showDateDropdown.set(false);
    }
  }

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

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  }

  private inRange(
    date: Date, 
    range: { from: Date; to: Date }
  ): boolean {
    return date >= range.from && date <= range.to;
  }

  // ── LIVE KPIs (always current) ──────────────────────
  liveKpis = computed(() => {
    const customers = this.allCustomers()
      .filter(c => !c.isDeleted);
    const activeCustomers = customers
      .filter(c => c.status === 'active').length;

    // Compute outstanding from live order balanceCents
    // (source of truth) not the denormalized counter
    // which can drift. Mirrors the aging report exactly.
    const outstandingBalance = this.allOrders()
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

  // ── ACTION REQUIRED ──────────────────────────────────
  // Reconciliation discrepancies frozen for manual review —
  // highest-priority integrity alert.
  reconciliationAlert = computed(() => {
    const items = this.needsReviewDiscrepancies();
    const count = items.length;
    const totalAbsDelta = items.reduce(
      (sum, r) => sum + Math.abs(r.maxAbsDelta || 0), 0
    );
    return { count, totalAbsDelta, hasItems: count > 0 };
  });

  actionItems = computed(() => {
    const overdueDays = this.settingsService
      .ordering().overdueAfterDays || 30;
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - overdueDays);

    const overdueOrders = this.allOrders().filter(o =>
      !o.isDeleted &&
      o.status !== 'cancelled' &&
      o.status !== 'delivered' &&
      (o.balanceCents || 0) > 0 &&
      this.toDate(o.confirmedAt) < threshold
    );

    const pendingReturns = this.allReturns()
      .filter(r => !r.isDeleted && r.status === 'pending');

    const lowStockProducts = this.allProducts()
      .filter(p =>
        !p.isDeleted &&
        p.active &&
        p.stock <= (p.lowStockThreshold || 5)
      )
      .sort((a, b) => a.stock - b.stock);

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
      overdueOrders,
      overdueTotalBalance,
      pendingReturns,
      lowStockProducts,
      pendingAccessRequests,
      hasItems:
        overdueOrders.length > 0 ||
        pendingReturns.length > 0 ||
        lowStockProducts.length > 0 ||
        pendingAccessRequests.length > 0,
      totalCount:
        overdueOrders.length +
        pendingReturns.length +
        lowStockProducts.length +
        pendingAccessRequests.length,
    };
  });

  // ── DELIVERY SCHEDULE ────────────────────────────────
  deliverySchedule = computed(() => {
    const now = new Date();
    const today = new Date(
      now.getFullYear(), now.getMonth(), now.getDate()
    );
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);

    const relevant = this.allOrders()
      .filter(o =>
        !o.isDeleted &&
        (o.status === 'confirmed' ||
         o.status === 'out_for_delivery') &&
        o.expectedDeliveryDate
      )
      .map(o => ({
        ...o,
        deliveryDate: this.toDate(o.expectedDeliveryDate)
      }))
      .filter(o => o.deliveryDate <= in7);

    return {
      delayed: relevant
        .filter(o => o.deliveryDate < today)
        .sort((a, b) =>
          a.deliveryDate.getTime() - b.deliveryDate.getTime()
        ),
      scheduled: relevant
        .filter(o => o.deliveryDate >= today)
        .sort((a, b) =>
          a.deliveryDate.getTime() - b.deliveryDate.getTime()
        )
    };
  });

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

  returnsSummary = computed(() => {
    const returns = this.periodReturns();
    return {
      total: returns.length,
      pending: returns.filter(
        r => r.status === 'pending'
      ).length,
      approved: returns.filter(
        r => r.status === 'approved'
      ).length,
      rejected: returns.filter(
        r => r.status === 'rejected'
      ).length,
      creditNotes: returns.filter(
        r => r.status === 'approved' && 
             r.type === 'credit_note'
      ).reduce((s, r) => s + r.amountCents, 0),
      refunds: returns.filter(
        r => r.status === 'approved' && 
             r.type === 'refund'
      ).reduce((s, r) => s + r.amountCents, 0),
    };
  });

  recentReturnsOrdersTab = computed(() => {
    return this.periodReturns()
      .sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at;
      })
      .slice(0, 10);
  });

  sortedOverdueOrders = computed(() => {
    return [...this.actionItems().overdueOrders].sort((a, b) => {
      const at = a.confirmedAt?.seconds ?? 0;
      const bt = b.confirmedAt?.seconds ?? 0;
      return at - bt;
    });
  });

  getOrderAgeDays(order: any): number {
    const confirmed = this.toDate(order.confirmedAt);
    return Math.floor(
      (new Date().getTime() - confirmed.getTime()) /
      86400000
    );
  }

  // ── OVERVIEW RECENT ──────────────────────────────────
  recentOrdersOverview = computed(() =>
    this.periodOrders()
      .sort((a, b) =>
        this.toDate(b.confirmedAt).getTime() -
        this.toDate(a.confirmedAt).getTime()
      )
      .slice(0, 5)
  );

  recentPaymentsOverview = computed(() =>
    this.periodPayments()
      .sort((a, b) =>
        (b.receivedDate || '').localeCompare(
          a.receivedDate || ''
        )
      )
      .slice(0, 5)
  );

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

      const revenueCents = this.allOrders()
        .filter(o => {
          if (o.isDeleted || o.status === 'cancelled') {
            return false;
          }
          const d = this.toDate(o.confirmedAt);
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

  // ── FINANCIALS ───────────────────────────────────────
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

  agingReport = computed(() => {
    const days = this.settingsService
      .ordering().overdueAfterDays || 30;
    const now = new Date();
    const unpaid = this.allOrders().filter(o =>
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
          this.toDate(o.confirmedAt).getTime()) /
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

  paymentMethodBreakdown = computed(() => {
    const p = this.periodPayments();
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

  recentPaymentsFull = computed(() =>
    this.periodPayments()
      .sort((a, b) =>
        (b.receivedDate || '').localeCompare(
          a.receivedDate || ''
        )
      )
      .slice(0, 20)
  );

  // ── ORDERS TAB ───────────────────────────────────────
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
      outForDelivery: o.filter(
        x => x.status === 'out_for_delivery'
      ).length,
      delivered: o.filter(
        x => x.status === 'delivered'
      ).length,
      cancelled
    };
  });

  topCustomers = computed(() => {
    const map = new Map<string, any>();
    for (const o of this.periodOrders()) {
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

  recentOrdersFull = computed(() =>
    this.periodOrders()
      .sort((a, b) =>
        this.toDate(b.confirmedAt).getTime() -
        this.toDate(a.confirmedAt).getTime()
      )
      .slice(0, 20)
  );

  // ── PRODUCTS TAB ─────────────────────────────────────
  topProducts = computed(() => {
    const map = new Map<string, any>();
    for (const o of this.periodOrders()) {
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

  lowStockProducts = computed(() =>
    this.allProducts()
      .filter(p =>
        !p.isDeleted &&
        p.active &&
        p.stock <= (p.lowStockThreshold || 5)
      )
      .sort((a, b) => a.stock - b.stock)
  );

  // ── CHARTS ───────────────────────────────────────────
  chartBuckets = computed(() => {
    const range = this.dateRange();
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

    for (const o of this.allOrders()) {
      if (o.isDeleted || o.status === 'cancelled') continue;
      const d = this.toDate(o.confirmedAt);
      const b = buckets.find(x => d >= x.from && d <= x.to);
      if (b) b.revenue += o.totalCents;
    }
    for (const p of this.allPayments()) {
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

  getDonutSegments() {
    const b = this.orderStatusBreakdown();
    const total = b.confirmed + b.outForDelivery +
      b.delivered + b.cancelled;
    if (total === 0) return [];

    const data = [
      { label: 'Confirmed', count: b.confirmed,
        color: 'var(--navy)' },
      { label: 'Out for Delivery', count: b.outForDelivery,
        color: 'var(--gold)' },
      { label: 'Delivered', count: b.delivered,
        color: 'var(--green)' },
      { label: 'Cancelled', count: b.cancelled,
        color: 'var(--red)' },
    ];

    let angle = -Math.PI / 2;
    const cx = 60, cy = 60, r = 50;

    return data.map(item => {
      const slice = (item.count / total) * 2 * Math.PI;
      const end = angle + slice;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = slice > Math.PI ? 1 : 0;
      const path = item.count === 0 ? '' :
        `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ` +
        `${large} 1 ${x2} ${y2} Z`;
      angle = end;
      return { ...item, path };
    });
  }

  getMethodBars() {
    const pm = this.paymentMethodBreakdown();
    return [
      { label: 'Cash', value: pm.cash,
        color: 'var(--green)' },
      { label: 'E-Transfer', value: pm.etransfer,
        color: 'var(--navy)' },
      { label: 'Cheque', value: pm.cheque,
        color: 'var(--gold)' },
      { label: 'Other', value: pm.other,
        color: 'var(--gray)' },
    ];
  }

  changePct(cur: number, prev: number): number {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }

  // ── UTILS ────────────────────────────────────────────
  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  formatShortDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric'
    });
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  getOrderStatusColor(status: string): string {
    const map: Record<string, string> = {
      confirmed: 'info',
      out_for_delivery: 'warning',
      delivered: 'success',
      cancelled: 'danger'
    };
    return map[status] || 'info';
  }

  getMethodLabel(method: string): string {
    const map: Record<string, string> = {
      cash: 'Cash',
      e_transfer: 'E-Transfer',
      cheque: 'Cheque',
      other: 'Other'
    };
    return map[method] || method;
  }

  getTimeOfDay(): string {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}
