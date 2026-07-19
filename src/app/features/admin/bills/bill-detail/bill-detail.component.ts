import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { Bill, BILL_STATUS_LABELS } from '../../../../core/models/bill.model';
import { BillPayment, BILL_PAYMENT_METHOD_LABELS } from '../../../../core/models/bill-payment.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { RecordBillPaymentModalComponent } from '../record-bill-payment-modal/record-bill-payment-modal.component';
import { where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';
import { TENANT_ID } from '../../../../core/config/tenant.config';

@Component({
  selector: 'app-bill-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, StatusBadgeComponent, LoadingSpinnerComponent, RecordBillPaymentModalComponent],
  templateUrl: './bill-detail.component.html',
  styleUrl: './bill-detail.component.scss'
})
export class BillDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(FirestoreService);

  private billId = this.route.snapshot.paramMap.get('id') || '';
  private bill$ = this.firestore.getDocument<Bill>(`bills/${this.billId}`);
  bill = toSignal(this.bill$);

  isLoading = computed(() => this.bill() === undefined);

  showPaymentModal = signal(false);

  private payments$ = this.firestore.getCollection<BillPayment>(
    'billPayments',
    where('billId', '==', this.billId),
    where('tenantId', '==', TENANT_ID)
  );
  billPayments = toSignal(this.payments$, { initialValue: [] as BillPayment[] });

  activePayments = computed(() =>
    this.billPayments()
      .filter(p => !p.isDeleted)
      .sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || ''))
  );

  formatCurrency(cents: number | undefined): string {
    return centsToDisplay(cents ?? 0);
  }

  getStatusLabel(status: string): string {
    return BILL_STATUS_LABELS[status as keyof typeof BILL_STATUS_LABELS] || status;
  }

  getMethodLabel(method: string): string {
    return BILL_PAYMENT_METHOD_LABELS[method as keyof typeof BILL_PAYMENT_METHOD_LABELS] || method;
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  isOverdue(): boolean {
    const b = this.bill();
    if (!b || !b.dueDate || b.status === 'paid') return false;
    const due = b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate);
    return due.getTime() < new Date().setHours(0, 0, 0, 0);
  }

  onPaymentModalClosed() {
    this.showPaymentModal.set(false);
  }
}
