import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Bill, BillLineItem, BillStatus } from '../../../../core/models/bill.model';
import { PurchaseOrder } from '../../../../core/models/purchase-order.model';
import { Supplier } from '../../../../core/models/supplier.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { serverTimestamp, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { todayInputValue, toDateInputValue, dateInputToLocalDate } from '../../../../shared/utils/date.utils';
import { TENANT_ID } from '../../../../core/config/tenant.config';

@Component({
  selector: 'app-bill-form',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent],
  templateUrl: './bill-form.component.html',
  styleUrl: './bill-form.component.scss'
})
export class BillFormComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  isEditing = signal(false);
  isSaving = signal(false);
  billId = this.route.snapshot.paramMap.get('id');
  private poIdParam = this.route.snapshot.queryParamMap.get('poId');

  private existingBill: Bill | null = null;

  orderingSettings = this.settings.ordering;

  private suppliers$ = this.firestore.getCollection<Supplier>('suppliers', where('tenantId', '==', TENANT_ID), where('isDeleted', '==', false), where('active', '==', true));
  suppliers = toSignal(this.suppliers$, { initialValue: [] as Supplier[] });

  // Form state
  formSupplierId = signal('');
  formBillDate = signal(todayInputValue());
  formDueDate = signal('');
  formNotes = signal('');
  formTaxCents = signal(0); // dollar value shown/entered in the input; taxCents computed converts to real cents
  private taxManuallyEdited = signal(false);

  linkedPurchaseOrderId = signal<string | undefined>(undefined);
  linkedPurchaseOrderNumber = signal<string | undefined>(undefined);

  items = signal<BillLineItem[]>([]);

  subtotalCents = computed(() => this.items().reduce((sum, item) => sum + item.lineTotalCents, 0));
  // formTaxCents holds a dollar value (see load/auto-tax below); convert to
  // real cents here — this was previously missing, so a manually-entered
  // tax amount (e.g. "13.00") was stored as 13 cents instead of 1300.
  taxCents = computed(() => Math.round(this.formTaxCents() * 100));
  totalCents = computed(() => this.subtotalCents() + this.taxCents());

  constructor() {
    if (this.billId) {
      this.isEditing.set(true);
      this.loadBill();
    } else if (this.poIdParam) {
      this.loadFromPo(this.poIdParam);
    }
  }

  private loadBill() {
    if (!this.billId) return;
    this.firestore.getDocument<Bill>(`bills/${this.billId}`).subscribe(bill => {
      if (!bill) return;
      this.existingBill = bill;
      this.formSupplierId.set(bill.supplierId);
      this.formBillDate.set(this.formatDateForInput(bill.billDate) || todayInputValue());
      this.formDueDate.set(bill.dueDate ? this.formatDateForInput(bill.dueDate) : '');
      this.formNotes.set(bill.notes || '');
      this.formTaxCents.set((bill.taxCents || 0) / 100);
      this.taxManuallyEdited.set(true);
      this.items.set(bill.lineItems || []);
      this.linkedPurchaseOrderId.set(bill.linkedPurchaseOrderId);
      this.linkedPurchaseOrderNumber.set(bill.linkedPurchaseOrderNumber);
    });
  }

  private loadFromPo(poId: string) {
    this.firestore.getDocument<PurchaseOrder>(`purchaseOrders/${poId}`).subscribe(po => {
      if (!po) return;
      this.formSupplierId.set(po.supplierId);
      this.items.set(po.items.map(i => ({
        description: `${i.productName} (${i.productSku})`,
        quantity: i.quantityOrdered,
        unitCents: i.unitCostCents,
        lineTotalCents: i.lineTotalCents,
      })));
      this.formTaxCents.set((po.taxCents || 0) / 100);
      this.taxManuallyEdited.set(true);
      this.linkedPurchaseOrderId.set(po.id);
      this.linkedPurchaseOrderNumber.set(po.poNumber);
      this.recalculateDueDate();
    });
  }

  private formatDateForInput(ts: any): string {
    if (!ts) return '';
    let d: Date;
    if (ts.toDate) d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return toDateInputValue(d);
  }

  onSupplierChange(supplierId: string) {
    this.formSupplierId.set(supplierId);
    this.recalculateDueDate();
  }

  onBillDateChange(value: string) {
    this.formBillDate.set(value);
    this.recalculateDueDate();
  }

  private recalculateDueDate() {
    if (this.formDueDate()) return; // never overwrite a date the user already set
    const supplier = this.suppliers().find(s => s.id === this.formSupplierId());
    if (!supplier || !this.formBillDate()) return;
    const billDate = dateInputToLocalDate(this.formBillDate());
    if (!billDate) return;
    const due = new Date(billDate);
    due.setDate(due.getDate() + (supplier.paymentTermsDays || 0));
    this.formDueDate.set(toDateInputValue(due));
  }

  onTaxChange(value: number) {
    this.formTaxCents.set(value);
    this.taxManuallyEdited.set(true);
  }

  addLineItem() {
    this.items.update(list => [...list, { description: '', quantity: 1, unitCents: 0, lineTotalCents: 0 }]);
  }

  updateItemDescription(index: number, description: string) {
    this.items.update(list => list.map((it, i) => i === index ? { ...it, description } : it));
    this.maybeAutoTax();
  }

  updateItemAmount(index: number, amountStr: string) {
    const cents = Math.round(parseFloat(amountStr || '0') * 100);
    this.items.update(list => list.map((it, i) => i === index ? { ...it, lineTotalCents: cents } : it));
    this.maybeAutoTax();
  }

  removeItem(index: number) {
    this.items.update(list => list.filter((_, i) => i !== index));
    this.maybeAutoTax();
  }

  private maybeAutoTax() {
    if (this.taxManuallyEdited()) return;
    const rate = this.orderingSettings().defaultTaxRatePercent || 0;
    // Compute the correct tax in real cents first (matching po-form's
    // pattern), then convert to the dollar value formTaxCents holds.
    const taxCents = Math.round(this.subtotalCents() * rate / 100);
    this.formTaxCents.set(taxCents / 100);
  }

  private computeStatus(totalCents: number, amountPaidCents: number): BillStatus {
    const balance = totalCents - amountPaidCents;
    if (balance <= 0 && totalCents > 0) return 'paid';
    if (amountPaidCents > 0) return 'partial';
    return 'unpaid';
  }

  async saveBill() {
    if (!this.formSupplierId()) {
      this.toast.error('Please select a supplier');
      return;
    }
    if (this.items().length === 0) {
      this.toast.error('Please add at least one line item');
      return;
    }

    this.isSaving.set(true);
    try {
      const supplier = this.suppliers().find(s => s.id === this.formSupplierId());
      const billDate = dateInputToLocalDate(this.formBillDate()) ?? new Date();
      const dueDate = this.formDueDate() ? dateInputToLocalDate(this.formDueDate()) : null;

      const billData: Partial<Bill> = {
        supplierId: this.formSupplierId(),
        supplierName: supplier?.displayName || '',
        billDate,
        dueDate,
        lineItems: this.items(),
        subtotalCents: this.subtotalCents(),
        taxCents: this.taxCents(),
        totalCents: this.totalCents(),
        notes: this.formNotes().trim(),
        ...(this.linkedPurchaseOrderId() && {
          linkedPurchaseOrderId: this.linkedPurchaseOrderId(),
          linkedPurchaseOrderNumber: this.linkedPurchaseOrderNumber(),
        }),
      };

      if (this.isEditing() && this.billId && this.existingBill) {
        const amountPaidCents = this.existingBill.amountPaidCents || 0;
        const balanceCents = Math.max(0, this.totalCents() - amountPaidCents);
        await this.firestore.updateDocument(`bills/${this.billId}`, {
          ...billData,
          balanceCents,
          status: this.computeStatus(this.totalCents(), amountPaidCents),
        });
        this.toast.success('Bill updated');
        this.router.navigate(['/admin/bills', this.billId]);
      } else {
        const billNumber = await this.settings.getNextBillNumber();
        const newBill = {
          ...billData,
          billNumber,
          status: 'unpaid' as BillStatus,
          amountPaidCents: 0,
          balanceCents: this.totalCents(),
          tenantId: TENANT_ID,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: this.auth.getActionBy(),
        };
        const ref = await this.firestore.addDocument('bills', newBill);
        this.toast.success(`Bill ${billNumber} created`);
        this.router.navigate(['/admin/bills', ref.id]);
      }
    } catch (err) {
      console.error('Error saving bill', err);
      this.toast.error('Failed to save bill');
    } finally {
      this.isSaving.set(false);
    }
  }

  formatCurrencyInput(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
