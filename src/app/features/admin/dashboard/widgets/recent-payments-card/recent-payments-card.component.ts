import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { centsToDisplay } from '../../../../../shared/utils/currency.utils';
import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-recent-payments-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './recent-payments-card.component.html',
  styleUrl: './recent-payments-card.component.scss',
})
export class RecentPaymentsCardComponent {
  protected readonly data = inject(AdminDashboardDataService);

  protected readonly formatCurrency = centsToDisplay;

  recentPaymentsFull = computed(() =>
    this.data.periodPayments()
      .sort((a, b) =>
        (b.receivedDate || '').localeCompare(
          a.receivedDate || ''
        )
      )
      .slice(0, 20)
  );

  getMethodLabel(method: string): string {
    const map: Record<string, string> = {
      cash: 'Cash',
      e_transfer: 'E-Transfer',
      cheque: 'Cheque',
      other: 'Other'
    };
    return map[method] || method;
  }
}
