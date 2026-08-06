import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AuthService } from '../../../../../core/services/auth.service';
import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-returns-summary-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './returns-summary-card.component.html',
  styleUrl: './returns-summary-card.component.scss',
})
export class ReturnsSummaryCardComponent {
  protected readonly data = inject(AdminDashboardDataService);
  private readonly authService = inject(AuthService);

  protected readonly formatCurrency = centsToDisplay;

  isAdmin = computed(() => this.authService.isAdmin());

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
}
