import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PortalService } from '../../../core/services/portal.service';

@Component({
  selector: 'app-portal-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './portal-orders.component.html',
  styleUrl: './portal-orders.component.scss'
})
export class PortalOrdersComponent {
  protected readonly portal = inject(PortalService);

  searchQuery = signal('');
  statusFilter = signal<string>('all');

  filteredOrders = computed(() => {
    let list = this.portal.activeOrders();

    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(o =>
        o.orderNumber?.toLowerCase().includes(q) ||
        o.items?.some((i: any) =>
          i.productName?.toLowerCase().includes(q)
        )
      );
    }

    const status = this.statusFilter();
    if (status !== 'all') {
      list = list.filter(o => o.status === status);
    }

    return list;
  });

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

  getStatusConfig(status: string): {
    label: string; class: string;
  } {
    const map: Record<string, {
      label: string; class: string;
    }> = {
      confirmed: {
        label: 'Confirmed', class: 'confirmed'
      },
      out_for_delivery: {
        label: 'Out for Delivery', class: 'delivery'
      },
      delivered: {
        label: 'Delivered', class: 'delivered'
      },
      cancelled: {
        label: 'Cancelled', class: 'cancelled'
      },
    };
    return map[status] ||
      { label: status, class: 'confirmed' };
  }
}
