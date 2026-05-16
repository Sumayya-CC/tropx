import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Order, OrderItem, OrderSource, OrderStatus, PaymentStatus, DeliveryType } from '../../../../core/models/order.model';
import { Customer } from '../../../../core/models/customer.model';
import { Product } from '../../../../core/models/product.model';
import { SearchableSelectComponent, SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { where, serverTimestamp, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';

@Component({
  selector: 'app-order-form',
  standalone: true,
  imports: [CommonModule, SearchableSelectComponent, PageHeaderComponent, LoadingSpinnerComponent],
  templateUrl: './order-form.component.html',
  styleUrls: ['./order-form.component.scss']
})
export class OrderFormComponent {
  protected readonly firestore = inject(FirestoreService);
  protected readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  protected readonly router = inject(Router);

  // State
  isSaving = signal(false);
  showProductPicker = signal(false);
  selectedCustomer = signal<Customer | null>(null);
  items = signal<OrderItem[]>([]);
  discountCents = signal(0);
  taxRatePercent = signal(13);
  deliveryType = signal<DeliveryType>('delivery');
  expectedDeliveryDate = signal<string>('');
  customerNotes = signal('');
  internalNotes = signal('');

  // Data
  private customers$ = this.firestore.getCollection<Customer>(
    'customers',
    where('status', '==', 'active')
  );
  private products$ = this.firestore.getCollection<Product>(
    'products',
    where('active', '==', true)
  );

  private allCustomers = toSignal(this.customers$, { initialValue: [] });
  private allProducts = toSignal(this.products$, { initialValue: [] });

  // Computed
  customerOptions = computed(() => {
    return this.allCustomers()
      .filter(c => !c.isDeleted)
      .map(c => ({
        value: c.id,
        label: c.businessName,
        sublabel: c.ownerName,
        meta: c.phone
      }));
  });

  productOptions = computed(() => {
    return this.allProducts()
      .filter(p => !p.isDeleted)
      .map(p => ({
        value: p.id,
        label: p.name,
        sublabel: p.sku,
        meta: `${this.formatCurrency(p.priceCents)} · Stock: ${p.stock}`
      }));
  });

  productStockMap = computed(() => {
    const map: Record<string, number> = {};
    this.allProducts().forEach(p => map[p.id] = p.stock);
    return map;
  });

  subtotalCents = computed(() => {
    return this.items().reduce((sum, item) => sum + item.lineTotalCents, 0);
  });

  taxCents = computed(() => {
    const taxable = this.subtotalCents() - this.discountCents();
    return Math.round(taxable * (this.taxRatePercent() / 100));
  });

  totalCents = computed(() => {
    return this.subtotalCents() - this.discountCents() + this.taxCents();
  });

  // Handlers
  onCustomerSelected(option: SearchableSelectOption) {
    const customer = this.allCustomers().find(c => c.id === option.value);
    if (customer) {
      this.selectedCustomer.set(customer);
    }
  }

  onProductSelected(option: SearchableSelectOption) {
    const product = this.allProducts().find(p => p.id === option.value);
    if (product) {
      const existing = this.items().find(i => i.productId === product.id);
      if (existing) {
        this.updateItemQuantity(existing, { target: { value: existing.quantity + 1 } } as any);
      } else {
        const newItem: OrderItem = {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          quantity: 1,
          unitPriceCents: product.priceCents,
          unitCostCents: product.costCents,
          lineTotalCents: product.priceCents,
          lineCostCents: product.costCents,
          currencyCode: 'CAD'
        };
        this.items.update(current => [...current, newItem]);
      }
    }
    this.showProductPicker.set(false);
  }

  updateItemQuantity(item: OrderItem, event: Event) {
    const qty = parseInt((event.target as HTMLInputElement).value) || 0;
    this.items.update(current => current.map(i => {
      if (i.productId === item.productId) {
        return {
          ...i,
          quantity: qty,
          lineTotalCents: qty * i.unitPriceCents,
          lineCostCents: qty * i.unitCostCents
        };
      }
      return i;
    }));
  }

  updateItemPrice(item: OrderItem, event: Event) {
    const price = Math.round(parseFloat((event.target as HTMLInputElement).value) * 100) || 0;
    this.items.update(current => current.map(i => {
      if (i.productId === item.productId) {
        return {
          ...i,
          unitPriceCents: price,
          lineTotalCents: i.quantity * price
        };
      }
      return i;
    }));
  }

  removeItem(productId: string) {
    this.items.update(current => current.filter(i => i.productId !== productId));
  }

  onDiscountChange(event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value) || 0;
    this.discountCents.set(Math.round(val * 100));
  }

  onTaxRateChange(event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value) || 0;
    this.taxRatePercent.set(val);
  }

  onDateChange(event: Event) {
    this.expectedDeliveryDate.set((event.target as HTMLInputElement).value);
  }

  async saveOrder() {
    const customer = this.selectedCustomer();
    const items = this.items();
    const actionBy = this.auth.getActionBy();

    if (!customer || items.length === 0 || !actionBy) {
      this.toast.error('Please select a customer and add at least one item.');
      return;
    }

    if (items.some(i => i.quantity <= 0)) {
      this.toast.error('All items must have a quantity greater than 0.');
      return;
    }

    this.isSaving.set(true);

    try {
      await this.firestore.runBatch(async (batch, db) => {
        const { collection, doc } = await import('@angular/fire/firestore');
        
        // 1. Generate Order Number
        const seqRef = doc(db, 'settings/orderSequence');
        const seqSnap = await getDoc(seqRef);
        
        let lastNumber = 0;
        let prefix = 'TRX';
        
        if (seqSnap.exists()) {
          const data = seqSnap.data();
          lastNumber = data['lastNumber'] || 0;
          prefix = data['prefix'] || 'TRX';
        } else {
          // Initialize if not exists
          batch.set(seqRef, { lastNumber: 0, prefix: 'TRX' });
        }

        const newNumber = lastNumber + 1;
        const year = new Date().getFullYear();
        const orderNumber = `${prefix}-${year}-${newNumber.toString().padStart(4, '0')}`;

        // Update sequence
        batch.update(seqRef, { lastNumber: newNumber });

        // 2. Build Order Doc
        const newOrderRef = doc(collection(db, 'orders'));

        const totalCostCents = items.reduce((sum, i) => sum + i.lineCostCents, 0);
        
        const orderData: Order = {
          id: newOrderRef.id,
          orderNumber,
          customerId: customer.id,
          customerName: customer.businessName,
          customerPhone: customer.phone,
          serviceAreaId: customer.serviceAreaId,
          serviceAreaName: customer.serviceAreaCustom,
          items,
          subtotalCents: this.subtotalCents(),
          taxRatePercent: this.taxRatePercent(),
          taxCents: this.taxCents(),
          discountCents: this.discountCents(),
          totalCents: this.totalCents(),
          currencyCode: 'CAD',
          totalCostCents,
          marginCents: this.totalCents() - totalCostCents,
          status: 'confirmed',
          paymentStatus: 'unpaid',
          amountPaidCents: 0,
          balanceCents: this.totalCents(),
          source: 'admin_created',
          deliveryType: this.deliveryType(),
          customerNotes: this.customerNotes(),
          internalNotes: this.internalNotes(),
          expectedDeliveryDate: this.expectedDeliveryDate() ? new Date(this.expectedDeliveryDate()) : null,
          confirmedAt: serverTimestamp(),
          confirmedBy: actionBy,
          tenantId: 1,
          createdAt: serverTimestamp(),
          createdBy: actionBy,
          isDeleted: false
        };

        batch.set(newOrderRef, orderData);

        // 3. Update Customer Doc
        const customerRef = doc(db, `customers/${customer.id}`);
        batch.update(customerRef, {
          totalOrderedCents: (customer.totalOrderedCents || 0) + orderData.totalCents,
          totalOwingCents: (customer.totalOwingCents || 0) + orderData.totalCents,
          lastOrderAt: serverTimestamp()
        });

        // Store ID for navigation
        (this as any)._newOrderId = newOrderRef.id;
        (this as any)._newOrderNumber = orderNumber;
      });

      this.toast.success(`Order ${(this as any)._newOrderNumber} created successfully`);
      this.router.navigate(['/admin/orders', (this as any)._newOrderId]);

    } catch (error: any) {
      console.error('Error saving order:', error);
      this.toast.error('Failed to create order. Please try again.');
    } finally {
      this.isSaving.set(false);
    }
  }

  // Utils
  formatCurrency(cents: number) {
    return centsToDisplay(cents);
  }
}
