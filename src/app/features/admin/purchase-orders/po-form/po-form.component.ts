import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { PurchaseOrder, PurchaseOrderItem } from '../../../../core/models/purchase-order.model';
import { Supplier } from '../../../../core/models/supplier.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { serverTimestamp, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-po-form',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent],
  templateUrl: './po-form.component.html',
  styleUrl: './po-form.component.scss'
})
export class PoFormComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  isEditing = signal(false);
  isSaving = signal(false);
  poId = this.route.snapshot.paramMap.get('id');

  inventorySettings = this.settings.inventory;
  orderingSettings = this.settings.ordering;

  // Data lookups
  private suppliers$ = this.firestore.getCollection<Supplier>('suppliers', where('tenantId', '==', 1), where('isDeleted', '==', false), where('active', '==', true));
  suppliers = toSignal(this.suppliers$, { initialValue: [] as Supplier[] });

  private products$ = this.firestore.getCollection<any>('products', where('tenantId', '==', 1), where('isDeleted', '==', false), where('active', '==', true));
  allProducts = toSignal(this.products$, { initialValue: [] as any[] });

  private warehouses$ = this.firestore.getCollection<any>('warehouses', where('tenantId', '==', 1), where('isDeleted', '==', false), where('active', '==', true));
  warehouses = toSignal(this.warehouses$, { initialValue: [] as any[] });

  // Form State
  formSupplierId = signal('');
  formWarehouseId = signal('');
  formOrderDate = signal(new Date().toISOString().split('T')[0]);
  formExpectedDate = signal('');
  formNotes = signal('');
  formTaxRate = signal(0);
  
  items = signal<PurchaseOrderItem[]>([]);

  // Computed Totals
  subtotalCents = computed(() => this.items().reduce((sum, item) => sum + item.lineTotalCents, 0));
  taxCents = computed(() => Math.round(this.subtotalCents() * this.formTaxRate() / 100));
  totalCents = computed(() => this.subtotalCents() + this.taxCents());

  constructor() {
    this.formTaxRate.set(this.orderingSettings().defaultTaxRatePercent || 13);
    
    if (this.poId) {
      this.isEditing.set(true);
      this.loadPo();
    } else {
      // Setup defaults for new PO
      setTimeout(() => {
        if (!this.inventorySettings().multiWarehouseEnabled) {
          this.formWarehouseId.set(this.inventorySettings().defaultWarehouseId);
        }
      });
    }
  }

  private loadPo() {
    if (!this.poId) return;
    this.firestore.getDocument<PurchaseOrder>(`purchaseOrders/${this.poId}`).subscribe(po => {
      if (po) {
        this.formSupplierId.set(po.supplierId);
        this.formWarehouseId.set(po.warehouseId);
        this.formOrderDate.set(this.formatDateForInput(po.orderDate));
        this.formExpectedDate.set(po.expectedDate ? this.formatDateForInput(po.expectedDate) : '');
        this.formNotes.set(po.notes || '');
        this.formTaxRate.set(po.taxRatePercent);
        this.items.set(po.items || []);
      }
    });
  }

  private formatDateForInput(ts: any): string {
    if (!ts) return '';
    let d: Date;
    if (ts.toDate) d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  }

  addProduct(product: any) {
    if (!product) return;
    const current = this.items();
    const existingIdx = current.findIndex(i => i.productId === product.id);
    if (existingIdx >= 0) {
      // Just increment
      const updated = [...current];
      updated[existingIdx].quantityOrdered += 1;
      updated[existingIdx].lineTotalCents = updated[existingIdx].quantityOrdered * updated[existingIdx].unitCostCents;
      this.items.set(updated);
    } else {
      this.items.set([...current, {
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        quantityOrdered: 1,
        quantityReceived: 0,
        unitCostCents: product.costCents || 0,
        lineTotalCents: product.costCents || 0
      }]);
    }
  }

  updateItemQty(index: number, qty: number) {
    const updated = [...this.items()];
    updated[index].quantityOrdered = qty;
    updated[index].lineTotalCents = qty * updated[index].unitCostCents;
    this.items.set(updated);
  }

  updateItemCost(index: number, costStr: string) {
    const cost = Math.round(parseFloat(costStr || '0') * 100);
    const updated = [...this.items()];
    updated[index].unitCostCents = cost;
    updated[index].lineTotalCents = updated[index].quantityOrdered * cost;
    this.items.set(updated);
  }

  removeItem(index: number) {
    const updated = [...this.items()];
    updated.splice(index, 1);
    this.items.set(updated);
  }

  async savePo() {
    if (!this.formSupplierId()) {
      this.toast.error('Please select a supplier');
      return;
    }
    const invSettings = this.inventorySettings();
    let warehouseId = this.formWarehouseId();
    let warehouseName = invSettings.defaultWarehouseName;

    if (invSettings.multiWarehouseEnabled) {
      if (!warehouseId) {
        this.toast.error('Please select a warehouse');
        return;
      }
      warehouseName = this.warehouses().find(w => w.id === warehouseId)?.name || '';
    } else {
      warehouseId = invSettings.defaultWarehouseId;
    }

    if (this.items().length === 0) {
      this.toast.error('Please add at least one item');
      return;
    }

    if (this.formExpectedDate() && this.formOrderDate()) {
      if (this.formExpectedDate() < this.formOrderDate()) {
        this.toast.error('Expected date cannot be before the order date');
        return;
      }
    }

    this.isSaving.set(true);

    try {
      const supplier = this.suppliers().find(s => s.id === this.formSupplierId());
      
      const poData: Partial<PurchaseOrder> = {
        supplierId: this.formSupplierId(),
        supplierName: supplier?.displayName || '',
        warehouseId,
        warehouseName,
        items: this.items(),
        subtotalCents: this.subtotalCents(),
        taxRatePercent: this.formTaxRate(),
        taxCents: this.taxCents(),
        totalCents: this.totalCents(),
        orderDate: this.formOrderDate() ? new Date(this.formOrderDate() + 'T12:00:00Z') : serverTimestamp(),
        expectedDate: this.formExpectedDate() ? new Date(this.formExpectedDate() + 'T12:00:00Z') : null,
        notes: this.formNotes(),
      };

      if (this.isEditing() && this.poId) {
        await this.firestore.updateDocument(`purchaseOrders/${this.poId}`, poData);
        this.toast.success('Purchase Order updated');
        this.router.navigate(['/admin/purchase-orders', this.poId]);
      } else {
        const poNumber = await this.settings.getNextPoNumber();
        const newPo = {
          ...poData,
          poNumber,
          status: 'draft',
          tenantId: 1,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: this.auth.getActionBy(),
        };
        const ref = await this.firestore.addDocument('purchaseOrders', newPo);
        this.toast.success(`Purchase Order ${poNumber} created`);
        this.router.navigate(['/admin/purchase-orders', ref.id]);
      }
    } catch (err) {
      console.error('Error saving PO', err);
      this.toast.error('Failed to save Purchase Order');
    } finally {
      this.isSaving.set(false);
    }
  }

  formatCurrencyInput(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
