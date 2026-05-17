import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
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
  imports: [CommonModule, SearchableSelectComponent, PageHeaderComponent, LoadingSpinnerComponent, DatePipe, RouterModule],
  templateUrl: './order-form.component.html',
  styleUrls: ['./order-form.component.scss']
})
export class OrderFormComponent {
  protected readonly firestore = inject(FirestoreService);
  protected readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  protected readonly router = inject(Router);
  protected readonly route = inject(ActivatedRoute);

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

  // Edit/Draft State
  isEditMode = signal(false);
  editOrderId = signal<string | null>(null);
  isLoadingOrder = signal(false);
  originalOrder = signal<Order | null>(null);
  hasSavedDraft = signal(false);
  savedDraftData = signal<any>(null);

  // Data
  private customers$ = this.firestore.getCollection<Customer>(
    'customers',
    where('status', '==', 'active')
  );
  private products$ = this.firestore.getCollection<Product>(
    'products',
    where('active', '==', true)
  );
  private serviceAreas$ = this.firestore.getCollection<any>(
    'serviceAreas',
    where('tenantId', '==', 1),
    where('isDeleted', '==', false)
  );

  private allCustomers = toSignal(this.customers$, { initialValue: [] });
  private allProducts = toSignal(this.products$, { initialValue: [] });
  private allServiceAreas = toSignal(this.serviceAreas$, { initialValue: [] });

  constructor() {
    // 1. Check for Edit Mode
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.editOrderId.set(id);
      this.loadOrderForEdit(id);
    }

    // 2. Check for Reorder Draft (only if not edit mode)
    const reorderDraft = localStorage.getItem('tropx_reorder_draft');
    if (reorderDraft && !this.isEditMode()) {
      try {
        const draft = JSON.parse(reorderDraft);
        localStorage.removeItem('tropx_reorder_draft');
        
        this.items.set(draft.items || []);
        this.taxRatePercent.set(draft.taxRatePercent || 13);
        this.deliveryType.set(draft.deliveryType || 'delivery');
        
        this.toast.success(`Items pre-filled from ${draft.sourceOrderNumber}`);
        
        const checkCustomer = () => {
          const customers = this.allCustomers();
          if (customers.length > 0) {
            const c = customers.find(x => x.id === draft.customerId);
            if (c) this.selectedCustomer.set(c);
          } else {
            setTimeout(checkCustomer, 200);
          }
        };
        setTimeout(checkCustomer, 300);
      } catch (e) {
        localStorage.removeItem('tropx_reorder_draft');
      }
    }

    // 3. Check for regular Draft (if no reorder draft and not edit mode)
    const savedDraft = localStorage.getItem('tropx_order_draft');
    if (savedDraft && !reorderDraft && !this.isEditMode()) {
      try {
        const draft = JSON.parse(savedDraft);
        const savedAt = new Date(draft.savedAt);
        const hoursSince = (Date.now() - savedAt.getTime()) / (1000 * 3600);
        
        if (hoursSince < 24) {
          this.hasSavedDraft.set(true);
          this.savedDraftData.set(draft);
        } else {
          localStorage.removeItem('tropx_order_draft');
        }
      } catch (e) {
        localStorage.removeItem('tropx_order_draft');
      }
    }

    // 4. Auto-save Draft (only if not edit mode)
    effect(() => {
      if (this.isEditMode()) return;
      
      const customer = this.selectedCustomer();
      const items = this.items();
      
      if (!customer && items.length === 0) return;
      
      const draft = {
        customerId: customer?.id,
        customerSnapshot: customer ? {
          id: customer.id,
          businessName: customer.businessName,
          phone: customer.phone,
          totalOwingCents: customer.totalOwingCents,
          serviceAreaCustom: customer.serviceAreaCustom,
          address: customer.address,
        } : null,
        items: items,
        discountCents: this.discountCents(),
        taxRatePercent: this.taxRatePercent(),
        deliveryType: this.deliveryType(),
        expectedDeliveryDate: this.expectedDeliveryDate(),
        customerNotes: this.customerNotes(),
        internalNotes: this.internalNotes(),
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('tropx_order_draft', JSON.stringify(draft));
    });
  }

  private loadOrderForEdit(id: string) {
    this.isLoadingOrder.set(true);
    this.firestore.getDocument<Order>(`orders/${id}`).subscribe(order => {
      if (!order || order.isDeleted) {
        this.toast.error('Order not found');
        this.router.navigate(['/admin/orders']);
        return;
      }
      if (order.status !== 'confirmed') {
        this.toast.error('Only confirmed orders can be edited');
        this.router.navigate(['/admin/orders', id]);
        return;
      }
      
      this.originalOrder.set(order);
      
      const customerFromOrder: any = {
        id: order.customerId,
        businessName: order.customerName,
        phone: order.customerPhone,
        serviceAreaId: order.serviceAreaId,
        serviceAreaCustom: order.serviceAreaName,
        totalOwingCents: 0,
        address: { city: '', province: '' }
      };
      this.selectedCustomer.set(customerFromOrder);
      this.items.set(order.items);
      this.discountCents.set(order.discountCents || 0);
      this.taxRatePercent.set(order.taxRatePercent || 13);
      this.deliveryType.set(order.deliveryType || 'delivery');
      this.customerNotes.set(order.customerNotes || '');
      this.internalNotes.set(order.internalNotes || '');
      
      if (order.expectedDeliveryDate) {
        const d = (order.expectedDeliveryDate as any).toDate ? (order.expectedDeliveryDate as any).toDate() : new Date(order.expectedDeliveryDate as any);
        this.expectedDeliveryDate.set(d.toISOString().split('T')[0]);
      }
      
      this.isLoadingOrder.set(false);
    });
  }

  restoreDraft() {
    const draft = this.savedDraftData();
    if (!draft) return;
    
    this.items.set(draft.items || []);
    this.discountCents.set(draft.discountCents || 0);
    this.taxRatePercent.set(draft.taxRatePercent || 13);
    this.deliveryType.set(draft.deliveryType || 'delivery');
    this.expectedDeliveryDate.set(draft.expectedDeliveryDate || '');
    this.customerNotes.set(draft.customerNotes || '');
    this.internalNotes.set(draft.internalNotes || '');
    
    if (draft.customerSnapshot) {
      this.selectedCustomer.set(draft.customerSnapshot);
    }
    
    this.hasSavedDraft.set(false);
    this.savedDraftData.set(null);
    this.toast.success('Draft restored');
  }

  discardDraft() {
    localStorage.removeItem('tropx_order_draft');
    this.hasSavedDraft.set(false);
    this.savedDraftData.set(null);
  }
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

  getAvailableStock(item: OrderItem): number {
    const currentStock = this.productStockMap()[item.productId] ?? 0;
    
    if (this.isEditMode() && this.originalOrder()) {
      const originalItem = this.originalOrder()!.items
        .find(i => i.productId === item.productId);
      const originalQty = originalItem?.quantity || 0;
      // Stock already has originalQty deducted,
      // so effective available = currentStock + originalQty
      return currentStock + originalQty;
    }
    return currentStock;
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

    if (this.isEditMode()) {
      await this.saveEditedOrder();
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
          customerPhone: customer.phone ?? null,
          serviceAreaId: customer.serviceAreaId ?? null,
          serviceAreaName: this.getServiceAreaName(customer) || null,
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
          customerNotes: this.customerNotes() || null,
          internalNotes: this.internalNotes() || null,
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

        // 4. Deduct stock for each item
        for (const item of items) {
          const productRef = doc(db, `products/${item.productId}`);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const productData = productSnap.data();
            const currentStock = productData['stock'] || 0;
            const newStock = Math.max(0, currentStock - item.quantity);
            
            // Update product stock
            batch.update(productRef, { stock: newStock });
            
            // Create stock adjustment record
            const adjustRef = doc(collection(db, 'stockAdjustments'));
            batch.set(adjustRef, {
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              type: 'sold',
              quantity: -item.quantity,
              previousStock: currentStock,
              newStock,
              reason: `Order ${orderNumber}`,
              notes: null,
              adjustedBy: actionBy,
              createdAt: serverTimestamp(),
              tenantId: 1,
              isDeleted: false,
              linkedOrderId: newOrderRef.id,
              linkedOrderNumber: orderNumber,
            });
          }
        }

        // Store ID for navigation
        (this as any)._newOrderId = newOrderRef.id;
        (this as any)._newOrderNumber = orderNumber;
      });

      localStorage.removeItem('tropx_order_draft');
      this.toast.success(`Order ${(this as any)._newOrderNumber} created successfully`);
      this.router.navigate(['/admin/orders', (this as any)._newOrderId]);

    } catch (error: any) {
      console.error('Error saving order:', error);
      this.toast.error('Failed to create order. Please try again.');
    } finally {
      this.isSaving.set(false);
    }
  }

  private async saveEditedOrder() {
    const order = this.originalOrder();
    const items = this.items();
    const actionBy = this.auth.getActionBy();
    
    if (!order || !actionBy) return;

    this.isSaving.set(true);

    try {
      const totalCostCents = items.reduce((sum, i) => sum + i.lineCostCents, 0);
      const subtotal = this.subtotalCents();
      const tax = this.taxCents();
      const discount = this.discountCents();
      const total = this.totalCents();
      
      const totalDiff = total - order.totalCents;

      await this.firestore.runBatch(async (batch, db) => {
        const { doc, getDoc, collection } = await import('@angular/fire/firestore');
        
        const orderRef = doc(db, `orders/${order.id}`);
        batch.update(orderRef, {
          items,
          subtotalCents: subtotal,
          taxRatePercent: this.taxRatePercent(),
          taxCents: tax,
          discountCents: discount,
          totalCents: total,
          totalCostCents,
          marginCents: total - totalCostCents,
          balanceCents: total - (order.amountPaidCents || 0),
          deliveryType: this.deliveryType(),
          customerNotes: this.customerNotes() || null,
          internalNotes: this.internalNotes() || null,
          expectedDeliveryDate: this.expectedDeliveryDate() ? new Date(this.expectedDeliveryDate()) : null,
          updatedAt: serverTimestamp(),
          updatedBy: actionBy,
        });

        if (totalDiff !== 0) {
          const customerRef = doc(db, `customers/${order.customerId}`);
          const customerSnap = await getDoc(customerRef);
          if (customerSnap.exists()) {
            const cd = customerSnap.data();
            batch.update(customerRef, {
              totalOrderedCents: Math.max(0, (cd['totalOrderedCents'] || 0) + totalDiff),
              totalOwingCents: Math.max(0, (cd['totalOwingCents'] || 0) + totalDiff),
            });
          }
        }

        // 3. Adjust stock for item changes
        const originalItems = order.items;
        const newItems = items;

        // Build maps for easy lookup
        const originalMap: Record<string, number> = {};
        for (const item of originalItems) {
          originalMap[item.productId] = item.quantity;
        }
        const newMap: Record<string, number> = {};
        for (const item of newItems) {
          newMap[item.productId] = item.quantity;
        }

        // All product IDs involved
        const allProductIds = new Set([
          ...Object.keys(originalMap),
          ...Object.keys(newMap)
        ]);

        for (const productId of allProductIds) {
          const originalQty = originalMap[productId] || 0;
          const newQty = newMap[productId] || 0;
          const diff = newQty - originalQty;
          
          if (diff === 0) continue; // No change
          
          const productRef = doc(db, `products/${productId}`);
          const productSnap = await getDoc(productRef);
          if (!productSnap.exists()) continue;
          
          const productData = productSnap.data();
          const currentStock = productData['stock'] || 0;
          // diff > 0 means more ordered = deduct more
          // diff < 0 means less ordered = restore some
          const newStock = Math.max(0, currentStock - diff);
          
          batch.update(productRef, { stock: newStock });
          
          // Find item name for snapshot
          const itemSnapshot = newItems.find(
            i => i.productId === productId
          ) || originalItems.find(i => i.productId === productId);
          
          const adjustRef = doc(collection(db, 'stockAdjustments'));
          batch.set(adjustRef, {
            productId,
            productName: itemSnapshot?.productName || productId,
            productSku: itemSnapshot?.productSku || '',
            type: diff > 0 ? 'sold' : 'returned',
            quantity: -diff,  // negative if sold, positive if returned
            previousStock: currentStock,
            newStock,
            reason: `Order ${order.orderNumber} edited`,
            notes: `Quantity changed from ${originalQty} to ${newQty}`,
            adjustedBy: actionBy,
            createdAt: serverTimestamp(),
            tenantId: 1,
            isDeleted: false,
            linkedOrderId: order.id,
            linkedOrderNumber: order.orderNumber,
          });
        }
      });

      this.toast.success('Order updated successfully');
      this.router.navigate(['/admin/orders', order.id]);
    } catch (error) {
      console.error('Error updating order:', error);
      this.toast.error('Failed to update order.');
    } finally {
      this.isSaving.set(false);
    }
  }

  // Utils
  formatCurrency(cents: number) {
    return centsToDisplay(cents);
  }

  getServiceAreaName(customer: Customer): string {
    if (customer.serviceAreaCustom) {
      return customer.serviceAreaCustom;
    }
    if (customer.serviceAreaId) {
      const sa = this.allServiceAreas().find(
        s => s.id === customer.serviceAreaId
      );
      return sa?.name || '';
    }
    return '';
  }
}
