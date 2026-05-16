import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Order, OrderStatus, ORDER_STATUS_LABELS, PaymentStatus } from '../../../../core/models/order.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { serverTimestamp, doc, getDoc } from '@angular/fire/firestore';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, StatusBadgeComponent, LoadingSpinnerComponent, RouterModule, DatePipe],
  templateUrl: './order-detail.component.html',
  styleUrls: ['./order-detail.component.scss']
})
export class OrderDetailComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // State
  isLoading = signal(true);
  showCancelForm = signal(false);
  isUpdating = signal(false);

  // Data
  private orderId = this.route.snapshot.paramMap.get('id') || '';
  private order$ = this.firestore.getDocument<Order>(`orders/${this.orderId}`);
  order = toSignal(this.order$);

  constructor() {
    this.order$.subscribe(order => {
      this.isLoading.set(false);
      if (!order) {
        this.toast.error('Order not found');
      }
    });
  }

  // Handlers
  async updateStatus(status: OrderStatus) {
    const order = this.order();
    const actionBy = this.auth.getActionBy();
    if (!order || !actionBy) return;

    this.isUpdating.set(true);
    try {
      const updates: any = { status };
      
      if (status === 'out_for_delivery') {
        updates.outForDeliveryAt = serverTimestamp();
        updates.outForDeliveryBy = actionBy;
      } else if (status === 'delivered') {
        updates.deliveredAt = serverTimestamp();
        updates.deliveredBy = actionBy;
      }

      await this.firestore.updateDocument(`orders/${order.id}`, updates);
      this.toast.success(`Order status updated to ${this.getStatusLabel(status)}`);
    } catch (error) {
      console.error('Error updating status:', error);
      this.toast.error('Failed to update order status');
    } finally {
      this.isUpdating.set(false);
    }
  }

  async confirmCancel(reason: string) {
    if (!reason.trim()) {
      this.toast.error('Please provide a reason for cancellation');
      return;
    }

    const order = this.order();
    const actionBy = this.auth.getActionBy();
    if (!order || !actionBy) return;

    this.isUpdating.set(true);
    try {
      await this.firestore.runBatch(async (batch, db) => {
        // 1. Update Order
        const orderRef = doc(db, `orders/${order.id}`);
        batch.update(orderRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelledBy: actionBy,
          cancellationReason: reason
        });

        // 2. Reverse Customer Totals
        const customerRef = doc(db, `customers/${order.customerId}`);
        const customerSnap = await getDoc(customerRef);
        
        if (customerSnap.exists()) {
          const customerData = customerSnap.data();
          const totalOrdered = (customerData['totalOrderedCents'] || 0) - order.totalCents;
          const totalOwing = (customerData['totalOwingCents'] || 0) - (order.totalCents - (order.amountPaidCents || 0));
          
          batch.update(customerRef, {
            totalOrderedCents: Math.max(0, totalOrdered),
            totalOwingCents: Math.max(0, totalOwing)
          });
        }
      });

      this.toast.success('Order cancelled successfully');
      this.showCancelForm.set(false);
    } catch (error) {
      console.error('Error cancelling order:', error);
      this.toast.error('Failed to cancel order');
    } finally {
      this.isUpdating.set(false);
    }
  }

  // Utils
  formatCurrency(cents: number) {
    return centsToDisplay(cents);
  }

  getStatusLabel(status: OrderStatus): string {
    return ORDER_STATUS_LABELS[status];
  }

  getOrderStatusColor(status: OrderStatus): string {
    switch (status) {
      case 'confirmed': return 'info';
      case 'out_for_delivery': return 'warning';
      case 'delivered': return 'success';
      case 'cancelled': return 'danger';
      default: return 'info';
    }
  }

  getPaymentStatusColor(status: PaymentStatus): string {
    switch (status) {
      case 'unpaid': return 'danger';
      case 'partial': return 'warning';
      case 'paid': return 'success';
      default: return 'info';
    }
  }
}
