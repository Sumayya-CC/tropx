import { ActionBy } from './action-by.model';

export type CouponType = 'percentage' | 'fixed';

// coupons/{code} — the normalized code (trim+uppercase) IS the doc id, so
// `id` here is always identical to `code`. See functions/src/coupon-shared.ts
// for the server-side validation/redemption logic this doc drives.
export interface Coupon {
  id: string;
  code: string;
  description: string;
  type: CouponType;
  value: number;               // percent (0-100) for 'percentage'; integer cents for 'fixed'
  active: boolean;
  startsAt?: any | null;
  expiresAt?: any | null;
  minOrderSubtotalCents?: number | null;
  maxUsesTotal?: number | null;
  maxUsesPerCustomer?: number | null;
  usedCount: number;
  stackable: boolean;

  tenantId: number;
  createdAt: any;
  createdBy: ActionBy;
  isDeleted: boolean;
  deletedAt?: any;
  deletedBy?: string;
}

export interface AppliedCoupon {
  couponId: string;
  code: string;
  type: CouponType;
  value: number;
  discountCents: number;
}
