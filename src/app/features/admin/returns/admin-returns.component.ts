import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { serverTimestamp, where, doc, getDoc, Firestore, collection } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { 
  Return, 
  ReturnType, 
  ReturnStatus, 
  ReturnReasonCode, 
  RefundMethod, 
  RETURN_TYPE_LABELS, 
  RETURN_STATUS_LABELS, 
  RETURN_REASON_LABELS, 
  REFUND_METHOD_LABELS 
} from '../../../core/models/return.model';
import { Customer } from '../../../core/models/customer.model';
import { Order } from '../../../core/models/order.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

@Component({
  selector: 'app-admin-returns',
  standalone: true,
  imports: [
    CommonModule, 
    RouterModule, 
    FormsModule, 
    PageHeaderComponent, 
    LoadingSpinnerComponent, 
    StatusBadgeComponent
  ],
  templateUrl: './admin-returns.component.html',
  styleUrl: './admin-returns.component.scss'
})
export class AdminReturnsComponent implements OnInit {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);

  // Filters
  searchQuery = signal('');
  typeFilter = signal<string>('all');
  statusFilter = signal<string>('all');
  dateFilter = signal<string>('all_time');

  // Review side panel
  selectedReturn = signal<Return | null>(null);
  
  // Rejection/Refund flows in side panel
  showRejectForm = signal(false);
  rejectionReason = signal('');
  selectedRefundMethod = signal<RefundMethod>('cash');
  refundReferenceNumber = signal('');
  isProcessing = signal(false);
  restoreStockOnApproval = signal(true);

  // Data
  private hasLoaded = signal(false);
  private returns$ = this.firestore.getCollection<Return>(
    'returns',
    where('tenantId', '==', 1)
  );

  allReturns = toSignal(this.returns$, { initialValue: [] as Return[] });

  isLoading = computed(() => !this.hasLoaded());

  constructor() {
    this.returns$.subscribe(() => this.hasLoaded.set(true));
  }

  ngOnInit() {
    // Check if there is a return ID to highlight / open from query params
    this.route.queryParams.subscribe(params => {
      const highlightId = params['highlight'];
      if (highlightId && this.allReturns().length > 0) {
        const ret = this.allReturns().find(r => r.id === highlightId);
        if (ret) {
          this.selectedReturn.set(ret);
        }
      }
    });
  }

  // Reactive Stats
  stats = computed(() => {
    const list = this.allReturns().filter(r => !r.isDeleted);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalReturnsThisMonth = 0;
    let pendingCount = 0;
    let creditNotesThisMonth = 0;
    let refundsThisMonth = 0;

    for (const r of list) {
      const createdDate = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
      const isThisMonth = createdDate >= startOfMonth;

      if (r.status === 'pending') {
        pendingCount++;
      }

      if (isThisMonth) {
        totalReturnsThisMonth += r.amountCents;

        if (r.status === 'approved') {
          if (r.type === 'credit_note') {
            creditNotesThisMonth += r.amountCents;
          } else if (r.type === 'refund') {
            refundsThisMonth += r.amountCents;
          }
        }
      }
    }

    return {
      totalReturnsThisMonth,
      pendingCount,
      creditNotesThisMonth,
      refundsThisMonth
    };
  });

  // Filtered returns list
  filteredReturns = computed(() => {
    let list = this.allReturns().filter(r => !r.isDeleted);

    // 1. Search
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(r => 
        (r.returnNumber && r.returnNumber.toLowerCase().includes(q)) ||
        (r.orderNumber && r.orderNumber.toLowerCase().includes(q)) ||
        (r.customerName && r.customerName.toLowerCase().includes(q))
      );
    }

    // 2. Type Filter
    const type = this.typeFilter();
    if (type !== 'all') {
      list = list.filter(r => r.type === type);
    }

    // 3. Status Filter
    const status = this.statusFilter();
    if (status !== 'all') {
      list = list.filter(r => r.status === status);
    }

    // 4. Date Filter
    const dFilter = this.dateFilter();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dFilter === 'today') {
      list = list.filter(r => {
        const d = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
      });
    } else if (dFilter === 'last_7' || dFilter === 'last_30') {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - (dFilter === 'last_7' ? 7 : 30));
      list = list.filter(r => {
        const d = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        return d >= threshold;
      });
    }

    // Sort by createdAt desc in memory
    return list.sort((a, b) => {
      const aTime = a.createdAt?.seconds ?? 0;
      const bTime = b.createdAt?.seconds ?? 0;
      return bTime - aTime;
    });
  });

  // Financial breakdown of filtered items
  filteredTotals = computed(() => {
    const list = this.filteredReturns();
    return {
      count: list.length,
      totalCents: list.reduce((sum, r) => sum + r.amountCents, 0),
      creditCents: list
        .filter(r => r.type === 'credit_note')
        .reduce((sum, r) => sum + r.amountCents, 0),
      refundCents: list
        .filter(r => r.type === 'refund')
        .reduce((sum, r) => sum + r.amountCents, 0),
    };
  });

  // Helpers
  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  getReturnTypeLabel(type: ReturnType): string {
    return RETURN_TYPE_LABELS[type] || type;
  }

  getReturnStatusLabel(status: ReturnStatus): string {
    return RETURN_STATUS_LABELS[status] || status;
  }

  getReturnReasonLabel(reason: ReturnReasonCode): string {
    return RETURN_REASON_LABELS[reason] || reason;
  }

  getRefundMethodLabel(method: RefundMethod): string {
    return REFUND_METHOD_LABELS[method] || method;
  }

  getReturnStatusColor(status: ReturnStatus): string {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved': return 'success';
      case 'rejected': return 'danger';
      default: return 'info';
    }
  }

  getFormattedDate(timestamp: any): string {
    if (!timestamp) return '—';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return new DatePipe('en-US').transform(d, 'MMM d, yyyy @ h:mm a') || '—';
  }

  // Side panel select
  selectReturn(ret: Return) {
    this.selectedReturn.set(ret);
    this.showRejectForm.set(false);
    this.rejectionReason.set('');
    this.selectedRefundMethod.set('cash');
    this.refundReferenceNumber.set('');
    this.restoreStockOnApproval.set(true);
  }

  // Approve workflow
  async approveReturn() {
    const returnDoc = this.selectedReturn();
    const actionBy = this.auth.getActionBy();
    if (!returnDoc || !actionBy) return;

    this.isProcessing.set(true);

    try {
      await this.firestore.runBatch(async (batch: any, db: Firestore) => {
        // 1. Update Return
        const returnRef = doc(db, `returns/${returnDoc.id}`);
        const returnUpdates: any = {
          status: 'approved',
          processedBy: actionBy,
          processedAt: serverTimestamp(),
          stockRestored: this.restoreStockOnApproval()
        };

        if (returnDoc.type === 'refund') {
          returnUpdates.refundMethod = this.selectedRefundMethod();
          returnUpdates.refundedAt = serverTimestamp();
          returnUpdates.refundedBy = actionBy;
          if (this.refundReferenceNumber().trim()) {
            returnUpdates.refundReferenceNumber = this.refundReferenceNumber().trim();
          }
        }

        // 2. Update Order Financials
        const orderRef = doc(db, `orders/${returnDoc.orderId}`);
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
          const orderData = orderSnap.data() as Order;
          
          const newTotal = Math.max(0, (orderData.totalCents || 0) - returnDoc.amountCents);
          const newBalance = Math.max(0, (orderData.balanceCents || 0) - returnDoc.amountCents);
          const newAmountPaid = Math.min(newTotal, orderData.amountPaidCents || 0);
          const newPaymentStatus = newBalance <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

          batch.update(orderRef, {
            totalCents: newTotal,
            balanceCents: newBalance,
            amountPaidCents: newAmountPaid,
            paymentStatus: newPaymentStatus
          });
        }

        // 3. Update Customer Financials
        const customerRef = doc(db, `customers/${returnDoc.customerId}`);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const customerData = customerSnap.data() as Customer;
          const updates: any = {
            totalOrderedCents: Math.max(0, (customerData.totalOrderedCents || 0) - returnDoc.amountCents)
          };

          if (returnDoc.type === 'credit_note') {
            updates.totalOwingCents = Math.max(0, (customerData.totalOwingCents || 0) - returnDoc.amountCents);
          } else if (returnDoc.type === 'refund') {
            updates.totalPaidCents = Math.max(0, (customerData.totalPaidCents || 0) - returnDoc.amountCents);
          }

          batch.update(customerRef, updates);
        }

        // 4. Restore stock if restoreStockOnApproval is true
        if (this.restoreStockOnApproval()) {
          const stockAdjustmentIds: string[] = [];

          for (const item of returnDoc.items) {
            const productRef = doc(db, `products/${item.productId}`);
            const productSnap = await getDoc(productRef);

            if (productSnap.exists()) {
              const productData = productSnap.data();
              const currentStock = productData['stock'] || 0;
              const newStock = currentStock + item.quantity;

              // Update product stock
              batch.update(productRef, { stock: newStock });

              // Create stockAdjustment record
              const adjustRef = doc(collection(db, 'stockAdjustments'));
              stockAdjustmentIds.push(adjustRef.id);

              batch.set(adjustRef, {
                productId: item.productId,
                productName: item.productName,
                productSku: item.productSku,
                type: 'returned',
                quantity: item.quantity,
                previousStock: currentStock,
                newStock,
                reason: `Return ${returnDoc.returnNumber} approved`,
                notes: `Return reason: ${returnDoc.reason}`,
                adjustedBy: actionBy,
                createdAt: serverTimestamp(),
                tenantId: 1,
                isDeleted: false,
                linkedOrderId: returnDoc.orderId,
                linkedOrderNumber: returnDoc.orderNumber
              });
            }
          }

          returnUpdates.stockAdjustmentIds = stockAdjustmentIds;
        }

        // Apply return document updates
        batch.update(returnRef, returnUpdates);
      });

      this.toast.success(`Return ${returnDoc.returnNumber} approved successfully`);
      
      // Update local panel state
      const updated = this.allReturns().find(r => r.id === returnDoc.id);
      if (updated) {
        this.selectedReturn.set(updated);
      } else {
        this.selectedReturn.set(null);
      }
    } catch (err) {
      console.error('Error approving return:', err);
      this.toast.error('Failed to approve return');
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Reject workflow
  async rejectReturn() {
    const reason = this.rejectionReason().trim();
    if (!reason) {
      this.toast.error('Rejection reason is required');
      return;
    }

    const returnDoc = this.selectedReturn();
    const actionBy = this.auth.getActionBy();
    if (!returnDoc || !actionBy) return;

    this.isProcessing.set(true);

    try {
      const updates = {
        status: 'rejected' as ReturnStatus,
        rejectionReason: reason,
        processedBy: actionBy,
        processedAt: serverTimestamp()
      };

      await this.firestore.updateDocument(`returns/${returnDoc.id}`, updates);
      
      this.toast.success(`Return ${returnDoc.returnNumber} rejected`);
      this.showRejectForm.set(false);
      this.rejectionReason.set('');
      
      // Update local panel state
      const updated = this.allReturns().find(r => r.id === returnDoc.id);
      if (updated) {
        this.selectedReturn.set(updated);
      } else {
        this.selectedReturn.set(null);
      }
    } catch (err) {
      console.error('Error rejecting return:', err);
      this.toast.error('Failed to reject return');
    } finally {
      this.isProcessing.set(false);
    }
  }
}
