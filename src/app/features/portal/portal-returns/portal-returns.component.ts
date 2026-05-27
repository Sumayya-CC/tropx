import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { PortalService } from '../../../core/services/portal.service';

@Component({
  selector: 'app-portal-returns',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './portal-returns.component.html',
  styleUrl: './portal-returns.component.scss'
})
export class PortalReturnsComponent {
  protected readonly portal = inject(PortalService);
  private readonly router = inject(Router);

  statusFilter = signal<string>('all');
  selectedReturn = signal<any>(null);

  selectReturn(ret: any) {
    this.selectedReturn.set(ret);
  }

  closePanel() {
    this.selectedReturn.set(null);
  }

  getTypeLabel(type: string): string {
    return type === 'credit_note'
      ? 'Credit Note' : 'Refund';
  }

  getReasonLabel(code: string): string {
    const map: Record<string, string> = {
      damaged: 'Damaged / Defective',
      wrong_item: 'Wrong Item Received',
      expired: 'Expired / Past Best Before',
      quality_issue: 'Quality Issue',
      customer_changed_mind: 'Changed My Mind',
      other: 'Other',
    };
    return map[code] || code;
  }

  filteredReturns = computed(() => {
    let list = this.portal.activeReturns();

    const status = this.statusFilter();
    if (status !== 'all') {
      list = list.filter((r: any) =>
        r.status === status
      );
    }

    return list;
  });

  getStatusConfig(status: string): {
    label: string; class: string;
  } {
    const map: Record<string, {
      label: string; class: string;
    }> = {
      pending: { label: 'Pending Review', class: 'pending' },
      approved: { label: 'Approved', class: 'approved' },
      rejected: { label: 'Not Approved', class: 'rejected' },
    };
    return map[status] ||
      { label: status, class: 'pending' };
  }

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

  goToOrder(orderId: string) {
    this.router.navigate(['/portal/orders', orderId]);
  }
}
