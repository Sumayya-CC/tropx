import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { Bill, BILL_STATUS_LABELS, BillStatus } from '../../../core/models/bill.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { RecordBillPaymentModalComponent } from './record-bill-payment-modal/record-bill-payment-modal.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';
import { TENANT_ID } from '../../../core/config/tenant.config';

@Component({
  selector: 'app-admin-bills',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageHeaderComponent, LoadingSpinnerComponent, RecordBillPaymentModalComponent],
  templateUrl: './admin-bills.component.html',
  styleUrl: './admin-bills.component.scss'
})
export class AdminBillsComponent {
  private readonly firestore = inject(FirestoreService);
  protected readonly router = inject(Router);

  centsToDisplay = centsToDisplay;
  statusLabels = BILL_STATUS_LABELS;

  searchQuery = signal('');
  statusFilter = signal<BillStatus | 'all'>('all');

  statusOptions: { value: BillStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'partial', label: 'Partial' },
    { value: 'paid', label: 'Paid' },
  ];

  private hasLoaded = signal(false);
  private bills$ = this.firestore.getCollection<Bill>('bills', where('tenantId', '==', TENANT_ID));
  allBills = toSignal(this.bills$, { initialValue: [] as Bill[] });

  isLoading = computed(() => !this.hasLoaded());

  payingBill = signal<Bill | null>(null);

  constructor() {
    this.bills$.subscribe(() => this.hasLoaded.set(true));
  }

  activeBills = computed(() => this.allBills().filter(b => !b.isDeleted));

  outstanding = computed(() => {
    const unpaidOrPartial = this.activeBills().filter(b => b.status !== 'paid');
    const total = unpaidOrPartial.reduce((sum, b) => sum + b.balanceCents, 0);
    return { total, count: unpaidOrPartial.length };
  });

  filteredBills = computed(() => {
    let list = this.activeBills();

    const search = this.searchQuery().trim().toLowerCase();
    if (search) {
      list = list.filter(b =>
        b.supplierName.toLowerCase().includes(search) ||
        b.billNumber.toLowerCase().includes(search) ||
        (b.linkedPurchaseOrderNumber || '').toLowerCase().includes(search)
      );
    }

    if (this.statusFilter() !== 'all') {
      list = list.filter(b => b.status === this.statusFilter());
    }

    return [...list].sort((a, b) => {
      // Bills with a due date sort first (soonest due), undated bills last
      const aDue = this.toDate(a.dueDate)?.getTime() ?? Infinity;
      const bDue = this.toDate(b.dueDate)?.getTime() ?? Infinity;
      return aDue - bDue;
    });
  });

  urgencyIcon(bill: Bill): string {
    if (bill.status === 'paid') return '🟢';
    if (this.isOverdue(bill)) return '⚠️';
    const due = this.toDate(bill.dueDate);
    if (due && due.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000) return '🟡';
    return '🟢';
  }

  isOverdue(bill: Bill): boolean {
    if (bill.status === 'paid') return false;
    const due = this.toDate(bill.dueDate);
    if (!due) return false;
    return due.getTime() < new Date().setHours(0, 0, 0, 0);
  }

  formatDate(ts: any): string {
    const d = this.toDate(ts);
    if (!d) return '—';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  openBill(bill: Bill) {
    this.router.navigate(['/admin/bills', bill.id]);
  }

  openRecordPayment(event: Event, bill: Bill) {
    event.stopPropagation();
    this.payingBill.set(bill);
  }

  closePaymentModal() {
    this.payingBill.set(null);
  }

  private toDate(ts: any): Date | null {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
}
