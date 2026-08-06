import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { ToastService } from '../../../shared/services/toast.service';
import { centsToDisplay } from '../../../shared/utils/currency.utils';
import { todayInputValue, toDateInputValue, dateInputToLocalDate } from '../../../shared/utils/date.utils';

import { Shop } from '../../../core/models/shop.model';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { LogFuelButtonComponent } from './log-fuel-button/log-fuel-button.component';
import { AdminDashboardDataService, DatePreset } from './admin-dashboard-data.service';
import { LiveKpiRowComponent } from './widgets/live-kpi-row/live-kpi-row.component';
import { NeedsAttentionCardComponent } from './widgets/needs-attention-card/needs-attention-card.component';
import { OverviewChartsRowComponent } from './widgets/overview-charts-row/overview-charts-row.component';
import { OrdersToFulfillCardComponent } from './widgets/orders-to-fulfill-card/orders-to-fulfill-card.component';
import { PeriodAnalyticsCardsComponent } from './widgets/period-analytics-cards/period-analytics-cards.component';
import { FinancialsChartsRowComponent } from './widgets/financials-charts-row/financials-charts-row.component';
import { AgingReportCardComponent } from './widgets/aging-report-card/aging-report-card.component';
import { RecentPaymentsCardComponent } from './widgets/recent-payments-card/recent-payments-card.component';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    StatusBadgeComponent,
    LoadingSpinnerComponent,
    LogFuelButtonComponent,
    LiveKpiRowComponent,
    NeedsAttentionCardComponent,
    OverviewChartsRowComponent,
    OrdersToFulfillCardComponent,
    PeriodAnalyticsCardsComponent,
    FinancialsChartsRowComponent,
    AgingReportCardComponent,
    RecentPaymentsCardComponent,
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss'
})
export class AdminDashboardComponent {
  protected readonly data = inject(AdminDashboardDataService);
  private readonly authService = inject(AuthService);
  protected readonly settingsService = inject(SettingsService);
  protected readonly router = inject(Router);
  private readonly functions2 = inject(Functions);
  private readonly toast = inject(ToastService);

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
  activeTab = signal<'overview' | 'financials' | 'orders' | 'products' | 'field_ops'>('overview');

  isRefreshingHealth = signal(false);
  async refreshShopHealth() {
    this.isRefreshingHealth.set(true);
    try {
      const fn = httpsCallable(this.functions2, 'refreshShopHealthNow'); // northeast2 instance
      const res: any = await fn({});
      this.toast.success(`Health refreshed: ${res.data?.updated ?? 0} shops`);
    } catch (e) {
      console.error(e);
      this.toast.error('Refresh failed');
    } finally {
      this.isRefreshingHealth.set(false);
    }
  }

  // Date range picker UI (the underlying selectedPreset/customFrom/
  // customTo signals live on the data service now — widgets need to
  // react to them too — but the dropdown UI itself stays here).
  showDateDropdown = signal(false);
  today = todayInputValue();

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
      p => p.value === this.data.selectedPreset()
    )?.label || 'This Month'
  );

  selectPreset(preset: DatePreset) {
    this.data.selectedPreset.set(preset);
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

  returnsSummary = computed(() => {
    const returns = this.data.periodReturns();
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
    return this.data.periodReturns()
      .sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at;
      })
      .slice(0, 10);
  });

  sortedOverdueOrders = computed(() => {
    return [...this.data.actionItems().overdueOrders].sort((a, b) => {
      const at = a.confirmedAt?.seconds ?? 0;
      const bt = b.confirmedAt?.seconds ?? 0;
      return at - bt;
    });
  });

  getOrderAgeDays(order: any): number {
    const confirmed = this.data.toDate(order.confirmedAt);
    return Math.floor(
      (new Date().getTime() - confirmed.getTime()) /
      86400000
    );
  }

  // ── ORDERS TAB ───────────────────────────────────────
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

  recentOrdersFull = computed(() =>
    this.data.periodOrders()
      .sort((a, b) =>
        this.data.toDate(b.confirmedAt).getTime() -
        this.data.toDate(a.confirmedAt).getTime()
      )
      .slice(0, 20)
  );

  // ── PRODUCTS TAB ─────────────────────────────────────
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

  getDonutSegments() {
    const b = this.data.orderStatusBreakdown();
    const total = b.confirmed + b.preparing + b.outForDelivery +
      b.delivered + b.cancelled;
    if (total === 0) return [];

    const data = [
      {
        label: 'Confirmed', count: b.confirmed,
        color: 'var(--navy)'
      },
      {
        label: 'Preparing', count: b.preparing,
        color: '#7c3aed'
      },
      {
        label: 'Out for Delivery', count: b.outForDelivery,
        color: 'var(--gold)'
      },
      {
        label: 'Delivered', count: b.delivered,
        color: 'var(--green)'
      },
      {
        label: 'Cancelled', count: b.cancelled,
        color: 'var(--red)'
      },
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
      preparing: 'purple',
      out_for_delivery: 'warning',
      delivered: 'success',
      cancelled: 'danger'
    };
    return map[status] || 'info';
  }


  getTimeOfDay(): string {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}
