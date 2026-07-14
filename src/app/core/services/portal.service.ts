import { Injectable, inject, computed, signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { take } from 'rxjs/operators';
import { where } from '@angular/fire/firestore';
import { doc, getDoc, serverTimestamp, Firestore } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class PortalService {
  private readonly firestoreService = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly settingsService = inject(SettingsService);
  private readonly functions = inject(Functions);

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
  allProducts = signal<any[]>([]);

  constructor() {
    this.firestoreService.getCollection<any>(
      'products',
      where('tenantId', '==', 1),
      where('active', '==', true),
      where('isDeleted', '==', false)
    ).subscribe(v => this.allProducts.set(v));
  }

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
    const profile = this.auth.currentProfile() as any;
    // Wait until linkedCustomerId is in the profile
    // before attempting to read the cart — avoids a
    // permission error on the first Firestore emission
    // before the token claim has propagated.
    if (!id || this.cartLoaded()) return;
    if (!profile?.linkedCustomerId) return;
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
      // Strip any undefined field values before writing —
      // Firestore rejects them outright. JSON round-trip
      // is the simplest reliable way to drop undefined keys.
      const cleanItems = JSON.parse(
        JSON.stringify(this.cartItems())
      );
      await this.firestoreService.setDocument(
        `portalCarts/${id}`, {
          customerId: id,
          items: cleanItems,
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
      // Every field must be a concrete value — Firestore
      // rejects undefined anywhere in the document, and
      // a missing field on the source product (name, sku,
      // priceCents, stock) would otherwise silently break
      // both cart save and order placement.
      return [...items, {
        productId: product.id,
        productName: product.name || 'Unnamed product',
        productSku: product.sku || '',
        priceCents: product.priceCents ?? 0,
        quantity: allowBackorder
          ? quantity
          : Math.min(quantity, product.stock || 0),
        stock: product.stock ?? 0,
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
    _settingsService?: any
  ): Promise<string> {
    const customerId = this.customerId();
    const profile = this.customerProfile() as any;
    if (!customerId || !profile) throw new Error('Not authenticated');

    const items = this.cartItems();
    if (items.length === 0) throw new Error('Cart is empty');

    const callable = httpsCallable<
      { deliveryType: string; notes: string; items: { productId: string; quantity: number }[] },
      { orderId: string; orderNumber: string }
    >(this.functions, 'placeOrder');

    try {
      const res = await callable({
        deliveryType,
        notes: notes || '',
        items: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
      });

      await this.clearCart();
      try {
        await this.firestoreService.updateDocument(`portalCarts/${customerId}`, {
          abandonedEmailSent24h: false,
          abandonedEmailSent72h: false,
          abandonedEmailSent7d: false,
        });
      } catch { /* non-fatal */ }

      return res.data.orderId;
    } catch (err: any) {
      // Firebase callable errors: err.code like 'functions/failed-precondition',
      // err.message carries the human text, err.details carries {productId, available, requested, name}.
      const msg = err?.message || 'Could not place order. Please try again.';
      // Re-throw with a clean message the checkout component can display.
      throw new Error(msg);
    }
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
