import { Injectable, inject, computed, signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { take } from 'rxjs/operators';
import { where } from '@angular/fire/firestore';
import { doc, getDoc, serverTimestamp, Firestore } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class PortalService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly settingsService = inject(SettingsService);

  // Customer identity from auth profile
  customerId = computed(() =>
    this.auth.currentProfile()?.linkedCustomerId ?? null
  );

  linkedCustomerId = computed(() =>
    this.auth.currentProfile()?.linkedCustomerId ?? null
  );

  customerProfile = computed(() =>
    this.auth.currentProfile()
  );

  businessName = computed(() => {
    const profile = this.auth.currentProfile() as any;
    return profile?.businessName ||
      `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`.trim() ||
      'My Account';
  });

  // ── DATA STREAMS ─────────────────────────────────────

  // My customer record
  private myCustomer$ = computed(() => {
    const id = this.customerId();
    if (!id) return null;
    return this.firestoreService
      .getDocument<any>(`customers/${id}`);
  });

  // Use a signal to hold customer data
  private _customerData = signal<any>(null);

  // Load customer doc reactively for credit balance
  private customerDoc$ = computed(() => {
    const id = this.customerId();
    if (!id) return of(null);
    return this.firestoreService
      .getDocument<any>(`customers/${id}`);
  });

  customerDoc = toSignal(
    toObservable(this.customerDoc$).pipe(
      switchMap(obs => obs ?? of(null))
    ),
    { initialValue: null as any }
  );

  creditBalanceCents = computed(() =>
    this.customerDoc()?.creditBalanceCents || 0
  );

  // My orders
  private myOrders$ = computed(() => {
    const id = this.customerId();
    if (!id) return of([] as any[]);
    return this.firestoreService.getCollection<any>(
      'orders',
      where('customerId', '==', id),
      where('tenantId', '==', 1)
    );
  });

  allOrders = toSignal(
    toObservable(this.myOrders$).pipe(
      switchMap(obs => obs ?? of([]))
    ),
    { initialValue: [] as any[] }
  );

  // My payments
  private myPayments$ = computed(() => {
    const id = this.customerId();
    if (!id) return of([] as any[]);
    return this.firestoreService.getCollection<any>(
      'payments',
      where('customerId', '==', id),
      where('tenantId', '==', 1)
    );
  });

  allPayments = toSignal(
    toObservable(this.myPayments$).pipe(
      switchMap(obs => obs ?? of([]))
    ),
    { initialValue: [] as any[] }
  );

  // My returns
  private myReturns$ = computed(() => {
    const id = this.customerId();
    if (!id) return of([] as any[]);
    return this.firestoreService.getCollection<any>(
      'returns',
      where('customerId', '==', id),
      where('tenantId', '==', 1)
    );
  });

  allReturns = toSignal(
    toObservable(this.myReturns$).pipe(
      switchMap(obs => obs ?? of([]))
    ),
    { initialValue: [] as any[] }
  );

  // All active products (no customer scope)
  private products$ = this.firestoreService
    .getCollection<any>(
      'products',
      where('tenantId', '==', 1),
      where('active', '==', true),
      where('isDeleted', '==', false)
    );

  allProducts = toSignal(this.products$,
    { initialValue: [] as any[] });

  // ── COMPUTED ─────────────────────────────────────────

  activeOrders = computed(() =>
    this.allOrders()
      .filter(o => !o.isDeleted)
      .sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at;
      })
  );

  activePayments = computed(() =>
    this.allPayments()
      .filter(p => !p.isDeleted)
      .sort((a, b) =>
        (b.receivedDate || '').localeCompare(
          a.receivedDate || ''
        )
      )
  );

  activeReturns = computed(() =>
    this.allReturns()
      .filter(r => !r.isDeleted)
      .sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at;
      })
  );

  totalOwingCents = computed(() => {
    return this.activeOrders()
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + (o.balanceCents || 0), 0);
  });

  pendingReturnsCount = computed(() =>
    this.activeReturns()
      .filter(r => r.status === 'pending')
      .length
  );

  recentOrders = computed(() =>
    this.activeOrders().slice(0, 5)
  );

  // ── CART (Firestore-persisted) ────────────────────────

  cartItems = signal<{
    productId: string;
    productName: string;
    productSku: string;
    priceCents: number;
    quantity: number;
    stock: number;
    imageUrl?: string;
    outOfStockBehaviorOverride?: 'hide' | 'show_disabled' | 'allow_backorder' | null;
  }[]>([]);

  cartCount = computed(() =>
    this.cartItems().reduce((sum, i) => sum + i.quantity, 0)
  );

  cartSubtotalCents = computed(() =>
    this.cartItems().reduce(
      (sum, i) => sum + i.priceCents * i.quantity, 0
    )
  );

  private cartLoaded = signal(false);

  getEffectiveOutOfStockBehavior(product: any): 'hide' | 'show_disabled' | 'allow_backorder' {
    if (product.outOfStockBehaviorOverride != null) {
      return product.outOfStockBehaviorOverride;
    }
    return this.settingsService.ordering().outOfStockBehavior || 'show_disabled';
  }

  async loadCart() {
    const id = this.customerId();
    if (!id || this.cartLoaded()) return;
    try {
      const cartDoc = await this.firestoreService
        .getDocument<any>(`portalCarts/${id}`)
        .pipe(take(1))
        .toPromise();
      if (cartDoc?.items) {
        this.cartItems.set(cartDoc.items);
      }
      this.cartLoaded.set(true);
    } catch {
      this.cartLoaded.set(true);
    }
  }

  private async saveCart() {
    const id = this.customerId();
    if (!id) return;
    try {
      await this.firestoreService.setDocument(
        `portalCarts/${id}`, {
          customerId: id,
          items: this.cartItems(),
          lastUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          tenantId: 1,
        }
      );
    } catch (err) {
      console.error('Failed to save cart:', err);
    }
  }

  addToCart(product: any, quantity = 1) {
    const behavior = this.getEffectiveOutOfStockBehavior(product);
    const allowBackorder = behavior === 'allow_backorder';

    this.cartItems.update(items => {
      const existing = items.find(
        i => i.productId === product.id
      );
      if (existing) {
        return items.map(i =>
          i.productId === product.id
            ? { ...i,
                quantity: allowBackorder
                  ? i.quantity + quantity
                  : Math.min(i.quantity + quantity, product.stock || 0)
              }
            : i
        );
      }
      return [...items, {
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        priceCents: product.priceCents,
        quantity: allowBackorder
          ? quantity
          : Math.min(quantity, product.stock || 0),
        stock: product.stock,
        imageUrl: product.imageUrl || null,
        outOfStockBehaviorOverride: product.outOfStockBehaviorOverride ?? null,
      }];
    });
    this.saveCart();
  }

  removeFromCart(productId: string) {
    this.cartItems.update(items =>
      items.filter(i => i.productId !== productId)
    );
    this.saveCart();
  }

  updateCartQty(productId: string, quantity: number) {
    if (quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }
    this.cartItems.update(items =>
      items.map(i => {
        if (i.productId === productId) {
          const behavior = this.getEffectiveOutOfStockBehavior(i);
          const allowBackorder = behavior === 'allow_backorder';
          return {
            ...i,
            quantity: allowBackorder
              ? quantity
              : Math.min(quantity, i.stock || 0)
          };
        }
        return i;
      })
    );
    this.saveCart();
  }

  async clearCart() {
    this.cartItems.set([]);
    const id = this.customerId();
    if (!id) return;
    try {
      await this.firestoreService.setDocument(
        `portalCarts/${id}`, {
          customerId: id,
          items: [],
          lastUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          tenantId: 1,
          cleared: true,
        }
      );
    } catch (err) {
      console.error('Failed to clear cart:', err);
    }
  }

  // ── ORDER PLACEMENT ───────────────────────────────────

  async placeOrder(
    deliveryType: 'delivery' | 'pickup',
    notes: string,
    settingsService: any
  ): Promise<string> {
    const customerId = this.customerId();
    const profile = this.customerProfile() as any;
    if (!customerId || !profile) {
      throw new Error('Not authenticated');
    }

    const items = this.cartItems();
    if (items.length === 0) {
      throw new Error('Cart is empty');
    }

    // Load customer doc
    const customerDocRef = doc(this.firestore, `customers/${customerId}`);
    const customerDocSnap = await getDoc(customerDocRef);
    const customerDoc = customerDocSnap.exists() ? customerDocSnap.data() as any : {};

    // Get next order number
    const ordering = settingsService.ordering();
    const prefix = ordering.orderPrefix || 'TRX';
    const year = new Date().getFullYear();

    // Read and increment sequence
    const seqRef = doc(
      this.firestore, 'settings/orderSequence'
    );
    const seqSnap = await getDoc(seqRef);
    const currentSeq = seqSnap.data()?.['sequence'] || 0;
    const nextSeq = currentSeq + 1;
    const orderNumber =
      `${prefix}-${year}-${String(nextSeq).padStart(4, '0')}`;

    const taxRatePercent =
      ordering.defaultTaxRatePercent || 13;
    const subtotalCents = items.reduce(
      (sum, i) => sum + i.priceCents * i.quantity, 0
    );
    const discountCents = 0;
    const taxableCents = subtotalCents - discountCents;
    const taxCents = Math.round(
      taxableCents * taxRatePercent / 100
    );
    const totalCents = taxableCents + taxCents;

    const orderItems = items.map(i => ({
      productId: i.productId,
      productName: i.productName,
      productSku: i.productSku,
      quantity: i.quantity,
      unitPriceCents: i.priceCents,
      lineTotalCents: i.priceCents * i.quantity,
      costCents: 0,
      lineMarginCents: 0,
    }));

    const orderData = {
      orderNumber,
      customerId,
      customerName: profile.businessName ||
        `${profile.firstName} ${profile.lastName}`.trim(),
      customerEmail: profile.email || '',
      customerPhone: profile.phone || '',
      serviceAreaId: customerDoc.serviceAreaId || null,
      serviceAreaName: customerDoc.serviceAreaName || customerDoc.serviceAreaCustom || '',
      status: 'confirmed',
      source: 'customer_portal',
      deliveryType,
      items: orderItems,
      subtotalCents,
      discountCents,
      taxRatePercent,
      taxCents,
      totalCents,
      marginCents: 0,
      amountPaidCents: 0,
      balanceCents: totalCents,
      paymentStatus: 'unpaid',
      customerNotes: notes || '',
      tenantId: 1,
      isDeleted: false,
      confirmedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    // Run batch: create order + deduct stock
    let orderId = '';

    await this.firestoreService.runBatch(
      async (batch: any, db: any) => {
        // Create order
        const { collection: col, doc: docFn } =
          await import('@angular/fire/firestore');
        const orderRef = docFn(col(db, 'orders'));
        orderId = orderRef.id;
        batch.set(orderRef, orderData);

        // Update sequence
        batch.update(seqRef, { sequence: nextSeq });

        // Update customer totals
        const customerRef = docFn(
          db, `customers/${customerId}`
        );
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const cd = customerSnap.data();
          batch.update(customerRef, {
            totalOrderedCents:
              (cd['totalOrderedCents'] || 0) + totalCents,
            totalOwingCents:
              (cd['totalOwingCents'] || 0) + totalCents,
          });
        }

        // Deduct stock + create stockAdjustments
        for (const item of items) {
          const productRef = docFn(
            db, `products/${item.productId}`
          );
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const pd = productSnap.data();
            const currentStock = pd['stock'] || 0;
            const newStock = Math.max(
              0, currentStock - item.quantity
            );
            batch.update(productRef, { stock: newStock });

            const adjRef = docFn(col(db, 'stockAdjustments'));
            batch.set(adjRef, {
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              type: 'sold',
              quantity: -item.quantity,
              previousStock: currentStock,
              newStock,
              reason: `Order ${orderNumber} (portal)`,
              adjustedBy: {
                firstName: profile.firstName,
                lastName: profile.lastName,
                uid: profile.uid,
              },
              createdAt: serverTimestamp(),
              tenantId: 1,
              isDeleted: false,
              linkedOrderId: orderRef.id,
              linkedOrderNumber: orderNumber,
            });
          }
        }
      }
    );

    await this.clearCart();
    await this.firestoreService.updateDocument(
      `portalCarts/${customerId}`,
      {
        abandonedEmailSent24h: false,
        abandonedEmailSent72h: false,
        abandonedEmailSent7d: false,
      }
    );
    return orderId;
  }

  // ── UTILS ─────────────────────────────────────────────

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }
}
