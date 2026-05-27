import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { where, doc, getDoc, serverTimestamp, Firestore } from '@angular/fire/firestore';

import { PortalService } from '../../../core/services/portal.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-portal-order-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './portal-order-detail.component.html',
  styleUrl: './portal-order-detail.component.scss'
})
export class PortalOrderDetailComponent {
  protected readonly portal = inject(PortalService);
  private readonly firestoreService = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly settingsService = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(Firestore);

  private orderId = this.route.snapshot.paramMap.get('id') || '';

  isLoading = signal(true);
  isGeneratingPdf = signal(false);
  showReturnModal = signal(false);
  isSubmittingReturn = signal(false);

  showCancelConfirm = signal(false);
  isCancelling = signal(false);
  cancelReason = signal('');

  canCancel = computed(() => {
    const o = this.order();
    if (!o) return false;
    // Can cancel only if confirmed (not yet out
    // for delivery, delivered, or cancelled)
    return o.status === 'confirmed';
  });

  // Return form
  returnItems = signal<{
    productId: string;
    productName: string;
    productSku: string;
    maxQty: number;
    selectedQty: number;
    selected: boolean;
    unitPriceCents: number;
  }[]>([]);
  returnType = signal<'credit_note' | 'refund'>('credit_note');
  returnReason = signal('');
  returnReasonCode = signal<string>('other');
  returnNotes = signal('');

  private order$ = this.firestoreService.getDocument<any>(`orders/${this.orderId}`);
  order = toSignal(this.order$, { initialValue: null });

  private orderPayments$ = this.firestoreService.getCollection<any>(
    'payments',
    where('orderId', '==', this.orderId),
    where('tenantId', '==', 1)
  );
  orderPayments = toSignal(this.orderPayments$, { initialValue: [] as any[] });

  activePayments = computed(() =>
    this.orderPayments()
      .filter((p: any) => !p.isDeleted)
      .sort((a: any, b: any) =>
        (b.receivedDate || '').localeCompare(a.receivedDate || '')
      )
  );

  private orderReturns$ = this.firestoreService.getCollection<any>(
    'returns',
    where('orderId', '==', this.orderId),
    where('tenantId', '==', 1)
  );
  orderReturns = toSignal(this.orderReturns$, { initialValue: [] as any[] });

  activeReturns = computed(() =>
    this.orderReturns()
      .filter((r: any) => !r.isDeleted)
      .sort((a: any, b: any) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at;
      })
  );

  canSubmitReturn = computed(() => {
    const o = this.order();
    if (!o) return false;
    return o.status === 'delivered';
  });

  constructor() {
    this.order$.subscribe(o => {
      this.isLoading.set(false);
      if (!o) {
        this.toast.error('Order not found');
        this.router.navigate(['/portal/orders']);
      }
    });
  }

  openReturnModal() {
    const o = this.order();
    if (!o) return;
    this.returnItems.set(
      o.items.map((item: any) => ({
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        maxQty: item.quantity,
        selectedQty: item.quantity,
        selected: false,
        unitPriceCents: item.unitPriceCents,
      }))
    );
    this.returnType.set('credit_note');
    this.returnReason.set('');
    this.returnReasonCode.set('other');
    this.returnNotes.set('');
    this.showReturnModal.set(true);
  }

  toggleReturnItem(index: number) {
    this.returnItems.update(items =>
      items.map((item, i) =>
        i === index
          ? { ...item, selected: !item.selected }
          : item
      )
    );
  }

  updateReturnQty(index: number, qty: number) {
    this.returnItems.update(items =>
      items.map((item, i) =>
        i === index
          ? { ...item,
              selectedQty: Math.min(Math.max(1, qty), item.maxQty)
            }
          : item
      )
    );
  }

  returnTotal = computed(() => {
    return this.returnItems()
      .filter(i => i.selected)
      .reduce(
        (sum, i) => sum + i.unitPriceCents * i.selectedQty,
        0
      );
  });

  selectedReturnItems = computed(() =>
    this.returnItems().filter(i => i.selected)
  );

  async submitReturn() {
    const o = this.order();
    const profile = this.auth.currentProfile();
    if (!o || !profile) return;

    const selected = this.selectedReturnItems();
    if (selected.length === 0) {
      this.toast.error('Please select at least one item to return');
      return;
    }

    if (!this.returnReasonCode()) {
      this.toast.error('Please select a reason');
      return;
    }

    this.isSubmittingReturn.set(true);

    try {
      // Get next return number
      const seqRef = doc(this.firestore, 'settings/returnSequence');
      const seqSnap = await getDoc(seqRef);
      const currentSeq = seqSnap.data()?.['sequence'] || 0;
      const nextSeq = currentSeq + 1;
      const ordering = this.settingsService.ordering();
      const prefix = ordering.returnPrefix || 'RET';
      const year = new Date().getFullYear();
      const returnNumber =
        `${prefix}-${year}-` +
        `${String(nextSeq).padStart(4, '0')}`;

      const returnItems = selected.map(i => ({
        productId: i.productId,
        productName: i.productName,
        productSku: i.productSku,
        quantity: i.selectedQty,
        unitPriceCents: i.unitPriceCents,
        lineTotalCents: i.unitPriceCents * i.selectedQty,
      }));

      const returnData = {
        returnNumber,
        orderId: this.orderId,
        orderNumber: o.orderNumber,
        customerId: o.customerId,
        customerName: o.customerName,
        customerEmail: o.customerEmail || '',
        type: this.returnType(),
        status: 'pending',
        source: 'customer_portal',
        reasonCode: this.returnReasonCode(),
        reason: this.returnNotes() || this.returnReasonCode(),
        items: returnItems,
        amountCents: this.returnTotal(),
        stockRestored: false,
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
        createdBy: {
          uid: profile.uid,
          firstName: profile.firstName,
          lastName: profile.lastName || '',
        },
      };

      // Save return + update sequence
      const { collection: col, doc: docFn } = await import('@angular/fire/firestore');
      const db = this.firestore;

      await this.firestoreService.runBatch(
        async (batch: any, batchDb: any) => {
          const returnRef = docFn(col(batchDb, 'returns'));
          batch.set(returnRef, returnData);
          batch.update(seqRef, { sequence: nextSeq });
        }
      );

      this.toast.success(`Return ${returnNumber} submitted`);
      this.showReturnModal.set(false);
    } catch (err) {
      console.error('Error submitting return:', err);
      this.toast.error('Failed to submit return');
    } finally {
      this.isSubmittingReturn.set(false);
    }
  }

  async cancelOrder() {
    const o = this.order();
    const profile = this.auth.currentProfile();
    if (!o || !profile) return;

    const reason = this.cancelReason().trim();
    if (!reason) {
      this.toast.error(
        'Please provide a reason for cancellation'
      );
      return;
    }

    this.isCancelling.set(true);
    try {
      await this.firestoreService.runBatch(
        async (batch: any, db: any) => {
          const { doc: docFn, getDoc, collection } =
            await import('@angular/fire/firestore');

          // 1. Update order status
          const orderRef = docFn(
            db, `orders/${o.id}`
          );
          batch.update(orderRef, {
            status: 'cancelled',
            cancelledAt: serverTimestamp(),
            cancelledBy: {
              uid: profile.uid,
              firstName: profile.firstName,
              lastName: profile.lastName || '',
            },
            cancellationReason: reason,
            cancelledByPortal: true,
            balanceCents: 0,
            paymentStatus: 'unpaid',
          });

          // 2. Reverse customer totals
          const customerRef = docFn(
            db, `customers/${o.customerId}`
          );
          const customerSnap = await getDoc(customerRef);
          if (customerSnap.exists()) {
            const cd = customerSnap.data();
            const amountPaid = o.amountPaidCents || 0;

            const customerUpdates: any = {
              totalOrderedCents: Math.max(
                0,
                (cd['totalOrderedCents'] || 0) - o.totalCents
              ),
              totalOwingCents: Math.max(
                0,
                (cd['totalOwingCents'] || 0) -
                (o.balanceCents || 0)
              ),
            };

            // If customer had paid something, reduce
            // totalPaidCents and add to creditBalanceCents
            if (amountPaid > 0) {
              customerUpdates.totalPaidCents = Math.max(
                0,
                (cd['totalPaidCents'] || 0) - amountPaid
              );
              customerUpdates.creditBalanceCents =
                (cd['creditBalanceCents'] || 0) + amountPaid;
            }

            batch.update(customerRef, customerUpdates);
          }

          // 3b. Create credit record if paid amount > 0
          const amountPaid = o.amountPaidCents || 0;
          if (amountPaid > 0) {
            const { collection: col } =
              await import('@angular/fire/firestore');

            // Get return sequence
            const retSeqRef = docFn(
              db, 'settings/returnSequence'
            );
            const retSeqSnap = await getDoc(retSeqRef);
            const currentSeq =
              retSeqSnap.data()?.['sequence'] || 0;
            const nextRetSeq = currentSeq + 1;
            const retPrefix =
              this.settingsService.ordering().returnPrefix || 'RET';
            const year = new Date().getFullYear();
            const returnNumber = `${retPrefix}-${year}-` +
              `${String(nextRetSeq).padStart(4, '0')}`;

            const creditRef = docFn(col(db, 'returns'));
            batch.set(creditRef, {
              returnNumber,
              orderId: o.id,
              orderNumber: o.orderNumber,
              customerId: o.customerId,
              customerName: o.customerName,
              customerEmail: o.customerEmail || '',
              customerPhone: o.customerPhone || '',
              type: 'refund',
              status: 'approved',
              source: 'cancellation',
              reasonCode: 'order_cancelled',
              reason: `Order cancelled by customer. ` +
                `Reason: ${reason}`,
              items: o.items.map((item: any) => ({
                productId: item.productId,
                productName: item.productName,
                productSku: item.productSku,
                quantity: item.quantity,
                unitPriceCents: item.unitPriceCents,
                lineTotalCents: item.lineTotalCents,
              })),
              amountCents: amountPaid,
              stockRestored: true,
              stockAdjustmentIds: [],
              refundMethod: 'store_credit',
              tenantId: 1,
              isDeleted: false,
              createdAt: serverTimestamp(),
              createdBy: {
                uid: profile.uid,
                firstName: profile.firstName,
                lastName: profile.lastName || '',
              },
              processedAt: serverTimestamp(),
              processedBy: {
                uid: profile.uid,
                firstName: profile.firstName,
                lastName: profile.lastName || '',
              },
            });

            batch.update(retSeqRef, { sequence: nextRetSeq });
          }

          // 3. Restore stock per item
          for (const item of o.items) {
            const productRef = docFn(
              db, `products/${item.productId}`
            );
            const productSnap =
              await getDoc(productRef);
            if (productSnap.exists()) {
              const pd = productSnap.data();
              const currentStock = pd['stock'] || 0;
              const newStock =
                currentStock + item.quantity;
              batch.update(productRef, {
                stock: newStock
              });

              // Stock adjustment record
              const adjRef = docFn(
                collection(db, 'stockAdjustments')
              );
              batch.set(adjRef, {
                productId: item.productId,
                productName: item.productName,
                productSku: item.productSku,
                type: 'returned',
                quantity: item.quantity,
                previousStock: currentStock,
                newStock,
                reason:
                  `Order ${o.orderNumber} cancelled ` +
                  `by customer`,
                notes: `Reason: ${reason}`,
                adjustedBy: {
                  uid: profile.uid,
                  firstName: profile.firstName,
                  lastName: profile.lastName || '',
                },
                createdAt: serverTimestamp(),
                tenantId: 1,
                isDeleted: false,
                linkedOrderId: o.id,
                linkedOrderNumber: o.orderNumber,
              });
            }
          }
        }
      );

      this.toast.success(
        `Order ${o.orderNumber} cancelled`
      );
      this.showCancelConfirm.set(false);
      this.cancelReason.set('');
    } catch (err) {
      console.error('Error cancelling order:', err);
      this.toast.error('Failed to cancel order');
    } finally {
      this.isCancelling.set(false);
    }
  }

  async reorder() {
    const o = this.order();
    if (!o) return;

    let addedCount = 0;
    for (const item of o.items) {
      const product = this.portal.allProducts()
        .find((p: any) => p.id === item.productId);
      if (product && product.stock > 0) {
        this.portal.addToCart(product, item.quantity);
        addedCount++;
      }
    }

    if (addedCount === 0) {
      this.toast.error('No items from this order are currently in stock');
      return;
    }

    this.toast.success(`${addedCount} item${addedCount > 1 ? 's' : ''} added to cart`);
    this.router.navigate(['/portal/cart']);
  }

  async downloadInvoice() {
    const order = this.order();
    if (!order) return;

    this.isGeneratingPdf.set(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const html = this.generateInvoiceHtml(order);

      const element = document.createElement('div');
      element.innerHTML = html;
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
      this.toast.success(`Invoice ${order.orderNumber} downloaded`);
    } catch (err) {
      console.error('PDF generation error:', err);
      this.toast.error('Failed to generate PDF');
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  private generateInvoiceHtml(order: any): string {
    const formatCurrency = (cents: number) => 
      '$' + (cents / 100).toFixed(2);
    
    const formatDate = (ts: any) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    };

    const business = this.settingsService.business();
    const invoice = this.settingsService.invoice();

    const companyName = business.tradingName || 'Tropx Wholesale';
    const legalName = business.companyName || 'Tropx Enterprises Inc.';
    const address = [
      business.city, business.province, business.country
    ].filter(Boolean).join(', ') || 'Kitchener, Ontario, Canada';
    const hstNumber = business.hstNumber || '793273830 RT 0001';
    const contactEmail = business.email || 'admin@tropxwholesale.ca';
    const website = business.website || 'tropxwholesale.ca';
    const etransferEmail = invoice.etransferEmail || 'tropxenterprises@gmail.com';
    const footerMsg = invoice.footerMessage || 'Thank you for your business!';
    const paymentTermsDays = invoice.paymentTermsDays || 30;
    const logoUrl = business.logoUrl;

    const dueDate = (() => {
      if (!order.confirmedAt) return '—';
      const d = order.confirmedAt.toDate 
        ? order.confirmedAt.toDate() 
        : new Date(order.confirmedAt);
      const due = new Date(d);
      due.setDate(due.getDate() + paymentTermsDays);
      return due.toLocaleDateString('en-CA', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    })();

    const itemRows = order.items.map((item: any) => `
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
        ${logoUrl ? 
          `<img src="${logoUrl}" alt="${companyName}" 
           style="height:48px;object-fit:contain;
           margin-bottom:8px;">
           <div class="tagline">${companyName}</div>` :
          `<div class="company-name">${companyName}</div>
           <div class="tagline">Your Wholesale Partner</div>`
        }
        <div class="details">
          ${legalName}<br>
          ${address}<br>
          HST# ${hstNumber}<br>
          ${contactEmail}
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
        💳 E-Transfer: ${etransferEmail}
      </div>
      ${invoice.acceptCash ? `
      <div class="pi-detail">
        💵 Cash on Delivery accepted
      </div>
      ` : ''}
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
        ${footerMsg}
      </div>
      <div class="website">${website}</div>
    </div>

  </div>
</body>
</html>`;
  }

  getStatusConfig(status: string) {
    const map: Record<string, {
      label: string; class: string; step: number;
    }> = {
      confirmed: {
        label: 'Confirmed', class: 'confirmed',
        step: 1
      },
      out_for_delivery: {
        label: 'Out for Delivery',
        class: 'delivery', step: 2
      },
      delivered: {
        label: 'Delivered', class: 'delivered',
        step: 3
      },
      cancelled: {
        label: 'Cancelled', class: 'cancelled',
        step: 0
      },
    };
    return map[status] ||
      { label: status, class: 'confirmed', step: 1 };
  }

  currentStep = computed(() => {
    const o = this.order();
    if (!o) return 0;
    return this.getStatusConfig(o.status).step;
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

  getMethodLabel(method: string): string {
    const map: Record<string, string> = {
      cash: 'Cash',
      e_transfer: 'E-Transfer',
      cheque: 'Cheque',
      other: 'Other',
    };
    return map[method] || method;
  }

  getReturnStatusConfig(status: string) {
    const map: Record<string, {
      label: string; class: string;
    }> = {
      pending: { label: 'Pending', class: 'pending' },
      approved: {
        label: 'Approved', class: 'approved'
      },
      rejected: {
        label: 'Rejected', class: 'rejected'
      },
    };
    return map[status] ||
      { label: status, class: 'pending' };
  }

  reasonCodes = [
    { value: 'damaged', label: 'Damaged / Defective' },
    { value: 'wrong_item', label: 'Wrong Item Received' },
    { value: 'expired', label: 'Expired / Past Best Before' },
    { value: 'quality_issue', label: 'Quality Issue' },
    { value: 'customer_changed_mind', label: 'Changed My Mind' },
    { value: 'other', label: 'Other' },
  ];
}
