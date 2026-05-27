import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PortalService } from '../../../core/services/portal.service';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-portal-payments',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './portal-payments.component.html',
  styleUrl: './portal-payments.component.scss'
})
export class PortalPaymentsComponent {
  protected readonly portal = inject(PortalService);
  protected readonly settingsService = inject(SettingsService);

  totalPaidCents = computed(() =>
    this.portal.activePayments()
      .reduce((sum: number, p: any) => sum + p.amountCents, 0)
  );

  unpaidOrders = computed(() =>
    this.portal.activeOrders()
      .filter((o: any) =>
        o.status !== 'cancelled' &&
        (o.balanceCents || 0) > 0
      )
      .sort((a: any, b: any) => {
        const at = a.confirmedAt?.seconds ?? 0;
        const bt = b.confirmedAt?.seconds ?? 0;
        return at - bt; // oldest first
      })
  );

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  getMethodLabel(method: string): string {
    const map: Record<string, string> = {
      cash: 'Cash',
      e_transfer: 'E-Transfer',
      cheque: 'Cheque',
      other: 'Other',
    };
    return map[method] || method;
  }

  getMethodIcon(method: string): string {
    const map: Record<string, string> = {
      cash: '💵',
      e_transfer: '💳',
      cheque: '📄',
      other: '💰',
    };
    return map[method] || '💰';
  }
}
