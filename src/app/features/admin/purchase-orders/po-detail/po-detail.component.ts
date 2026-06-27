import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { PurchaseOrder, PO_STATUS_LABELS, PurchaseOrderStatus } from '../../../../core/models/purchase-order.model';
import { Supplier } from '../../../../core/models/supplier.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { serverTimestamp, doc, getDoc, Firestore, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-po-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent, StatusBadgeComponent, LoadingSpinnerComponent, DatePipe],
  templateUrl: './po-detail.component.html',
  styleUrl: './po-detail.component.scss'
})
export class PoDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly db = inject(Firestore);

  private poId: string = this.route.snapshot.paramMap.get('id') || '';
  private po$ = this.firestore.getDocument<PurchaseOrder>(`purchaseOrders/${this.poId}`);
  
  private receives$ = this.firestore.getCollection<any>('purchaseReceives', where('purchaseOrderId', '==', this.poId));

  po = toSignal(this.po$);
  receives = toSignal(this.receives$, { initialValue: [] as any[] });
  
  isLoading = computed(() => !this.po() && !this.hasError());
  hasError = signal(false);

  showCancelForm = signal(false);
  cancelReason = signal('');
  isUpdating = signal(false);
  isGeneratingPdf = signal(false);
  isSendingEmail = signal(false);

  constructor() {
    this.po$.subscribe({
      error: () => this.hasError.set(true)
    });
  }

  getStatusLabel(status: string): string {
    return PO_STATUS_LABELS[status as PurchaseOrderStatus] || status;
  }

  getBadgeStatus(status: string): 'info' | 'success' | 'warning' | 'danger' | 'inactive' {
    switch (status) {
      case 'draft': return 'info';
      case 'sent': return 'warning';
      case 'partially_received': return 'warning';
      case 'received': return 'success';
      case 'cancelled': return 'danger';
      default: return 'inactive';
    }
  }

  formatDate(ts: any): Date | null {
    if (!ts) return null;
    return ts.toDate ? ts.toDate() : new Date(ts);
  }

  async markAsSent() {
    const order = this.po();
    if (!order) return;
    this.isUpdating.set(true);
    try {
      await this.firestore.updateDocument(`purchaseOrders/${this.poId}`, {
        status: 'sent',
      });
      this.toast.success('PO marked as Sent');
    } catch (err) {
      console.error('Error updating PO status:', err);
      this.toast.error('Failed to update status');
    } finally {
      this.isUpdating.set(false);
    }
  }

  async confirmCancel() {
    if (!this.cancelReason().trim()) {
      this.toast.error('Please provide a reason for cancellation');
      return;
    }
    const order = this.po();
    if (!order) return;
    this.isUpdating.set(true);
    try {
      await this.firestore.updateDocument(`purchaseOrders/${this.poId}`, {
        status: 'cancelled',
        cancellationReason: this.cancelReason().trim(),
        cancelledAt: serverTimestamp(),
        cancelledBy: this.auth.getActionBy()
      });
      this.toast.success('PO cancelled successfully');
      this.showCancelForm.set(false);
    } catch (err) {
      console.error('Error cancelling PO:', err);
      this.toast.error('Failed to cancel PO');
    } finally {
      this.isUpdating.set(false);
    }
  }

  // --- PDF & Email Logic ---
  private generatePoHtml(
    order: PurchaseOrder,
    supplier: Supplier | null,
    logoDataUrl: string = ''
  ): string {
    const formatCurrency = (cents: number) => '$' + (cents / 100).toFixed(2);
    const formatDate = (ts: any) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const business = this.settings.business();
    const companyName = business.tradingName || 'Tropx Wholesale';
    const addressHtml = `
      ${business.street ? business.street + '<br>' : ''}
      ${business.city || ''}, ${business.province || ''}
      ${business.postalCode ? ' ' + business.postalCode : ''}
      <br>${business.country || ''}
      ${business.phone ? '<br>' + business.phone : ''}
      ${business.email ? '<br>' + business.email : ''}
    `.trim();
    const logoUrl = logoDataUrl || business.logoUrl || '';

    const itemRows = order.items.map((item, index) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#8a94a6;">${index + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
          <div style="font-weight:600;color:#1c1c1c;">${item.productName}</div>
          <div style="font-size:0.75rem;color:#8a94a6;font-family:monospace;">${item.productSku}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">
          ${item.quantityOrdered}
          <div style="font-size:0.7rem;color:#9ca3af;margin-top:2px;">pcs</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">${formatCurrency(item.unitCostCents)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;">${formatCurrency(item.lineTotalCents)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Purchase Order ${order.poNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', Arial, sans-serif;
      color: #1c1c1c; background: #fff;
      font-size: 14px; line-height: 1.5;
    }
    .page { max-width: 820px; margin: 0 auto; }

    /* ── TOP HEADER BAND ── */
    .header-band {
      background: #0a2d4a;
      padding: 28px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-logo img {
      height: 60px;
      object-fit: contain;
      display: block;
    }
    .header-logo .logo-fallback {
      font-size: 1.6rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.02em;
    }
    .header-title {
      text-align: right;
    }
    .header-title .po-word {
      font-size: 2.25rem;
      font-weight: 900;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      line-height: 1;
    }
    .header-title .po-number {
      font-family: monospace;
      font-size: 1.1rem;
      color: #c9952a;
      font-weight: 700;
      margin-top: 6px;
    }

    /* ── COMPANY STRIP ── */
    .company-strip {
      background: #f0f4f8;
      border-left: 5px solid #c9952a;
      padding: 14px 40px;
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    .company-strip .trading-name {
      font-size: 1rem;
      font-weight: 800;
      color: #0a2d4a;
    }
    .company-strip .legal-name {
      font-size: 0.8rem;
      color: #64748b;
    }
    .company-strip .address-inline {
      font-size: 0.8rem;
      color: #64748b;
      margin-left: auto;
      text-align: right;
      line-height: 1.5;
    }

    /* ── META GRID ── */
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      border-bottom: 3px solid #0a2d4a;
      margin-top: 0;
    }
    .meta-cell {
      padding: 20px 24px;
      border-right: 1px solid #e2e8f0;
    }
    .meta-cell:last-child { border-right: none; }
    .meta-cell .cell-label {
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .meta-cell .cell-name {
      font-size: 0.975rem;
      font-weight: 700;
      color: #0a2d4a;
      margin-bottom: 4px;
    }
    .meta-cell .cell-detail {
      font-size: 0.8rem;
      color: #475569;
      line-height: 1.55;
    }
    .meta-cell .date-block {
      margin-bottom: 10px;
    }
    .meta-cell .date-block:last-child {
      margin-bottom: 0;
    }
    .meta-cell .date-val {
      font-size: 0.9rem;
      font-weight: 700;
      color: #1e293b;
    }

    /* ── ITEMS TABLE ── */
    .items-wrap {
      padding: 0 0 0 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead tr {
      background: #0a2d4a;
    }
    thead th {
      padding: 12px 16px;
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #ffffff;
      text-align: right;
    }
    thead th:nth-child(1) {
      text-align: center;
      width: 44px;
    }
    thead th:nth-child(2) { text-align: left; }
    thead th:nth-child(3) { text-align: center; }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    tbody td {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .td-num {
      text-align: center;
      color: #94a3b8;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .td-product-name {
      font-weight: 700;
      color: #0f172a;
      font-size: 0.9rem;
    }
    .td-sku {
      font-size: 0.72rem;
      color: #94a3b8;
      font-family: monospace;
      margin-top: 2px;
    }
    .td-qty {
      text-align: center;
      font-weight: 700;
      font-size: 0.95rem;
      color: #0f172a;
    }
    .td-unit {
      font-size: 0.68rem;
      color: #94a3b8;
      margin-top: 2px;
    }
    .td-cost {
      text-align: right;
      color: #334155;
    }
    .td-total {
      text-align: right;
      font-weight: 700;
      color: #0a2d4a;
    }

    /* ── TOTALS ── */
    .totals-block {
      display: flex;
      justify-content: flex-end;
    }
    .totals-inner {
      width: 280px;
      border: 1px solid #e2e8f0;
      border-top: none;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 9px 16px;
      font-size: 0.875rem;
      color: #475569;
      border-bottom: 1px solid #f1f5f9;
    }
    .totals-row.grand {
      background: #0a2d4a;
      color: #ffffff;
      font-size: 1rem;
      font-weight: 800;
      padding: 13px 16px;
      border-bottom: none;
    }
    .totals-row.grand span:last-child {
      color: #c9952a;
    }

    /* ── NOTES ── */
    .notes-block {
      margin: 28px 40px;
      padding: 16px 20px;
      background: #f8fafc;
      border-left: 4px solid #c9952a;
      border-radius: 0 6px 6px 0;
    }
    .notes-block .notes-label {
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .notes-block .notes-text {
      font-size: 0.875rem;
      color: #334155;
      line-height: 1.6;
    }

    /* ── FOOTER ── */
    .footer-band {
      background: #0a2d4a;
      padding: 12px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 40px;
    }
    .footer-band .footer-left {
      font-size: 0.75rem;
      color: rgba(255,255,255,0.6);
    }
    .footer-band .footer-right {
      font-size: 0.75rem;
      color: #c9952a;
      font-weight: 600;
    }

    @media print {
      .page { max-width: 100%; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header Band -->
  <div class="header-band">
    <div class="header-logo">
      ${logoUrl
        ? `<img src="${logoUrl}" alt="${companyName}">`
        : `<div class="logo-fallback">${companyName}</div>`}
    </div>
    <div class="header-title">
      <div class="po-word">Purchase Order</div>
      <div class="po-number">${order.poNumber}</div>
    </div>
  </div>

  <!-- Company Strip -->
  <div class="company-strip">
    <span class="trading-name">${companyName}</span>
    <span class="legal-name">${business.companyName || ''}</span>
    <div class="address-inline">
      ${[business.street, business.city + (business.province ? ', ' + business.province : '') + (business.postalCode ? ' ' + business.postalCode : ''), business.country].filter(Boolean).join(' &nbsp;·&nbsp; ')}
      ${business.phone ? '&nbsp;·&nbsp; ' + business.phone : ''}
    </div>
  </div>

  <!-- Meta Grid -->
  <div class="meta-grid">
    <!-- Vendor -->
    <div class="meta-cell">
      <div class="cell-label">Vendor</div>
      <div class="cell-name">${order.supplierName}</div>
      <div class="cell-detail">
        ${supplier ? [
          supplier.street,
          [supplier.city, supplier.province].filter(Boolean).join(', ') + (supplier.postalCode ? ' ' + supplier.postalCode : ''),
          supplier.country,
          supplier.email,
          supplier.phone
        ].filter(Boolean).join('<br>') : ''}
      </div>
    </div>
    <!-- Deliver To -->
    <div class="meta-cell">
      <div class="cell-label">Deliver To</div>
      <div class="cell-name">${order.warehouseName || companyName}</div>
      <div class="cell-detail">
        ${[business.street, business.city + (business.province ? ', ' + business.province : '') + (business.postalCode ? ' ' + business.postalCode : ''), business.country].filter(Boolean).join('<br>')}
      </div>
    </div>
    <!-- Dates -->
    <div class="meta-cell">
      <div class="date-block">
        <div class="cell-label">Order Date</div>
        <div class="date-val">${formatDate(order.orderDate)}</div>
      </div>
      ${order.expectedDate ? `
      <div class="date-block">
        <div class="cell-label">Expected Date</div>
        <div class="date-val">${formatDate(order.expectedDate)}</div>
      </div>` : ''}
    </div>
  </div>

  <!-- Items Table -->
  <div class="items-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th>Qty</th>
          <th>Unit Cost</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- Totals -->
  <div class="totals-block">
    <div class="totals-inner">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${formatCurrency(order.subtotalCents)}</span>
      </div>
      <div class="totals-row">
        <span>Tax (${order.taxRatePercent}%)</span>
        <span>${formatCurrency(order.taxCents)}</span>
      </div>
      <div class="totals-row grand">
        <span>Total</span>
        <span>${formatCurrency(order.totalCents)}</span>
      </div>
    </div>
  </div>

  <!-- Notes -->
  ${order.notes ? `
  <div class="notes-block">
    <div class="notes-label">Notes</div>
    <div class="notes-text">${order.notes}</div>
  </div>` : ''}

  <!-- Footer Band -->
  <div class="footer-band">
    <div class="footer-left">
      ${business.companyName || 'Tropx Enterprises Inc.'} &nbsp;·&nbsp;
      ${business.email || ''}
    </div>
    <div class="footer-right">tropxwholesale.ca</div>
  </div>

</div>
</body>
</html>`;
  }

  async downloadPdf() {
    const order = this.po();
    if (!order) return;
    this.isGeneratingPdf.set(true);
    try {
      const { doc: fdoc, getDoc: fgetDoc } = await import('@angular/fire/firestore');
      const suppRef = fdoc(this.db, `suppliers/${order.supplierId}`);
      const suppSnap = await fgetDoc(suppRef);
      const supplier = suppSnap.exists() ? (suppSnap.data() as Supplier) : null;

      let logoDataUrl = '';
      const bLogoUrl = this.settings.business().logoUrl;
      if (bLogoUrl) {
        try {
          const response = await fetch(bLogoUrl);
          const blob = await response.blob();
          logoDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch {
          logoDataUrl = ''; // fall back to no logo
        }
      }

      const html2pdf = (await import('html2pdf.js')).default;
      const element = document.createElement('div');
      element.innerHTML = this.generatePoHtml(order, supplier, logoDataUrl);
      document.body.appendChild(element);

      await html2pdf()
        .set({
          margin: 0,
          filename: `PurchaseOrder-${order.poNumber}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        } as any)
        .from(element)
        .save();

      document.body.removeChild(element);
      this.toast.success(`Purchase Order ${order.poNumber} downloaded`);
    } catch (err) {
      console.error('PDF generation error:', err);
      this.toast.error('Failed to generate PDF');
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async emailSupplier() {
    const order = this.po();
    if (!order) return;
    this.isSendingEmail.set(true);
    try {
      const { doc: fdoc, getDoc: fgetDoc } = await import('@angular/fire/firestore');
      const suppRef = fdoc(this.db, `suppliers/${order.supplierId}`);
      const suppSnap = await fgetDoc(suppRef);
      const supplier = suppSnap.exists() ? (suppSnap.data() as Supplier) : null;
      const supplierEmail = supplier?.email;

      if (!supplierEmail) {
        this.toast.error('No email found for this supplier');
        this.isSendingEmail.set(false);
        return;
      }

      const poHtml = this.generatePoHtml(order, supplier);

      await this.firestore.addDocument('poRequests', {
        purchaseOrderId: order.id,
        poNumber: order.poNumber,
        supplierId: order.supplierId,
        supplierEmail,
        poHtml,
        status: 'pending',
        tenantId: 1,
        createdAt: serverTimestamp(),
        isDeleted: false,
      });

      this.toast.success(`Purchase Order sent to ${supplierEmail}`);
    } catch (err) {
      console.error('Error sending email:', err);
      this.toast.error('Failed to queue email');
    } finally {
      this.isSendingEmail.set(false);
    }
  }

  receiveItems() {
    this.router.navigate(['/admin/purchase-orders', this.poId, 'receive']);
  }
}
