import { Component, EventEmitter, Input, Output, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Order } from '../../../../core/models/order.model';
import { PaymentMethod } from '../../../../core/models/payment.model';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { doc, getDoc, serverTimestamp, collection, Firestore } from '@angular/fire/firestore';

@Component({
  selector: 'app-record-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './record-payment-modal.component.html',
  styleUrl: './record-payment-modal.component.scss'
})
export class RecordPaymentModalComponent {
  @Input() order!: Order;
  @Output() closed = new EventEmitter<boolean>();

  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  amount = signal<number>(0);
  method = signal<PaymentMethod>('cash');
  referenceNumber = signal<string>('');
  receivedDate = signal<string>('');
  notes = signal<string>('');
  isSaving = signal(false);

  amountCents = computed(() => Math.round(this.amount() * 100));
  newBalanceCents = computed(() => Math.max(0, this.order.balanceCents - this.amountCents()));
  willBeOverpaid = computed(() => this.amountCents() > this.order.balanceCents);
  overpaymentAmountCents = computed(() => this.amountCents() - this.order.balanceCents);

  ngOnInit() {
    this.amount.set(this.order.balanceCents / 100);
    this.receivedDate.set(new Date().toISOString().split('T')[0]);
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
      this.toast.error('Amount cannot exceed order balance');
      return;
    }
    if (this.showReference && !this.referenceNumber().trim()) {
      this.toast.error(`Please provide ${this.referenceLabel}`);
      return;
    }
    
    const selectedDate = new Date(this.receivedDate());
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (selectedDate > today) {
      this.toast.error('Date cannot be in the future');
      return;
    }

    this.isSaving.set(true);

    try {
      let generatedPaymentNumber = '';

      await this.firestore.runBatch(async (batch: any, db: Firestore) => {
        // 1. Generate payment number
        const seqRef = doc(db, 'settings/paymentSequence');
        const seqSnap = await getDoc(seqRef);
        
        let lastNumber = 0;
        let prefix = 'PAY';
        const currentYear = new Date().getFullYear();

        if (seqSnap.exists()) {
          const data = seqSnap.data();
          lastNumber = data['lastNumber'] || 0;
          prefix = data['prefix'] || 'PAY';
        } else {
          batch.set(seqRef, { lastNumber: 0, prefix: 'PAY', tenantId: 1 });
        }

        lastNumber++;
        const paddedNumber = lastNumber.toString().padStart(4, '0');
        generatedPaymentNumber = `${prefix}-${currentYear}-${paddedNumber}`;
        
        batch.update(seqRef, { lastNumber });

        // 2. Create payment doc
        const paymentRef = doc(collection(db, 'payments'));
        batch.set(paymentRef, {
          id: paymentRef.id,
          paymentNumber: generatedPaymentNumber,
          orderId: this.order.id,
          orderNumber: this.order.orderNumber,
          customerId: this.order.customerId,
          customerName: this.order.customerName,
          amountCents: this.amountCents(),
          currencyCode: 'CAD',
          method: this.method(),
          referenceNumber: this.showReference ? this.referenceNumber().trim() : null,
          receivedDate: this.receivedDate(),
          notes: this.notes().trim() || null,
          recordedBy: this.auth.getActionBy(),
          recordedAt: serverTimestamp(),
          isDeleted: false,
          tenantId: 1,
        });

        // 3. Update order
        const newAmountPaid = this.order.amountPaidCents + this.amountCents();
        const newBalance = this.order.totalCents - newAmountPaid;
        const newPaymentStatus = newBalance <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';
        
        const orderRef = doc(db, `orders/${this.order.id}`);
        batch.update(orderRef, {
          amountPaidCents: newAmountPaid,
          balanceCents: Math.max(0, newBalance),
          paymentStatus: newPaymentStatus,
          lastPaymentAt: serverTimestamp(),
        });

        // 4. Update customer
        const customerRef = doc(db, `customers/${this.order.customerId}`);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const customerData = customerSnap.data();
          const currentPaid = customerData['totalPaidCents'] || 0;
          const currentOwing = customerData['totalOwingCents'] || 0;
          batch.update(customerRef, {
            totalPaidCents: currentPaid + this.amountCents(),
            totalOwingCents: Math.max(0, currentOwing - this.amountCents()),
            lastPaymentAt: serverTimestamp(),
          });
        }
      });

      this.toast.success(`Payment ${generatedPaymentNumber} recorded successfully`);
      this.closed.emit(true);
    } catch (err) {
      console.error('Error recording payment:', err);
      this.toast.error('Failed to record payment');
    } finally {
      this.isSaving.set(false);
    }
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }
}
