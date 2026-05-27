import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PortalService } from '../../../core/services/portal.service';

@Component({
  selector: 'app-portal-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './portal-dashboard.component.html',
  styleUrl: './portal-dashboard.component.scss'
})
export class PortalDashboardComponent {
  protected readonly portal = inject(PortalService);

  greeting = computed(() => {
    const h = new Date().getHours();
    const name = this.portal.customerProfile()
      ?.firstName || '';
    const time = h < 12 ? 'morning' :
      h < 17 ? 'afternoon' : 'evening';
    return `Good ${time}${name ? ', ' + name : ''}`;
  });

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  formatShortDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'confirmed': return 'blue';
      case 'out_for_delivery': return 'gold';
      case 'delivered': return 'green';
      case 'cancelled': return 'red';
      default: return 'gray';
    }
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      confirmed: 'Confirmed',
      out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    return map[status] || status;
  }
}
