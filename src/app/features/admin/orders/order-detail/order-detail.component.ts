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
import { serverTimestamp, doc, getDoc, where } from '@angular/fire/firestore';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';
import { take } from 'rxjs/operators';
import { RecordPaymentModalComponent } from '../../payments/record-payment-modal/record-payment-modal.component';
import { Payment, PaymentMethod, PAYMENT_METHOD_LABELS } from '../../../../core/models/payment.model';
import { Return, RETURN_TYPE_LABELS, RETURN_STATUS_LABELS, ReturnType } from '../../../../core/models/return.model';
import { CreateReturnModalComponent } from '../../returns/create-return-modal/create-return-modal.component';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, StatusBadgeComponent, LoadingSpinnerComponent, RouterModule, DatePipe, RecordPaymentModalComponent, CreateReturnModalComponent],
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
  isGeneratingPdf = signal(false);
  isSendingInvoice = signal(false);

  // Data
  private orderId = this.route.snapshot.paramMap.get('id') || '';
  private order$ = this.firestore.getDocument<Order>(`orders/${this.orderId}`);
  order = toSignal(this.order$);

  // Payments
  showPaymentModal = signal(false);
  private payments$ = this.firestore.getCollection<Payment>(
    'payments',
    where('orderId', '==', this.orderId),
    where('tenantId', '==', 1)
  );
  orderPayments = toSignal(this.payments$, { initialValue: [] as Payment[] });

  activePayments = computed(() =>
    this.orderPayments()
      .filter(p => !p.isDeleted)
      .sort((a, b) => {
        return (b.receivedDate || '').localeCompare(a.receivedDate || '');
      })
  );

  // Returns
  showReturnModal = signal(false);
  private returns$ = this.firestore.getCollection<Return>(
    'returns',
    where('orderId', '==', this.orderId),
    where('tenantId', '==', 1)
  );
  orderReturns = toSignal(this.returns$, { initialValue: [] as Return[] });

  activeReturns = computed(() =>
    this.orderReturns()
      .filter(r => !r.isDeleted)
      .sort((a, b) => {
        const aTime = a.createdAt?.seconds ?? 0;
        const bTime = b.createdAt?.seconds ?? 0;
        return bTime - aTime;
      })
  );

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

        // 3. Restore stock for each item
        const { collection } = await import('@angular/fire/firestore');
        for (const item of order.items) {
          const productRef = doc(db, `products/${item.productId}`);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const productData = productSnap.data();
            const currentStock = productData['stock'] || 0;
            const newStock = currentStock + item.quantity;
            
            batch.update(productRef, { stock: newStock });
            
            // Create stock adjustment record for the reversal
            const adjustRef = doc(
              collection(db, 'stockAdjustments')
            );
            batch.set(adjustRef, {
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              type: 'returned',
              quantity: item.quantity,
              previousStock: currentStock,
              newStock,
              reason: `Order ${order.orderNumber} cancelled`,
              notes: `Cancellation reason: ${reason}`,
              adjustedBy: actionBy,
              createdAt: serverTimestamp(),
              tenantId: 1,
              isDeleted: false,
              linkedOrderId: order.id,
              linkedOrderNumber: order.orderNumber,
            });
          }
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

  async reorder() {
    const order = this.order();
    if (!order) return;
    
    const reorderData = {
      customerId: order.customerId,
      items: order.items,
      taxRatePercent: order.taxRatePercent,
      deliveryType: order.deliveryType,
      sourceOrderNumber: order.orderNumber,
    };
    localStorage.setItem('tropx_reorder_draft', JSON.stringify(reorderData));
    this.router.navigate(['/admin/orders/new']);
    this.toast.success(`Reorder started — items pre-filled from ${order.orderNumber}`);
  }

  private generateInvoiceHtml(order: Order): string {
    const formatCurrency = (cents: number) => 
      '$' + (cents / 100).toFixed(2);
    
    const formatDate = (ts: any) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    };

    const dueDate = (() => {
      if (!order.confirmedAt) return '—';
      const d = order.confirmedAt.toDate 
        ? order.confirmedAt.toDate() 
        : new Date(order.confirmedAt);
      const due = new Date(d);
      due.setDate(due.getDate() + 30);
      return due.toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    })();

    const itemRows = order.items.map(item => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
          <div style="font-weight:600;color:#1c1c1c;">
            ${item.productName}
          </div>
          <div style="font-size:0.75rem;color:#8a94a6;font-family:monospace;">
            ${item.productSku}
          </div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">
          ${formatCurrency(item.unitPriceCents)}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;">
          ${formatCurrency(item.lineTotalCents)}
        </td>
      </tr>
    `).join('');

    const discountRow = order.discountCents > 0 ? `
      <tr>
        <td colspan="3" style="padding:6px 12px;text-align:right;color:#8a94a6;">Discount</td>
        <td style="padding:6px 12px;text-align:right;color:#e7222e;">
          -${formatCurrency(order.discountCents)}
        </td>
      </tr>
    ` : '';

    const paymentStatusColor = 
      order.paymentStatus === 'paid' ? '#1a7c4a' :
      order.paymentStatus === 'partial' ? '#c9952a' : '#e7222e';

    const paymentStatusLabel = 
      order.paymentStatus === 'paid' ? 'PAID' :
      order.paymentStatus === 'partial' ? 'PARTIAL' : 'UNPAID';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${order.orderNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      color: #1c1c1c;
      background: #ffffff;
      font-size: 14px;
      line-height: 1.5;
    }
    .page { max-width: 800px; margin: 0 auto; padding: 48px; }
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 40px; padding-bottom: 24px; border-bottom: 3px solid #0a2d4a;
    }
    .company-info .company-name {
      font-size: 1.5rem; font-weight: 800; color: #0a2d4a; letter-spacing: -0.02em;
    }
    .company-info .tagline {
      color: #c9952a; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; margin-top: 2px;
    }
    .company-info .details {
      margin-top: 8px; font-size: 0.8125rem; color: #8a94a6; line-height: 1.6;
    }
    .invoice-title { text-align: right; }
    .invoice-title .word {
      font-size: 2rem; font-weight: 800; color: #0a2d4a; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .invoice-title .number {
      font-family: monospace; font-size: 1rem; color: #16588e; font-weight: 700; margin-top: 4px;
    }
    .invoice-title .status-badge {
      display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 20px;
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em;
      background: ${paymentStatusColor}20; color: ${paymentStatusColor}; border: 1px solid ${paymentStatusColor};
    }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .meta-section .section-label {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: #8a94a6; margin-bottom: 8px;
    }
    .meta-section .business-name { font-size: 1rem; font-weight: 700; color: #0a2d4a; }
    .meta-section .detail { font-size: 0.8125rem; color: #444; margin-top: 2px; }
    .dates-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
    .date-item .date-label {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #8a94a6;
    }
    .date-item .date-value { font-size: 0.875rem; font-weight: 600; color: #1c1c1c; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead tr { background: #0a2d4a; }
    thead th {
      padding: 10px 12px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: white; text-align: left;
    }
    thead th:not(:first-child) { text-align: right; }
    thead th:nth-child(2) { text-align: center; }
    .totals-section { margin-top: 0; border: 1px solid #f0f0f0; border-top: none; }
    .totals-row {
      display: flex; justify-content: space-between; padding: 8px 12px;
      font-size: 0.875rem; border-bottom: 1px solid #f0f0f0; color: #444;
    }
    .totals-row.total {
      background: #0a2d4a; color: white; font-size: 1rem; font-weight: 700;
      padding: 14px 12px; border-bottom: none;
    }
    .totals-row.balance {
      background: ${order.balanceCents > 0 ? '#fff5f5' : '#f0fdf4'};
      color: ${order.balanceCents > 0 ? '#e7222e' : '#1a7c4a'};
      font-weight: 700; font-size: 0.875rem; border-bottom: none;
    }
    .payment-info {
      margin-top: 32px; background: #f0f7ff; border-left: 4px solid #16588e;
      border-radius: 0 8px 8px 0; padding: 16px 20px;
    }
    .payment-info .pi-title {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
      color: #16588e; margin-bottom: 8px;
    }
    .payment-info .pi-detail { font-size: 0.8125rem; color: #0a2d4a; margin-bottom: 4px; }
    .footer {
      margin-top: 48px; padding-top: 24px; border-top: 1px solid #f0f0f0;
      display: flex; justify-content: space-between; align-items: flex-end;
    }
    .footer .thank-you { font-size: 0.875rem; color: #8a94a6; }
    .footer .website { font-size: 0.8rem; color: #16588e; font-weight: 600; }
    @media print { body { padding: 0; } .page { padding: 24px; } }
  </style>
</head>
<body>
  <div class="page">
    
    <!-- Header -->
    <div class="header">
      <div class="company-info">
        <div class="company-name">Tropx Wholesale</div>
        <div class="tagline">Your Wholesale Partner</div>
        <div class="details">
          Tropx Enterprises Inc.<br>
          Kitchener, Ontario, Canada<br>
          HST# 793273830 RT 0001<br>
          admin@tropxwholesale.ca
        </div>
      </div>
      <div class="invoice-title">
        <div class="word">Invoice</div>
        <div class="number">${order.orderNumber}</div>
        <div>
          <span class="status-badge">
            ${paymentStatusLabel}
          </span>
        </div>
      </div>
    </div>

    <!-- Bill To + Dates -->
    <div class="meta-grid">
      <div class="meta-section">
        <div class="section-label">Bill To</div>
        <div class="business-name">${order.customerName}</div>
        <div class="detail">${order.customerPhone}</div>
        ${order.serviceAreaName ? 
          `<div class="detail">
            Service Area: ${order.serviceAreaName}
          </div>` : ''}
      </div>
      <div>
        <div class="dates-grid">
          <div class="date-item">
            <div class="date-label">Invoice Date</div>
            <div class="date-value">
              ${formatDate(order.confirmedAt)}
            </div>
          </div>
          <div class="date-item">
            <div class="date-label">Due Date</div>
            <div class="date-value">${dueDate}</div>
          </div>
          <div class="date-item">
            <div class="date-label">Delivery</div>
            <div class="date-value">
              ${order.deliveryType === 'pickup' ? 'Pickup' : 'Delivery'}
            </div>
          </div>
          ${order.expectedDeliveryDate ? `
            <div class="date-item">
              <div class="date-label">Expected</div>
              <div class="date-value">
                ${formatDate(order.expectedDeliveryDate)}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center">Qty</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <!-- Totals -->
    <div class="totals-section">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${formatCurrency(order.subtotalCents)}</span>
      </div>
      ${discountRow}
      <div class="totals-row">
        <span>HST (${order.taxRatePercent}%)</span>
        <span>${formatCurrency(order.taxCents)}</span>
      </div>
      <div class="totals-row total">
        <span>Total</span>
        <span>${formatCurrency(order.totalCents)}</span>
      </div>
      ${order.amountPaidCents > 0 ? `
        <div class="totals-row" style="color:#1a7c4a;">
          <span>Amount Paid</span>
          <span>-${formatCurrency(order.amountPaidCents)}</span>
        </div>
      ` : ''}
      <div class="totals-row balance">
        <span>Balance Due</span>
        <span>${formatCurrency(order.balanceCents)}</span>
      </div>
    </div>

    <!-- Payment Info -->
    <div class="payment-info">
      <div class="pi-title">Payment Information</div>
      <div class="pi-detail">
        💳 E-Transfer: tropxenterprises@gmail.com
      </div>
      <div class="pi-detail">
        💵 Cash on Delivery accepted
      </div>
      <div class="pi-detail" style="margin-top:8px;font-size:0.75rem;color:#444;">
        Please reference invoice number 
        <strong>${order.orderNumber}</strong> 
        in your payment.
      </div>
    </div>

    ${order.customerNotes ? `
      <div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;">
        <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8a94a6;margin-bottom:8px;">Notes</div>
        <div style="font-size:0.875rem;color:#444;">
          ${order.customerNotes}
        </div>
      </div>
    ` : ''}

    <!-- Footer -->
    <div class="footer">
      <div class="thank-you">
        Thank you for your business!
      </div>
      <div class="website">tropxwholesale.ca</div>
    </div>

  </div>
</body>
</html>`;
  }

  async downloadInvoice() {
    const order = this.order();
    if (!order) return;

    this.isGeneratingPdf.set(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      
      const element = document.createElement('div');
      element.innerHTML = this.generateInvoiceHtml(order);
      document.body.appendChild(element);

      await html2pdf()
        .set({
          margin: 0,
          filename: `Invoice-${order.orderNumber}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { 
            scale: 2,
            useCORS: true,
            letterRendering: true,
          },
          jsPDF: { 
            unit: 'mm', 
            format: 'a4', 
            orientation: 'portrait' 
          },
          pagebreak: { mode: 'avoid-all' }
        } as any)
        .from(element)
        .save();

      document.body.removeChild(element);
      this.toast.success(
        `Invoice ${order.orderNumber} downloaded`
      );
    } catch (err) {
      console.error('PDF generation error:', err);
      this.toast.error('Failed to generate PDF');
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async sendInvoiceByEmail() {
    const order = this.order();
    if (!order) return;

    // Get customer email
    const customerDoc = await this.firestore
      .getDocument<any>(`customers/${order.customerId}`)
      .pipe(take(1))
      .toPromise()
      .catch(() => null);

    const customerEmail = customerDoc?.email;
    if (!customerEmail) {
      this.toast.error('No email found for this customer');
      return;
    }

    this.isSendingInvoice.set(true);
    try {
      const invoiceHtml = this.generateInvoiceHtml(order);
      
      await this.firestore.addDocument('invoiceRequests', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        customerName: order.customerName,
        customerEmail,
        invoiceHtml,
        status: 'pending',
        tenantId: 1,
        createdAt: serverTimestamp(),
        isDeleted: false,
      });

      this.toast.success(
        `Invoice sent to ${customerEmail}`
      );
    } catch (err) {
      console.error('Error sending invoice:', err);
      this.toast.error('Failed to send invoice');
    } finally {
      this.isSendingInvoice.set(false);
    }
  }

  printDeliverySlip() {
    const order = this.order();
    if (!order) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const items = order.items.map(item => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          <strong>${item.productName}</strong><br>
          <small style="color:#666;">${item.productSku}</small>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;font-size:1.25rem;font-weight:700;">
          ${item.quantity}
        </td>
      </tr>
    `).join('');
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Delivery Slip - ${order.orderNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
          .header { border-bottom: 3px solid #0a2d4a; padding-bottom: 16px; margin-bottom: 20px; }
          .company { font-size: 1.25rem; font-weight: 700; color: #0a2d4a; }
          .slip-title { font-size: 0.875rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
          .order-number { font-size: 1.5rem; font-weight: 700; color: #0a2d4a; font-family: monospace; }
          .section { margin-bottom: 20px; }
          .section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #666; letter-spacing: 0.05em; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; }
          th { text-align: left; padding: 8px; border-bottom: 2px solid #0a2d4a; font-size: 0.75rem; text-transform: uppercase; color: #666; }
          .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 0.75rem; color: #999; text-align: center; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="slip-title">Delivery Slip</div>
          <div class="company">Tropx Enterprises Inc.</div>
          <div>Kitchener, Ontario, Canada</div>
        </div>
        
        <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
          <div>
            <div class="order-number">${order.orderNumber}</div>
            <div style="color:#666;font-size:0.875rem;">
              ${new Date(order.createdAt?.toDate ? order.createdAt.toDate() : order.createdAt as any).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700">${order.deliveryType === 'pickup' ? '📦 PICKUP' : '🚚 DELIVERY'}</div>
            ${order.expectedDeliveryDate ? `
              <div style="color:#666;font-size:0.875rem;">
                Expected: ${new Date((order.expectedDeliveryDate as any).toDate ? (order.expectedDeliveryDate as any).toDate() : order.expectedDeliveryDate as any).toLocaleDateString('en-CA')}
              </div>
            ` : ''}
          </div>
        </div>

        <div class="section">
          <div class="section-title">Deliver To</div>
          <div style="font-weight:700;font-size:1rem;">${order.customerName}</div>
          <div style="color:#666;">${order.customerPhone}</div>
          ${order.serviceAreaName ? `<div style="color:#666;">Area: ${order.serviceAreaName}</div>` : ''}
        </div>

        <div class="section">
          <div class="section-title">Items</div>
          <table>
            <thead><tr><th>Product</th><th style="text-align:center;width:80px;">Qty</th></tr></thead>
            <tbody>${items}</tbody>
          </table>
        </div>

        ${order.customerNotes ? `
          <div class="section">
            <div class="section-title">Customer Notes</div>
            <div style="background:#f8fafc;padding:12px;border-radius:8px;font-size:0.875rem;">${order.customerNotes}</div>
          </div>
        ` : ''}

        <div style="margin-top:40px;display:flex;gap:40px;">
          <div>
            <div style="font-size:0.75rem;color:#666;margin-bottom:40px;">Received By</div>
            <div style="border-top:1px solid #333;padding-top:8px;width:200px;font-size:0.75rem;color:#666;">Signature</div>
          </div>
          <div>
            <div style="font-size:0.75rem;color:#666;margin-bottom:40px;">Date</div>
            <div style="border-top:1px solid #333;padding-top:8px;width:150px;font-size:0.75rem;color:#666;">Date</div>
          </div>
        </div>

        <div class="footer">Tropx Enterprises Inc. · tropxwholesale.ca</div>
        <script>window.onload = () => window.print();</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  shareViaWhatsApp() {
    const order = this.order();
    if (!order) return;
    
    const items = order.items.map(i => `  • ${i.productName} × ${i.quantity}`).join('\n');
    
    const message = [
      `*Order Confirmation - ${order.orderNumber}*`,
      ``,
      `Hi ${order.customerName},`,
      `Your order has been confirmed.`,
      ``,
      `*Items:*`,
      items,
      ``,
      `*Total: ${this.formatCurrency(order.totalCents)}*`,
      order.expectedDeliveryDate ? `Expected Delivery: ${new Date((order.expectedDeliveryDate as any).toDate ? (order.expectedDeliveryDate as any).toDate() : order.expectedDeliveryDate as any).toLocaleDateString('en-CA')}` : '',
      ``,
      `Thank you for your business!`,
      `— Tropx Wholesale`,
    ].filter(Boolean).join('\n');
    
    const encoded = encodeURIComponent(message);
    const phone = order.customerPhone?.replace(/\D/g, '')?.replace(/^1/, '');
    
    const url = phone ? `https://wa.me/1${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
  }

  // Utils
  formatCurrency(cents: number) {
    return centsToDisplay(cents);
  }

  getMethodLabel(method: string): string {
    return PAYMENT_METHOD_LABELS[method as PaymentMethod] || method;
  }

  onPaymentModalClosed(saved: boolean) {
    this.showPaymentModal.set(false);
  }

  onReturnModalClosed(saved: boolean) {
    this.showReturnModal.set(false);
  }

  getReturnTypeLabel(type: string): string {
    return RETURN_TYPE_LABELS[type as ReturnType] || type;
  }

  getReturnStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved': return 'success';
      case 'rejected': return 'danger';
      default: return 'info';
    }
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
