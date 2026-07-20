import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { OrderFormComponent } from './order-form.component';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { OrderItem } from '../../../../core/models/order.model';

function lineItem(quantity: number, unitPriceCents: number): OrderItem {
  return {
    productId: 'p1',
    productName: 'Test product',
    productSku: 'SKU-1',
    quantity,
    unitPriceCents,
    unitCostCents: 0,
    lineTotalCents: quantity * unitPriceCents,
    lineCostCents: 0,
    currencyCode: 'CAD',
  };
}

// Phase 3.1 — money math. This is the real production computation
// (subtotalCents/taxCents/totalCents computed signals on the component
// itself), not a re-typed parallel formula — a copy of the formula in the
// spec would pass even if the component's actual logic drifted from it.
describe('OrderFormComponent — money math (create mode)', () => {
  let component: OrderFormComponent;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [OrderFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: FirestoreService, useValue: { getCollection: () => of([]), getDocument: () => of(null) } },
        { provide: AuthService, useValue: { getActionBy: () => null, currentProfile: () => null, isStaff: () => false } },
        {
          provide: SettingsService,
          useValue: { ordering: () => ({ defaultTaxRatePercent: 13, defaultDeliveryType: 'delivery' }) },
        },
        { provide: ToastService, useValue: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') } },
      ],
    });
    component = TestBed.createComponent(OrderFormComponent).componentInstance;
  });

  it('computes the full subtotal -> discount -> tax -> total chain on a multi-line cart', () => {
    component.items.set([lineItem(3, 1000), lineItem(2, 2500)]); // 3x$10.00 + 2x$25.00
    component.discountCents.set(500); // $5.00
    component.taxRatePercent.set(13);

    expect(component.subtotalCents()).toBe(8000); // 3000 + 5000
    expect(component.taxCents()).toBe(975); // (8000 - 500) * 0.13 = 975
    expect(component.totalCents()).toBe(8475); // 7500 + 975
  });

  it('clamps a discount larger than the subtotal instead of going negative', () => {
    component.items.set([lineItem(1, 1000)]); // $10.00
    component.discountCents.set(5000); // $50.00 discount, exceeds subtotal
    component.taxRatePercent.set(13);

    expect(component.subtotalCents()).toBe(1000);
    expect(component.taxCents()).toBe(0); // taxable base floored at 0, not negative
    expect(component.totalCents()).toBe(0); // never negative
  });

  it('rounds tax the same way regardless of float-hostile subtotals', () => {
    // 3 x $6.65 = 1995 cents; 1995 * 0.13 = 259.35 — must round, not truncate.
    component.items.set([lineItem(3, 665)]);
    component.discountCents.set(0);
    component.taxRatePercent.set(13);

    expect(component.subtotalCents()).toBe(1995);
    expect(component.taxCents()).toBe(259);
    expect(component.totalCents()).toBe(2254);
  });
});
