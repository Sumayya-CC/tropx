import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { todayInputValue } from '../../../shared/utils/date.utils';

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
import { RefreshShopHealthActionComponent } from './widgets/refresh-shop-health-action/refresh-shop-health-action.component';
import { ShopHealthSummaryComponent } from './widgets/shop-health-summary/shop-health-summary.component';
import { PipelineSummaryCardComponent } from './widgets/pipeline-summary-card/pipeline-summary-card.component';

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
    RefreshShopHealthActionComponent,
    ShopHealthSummaryComponent,
    PipelineSummaryCardComponent,
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss'
})
export class AdminDashboardComponent {
  protected readonly data = inject(AdminDashboardDataService);
  private readonly authService = inject(AuthService);
  protected readonly settingsService = inject(SettingsService);
  protected readonly router = inject(Router);

  isLoading = computed(() => !this.authService.currentProfile());
  userFirstName = computed(() =>
    this.authService.currentProfile()?.firstName || ''
  );

  // Tabs
  activeTab = signal<'overview' | 'financials' | 'orders' | 'products' | 'field_ops'>('overview');

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

  // ── UTILS ────────────────────────────────────────────
  getTimeOfDay(): string {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}
