import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Bill } from '../../../../core/models/bill.model';
import { BillPaymentMethod } from '../../../../core/models/bill-payment.model';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { doc, serverTimestamp, collection, Firestore } from '@angular/fire/firestore';
import { todayInputValue } from '../../../../shared/utils/date.utils';
import { TENANT_ID } from '../../../../core/config/tenant.config';

@Component({
  selector: 'app-record-bill-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './record-bill-payment-modal.component.html',
  styleUrl: './record-bill-payment-modal.component.scss'
})
export class RecordBillPaymentModalComponent {
  @Input() bill!: Bill;
  @Output() closed = new EventEmitter<boolean>();

  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  amount = signal<number>(0);
  method = signal<BillPaymentMethod>('cash');
  referenceNumber = signal<string>('');
  paidDate = signal<string>('');
  notes = signal<string>('');
  isSaving = signal(false);

  amountCents = computed(() => Math.round(this.amount() * 100));
  newBalanceCents = computed(() => Math.max(0, this.bill.balanceCents - this.amountCents()));
  willBeOverpaid = computed(() => this.amountCents() > this.bill.balanceCents);
  overpaymentAmountCents = computed(() => this.amountCents() - this.bill.balanceCents);

  ngOnInit() {
    this.amount.set(this.bill.balanceCents / 100);
    this.paidDate.set(todayInputValue());
  }

  get showReference(): boolean {
    return this.method() === 'e_transfer' || this.method() === 'cheque';
  }

  get referenceLabel(): string {
    return this.method() === 'e_transfer' ? 'E-Transfer Confirmation #' : 'Cheque #';
  }

  cancel() {
    this.closed.emit(false);
  }

  async save() {
    if (this.amount() <= 0) {
      this.toast.error('Amount must be greater than 0');
      return;
    }
    if (this.willBeOverpaid()) {
      this.toast.error('Amount cannot exceed bill balance');
      return;
    }
    if (this.showReference && !this.referenceNumber().trim()) {
      this.toast.error(`Please provide ${this.referenceLabel}`);
      return;
    }

    const selectedDate = new Date(this.paidDate());
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (selectedDate > today) {
      this.toast.error('Date cannot be in the future');
      return;
    }

    this.isSaving.set(true);

    try {
      await this.firestore.runBatch(async (batch: any, db: Firestore) => {
        const paymentRef = doc(collection(db, 'billPayments'));
        batch.set(paymentRef, {
          id: paymentRef.id,
          billId: this.bill.id,
          billNumber: this.bill.billNumber,
          supplierId: this.bill.supplierId,
          supplierName: this.bill.supplierName,
          amountCents: this.amountCents(),
          method: this.method(),
          referenceNumber: this.showReference ? this.referenceNumber().trim() : null,
          paidDate: this.paidDate(),
          notes: this.notes().trim() || null,
          createdBy: this.auth.getActionBy(),
          createdAt: serverTimestamp(),
          isDeleted: false,
          tenantId: TENANT_ID,
        });

        const newAmountPaid = this.bill.amountPaidCents + this.amountCents();
        const newBalance = this.bill.totalCents - newAmountPaid;
        const newStatus = newBalance <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

        const billRef = doc(db, `bills/${this.bill.id}`);
        batch.update(billRef, {
          amountPaidCents: newAmountPaid,
          balanceCents: Math.max(0, newBalance),
          status: newStatus,
        });
      });

      this.toast.success('Payment recorded successfully');
      this.closed.emit(true);
    } catch (err) {
      console.error('Error recording bill payment:', err);
      this.toast.error('Failed to record payment');
    } finally {
      this.isSaving.set(false);
    }
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }
}
