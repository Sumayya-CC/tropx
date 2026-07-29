import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { Functions } from '@angular/fire/functions';
import { OrderDetailComponent } from './order-detail.component';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Order } from '../../../../core/models/order.model';

function fakeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'TRX-2026-0001',
    customerId: 'c1',
    customerName: 'Test Customer',
    customerPhone: null,
    items: [],
    subtotalCents: 10000,
    taxRatePercent: 13,
    taxCents: 1300,
    discountCents: 0,
    totalCents: 11300,
    currencyCode: 'CAD',
    totalCostCents: 0,
    marginCents: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    amountPaidCents: 0,
    balanceCents: 11300,
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
    ...overrides,
  } as Order;
}

function editItem(quantity: number, unitPriceCents: number) {
  return {
    productId: 'p1',
    productName: 'Test product',
    productSku: 'SKU-1',
    quantity,
    unitPriceCents,
    lineTotalCents: quantity * unitPriceCents,
    originalQuantity: quantity,
    originalUnitPriceCents: unitPriceCents,
  };
}

// Phase 3.1 — money math (edit mode). editTotals already floors the
// taxable base and balance at 0 — this locks that behavior in and
// confirms it stays consistent with order-form's create-mode chain
// (fixed in this same phase to match).
describe('OrderDetailComponent — money math (editTotals)', () => {
  function createComponent(order: Order) {
    TestBed.configureTestingModule({
      imports: [OrderDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => order.id } } } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        {
          provide: FirestoreService,
          useValue: { getDocument: () => of(order), getCollection: () => of([]) },
        },
        { provide: AuthService, useValue: { getActionBy: () => null, currentProfile: () => null, isStaff: () => false } },
        { provide: Functions, useValue: {} },
        { provide: SettingsService, useValue: { ordering: () => ({}), business: () => ({}) } },
        { provide: ToastService, useValue: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') } },
      ],
    });
    return TestBed.createComponent(OrderDetailComponent).componentInstance;
  }

  it('computes the full chain and floors balance at 0 when fully paid', () => {
    const component = createComponent(fakeOrder({ amountPaidCents: 11300 }));
    component.editItems.set([editItem(2, 5000)]); // $100.00
    component.editDiscountCents.set(0);

    const totals = component.editTotals();
    expect(totals?.subtotalCents).toBe(10000);
    expect(totals?.taxCents).toBe(1300); // 10000 * 0.13
    expect(totals?.totalCents).toBe(11300);
    expect(totals?.balanceCents).toBe(0); // paid in full, never negative
  });

  it('reports a positive balance when partially paid', () => {
    const component = createComponent(fakeOrder({ amountPaidCents: 5000 }));
    component.editItems.set([editItem(2, 5000)]);
    component.editDiscountCents.set(0);

    expect(component.editTotals()?.balanceCents).toBe(6300); // 11300 - 5000
  });

  it('clamps a discount larger than the subtotal instead of going negative', () => {
    const component = createComponent(fakeOrder({ amountPaidCents: 0 }));
    component.editItems.set([editItem(1, 1000)]); // $10.00
    component.editDiscountCents.set(5000); // $50.00 discount

    const totals = component.editTotals();
    expect(totals?.taxCents).toBe(0);
    expect(totals?.totalCents).toBe(0);
    expect(totals?.balanceCents).toBe(0);
  });
});
