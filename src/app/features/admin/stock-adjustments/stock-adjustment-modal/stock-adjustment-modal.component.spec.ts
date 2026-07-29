import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { Functions } from '@angular/fire/functions';
import { StockAdjustmentModalComponent } from './stock-adjustment-modal.component';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Product } from '../../../../core/models/product.model';

function fakeProduct(stock: number): Product {
  return {
    id: 'p1',
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

// Phase 3.2 — stock/ATP. This modal's newStock/isValid are the one
// genuinely pure, testable "stock write" computation in the app — every
// other stock-clamping site (VisitService samples, order create/edit/
// cancel) reads the current stock via a live Firestore getDoc() inside a
// runBatch closure, which can't be reached without the emulator (Phase
// 3.3). This modal is architecturally different from those on purpose:
// it HARD-BLOCKS a would-go-negative adjustment via isValid rather than
// silently clamping — appropriate here because a staff member entering a
// manual correction can just fix their input, unlike a field rep mid-
// visit or a customer mid-checkout (see CLAUDE.md's non-blocking-in-the-
// field philosophy, which is why samples/orders clamp-and-record instead).
describe('StockAdjustmentModalComponent — stock math (single-product mode)', () => {
  let component: StockAdjustmentModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StockAdjustmentModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirestoreService, useValue: { getCollection: () => of([]), getDocument: () => of(null) } },
        { provide: AuthService, useValue: { getActionBy: () => null, currentProfile: () => null, isStaff: () => false } },
        { provide: Functions, useValue: {} },
        {
          provide: ToastService,
          useValue: {
            success: jasmine.createSpy('success'),
            error: jasmine.createSpy('error'),
            warning: jasmine.createSpy('warning'),
          },
        },
      ],
    });
    component = TestBed.createComponent(StockAdjustmentModalComponent).componentInstance;
  });

  it('computes newStock for an "in" direction adjustment (received)', () => {
    component.reason.set('Test reason');
    component.product.set(fakeProduct(20));
    component.type.set('received');
    component.quantity.set(30);

    expect(component.newStock()).toBe(50);
    expect(component.isValid()).toBeTrue();
  });

  it('computes newStock for an "out" direction adjustment (damaged)', () => {
    component.reason.set('Test reason');
    component.product.set(fakeProduct(20));
    component.type.set('damaged');
    component.quantity.set(5);

    expect(component.newStock()).toBe(15);
    expect(component.isValid()).toBeTrue();
  });

  it('blocks (does not clamp) an adjustment that would take stock negative', () => {
    component.reason.set('Test reason');
    component.product.set(fakeProduct(20));
    component.type.set('damaged');
    component.quantity.set(25); // more than current stock

    expect(component.newStock()).toBe(-5); // computed honestly, not floored
    expect(component.isValid()).toBeFalse(); // but blocked from saving
  });

  it('respects the correction type\'s explicit direction toggle', () => {
    component.reason.set('Test reason');
    component.product.set(fakeProduct(20));
    component.type.set('correction');
    component.direction.set('out');
    component.quantity.set(20);

    expect(component.effectiveDirection()).toBe('out');
    expect(component.newStock()).toBe(0); // exactly zero is valid
    expect(component.isValid()).toBeTrue();
  });
});
