import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { serverTimestamp, where, doc, getDoc, Firestore } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Payment, PaymentMethod, PAYMENT_METHOD_LABELS } from '../../../core/models/payment.model';
import { Customer } from '../../../core/models/customer.model';
import { Order } from '../../../core/models/order.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

@Component({
  selector: 'app-admin-payments',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent, LoadingSpinnerComponent, DatePipe],
  templateUrl: './admin-payments.component.html',
  styleUrl: './admin-payments.component.scss'
})
export class AdminPaymentsComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly router = inject(Router);

  // Filters
  searchQuery = signal('');
  customerFilter = signal<string>('all');
  orderFilter = signal('');
  methodFilter = signal<string>('all');
  dateFilter = signal<string>('last_30');
  showVoided = signal(false);

  // Voiding State
  voidingPaymentId = signal<string | null>(null);
  selectedPayment = signal<Payment | null>(null);

  // Data
  private hasLoaded = signal(false);
  private payments$ = this.firestore.getCollection<Payment>(
    'payments',
    where('tenantId', '==', 1)
  );
  
  private customers$ = this.firestore.getCollection<Customer>(
    'customers',
    where('tenantId', '==', 1)
  );

  allPayments = toSignal(this.payments$, { initialValue: [] as Payment[] });
  allCustomers = toSignal(this.customers$, { initialValue: [] as Customer[] });

  customerOptions = computed(() =>
    this.allCustomers()
      .filter(c => !c.isDeleted)
      .sort((a, b) => 
        a.businessName.localeCompare(b.businessName)
      )
  );

  isLoading = computed(() => !this.hasLoaded());

  constructor() {
    this.payments$.subscribe(() => this.hasLoaded.set(true));
  }

  // Stats
  stats = computed(() => {
    const payments = this.allPayments();
    const customers = this.allCustomers();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    let totalCollectedThisMonth = 0;
    let cashThisMonth = 0;
    let etransferThisMonth = 0;

    for (const p of payments) {
      if (!p.isDeleted && p.receivedDate >= startOfMonth) {
        totalCollectedThisMonth += p.amountCents;
        if (p.method === 'cash') cashThisMonth += p.amountCents;
        if (p.method === 'e_transfer') etransferThisMonth += p.amountCents;
      }
    }

    let outstandingBalance = 0;
    for (const c of customers) {
      if (!c.isDeleted) {
        outstandingBalance += c.totalOwingCents || 0;
      }
    }

    return {
      totalCollectedThisMonth,
      cashThisMonth,
      etransferThisMonth,
      outstandingBalance
    };
  });

  // Filtered Totals
  filteredTotals = computed(() => {
    const list = this.filteredPayments();
    const active = list.filter(p => !p.isDeleted);
    return {
      count: active.length,
      totalCents: active.reduce(
        (sum, p) => sum + p.amountCents, 0
      ),
      cashCents: active
        .filter(p => p.method === 'cash')
        .reduce((sum, p) => sum + p.amountCents, 0),
      etransferCents: active
        .filter(p => p.method === 'e_transfer')
        .reduce((sum, p) => sum + p.amountCents, 0),
    };
  });

  // Filtered list
  filteredPayments = computed(() => {
    let list = this.allPayments();

    // 1. Show/Hide Voided
    if (!this.showVoided()) {
      list = list.filter(p => !p.isDeleted);
    }

    // 2. Search
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(p => 
        (p.orderNumber && p.orderNumber.toLowerCase().includes(q)) ||
        (p.customerName && p.customerName.toLowerCase().includes(q)) ||
        (p.referenceNumber && p.referenceNumber.toLowerCase().includes(q))
      );
    }

    // 3. Method Filter
    const m = this.methodFilter();
    if (m !== 'all') {
      list = list.filter(p => p.method === m);
    }

    // Customer filter
    const cf = this.customerFilter();
    if (cf !== 'all') {
      list = list.filter(p => p.customerId === cf);
    }

    // Order filter
    const of = this.orderFilter().trim().toLowerCase();
    if (of) {
      list = list.filter(p => 
        p.orderNumber.toLowerCase().includes(of)
      );
    }

    // 4. Date Filter
    const dFilter = this.dateFilter();
    const todayStr = new Date().toISOString().split('T')[0];
    
    if (dFilter === 'today') {
      list = list.filter(p => p.receivedDate === todayStr);
    } else if (dFilter === 'last_7' || dFilter === 'last_30') {
      const d = new Date();
      d.setDate(d.getDate() - (dFilter === 'last_7' ? 7 : 30));
      const threshold = d.toISOString().split('T')[0];
      list = list.filter(p => p.receivedDate >= threshold);
    }

    // Sort by receivedDate desc
    return list.sort((a, b) => (b.receivedDate || '').localeCompare(a.receivedDate || ''));
  });

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  getMethodLabel(method: string): string {
    return PAYMENT_METHOD_LABELS[method as PaymentMethod] || method;
  }

  getRecordedDate(payment: Payment): string {
    if (!payment.recordedAt) return '—';
    const d = payment.recordedAt.toDate ? payment.recordedAt.toDate() : new Date(payment.recordedAt);
    return new DatePipe('en-US').transform(d, 'MMM d, yyyy @ h:mm a') || '—';
  }

  async confirmVoid(payment: Payment, reason: string) {
    if (!reason.trim()) {
      this.toast.error('Void reason is required');
      return;
    }

    try {
      await this.firestore.runBatch(async (batch: any, db: Firestore) => {
        // 1. Soft-delete payment
        const paymentRef = doc(db, `payments/${payment.id}`);
        batch.update(paymentRef, {
          isDeleted: true,
          isDeletedAt: serverTimestamp(),
          deletedBy: this.auth.getActionBy(),
          voidReason: reason.trim(),
        });

        // 2. Reverse order amounts
        const orderRef = doc(db, `orders/${payment.orderId}`);
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
          const orderData = orderSnap.data() as Order;
          const newAmountPaid = (orderData.amountPaidCents || 0) - payment.amountCents;
          const newBalance = (orderData.totalCents || 0) - newAmountPaid;
          const newPaymentStatus = newBalance <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';
          
          batch.update(orderRef, {
            amountPaidCents: Math.max(0, newAmountPaid),
            balanceCents: newBalance,
            paymentStatus: newPaymentStatus,
          });
        }

        // 3. Reverse customer amounts
        const customerRef = doc(db, `customers/${payment.customerId}`);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const customerData = customerSnap.data() as Customer;
          batch.update(customerRef, {
            totalPaidCents: Math.max(0, (customerData.totalPaidCents || 0) - payment.amountCents),
            totalOwingCents: (customerData.totalOwingCents || 0) + payment.amountCents,
          });
        }
      });

      this.toast.success('Payment voided successfully');
      this.voidingPaymentId.set(null);
    } catch (err) {
      console.error('Error voiding payment:', err);
      this.toast.error('Failed to void payment');
    }
  }
}
