import { Injectable, inject, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';

import { FirestoreService } from '../../../core/services/firestore.service';
import { Order } from '../../../core/models/order.model';
import { Payment } from '../../../core/models/payment.model';
import { Return } from '../../../core/models/return.model';
import { Customer } from '../../../core/models/customer.model';
import { Product } from '../../../core/models/product.model';
import { Shop } from '../../../core/models/shop.model';

export type DatePreset = 'today' | 'week' | 'month' | 'days30' | 'months3' | 'months6' | 'year' | 'custom';

// Shared state for the admin dashboard's 5 tabs (Overview/Financials/
// Orders/Products/Field Ops): the 8 raw Firestore streams every tab reads
// from, the date-range picker state, and the specific computeds more than
// one tab reuses (periodOrders/prevPeriodOrders/periodPayments/
// prevPeriodPayments/periodReturns, orderStatusBreakdown). Deliberately
// lean — everything else (liveKpis, actionItems, chart math, aging report,
// topCustomers/topProducts, etc.) stays a local computed inside whichever
// widget owns it, reading off these raw signals. Mirrors SettingsService's
// own shape (a service exposing live signals, consumed directly by many
// components) rather than accumulating derived/presentation logic here.
@Injectable({ providedIn: 'root' })
export class AdminDashboardDataService {
  private readonly firestore = inject(FirestoreService);

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
}
