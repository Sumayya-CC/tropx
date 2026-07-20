import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { BillFormComponent } from './bill-form.component';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';

// Phase 3.1 — money math. Regression coverage for a real bug found during
// this phase: formTaxCents holds a DOLLAR value (loaded via /100, typed
// directly into the input), but the taxCents computed used to return it
// unconverted — a manually-entered "$13.00" tax saved as 13 cents instead
// of 1300. Fixed by converting in the taxCents computed; this test locks
// that conversion in place.
describe('BillFormComponent — money math', () => {
  let component: BillFormComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BillFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } },
          },
        },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: FirestoreService, useValue: { getCollection: () => of([]), getDocument: () => of(null) } },
        { provide: AuthService, useValue: { getActionBy: () => null, currentProfile: () => null, isStaff: () => false } },
        { provide: SettingsService, useValue: { ordering: () => ({ defaultTaxRatePercent: 13 }) } },
        { provide: ToastService, useValue: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') } },
      ],
    });
    component = TestBed.createComponent(BillFormComponent).componentInstance;
  });

  it('converts a manually-entered dollar tax amount to real cents', () => {
    component.items.set([{ description: 'Item', quantity: 1, unitCents: 10000, lineTotalCents: 10000 }]);
    component.onTaxChange(13); // user types "13.00" meaning $13.00

    expect(component.taxCents()).toBe(1300); // not 13
    expect(component.totalCents()).toBe(11300); // 10000 + 1300, not 10013
  });

  it('produces the same result via auto-tax as an equivalent manual entry', () => {
    component.items.set([{ description: 'Item', quantity: 1, unitCents: 10000, lineTotalCents: 10000 }]);
    component.updateItemAmount(0, '100.00'); // triggers maybeAutoTax at 13% (settings mock)

    expect(component.taxCents()).toBe(1300); // 10000 * 13 / 100 = 1300, same as manual $13.00 above
  });
});
