import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { Expense } from '../../../core/models/expense.model';
import { Bill } from '../../../core/models/bill.model';
import { Order } from '../../../core/models/order.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';
import { generateCsvContent, downloadCsv } from '../../../shared/utils/csv-export.utils';
import { TENANT_ID } from '../../../core/config/tenant.config';

interface RevenueByCustomer {
  customerId: string;
  customerName: string;
  revenueCents: number;
  orderCount: number;
  pctOfTotal: number;
}

@Component({
  selector: 'app-money-out-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, LoadingSpinnerComponent],
  templateUrl: './money-out-dashboard.component.html',
  styleUrl: './money-out-dashboard.component.scss'
})
export class MoneyOutDashboardComponent {
  private readonly firestore = inject(FirestoreService);

  centsToDisplay = centsToDisplay;

  private hasLoaded = signal(false);
  private expenses$ = this.firestore.getCollection<Expense>('expenses', where('tenantId', '==', TENANT_ID));
  private bills$ = this.firestore.getCollection<Bill>('bills', where('tenantId', '==', TENANT_ID));
  private orders$ = this.firestore.getCollection<Order>('orders', where('tenantId', '==', TENANT_ID));

  allExpenses = toSignal(this.expenses$, { initialValue: [] as Expense[] });
  allBills = toSignal(this.bills$, { initialValue: [] as Bill[] });
  allOrders = toSignal(this.orders$, { initialValue: [] as Order[] });

  isLoading = computed(() => !this.hasLoaded());

  constructor() {
    this.expenses$.subscribe(() => this.hasLoaded.set(true));
  }

  private now = new Date();
  private monthStart = new Date(this.now.getFullYear(), this.now.getMonth(), 1);
  private lastMonthStart = new Date(this.now.getFullYear(), this.now.getMonth() - 1, 1);
  private lastMonthEnd = this.monthStart;

  private activeExpenses = computed(() => this.allExpenses().filter(e => !e.isDeleted));
  private activeBills = computed(() => this.allBills().filter(b => !b.isDeleted));
  private activeOrders = computed(() => this.allOrders().filter(o => !o.isDeleted && o.status !== 'cancelled'));

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  // ── KPIs ──────────────────────────────────────────
  expensesThisMonth = computed(() =>
    this.activeExpenses()
      .filter(e => this.toDate(e.expenseDate).getTime() >= this.monthStart.getTime())
      .reduce((sum, e) => sum + e.amountCents, 0)
  );

  billsOwed = computed(() =>
    this.activeBills()
      .filter(b => b.status !== 'paid')
      .reduce((sum, b) => sum + b.balanceCents, 0)
  );

  overdueAmount = computed(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    return this.activeBills()
      .filter(b => b.status !== 'paid' && b.dueDate && this.toDate(b.dueDate).getTime() < today)
      .reduce((sum, b) => sum + b.balanceCents, 0);
  });

  // ── Fuel trend ────────────────────────────────────
  private fuelExpensesInRange(start: Date, end: Date | null) {
    return this.activeExpenses().filter(e => {
      if (e.category !== 'fuel') return false;
      const d = this.toDate(e.expenseDate);
      return d.getTime() >= start.getTime() && (!end || d.getTime() < end.getTime());
    });
  }

  fuelThisMonth = computed(() =>
    this.fuelExpensesInRange(this.monthStart, null)
      .reduce((sum, e) => sum + e.amountCents, 0)
  );

  fuelLastMonth = computed(() =>
    this.fuelExpensesInRange(this.lastMonthStart, this.lastMonthEnd)
      .reduce((sum, e) => sum + e.amountCents, 0)
  );

  fuelTrend = computed<'up' | 'down' | 'flat'>(() => {
    const cur = this.fuelThisMonth();
    const prev = this.fuelLastMonth();
    if (cur === prev) return 'flat';
    return cur > prev ? 'up' : 'down';
  });

  // Deliberately "per fuel log", not "per route" — there's no persisted
  // record of individual route runs to divide by, only fuel log entries.
  avgPerFuelLog = computed(() => {
    const logs = this.fuelExpensesInRange(this.monthStart, null);
    if (logs.length === 0) return 0;
    return Math.round(this.fuelThisMonth() / logs.length);
  });

  // ── Upcoming bills (next 14 days, includes overdue) ──
  upcomingBills = computed(() => {
    const horizon = Date.now() + 14 * 24 * 60 * 60 * 1000;
    return this.activeBills()
      .filter(b => b.status !== 'paid' && b.dueDate && this.toDate(b.dueDate).getTime() <= horizon)
      .sort((a, b) => this.toDate(a.dueDate).getTime() - this.toDate(b.dueDate).getTime())
      .slice(0, 6);
  });

  daysUntil(dueDate: any): number {
    const due = this.toDate(dueDate).setHours(0, 0, 0, 0);
    const today = new Date().setHours(0, 0, 0, 0);
    return Math.round((due - today) / (24 * 60 * 60 * 1000));
  }

  // ── Operating margin (this month) ────────────────
  private ordersThisMonth = computed(() =>
    this.activeOrders().filter(o => this.toDate(o.confirmedAt).getTime() >= this.monthStart.getTime())
  );

  revenueThisMonth = computed(() => this.ordersThisMonth().reduce((sum, o) => sum + o.totalCents, 0));
  cogsThisMonth = computed(() => this.ordersThisMonth().reduce((sum, o) => sum + (o.totalCostCents || 0), 0));
  grossMarginThisMonth = computed(() => this.revenueThisMonth() - this.cogsThisMonth());

  billsIncurredThisMonth = computed(() =>
    this.activeBills()
      .filter(b => this.toDate(b.billDate).getTime() >= this.monthStart.getTime())
      .reduce((sum, b) => sum + b.totalCents, 0)
  );

  adjustedMarginThisMonth = computed(() =>
    this.grossMarginThisMonth() - this.expensesThisMonth() - this.billsIncurredThisMonth()
  );

  // ── Revenue concentration (top 5 customers this month) ──
  revenueByCustomer = computed<RevenueByCustomer[]>(() => {
    const byCustomer = new Map<string, { customerName: string; revenueCents: number; orderCount: number }>();
    for (const o of this.ordersThisMonth()) {
      const entry = byCustomer.get(o.customerId) ?? { customerName: o.customerName, revenueCents: 0, orderCount: 0 };
      entry.revenueCents += o.totalCents;
      entry.orderCount += 1;
      byCustomer.set(o.customerId, entry);
    }
    const total = this.revenueThisMonth();
    return Array.from(byCustomer.entries())
      .map(([customerId, v]) => ({
        customerId,
        customerName: v.customerName,
        revenueCents: v.revenueCents,
        orderCount: v.orderCount,
        pctOfTotal: total > 0 ? (v.revenueCents / total) * 100 : 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 5);
  });

  // ── CSV export ────────────────────────────────────
  exportExpensesCsv() {
    const rows = this.activeExpenses()
      .filter(e => this.toDate(e.expenseDate).getTime() >= this.monthStart.getTime())
      .map(e => [
        this.formatDateForCsv(e.expenseDate),
        e.category,
        (e.amountCents / 100).toFixed(2),
        e.vendor || '',
        e.note || '',
      ]);
    const csv = generateCsvContent(['Date', 'Category', 'Amount', 'Vendor', 'Note'], rows);
    downloadCsv(`expenses_${this.monthLabel()}.csv`, csv);
  }

  exportBillsCsv() {
    const rows = this.activeBills()
      .filter(b => this.toDate(b.billDate).getTime() >= this.monthStart.getTime())
      .map(b => [
        b.billNumber,
        b.supplierName,
        this.formatDateForCsv(b.billDate),
        b.dueDate ? this.formatDateForCsv(b.dueDate) : '',
        (b.totalCents / 100).toFixed(2),
        (b.amountPaidCents / 100).toFixed(2),
        (b.balanceCents / 100).toFixed(2),
        b.status,
      ]);
    const csv = generateCsvContent(
      ['Bill #', 'Supplier', 'Bill Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status'],
      rows
    );
    downloadCsv(`bills_${this.monthLabel()}.csv`, csv);
  }

  private monthLabel(): string {
    return this.monthStart.toISOString().slice(0, 7);
  }

  private formatDateForCsv(ts: any): string {
    const d = this.toDate(ts);
    return d.getTime() ? d.toISOString().slice(0, 10) : '';
  }
}
