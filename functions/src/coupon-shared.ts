import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";
import {db} from "./core";

/**
 * Shared coupon validation/redemption/release logic used by placeOrder,
 * createAdminOrder, updateAdminOrder, saveOrderQuantityEdits, cancelOrder,
 * approveReturn, and the validateCoupon preview callable (domains/coupons.ts).
 *
 * `coupons/{code}` uses the normalized code itself as the doc ID (see
 * normalizeCouponCode) — free uniqueness, O(1) lookup, no query needed.
 * `coupons/{code}/redemptions/{customerId}` tracks per-customer usage,
 * bounded by real customer count, not per-order.
 *
 * Two distinct release functions exist on purpose — see the "release
 * idempotency" reasoning in releaseCoupons/releaseAllCoupons below. Do not
 * collapse them; conflating them causes either a permanent redemption leak
 * (terminal flag reused for incremental edits) or a permanent lockout of
 * further redemption (incremental release setting the terminal flag).
 */

export interface AppliedCoupon {
  couponId: string; // == normalized code, doc ID
  code: string;
  type: "percentage" | "fixed";
  value: number;
  discountCents: number;
}

interface CouponDoc {
  type: "percentage" | "fixed";
  value: number;
  active: boolean;
  startsAt?: admin.firestore.Timestamp | null;
  expiresAt?: admin.firestore.Timestamp | null;
  minOrderSubtotalCents?: number | null;
  maxUsesTotal?: number | null;
  maxUsesPerCustomer?: number | null;
  usedCount?: number;
  stackable?: boolean;
  isDeleted?: boolean;
}

interface RedemptionWrite {
  couponRef: admin.firestore.DocumentReference;
  redemptionRef: admin.firestore.DocumentReference;
  newUsedCount: number;
  newCustomerCount: number;
}

export interface CouponValidationResult {
  appliedCoupons: AppliedCoupon[];
  couponDiscountCents: number;
  // Pre-read current counters for the write phase — carrying these forward
  // avoids a second read after validation, keeping every coupon-related
  // read strictly before any write in the caller's transaction.
  redemptionPlan: RedemptionWrite[];
}

/**
 * Trim + uppercase — the single normalization used at every touchpoint so
 * "SAVE10" and "save10" can never diverge into separate docs.
 * @param {string} raw The raw code as typed/submitted.
 * @return {string} The normalized code, safe to use as a coupons/{code} doc ID.
 */
export function normalizeCouponCode(raw: string): string {
  return (raw || "").toString().trim().toUpperCase();
}

/**
 * Validates a set of coupon codes against a subtotal and customer, reading
 * everything fresh inside the given transaction. Throws HttpsError on any
 * ineligible code or a stacking violation — the whole set is rejected
 * together, never partially applied. Read-only (no writes) — safe to call
 * from both the authoritative order-commit path and the advisory
 * validateCoupon preview.
 * @param {admin.firestore.Transaction} tx The in-flight transaction to read through.
 * @param {string[]} codes Raw coupon codes as submitted by the client.
 * @param {number} subtotalCents The order's pre-discount subtotal, used to price percentage coupons.
 * @param {string} customerId The customer the coupons would be redeemed against.
 * @param {{count: number, allStackable: boolean}} [existingApplied] See in-body comment.
 * @return {Promise<CouponValidationResult>} Applied coupons, their combined discount, and a
 *   redemption plan for the write phase.
 */
export async function validateAndComputeCoupons(
  tx: admin.firestore.Transaction,
  codes: string[],
  subtotalCents: number,
  customerId: string,
  // Set by updateAdminOrder when some coupons are already on the order and
  // staying (not being added/removed this edit) — lets the stacking check
  // below see the FULL resulting set, not just the newly-submitted codes,
  // so adding a 2nd code onto an order that already carries one
  // non-stackable coupon is still rejected. Omitted (placeOrder,
  // createAdminOrder, a fresh order) means "nothing already applied."
  existingApplied?: {count: number; allStackable: boolean}
): Promise<CouponValidationResult> {
  const normalized = [...new Set(codes.map(normalizeCouponCode).filter(Boolean))];
  if (normalized.length === 0) {
    return {appliedCoupons: [], couponDiscountCents: 0, redemptionPlan: []};
  }

  const couponRefs = normalized.map((code) => db.collection("coupons").doc(code));
  const redemptionRefs = couponRefs.map((ref) => ref.collection("redemptions").doc(customerId));

  const [couponSnaps, redemptionSnaps] = await Promise.all([
    Promise.all(couponRefs.map((r) => tx.get(r))),
    Promise.all(redemptionRefs.map((r) => tx.get(r))),
  ]);

  const now = Date.now();
  const validated: Array<{
    code: string;
    data: CouponDoc;
    couponRef: admin.firestore.DocumentReference;
    redemptionRef: admin.firestore.DocumentReference;
    usedCount: number;
    customerCount: number;
  }> = [];

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized[i];
    const snap = couponSnaps[i];
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", `Coupon code "${code}" is not valid`);
    }
    const data = snap.data() as CouponDoc;
    if (data.isDeleted || !data.active) {
      throw new HttpsError("failed-precondition", `Coupon code "${code}" is not active`);
    }
    if (data.startsAt && data.startsAt.toMillis() > now) {
      throw new HttpsError("failed-precondition", `Coupon code "${code}" is not active yet`);
    }
    if (data.expiresAt && data.expiresAt.toMillis() < now) {
      throw new HttpsError("failed-precondition", `Coupon code "${code}" has expired`);
    }
    if (data.minOrderSubtotalCents != null && subtotalCents < data.minOrderSubtotalCents) {
      const minDisplay = (data.minOrderSubtotalCents / 100).toFixed(2);
      throw new HttpsError(
        "failed-precondition",
        `Coupon code "${code}" requires a minimum order of $${minDisplay}`
      );
    }
    const usedCount = data.usedCount || 0;
    if (data.maxUsesTotal != null && usedCount >= data.maxUsesTotal) {
      throw new HttpsError("failed-precondition", `Coupon code "${code}" has reached its usage limit`);
    }
    const redemptionSnap = redemptionSnaps[i];
    const customerCount = redemptionSnap.exists ? (redemptionSnap.data()?.["count"] || 0) : 0;
    if (data.maxUsesPerCustomer != null && customerCount >= data.maxUsesPerCustomer) {
      throw new HttpsError(
        "failed-precondition",
        `Coupon code "${code}" has already been used the maximum number of times on this account`
      );
    }
    validated.push({code, data, couponRef: couponRefs[i], redemptionRef: redemptionRefs[i], usedCount, customerCount});
  }

  // Stacking: every coupon in the resulting set — this call's codes PLUS
  // whatever's already applied and staying (existingApplied) — must allow
  // it, unless the set has exactly one coupon total.
  const existingCount = existingApplied?.count ?? 0;
  const existingAllStackable = existingApplied?.allStackable ?? true;
  const totalCount = validated.length + existingCount;
  if (totalCount > 1 && (!existingAllStackable || validated.some((v) => !v.data.stackable))) {
    throw new HttpsError(
      "failed-precondition",
      "One of these coupon codes can't be combined with another — remove one and try again"
    );
  }

  const appliedCoupons: AppliedCoupon[] = validated.map((v) => {
    const discountCents = v.data.type === "percentage" ?
      Math.round(subtotalCents * (v.data.value / 100)) :
      v.data.value;
    return {couponId: v.code, code: v.code, type: v.data.type, value: v.data.value, discountCents};
  });

  const couponDiscountCents = appliedCoupons.reduce((sum, c) => sum + c.discountCents, 0);

  const redemptionPlan: RedemptionWrite[] = validated.map((v) => ({
    couponRef: v.couponRef,
    redemptionRef: v.redemptionRef,
    newUsedCount: v.usedCount + 1,
    newCustomerCount: v.customerCount + 1,
  }));

  return {appliedCoupons, couponDiscountCents, redemptionPlan};
}

/**
 * Writes the redemption increments computed by validateAndComputeCoupons.
 * Pure writes — call in the write phase, after all reads (including
 * validateAndComputeCoupons's) are done.
 * @param {admin.firestore.Transaction} tx The in-flight transaction to write through.
 * @param {RedemptionWrite[]} redemptionPlan The plan returned by validateAndComputeCoupons.
 * @param {string} orderId The order these redemptions belong to, stamped for audit.
 * @param {admin.firestore.FieldValue} now A serverTimestamp() sentinel, shared with the caller's other writes.
 * @return {void}
 */
export function redeemCoupons(
  tx: admin.firestore.Transaction,
  redemptionPlan: RedemptionWrite[],
  orderId: string,
  now: admin.firestore.FieldValue
): void {
  for (const r of redemptionPlan) {
    tx.update(r.couponRef, {usedCount: r.newUsedCount});
    tx.set(r.redemptionRef, {
      count: r.newCustomerCount,
      lastOrderId: orderId,
      lastRedeemedAt: now,
      tenantId: 1,
      isDeleted: false,
    }, {merge: true});
  }
}

interface DecrementPlan {
  couponRef: admin.firestore.DocumentReference;
  redemptionRef: admin.firestore.DocumentReference;
  newUsedCount: number;
  newCustomerCount: number;
}

/**
 * Reads current usedCount/redemption-count for a batch of coupons and
 * returns the (floored) decremented values to write. Shared by
 * releaseCoupons and releaseAllCoupons so both always batch their reads
 * before any write, regardless of how many coupons are involved — a loop
 * of independent single-coupon get-then-write calls would interleave a
 * later coupon's read after an earlier coupon's write and violate
 * Firestore's whole-transaction reads-before-writes rule on any order with
 * more than one coupon (stacked, or several removed in one edit).
 * @param {admin.firestore.Transaction} tx The in-flight transaction to read through.
 * @param {AppliedCoupon[]} appliedCoupons The coupons to plan decrements for.
 * @param {string} customerId The customer whose redemption docs to read.
 * @return {Promise<DecrementPlan[]>} One decrement plan per coupon, ready to write.
 */
async function planCouponDecrements(
  tx: admin.firestore.Transaction,
  appliedCoupons: AppliedCoupon[],
  customerId: string
): Promise<DecrementPlan[]> {
  if (appliedCoupons.length === 0) return [];

  const refs = appliedCoupons.map((coupon) => {
    const couponRef = db.collection("coupons").doc(coupon.couponId);
    return {couponRef, redemptionRef: couponRef.collection("redemptions").doc(customerId)};
  });

  const [couponSnaps, redemptionSnaps] = await Promise.all([
    Promise.all(refs.map((r) => tx.get(r.couponRef))),
    Promise.all(refs.map((r) => tx.get(r.redemptionRef))),
  ]);

  return refs.map((r, i) => {
    const currentUsed = couponSnaps[i].exists ? (couponSnaps[i].data()?.["usedCount"] || 0) : 0;
    const currentCustomerCount = redemptionSnaps[i].exists ? (redemptionSnaps[i].data()?.["count"] || 0) : 0;
    return {
      couponRef: r.couponRef,
      redemptionRef: r.redemptionRef,
      newUsedCount: Math.max(0, currentUsed - 1),
      newCustomerCount: Math.max(0, currentCustomerCount - 1),
    };
  });
}

/**
 * Releases a batch of coupons' redemption slots (any size — one removed
 * code or several removed in the same edit). Used by updateAdminOrder's
 * per-edit diff, while the order stays alive and editable. Deliberately
 * does NOT touch order.couponsReleasedAt: an order is a live document, so
 * a coupon removed here can be re-added in a later edit. The removal is
 * naturally idempotent on its own terms — it's driven by a diff against
 * the order's *current* appliedCoupons, so retrying the same edit re-diffs
 * against an array that no longer contains the removed code(s) and finds
 * nothing left to release. Reusing the terminal flag here would make a
 * later cancelOrder/full-return wrongly believe the order was already
 * released and skip releasing a coupon re-added after this call.
 * @param {admin.firestore.Transaction} tx The in-flight transaction to read/write through.
 * @param {AppliedCoupon[]} removedCoupons The coupons removed in this edit.
 * @param {string} customerId The customer these coupons were redeemed against.
 * @return {Promise<void>}
 */
export async function releaseCoupons(
  tx: admin.firestore.Transaction,
  removedCoupons: AppliedCoupon[],
  customerId: string
): Promise<void> {
  const plan = await planCouponDecrements(tx, removedCoupons, customerId);
  for (const p of plan) {
    tx.update(p.couponRef, {usedCount: p.newUsedCount});
    tx.set(p.redemptionRef, {count: p.newCustomerCount}, {merge: true});
  }
}

/**
 * Terminal release: releases every coupon on an order, once, ever — because
 * the order is now dead (cancelled) or fully unwound (nothing left to
 * re-add coupons to). Guarded by order.couponsReleasedAt so a retried
 * approveReturn, or both cancelOrder and a full-return approval somehow
 * firing for the same order, can't over-decrement a usedCount shared with
 * other customers' redemptions (Math.max(0, ...) alone only floors at
 * zero — it doesn't stop 5→3 when this order only ever owed 1). Callers
 * must check `!order.couponsReleasedAt` before calling this, and must
 * write `couponsReleasedAt` onto the order doc themselves in the same
 * transaction (this function only touches coupon/redemption docs, not the
 * order doc, since callers own the order write).
 * @param {admin.firestore.Transaction} tx The in-flight transaction to read/write through.
 * @param {AppliedCoupon[]} appliedCoupons Every coupon on the order being released.
 * @param {string} customerId The customer these coupons were redeemed against.
 * @return {Promise<void>}
 */
export async function releaseAllCoupons(
  tx: admin.firestore.Transaction,
  appliedCoupons: AppliedCoupon[],
  customerId: string
): Promise<void> {
  const plan = await planCouponDecrements(tx, appliedCoupons, customerId);
  for (const p of plan) {
    tx.update(p.couponRef, {usedCount: p.newUsedCount});
    tx.set(p.redemptionRef, {count: p.newCustomerCount}, {merge: true});
  }
}
