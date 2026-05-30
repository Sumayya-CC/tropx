import { Component, inject, signal, computed, output, input, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { Product } from '../../../../core/models/product.model';
import { StockAdjustment, AdjustmentType, ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_TYPE_DIRECTION } from '../../../../core/models/stock-adjustment.model';
import { where, serverTimestamp, doc, collection } from '@angular/fire/firestore';
import { TENANT_ID } from '../../../../core/config/tenant.config';
import { SearchableSelectComponent, SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';

@Component({
  selector: 'app-stock-adjustment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingSpinnerComponent, SearchableSelectComponent],
  templateUrl: './stock-adjustment-modal.component.html',
  styleUrl: './stock-adjustment-modal.component.scss'
})
export class StockAdjustmentModalComponent implements OnInit {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // Inputs
  productId = input<string | undefined>();

  // Outputs
  closed = output<boolean>();

  // State
  isSaving = signal(false);
  isLoadingProduct = signal(false);
  product = signal<Product | null>(null);
  
  allProducts = signal<Product[]>([]);
  
  productOptions = computed<SearchableSelectOption[]>(() => 
    this.allProducts().map(p => ({
      value: p.id,
      label: p.name,
      sublabel: p.sku,
      imageUrl: p.imageUrl || undefined,
      meta: `Stock: ${p.stock}`
    }))
  );

  // Form fields
  type = signal<AdjustmentType>('received');
  quantity = signal<number | null>(null);
  direction = signal<'in' | 'out'>('in'); // Only for 'correction'
  reason = signal('');
  notes = signal('');

  // Constants
  adjustmentTypes = Object.entries(ADJUSTMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

  // Computed
  showDirectionToggle = computed(() => this.type() === 'correction');
  
  effectiveDirection = computed(() => {
    const type = this.type();
    const dir = ADJUSTMENT_TYPE_DIRECTION[type];
    if (dir === 'either') return this.direction();
    return dir;
  });

  newStock = computed(() => {
    const current = this.product()?.stock ?? 0;
    const qty = this.quantity() ?? 0;
    const dir = this.effectiveDirection();
    return dir === 'in' ? current + qty : current - qty;
  });

  isValid = computed(() => {
    const qty = this.quantity() ?? 0;
    const hasProduct = !!this.product();
    const hasReason = this.reason().trim().length > 0;
    const positiveQty = qty > 0;
    const noNegativeStock = this.newStock() >= 0;
    return hasProduct && hasReason && positiveQty && noNegativeStock;
  });

  // Multi-product mode (when no productId input)
  multiItems = signal<{
    product: Product;
    quantity: number;
    direction: 'in' | 'out';
  }[]>([]);

  selectedProductForAdd = signal<Product | null>(null);
  pendingQty = signal<number | null>(null);
  pendingDirection = signal<'in' | 'out'>('in');

  isMultiMode = computed(() => !this.productId());

  // For multi mode: shared reason/type/notes
  // (type and reason apply to all items)

  multiTotal = computed(() =>
    this.multiItems().length
  );

  multiIsValid = computed(() => {
    if (!this.isMultiMode()) return false;
    return this.multiItems().length > 0 &&
      this.reason().trim().length > 0;
  });

  addItemToMulti() {
    const p = this.selectedProductForAdd();
    const qty = this.pendingQty();
    if (!p || !qty || qty <= 0) return;

    // Check stock for out direction
    if (this.pendingDirection() === 'out' ||
        (this.effectivePendingDirection() === 'out')) {
      const newStk = p.stock - qty;
      if (newStk < 0) {
        this.toast.error(
          `${p.name}: cannot reduce below 0`
        );
        return;
      }
    }

    // Check if already in list — update qty instead
    const existing = this.multiItems()
      .findIndex(i => i.product.id === p.id);

    if (existing >= 0) {
      this.multiItems.update(items =>
        items.map((item, idx) =>
          idx === existing
            ? { ...item,
                quantity: qty,
                direction: this.pendingDirection()
              }
            : item
        )
      );
    } else {
      this.multiItems.update(items => [
        ...items,
        {
          product: p,
          quantity: qty,
          direction: this.pendingDirection(),
        }
      ]);
    }

    // Reset pending
    this.selectedProductForAdd.set(null);
    this.pendingQty.set(null);
  }

  removeMultiItem(index: number) {
    this.multiItems.update(items =>
      items.filter((_, i) => i !== index)
    );
  }

  updateMultiItemQty(index: number, qty: number) {
    this.multiItems.update(items =>
      items.map((item, i) =>
        i === index ? { ...item, quantity: qty } : item
      )
    );
  }

  effectivePendingDirection = computed(() => {
    const t = this.type();
    const dir = ADJUSTMENT_TYPE_DIRECTION[t];
    if (dir === 'either') return this.pendingDirection();
    return dir as 'in' | 'out';
  });

  onProductSelectedForMulti(
    option: SearchableSelectOption
  ) {
    const p = this.allProducts()
      .find(p => p.id === option.value);
    if (p) {
      this.selectedProductForAdd.set(p);
      this.pendingQty.set(1);
    }
  }

  constructor() {
    effect(() => {
      const id = this.productId();
      if (id) {
        this.loadProduct(id);
      }
    });
  }

  ngOnInit() {
    if (!this.productId()) {
      this.loadAllProducts();
    }
  }

  loadAllProducts() {
    this.firestore.getCollection<Product>('products', 
      where('tenantId', '==', TENANT_ID),
      where('isDeleted', '==', false)
    ).subscribe((products: Product[]) => {
      const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
      this.allProducts.set(sorted);
    });
  }

  async loadProduct(id: string) {
    this.isLoadingProduct.set(true);
    this.firestore.getDocument<Product>(`products/${id}`).subscribe((p: Product | null) => {
      this.product.set(p);
      this.isLoadingProduct.set(false);
    });
  }

  onProductSelected(option: SearchableSelectOption) {
    const p = this.allProducts().find(p => p.id === option.value);
    if (p) {
      this.product.set(p);
    }
  }

  clearProduct() {
    if (this.productId()) return; // Locked
    this.product.set(null);
  }

  adjustQuantity(amount: number) {
    const current = this.quantity() ?? 0;
    const newVal = Math.max(0, current + amount);
    this.quantity.set(newVal === 0 ? null : newVal);
  }

  cancel() {
    this.closed.emit(false);
  }

  async save() {
    if (this.isMultiMode()) {
      await this.saveMulti();
    } else {
      await this.saveSingle();
    }
  }

  private async saveSingle() {
    if (!this.isValid()) {
      if ((this.quantity() ?? 0) <= 0) this.toast.warning('Quantity must be at least 1');
      else if (this.newStock() < 0) this.toast.error('Cannot reduce stock below 0');
      else if (!this.reason().trim()) this.toast.warning('Please provide a reason');
      return;
    }

    const p = this.product()!;
    const actionBy = this.auth.getActionBy();
    if (!actionBy) {
      this.toast.error('User session not found');
      return;
    }

    this.isSaving.set(true);

    try {
      await this.firestore.runBatch(async (batch, db) => {
        const adjustmentRef = doc(collection(db, 'stockAdjustments'));
        const productRef = doc(db, `products/${p.id}`);

        const adjustment: Omit<StockAdjustment, 'id'> = {
          productId: p.id,
          productName: p.name,
          productSku: p.sku,
          type: this.type(),
          quantity: (this.effectiveDirection() === 'in' ? 1 : -1) * this.quantity()!,
          previousStock: p.stock,
          newStock: this.newStock(),
          reason: this.reason().trim(),
          notes: this.notes().trim(),
          adjustedBy: actionBy,
          createdAt: serverTimestamp(),
          tenantId: TENANT_ID,
          isDeleted: false
        };

        batch.set(adjustmentRef, adjustment);
        batch.update(productRef, { stock: this.newStock(), updatedAt: serverTimestamp() });
      });

      this.toast.success('Stock adjusted successfully');
      this.closed.emit(true);
    } catch (e) {
      console.error('Adjustment error', e);
      this.toast.error('Failed to save adjustment');
    } finally {
      this.isSaving.set(false);
    }
  }

  private async saveMulti() {
    if (!this.multiIsValid()) {
      if (this.multiItems().length === 0) {
        this.toast.warning(
          'Add at least one product'
        );
      } else if (!this.reason().trim()) {
        this.toast.warning('Please provide a reason');
      }
      return;
    }

    const actionBy = this.auth.getActionBy();
    if (!actionBy) {
      this.toast.error('User session not found');
      return;
    }

    this.isSaving.set(true);

    try {
      await this.firestore.runBatch(
        async (batch, db) => {
          for (const item of this.multiItems()) {
            const p = item.product;
            const dir = item.direction;
            const qty = item.quantity;
            const newStock = dir === 'in'
              ? p.stock + qty
              : p.stock - qty;

            const adjustmentRef =
              doc(collection(db, 'stockAdjustments'));
            const productRef =
              doc(db, `products/${p.id}`);

            batch.set(adjustmentRef, {
              productId: p.id,
              productName: p.name,
              productSku: p.sku,
              type: this.type(),
              quantity: dir === 'in' ? qty : -qty,
              previousStock: p.stock,
              newStock,
              reason: this.reason().trim(),
              notes: this.notes().trim(),
              adjustedBy: actionBy,
              createdAt: serverTimestamp(),
              tenantId: TENANT_ID,
              isDeleted: false,
            });

            batch.update(productRef, {
              stock: newStock,
              updatedAt: serverTimestamp(),
            });
          }
        }
      );

      const count = this.multiItems().length;
      this.toast.success(
        `${count} product${count > 1 ? 's' : ''} adjusted successfully`
      );
      this.closed.emit(true);
    } catch (e) {
      console.error('Multi adjustment error', e);
      this.toast.error('Failed to save adjustments');
    } finally {
      this.isSaving.set(false);
    }
  }
}
