import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from '../../../../../core/services/auth.service';
import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-period-analytics-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './period-analytics-cards.component.html',
  styleUrl: './period-analytics-cards.component.scss',
})
export class PeriodAnalyticsCardsComponent {
  protected readonly data = inject(AdminDashboardDataService);
  private readonly authService = inject(AuthService);

  protected readonly formatCurrency = centsToDisplay;

  isAdmin = computed(() => this.authService.isAdmin());

  changePct(cur: number, prev: number): number {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }
}
