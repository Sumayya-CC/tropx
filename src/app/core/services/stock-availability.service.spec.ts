import { TestBed } from '@angular/core/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { StockAvailabilityService } from './stock-availability.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Order } from '../models/order.model';
import { Product } from '../models/product.model';

function fakeProduct(id: string, stock: number): Product {
  return {
    id,
    name: 'Test product',
    description: '',
    categoryId: 'c1',
    brandId: 'b1',
    sku: 'SKU-1',
    measurement: { quantity: 1, unit: 'pcs' },
    priceCents: 1000,
    costCents: 500,
    currencyCode: 'CAD',
    imageUrl: '',
    stock,
    lowStockThreshold: 5,
    active: true,
    tenantId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: { uid: 'u1', firstName: 'Test', lastName: '' },
    isDeleted: false,
  };
}

function fakeOrder(status: Order['status'], items: { productId: string; quantity: number }[]): Order {
  return {
    id: 'o1',
    orderNumber: 'TRX-2026-0001',
    customerId: 'c1',
    customerName: 'Test Customer',
    customerPhone: null,
    items: items.map(i => ({
      productId: i.productId,
      productName: 'Test product',
      productSku: 'SKU-1',
      quantity: i.quantity,
      unitPriceCents: 1000,
      unitCostCents: 500,
      lineTotalCents: i.quantity * 1000,
      lineCostCents: i.quantity * 500,
      currencyCode: 'CAD',
    })),
    subtotalCents: 0,
    taxRatePercent: 13,
    taxCents: 0,
    discountCents: 0,
    totalCents: 0,
    currencyCode: 'CAD',
    totalCostCents: 0,
    marginCents: 0,
    status,
    paymentStatus: 'unpaid',
    amountPaidCents: 0,
    balanceCents: 0,
    source: 'admin_created',
    deliveryType: 'delivery',
    customerNotes: null,
    internalNotes: null,
    confirmedAt: null,
    confirmedBy: { uid: 'u1', firstName: 'Test', lastName: '' },
    tenantId: 1,
    createdAt: null,
    createdBy: { uid: 'u1', firstName: 'Test', lastName: '' },
    isDeleted: false,
  } as Order;
}

// Phase 3.2 — stock/ATP. This is the one service the plan itself calls
// out as pure and testable — and the guard test below (availableFor does
// NOT subtract committed) is the most important assertion in this file:
// product.stock is decremented at order confirmation, not delivery, so it
// is ALREADY net of everything committed to open orders. Subtracting
// committed again would double-count that deduction. This test exists
// specifically to catch a future "fix" that reintroduces the subtraction.
describe('StockAvailabilityService', () => {
  // toObservable() (used internally for openOrders) schedules its signal
  // subscription via an effect, which — even synchronously-emitting
  // sources like of(...) — doesn't flush until Angular's next stability
  // point. whenStable() is the documented way to wait for that in a
  // zoneless app; without it, committedFor reads the toSignal initialValue
  // ([]) and every test silently sees zero committed orders.
  async function createService(orders: Order[], isStaff = true) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirestoreService, useValue: { getCollection: () => of(orders) } },
        { provide: AuthService, useValue: { isStaff: () => isStaff } },
      ],
    });
    const service = TestBed.inject(StockAvailabilityService);
    await TestBed.inject(ApplicationRef).whenStable();
    return service;
  }

  it('availableFor returns product.stock directly — never subtracts committed', async () => {
    const service = await createService([
      fakeOrder('confirmed', [{ productId: 'p1', quantity: 500 }]), // huge committed qty
    ]);
    const product = fakeProduct('p1', 20);

    // If this ever returns anything other than 20 (e.g. 20 - committedFor),
    // that's the double-counting bug CLAUDE.md explicitly warns against.
    expect(service.availableFor(product)).toBe(20);
  });

  it('committedFor sums quantities across the orders it is given', async () => {
    // Finding: committedByProductId's JS loop does NOT itself filter by
    // status — it trusts the Firestore query's
    // where('status', 'in', ['confirmed', 'preparing', 'out_for_delivery'])
    // constraint to have already narrowed the result set (the only
    // client-side filter is `!order.isDeleted`, covered separately below).
    // A mocked getCollection() bypasses that query entirely, so passing a
    // 'delivered'/'cancelled' order here wouldn't prove exclusion — it
    // would only prove this mock doesn't apply Firestore's query filters,
    // which is true of any mock and not the invariant worth asserting.
    // "Only open-status orders actually reach this code" is a property of
    // the query, verifiable against a real Firestore instance — that's
    // Phase 3.3/3.5 (emulator), not this pure test.
    const service = await createService([
      fakeOrder('confirmed', [{ productId: 'p1', quantity: 3 }]),
      fakeOrder('preparing', [{ productId: 'p1', quantity: 4 }]),
      fakeOrder('out_for_delivery', [{ productId: 'p1', quantity: 5 }]),
    ]);

    expect(service.committedFor('p1')).toBe(12); // 3 + 4 + 5
  });

  it('queries orders scoped by tenantId and an open-status filter', async () => {
    const getCollectionSpy = jasmine.createSpy('getCollection').and.returnValue(of([]));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirestoreService, useValue: { getCollection: getCollectionSpy } },
        { provide: AuthService, useValue: { isStaff: () => true } },
      ],
    });
    TestBed.inject(StockAvailabilityService);
    await TestBed.inject(ApplicationRef).whenStable();

    // Structural check, not a deep inspection of the where() constraint
    // internals (fragile against SDK changes): confirms the call shape is
    // 'orders' plus two constraints (tenantId, status), not that Firestore
    // actually applies them correctly — that needs the emulator.
    expect(getCollectionSpy).toHaveBeenCalledWith('orders', jasmine.anything(), jasmine.anything());
  });

  it('ignores soft-deleted orders when summing committed quantity', async () => {
    const deletedOrder = fakeOrder('confirmed', [{ productId: 'p1', quantity: 50 }]);
    deletedOrder.isDeleted = true;
    const service = await createService([
      fakeOrder('confirmed', [{ productId: 'p1', quantity: 3 }]),
      deletedOrder,
    ]);

    expect(service.committedFor('p1')).toBe(3);
  });

  it('onHandFor reconstructs the gross physical count (available + committed)', async () => {
    const service = await createService([
      fakeOrder('confirmed', [{ productId: 'p1', quantity: 7 }]),
    ]);
    const product = fakeProduct('p1', 20);

    expect(service.onHandFor(product)).toBe(27); // 20 already-net + 7 still-in-warehouse-but-spoken-for
  });

  it('returns 0 committed for a product with no open orders', async () => {
    const service = await createService([]);
    expect(service.committedFor('unknown-product')).toBe(0);
  });

  it('does not read open orders at all for a non-staff (customer) session', async () => {
    const service = await createService(
      [fakeOrder('confirmed', [{ productId: 'p1', quantity: 9 }])],
      /* isStaff */ false,
    );

    expect(service.committedFor('p1')).toBe(0);
  });
});
