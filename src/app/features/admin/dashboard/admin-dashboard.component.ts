import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { ToastService } from '../../../shared/services/toast.service';
import { todayInputValue, toDateInputValue, dateInputToLocalDate } from '../../../shared/utils/date.utils';

import { Shop } from '../../../core/models/shop.model';
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
import { OverdueInvoicesCardComponent } from './widgets/overdue-invoices-card/overdue-invoices-card.component';
import { TopCustomersCardComponent } from './widgets/top-customers-card/top-customers-card.component';
import { OrderStatusDonutComponent } from './widgets/order-status-donut/order-status-donut.component';
import { ReturnsSummaryCardComponent } from './widgets/returns-summary-card/returns-summary-card.component';
import { RecentOrdersCardComponent } from './widgets/recent-orders-card/recent-orders-card.component';
import { ProductsOverviewCardComponent } from './widgets/products-overview-card/products-overview-card.component';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
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
    OverdueInvoicesCardComponent,
    TopCustomersCardComponent,
    OrderStatusDonutComponent,
    ReturnsSummaryCardComponent,
    RecentOrdersCardComponent,
    ProductsOverviewCardComponent,
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

  // ── UTILS ────────────────────────────────────────────
  getTimeOfDay(): string {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}
