import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { serverTimestamp } from '@angular/fire/firestore';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { Coupon, CouponType } from '../../../../core/models/coupon.model';
import { displayToCents, centsToDisplay } from '../../../../shared/utils/currency.utils';
import { dateInputToLocalDate, toDateInputValue } from '../../../../shared/utils/date.utils';

@Component({
  selector: 'app-coupon-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LoadingSpinnerComponent],
  templateUrl: './coupon-form.component.html',
  styleUrl: './coupon-form.component.scss'
})
export class CouponFormComponent implements OnInit {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  couponId = signal<string | null>(null);
  isEditMode = computed(() => this.couponId() !== null);
  isSaving = signal(false);
  isLoading = signal(false);

  code = signal('');
  description = signal('');
  type = signal<CouponType>('percentage');
  percentValue = signal<number>(10);
  fixedValueDisplay = signal<string>('0.00');
  active = signal(true);
  stackable = signal(false);
  startsAtInput = signal('');
  expiresAtInput = signal('');
  minOrderDisplay = signal<string>('');
  maxUsesTotal = signal<number | null>(null);
  maxUsesPerCustomer = signal<number | null>(null);
  usedCount = signal(0);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.couponId.set(id);
      this.loadCoupon(id);
    }
  }

  private loadCoupon(id: string) {
    this.isLoading.set(true);
    this.firestore.getDocument<Coupon>(`coupons/${id}`).subscribe({
      next: (coupon) => {
        this.isLoading.set(false);
        if (!coupon) {
          this.toast.error('Coupon not found');
          this.router.navigate(['/admin/coupons']);
          return;
        }
        this.code.set(coupon.code);
        this.description.set(coupon.description || '');
        this.type.set(coupon.type);
        if (coupon.type === 'percentage') {
          this.percentValue.set(coupon.value);
        } else {
          this.fixedValueDisplay.set(centsToDisplay(coupon.value).replace(/^\$/, ''));
        }
        this.active.set(coupon.active);
        this.stackable.set(!!coupon.stackable);
        this.startsAtInput.set(toDateInputValue(coupon.startsAt));
        this.expiresAtInput.set(toDateInputValue(coupon.expiresAt));
        this.minOrderDisplay.set(
          coupon.minOrderSubtotalCents != null ? centsToDisplay(coupon.minOrderSubtotalCents).replace(/^\$/, '') : ''
        );
        this.maxUsesTotal.set(coupon.maxUsesTotal ?? null);
        this.maxUsesPerCustomer.set(coupon.maxUsesPerCustomer ?? null);
        this.usedCount.set(coupon.usedCount || 0);
      },
      error: (err) => {
        console.error('Failed to load coupon:', err);
        this.isLoading.set(false);
      }
    });
  }

  // ngModel on <input type="number"> returns strings — coerce before writing to numeric signals.
  toNum(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  toNumOrNull(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async save() {
    const codeInput = this.code().trim().toUpperCase();
    if (!codeInput) {
      this.toast.error('A coupon code is required');
      return;
    }
    if (this.type() === 'percentage' && (this.percentValue() <= 0 || this.percentValue() > 100)) {
      this.toast.error('Percentage must be between 1 and 100');
      return;
    }
    const fixedCents = displayToCents(this.fixedValueDisplay() || '0');
    if (this.type() === 'fixed' && fixedCents <= 0) {
      this.toast.error('Fixed discount amount must be greater than $0');
      return;
    }

    const startsAtDate = dateInputToLocalDate(this.startsAtInput());
    const expiresAtDate = dateInputToLocalDate(this.expiresAtInput());
    const minOrderCents = this.minOrderDisplay().trim() ? displayToCents(this.minOrderDisplay()) : null;

    this.isSaving.set(true);
    try {
      const actionBy = this.auth.getActionBy();
      const payload: Partial<Coupon> & Record<string, unknown> = {
        code: codeInput,
        description: this.description().trim(),
        type: this.type(),
        value: this.type() === 'percentage' ? this.percentValue() : fixedCents,
        active: this.active(),
        stackable: this.stackable(),
        startsAt: startsAtDate,
        expiresAt: expiresAtDate,
        minOrderSubtotalCents: minOrderCents,
        maxUsesTotal: this.maxUsesTotal(),
        maxUsesPerCustomer: this.maxUsesPerCustomer(),
        tenantId: 1,
      };

      if (this.isEditMode()) {
        // Code is immutable after creation (it's the doc ID) — never included in an edit write.
        await this.firestore.updateDocument(`coupons/${this.couponId()}`, payload);
        this.toast.success('Coupon updated');
      } else {
        payload['usedCount'] = 0;
        payload['isDeleted'] = false;
        payload['createdAt'] = serverTimestamp();
        payload['createdBy'] = actionBy as any;
        // codeInput doubles as the doc ID — see coupon-shared.ts's
        // normalizeCouponCode; setDocument on an existing ID would silently
        // overwrite another coupon, so guard against collisions first.
        const existing = await firstValueFrom(this.firestore.getDocument<Coupon>(`coupons/${codeInput}`));
        if (existing) {
          this.toast.error(`Coupon code "${codeInput}" already exists`);
          this.isSaving.set(false);
          return;
        }
        await this.firestore.setDocument(`coupons/${codeInput}`, payload);
        this.toast.success('Coupon created');
      }
      this.router.navigate(['/admin/coupons']);
    } catch (e: any) {
      console.error('Failed to save coupon', e);
      this.toast.error(e?.message || 'Failed to save coupon');
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteCoupon() {
    if (!this.couponId()) return;
    if (!confirm(`Delete coupon "${this.code()}"? This can't be undone.`)) return;
    try {
      await this.firestore.softDelete(`coupons/${this.couponId()}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Coupon deleted');
      this.router.navigate(['/admin/coupons']);
    } catch (e) {
      console.error('Failed to delete coupon', e);
      this.toast.error('Failed to delete coupon');
    }
  }
}
