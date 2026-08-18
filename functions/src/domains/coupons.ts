import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db, sentryDsn, STAFF_ROLES} from "../core";
import {isRateLimited} from "../rate-limit";
import {normalizeCouponCode, validateAndComputeCoupons} from "../coupon-shared";

// ═══ Coupon validation preview + drift-safety sweep ═══════════════════════
// Coupon CRUD (create/edit/soft-delete) is plain staff-permitted Firestore
// writes from the admin UI via FirestoreService, same as products — no
// Cloud Function needed there, since staff writes are already trusted.
// These two callables exist only for the parts that need server trust or
// server-only visibility: a live discount preview before commit, and an
// on-demand recompute of the denormalized usedCount counter.

export const validateCoupon = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    const isCustomer = role === "customer";
    const isStaff = STAFF_ROLES.includes(role);
    if (!isCustomer && !isStaff) {
      throw new HttpsError("permission-denied", "Not authorized");
    }

    // Authenticated-but-malicious accounts could still script repeated
    // guesses to enumerate valid codes — throttle per-uid. Advisory-only
    // endpoint, so a denied preview just means the customer finds out the
    // code's status at placeOrder instead; failing closed here is safe.
    if (await isRateLimited("validateCoupon", auth.uid)) {
      throw new HttpsError("resource-exhausted", "Too many attempts — try again shortly");
    }

    const data = request.data || {};
    const rawCodes: string[] = Array.isArray(data.couponCodes) ? data.couponCodes : [];
    const subtotalCents = Math.max(0, Math.floor(Number(data.subtotalCents) || 0));

    let customerId: string;
    if (isCustomer) {
      // Never trust a client-supplied customerId for a customer caller —
      // always resolve from their own claim, same as placeOrder, so one
      // customer can't probe another's per-customer usage.
      customerId = (auth.token["linkedCustomerId"] as string) || "";
      if (!customerId) throw new HttpsError("permission-denied", "No linked customer account");
    } else {
      customerId = (data.customerId || "").toString();
      if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");
    }

    if (rawCodes.length === 0) {
      return {valid: true, discountCents: 0, message: ""};
    }

    try {
      // Takes the FULL code set, not one code at a time — a per-code
      // preview would validate each in isolation and could show two
      // mutually-exclusive non-stackable coupons both "valid," only for
      // placeOrder to reject the whole set at commit. Read-only: no
      // writes/redemption here, so this transaction never conflicts with a
      // real placeOrder — enforcement + redemption happen there.
      const result = await db.runTransaction((tx) =>
        validateAndComputeCoupons(tx, rawCodes, subtotalCents, customerId)
      );
      // Only the combined result, never the raw coupon doc(s) — usedCount/
      // maxUsesTotal shouldn't leak to the client.
      return {valid: true, discountCents: result.couponDiscountCents, message: ""};
    } catch (err) {
      const message = err instanceof HttpsError ? err.message : "Unable to validate coupon";
      return {valid: false, discountCents: 0, message};
    }
  }
);

export const recomputeCouponUsage = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");
    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) throw new HttpsError("permission-denied", "Staff only");

    const data = request.data || {};
    const code = normalizeCouponCode((data.couponId || data.code || "").toString());
    if (!code) throw new HttpsError("invalid-argument", "couponId is required");

    const couponRef = db.collection("coupons").doc(code);
    const couponSnap = await couponRef.get();
    if (!couponSnap.exists) throw new HttpsError("not-found", "Coupon not found");

    // usedCount = sum of every customer's redemption count — bounded by
    // real customer count, cheap, run-twice-idempotent drift-safety sweep,
    // same spirit as recomputeCustomerCounters but manually triggered.
    const redemptionsSnap = await couponRef.collection("redemptions").get();
    const usedCount = redemptionsSnap.docs.reduce((sum, d) => sum + (d.data()["count"] || 0), 0);
    await couponRef.update({usedCount});

    return {couponId: code, usedCount};
  }
);
