import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Coupon feature — black-box emulator tests against the real onCall
 * functions (placeOrder/createAdminOrder/updateAdminOrder/cancelOrder/
 * submitReturn/approveReturn/validateCoupon/recomputeCouponUsage), same
 * harness pattern as place-order.spec.ts/create-admin-order.spec.ts. Covers
 * the money math, tax-base ordering, usage limits/stacking, and the
 * release-idempotency scenarios found during design review (see the plan's
 * "Release idempotency" section).
 */

const REGION = "northamerica-northeast2";
const DATABASE_ID = "tropx-dev";
const FUNCTIONS_PORT = 5001;
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;

let adminDb: admin.firestore.Firestore;
let adminAuth: admin.auth.Auth;
let clientApp: FirebaseApp;
let clientAuth: Auth;
let clientFunctions: Functions;

function uid(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function seedProduct(overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("product");
  await adminDb.collection("products").doc(id).set({
    name: "Test Product",
    sku: "SKU-TEST",
    priceCents: 1000,
    costCents: 500,
    stock: 100,
    active: true,
    isDeleted: false,
    tenantId: 1,
    ...overrides,
  });
  return id;
}

async function seedCoupon(code: string, overrides: Partial<Record<string, unknown>> = {}) {
  await adminDb.collection("coupons").doc(code).set({
    code,
    description: "Test coupon",
    type: "percentage",
    value: 10,
    active: true,
    startsAt: null,
    expiresAt: null,
    minOrderSubtotalCents: null,
    maxUsesTotal: null,
    maxUsesPerCustomer: null,
    usedCount: 0,
    stackable: false,
    tenantId: 1,
    isDeleted: false,
    createdAt: new Date(),
    ...overrides,
  });
  return code;
}

async function getCoupon(code: string) {
  const snap = await adminDb.collection("coupons").doc(code).get();
  return snap.data()!;
}

async function getRedemption(code: string, customerId: string) {
  const snap = await adminDb.collection("coupons").doc(code).collection("redemptions").doc(customerId).get();
  return snap.exists ? snap.data()! : null;
}

async function signInWithClaims(claims: Record<string, unknown>) {
  const userRecord = await adminAuth.createUser({});
  const customToken = await adminAuth.createCustomToken(userRecord.uid, claims);
  const cred = await signInWithCustomToken(clientAuth, customToken);
  await cred.user.getIdToken(true);
  return userRecord.uid;
}

async function signInStaff(claims: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
  const userRecord = await adminAuth.createUser({});
  await adminDb.collection("users").doc(userRecord.uid).set({
    firstName: "Staff",
    lastName: "Member",
    role: claims["role"] || "admin",
    tenantId: 1,
    ...profile,
  });
  const customToken = await adminAuth.createCustomToken(userRecord.uid, {role: "admin", ...claims});
  const cred = await signInWithCustomToken(clientAuth, customToken);
  await cred.user.getIdToken(true);
  return userRecord.uid;
}

async function seedCustomerAndAuth(overrides: Partial<Record<string, unknown>> = {}) {
  const customerId = uid("customer");
  await adminDb.collection("customers").doc(customerId).set({
    businessName: "Test Business",
    ownerFirstName: "Test",
    ownerLastName: "Owner",
    email: "test@example.com",
    totalOrderedCents: 0,
    totalOwingCents: 0,
    totalPaidCents: 0,
    tenantId: 1,
    isDeleted: false,
    ...overrides,
  });
  const authUid = await signInWithClaims({role: "customer", linkedCustomerId: customerId, tenantId: 1});
  return {customerId, uid: authUid};
}

async function seedCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  const customerId = uid("customer");
  await adminDb.collection("customers").doc(customerId).set({
    businessName: "Test Business",
    ownerFirstName: "Test",
    ownerLastName: "Owner",
    email: "test@example.com",
    totalOrderedCents: 0,
    totalOwingCents: 0,
    totalPaidCents: 0,
    tenantId: 1,
    isDeleted: false,
    ...overrides,
  });
  return customerId;
}

async function seedOrder(customerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("order");
  await adminDb.collection("orders").doc(id).set({
    orderNumber: `TRX-2026-${id.slice(-4)}`,
    customerId,
    customerName: "Test Business",
    status: "delivered",
    items: [],
    subtotalCents: 0,
    discountCents: 0,
    manualDiscountCents: 0,
    couponDiscountCents: 0,
    appliedCoupons: [],
    totalCents: 0,
    balanceCents: 0,
    amountPaidCents: 0,
    tenantId: 1,
    isDeleted: false,
    createdAt: new Date(),
    ...overrides,
  });
  return id;
}

async function seedReturn(orderId: string, customerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("return");
  await adminDb.collection("returns").doc(id).set({
    returnNumber: `RET-2026-${id.slice(-4)}`,
    orderId,
    orderNumber: `TRX-2026-${orderId.slice(-4)}`,
    customerId,
    customerName: "Test Business",
    type: "credit_note",
    status: "pending",
    reasonCode: "damaged",
    reason: "test",
    items: [],
    amountCents: 0,
    isFullReturn: false,
    stockRestored: false,
    stockAdjustmentIds: [],
    tenantId: 1,
    isDeleted: false,
    createdAt: new Date(),
    createdBy: {uid: "portal-customer", firstName: "Test", lastName: "Owner"},
    ...overrides,
  });
  return id;
}

function callable<TIn = unknown, TOut = unknown>(name: string) {
  return (data: TIn) => httpsCallable<TIn, TOut>(clientFunctions, name)(data);
}

function adminItem(productId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    productId,
    productName: "Test Product",
    productSku: "SKU-TEST",
    quantity: 1,
    unitPriceCents: 5000,
    unitCostCents: 2500,
    ...overrides,
  };
}

function lineItem(productId: string, quantity: number, unitPriceCents: number) {
  return {
    productId,
    productName: "Test Product",
    productSku: "SKU-TEST",
    quantity,
    unitPriceCents,
    lineTotalCents: quantity * unitPriceCents,
  };
}

const callPlaceOrder = callable<unknown, {orderId: string; orderNumber: string}>("placeOrder");
const callCreateAdminOrder = callable<unknown, {orderId: string; orderNumber: string}>("createAdminOrder");
const callUpdateAdminOrder = callable<unknown, {orderId: string; orderNumber: string}>("updateAdminOrder");
const callCancelOrder = callable<unknown, {orderNumber: string}>("cancelOrder");
const callApproveReturn = callable<unknown, {returnNumber: string}>("approveReturn");
const callSubmitReturn = callable<unknown, {returnId: string; returnNumber: string}>("submitReturn");
const callValidateCoupon =
  callable<unknown, {valid: boolean; discountCents: number; message: string}>("validateCoupon");
const callRecomputeCouponUsage = callable<unknown, {couponId: string; usedCount: number}>("recomputeCouponUsage");

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "coupons-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "coupons-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("coupon money math + tax-base ordering", () => {
  it("percentage coupon: HST is computed on the DISCOUNTED subtotal, never the gross subtotal", async () => {
    // $100 item, 10% coupon → subtotal 10000, discount 1000, taxable 9000,
    // HST 13% of 9000 = 1170 (NOT 13% of 10000 = 1300 minus anything).
    const productId = await seedProduct({priceCents: 10000});
    const code = uid("SAVE10").toUpperCase();
    await seedCoupon(code, {type: "percentage", value: 10, stackable: false});
    const {customerId} = await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
      couponCodes: [code],
    });

    const order = (await adminDb.collection("orders").doc(res.data.orderId).get()).data()!;
    expect(order["subtotalCents"]).toBe(10000);
    expect(order["couponDiscountCents"]).toBe(1000);
    expect(order["discountCents"]).toBe(1000);
    expect(order["taxCents"]).toBe(1170); // 13% of (10000 - 1000), not of 10000
    expect(order["totalCents"]).toBe(10170);
    expect(order["appliedCoupons"]).toHaveLength(1);
    expect(order["appliedCoupons"][0]).toMatchObject(
      {couponId: code, type: "percentage", value: 10, discountCents: 1000}
    );

    const coupon = await getCoupon(code);
    expect(coupon["usedCount"]).toBe(1);
    const redemption = await getRedemption(code, customerId);
    expect(redemption).toMatchObject({count: 1});
  });

  it("fixed coupon: exact cents off, tax still computed on the discounted subtotal", async () => {
    const productId = await seedProduct({priceCents: 5000});
    const code = uid("FIVEOFF").toUpperCase();
    await seedCoupon(code, {type: "fixed", value: 500, stackable: false});
    await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
      couponCodes: [code],
    });

    const order = (await adminDb.collection("orders").doc(res.data.orderId).get()).data()!;
    expect(order["couponDiscountCents"]).toBe(500);
    expect(order["taxCents"]).toBe(Math.round((5000 - 500) * 0.13)); // 585
    expect(order["totalCents"]).toBe(5000 - 500 + 585);
  });

  it("multi-coupon stacking: each coupon computed independently, then summed (not compounded)", async () => {
    const productId = await seedProduct({priceCents: 10000});
    const codeA = uid("A").toUpperCase();
    const codeB = uid("B").toUpperCase();
    // 10% + 20% on a 10000 subtotal = 1000 + 2000 = 3000, NOT compounded
    // (compounding would give 10000*0.9*0.8 = 7200, i.e. 2800 off).
    await seedCoupon(codeA, {type: "percentage", value: 10, stackable: true});
    await seedCoupon(codeB, {type: "percentage", value: 20, stackable: true});
    await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
      couponCodes: [codeA, codeB],
    });

    const order = (await adminDb.collection("orders").doc(res.data.orderId).get()).data()!;
    expect(order["couponDiscountCents"]).toBe(3000);
    expect(order["subtotalCents"] - order["couponDiscountCents"]).toBe(7000);
  });

  it("clamps combined discount at the subtotal — never a negative taxable amount", async () => {
    const productId = await seedProduct({priceCents: 1000});
    const code = uid("HUGE").toUpperCase();
    await seedCoupon(code, {type: "fixed", value: 5000, stackable: false}); // way more than the order
    await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
      couponCodes: [code],
    });

    const order = (await adminDb.collection("orders").doc(res.data.orderId).get()).data()!;
    expect(order["taxCents"]).toBe(0);
    expect(order["totalCents"]).toBe(0);
  });

  it("rejects mixing a non-stackable coupon with any other code", async () => {
    const productId = await seedProduct();
    const codeA = uid("SOLO").toUpperCase();
    const codeB = uid("OTHER").toUpperCase();
    await seedCoupon(codeA, {stackable: false});
    await seedCoupon(codeB, {stackable: true});
    await seedCustomerAndAuth();

    await expect(callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
      couponCodes: [codeA, codeB],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });
});

describe("coupon eligibility / usage limits", () => {
  it("rejects an inactive coupon", async () => {
    const productId = await seedProduct();
    const code = uid("OFF").toUpperCase();
    await seedCoupon(code, {active: false});
    await seedCustomerAndAuth();

    await expect(callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("rejects an expired coupon and one not yet started", async () => {
    const productId = await seedProduct();
    const expired = uid("EXPIRED").toUpperCase();
    const future = uid("FUTURE").toUpperCase();
    await seedCoupon(expired, {expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 86400000)});
    await seedCoupon(future, {startsAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000)});
    await seedCustomerAndAuth();

    await expect(callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [expired],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});

    await expect(callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [future],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("enforces minOrderSubtotalCents", async () => {
    const productId = await seedProduct({priceCents: 500});
    const code = uid("BIGORDER").toUpperCase();
    await seedCoupon(code, {minOrderSubtotalCents: 10000});
    await seedCustomerAndAuth();

    await expect(callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("enforces maxUsesTotal across different customers", async () => {
    const productId = await seedProduct();
    const code = uid("LIMITED").toUpperCase();
    await seedCoupon(code, {maxUsesTotal: 1});

    await seedCustomerAndAuth();
    await callPlaceOrder({deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code]});

    await signOut(clientAuth);
    await seedCustomerAndAuth();
    await expect(callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});

    expect((await getCoupon(code))["usedCount"]).toBe(1);
  });

  it("enforces maxUsesPerCustomer independent of the global cap", async () => {
    const productId = await seedProduct();
    const code = uid("ONEEACH").toUpperCase();
    await seedCoupon(code, {maxUsesPerCustomer: 1});
    const {customerId} = await seedCustomerAndAuth();

    await callPlaceOrder({deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code]});
    await expect(callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});

    const redemption = await getRedemption(code, customerId);
    expect(redemption!["count"]).toBe(1);
  });
});

describe("validateCoupon (advisory preview)", () => {
  it("rejects unauthenticated calls", async () => {
    await signOut(clientAuth);
    await expect(callValidateCoupon({couponCodes: ["ANY"], subtotalCents: 1000}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });

  it("previews a combined discount and mirrors placeOrder's stacking rejection for a non-stackable mix", async () => {
    const codeA = uid("PA").toUpperCase();
    const codeB = uid("PB").toUpperCase();
    await seedCoupon(codeA, {type: "percentage", value: 10, stackable: true});
    await seedCoupon(codeB, {type: "fixed", value: 200, stackable: false});
    await seedCustomerAndAuth();

    const preview = await callValidateCoupon({couponCodes: [codeA], subtotalCents: 10000});
    expect(preview.data).toMatchObject({valid: true, discountCents: 1000});
    expect((preview.data as any).couponId).toBeUndefined(); // never leaks raw coupon fields

    const rejected = await callValidateCoupon({couponCodes: [codeA, codeB], subtotalCents: 10000});
    expect(rejected.data.valid).toBe(false);
  });
});

describe("release idempotency", () => {
  it("cancelOrder releases both usedCount and the customer's redemption count exactly once", async () => {
    const productId = await seedProduct({priceCents: 5000});
    const code = uid("CANCELME").toUpperCase();
    await seedCoupon(code, {type: "percentage", value: 10, stackable: false});
    const {customerId} = await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery", items: [{productId, quantity: 1}], couponCodes: [code],
    });
    expect((await getCoupon(code))["usedCount"]).toBe(1);

    await callCancelOrder({orderId: res.data.orderId, reason: "test cancel"});

    expect((await getCoupon(code))["usedCount"]).toBe(0);
    expect((await getRedemption(code, customerId))!["count"]).toBe(0);
    const order = (await adminDb.collection("orders").doc(res.data.orderId).get()).data()!;
    expect(order["couponsReleasedAt"]).toBeTruthy();
  });

  it("remove-then-readd-then-cancel: exactly one active redemption is released, not zero", async () => {
    // place with a coupon (redeemed) -> updateAdminOrder removes it
    // (releaseCoupons, no flag set) -> updateAdminOrder re-adds it
    // (redeemCoupons again) -> cancelAdminOrder -> the terminal release
    // must still fire (couponsReleasedAt wasn't wrongly set by the
    // incremental removal) and decrement exactly the one live redemption.
    const productId = await seedProduct({priceCents: 5000});
    const code = uid("LEAKTEST").toUpperCase();
    await seedCoupon(code, {type: "fixed", value: 100, stackable: false});
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});

    const created = await callCreateAdminOrder({
      customerId,
      items: [adminItem(productId)],
      discountCents: 0,
      couponCodes: [code],
      taxRatePercent: 13,
      deliveryType: "delivery",
      customerNotes: "",
      internalNotes: "",
      expectedDeliveryDateMs: null,
    });
    expect((await getCoupon(code))["usedCount"]).toBe(1);

    // Remove the coupon via an edit.
    await callUpdateAdminOrder({
      orderId: created.data.orderId,
      items: [adminItem(productId)],
      discountCents: 0,
      couponCodes: [],
      taxRatePercent: 13,
      deliveryType: "delivery",
      customerNotes: "",
      internalNotes: "",
      expectedDeliveryDateMs: null,
    });
    expect((await getCoupon(code))["usedCount"]).toBe(0);
    let order = (await adminDb.collection("orders").doc(created.data.orderId).get()).data()!;
    expect(order["couponsReleasedAt"]).toBeUndefined(); // incremental removal must NOT set the terminal flag

    // Re-add the same coupon.
    await callUpdateAdminOrder({
      orderId: created.data.orderId,
      items: [adminItem(productId)],
      discountCents: 0,
      couponCodes: [code],
      taxRatePercent: 13,
      deliveryType: "delivery",
      customerNotes: "",
      internalNotes: "",
      expectedDeliveryDateMs: null,
    });
    expect((await getCoupon(code))["usedCount"]).toBe(1);

    // Cancel — must still release since couponsReleasedAt was never set.
    const callCancelAdminOrder = callable("cancelAdminOrder");
    await callCancelAdminOrder({orderId: created.data.orderId, reason: "test"});

    expect((await getCoupon(code))["usedCount"]).toBe(0); // released exactly once, not left at -1 or stuck at 1
    expect((await getRedemption(code, customerId))!["count"]).toBe(0);
    order = (await adminDb.collection("orders").doc(created.data.orderId).get()).data()!;
    expect(order["couponsReleasedAt"]).toBeTruthy();
  });

  it("rejects redeeming a new coupon onto an order whose coupons were already terminally released", async () => {
    const productId = await seedProduct({priceCents: 5000});
    const code = uid("REDEEMAFTER").toUpperCase();
    await seedCoupon(code, {stackable: false});
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});

    const created = await callCreateAdminOrder({
      customerId,
      items: [adminItem(productId)],
      discountCents: 0,
      couponCodes: [],
      taxRatePercent: 13,
      deliveryType: "delivery",
      customerNotes: "",
      internalNotes: "",
      expectedDeliveryDateMs: null,
    });

    const callCancelAdminOrder = callable("cancelAdminOrder");
    await callCancelAdminOrder({orderId: created.data.orderId, reason: "test"});

    // updateAdminOrder is gated to status==='confirmed', so this should
    // already be rejected by the status guard — asserting it's rejected
    // either way (status guard or the flag check) is what matters here.
    await expect(callUpdateAdminOrder({
      orderId: created.data.orderId,
      items: [adminItem(productId)],
      discountCents: 0,
      couponCodes: [code],
      taxRatePercent: 13,
      deliveryType: "delivery",
      customerNotes: "",
      internalNotes: "",
      expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });
});

describe("returns interaction", () => {
  it("a full return releases the coupon's redemption; a partial return does not touch appliedCoupons", async () => {
    const productId = await seedProduct();
    const code = uid("RETURNTEST").toUpperCase();
    await seedCoupon(code, {type: "fixed", value: 300});
    const customerId = await seedCustomer();

    const orderId = await seedOrder(customerId, {
      status: "delivered",
      items: [lineItem(productId, 2, 1000)],
      subtotalCents: 2000,
      discountCents: 300,
      couponDiscountCents: 300,
      appliedCoupons: [{couponId: code, code, type: "fixed", value: 300, discountCents: 300}],
      totalCents: 2000 - 300,
      balanceCents: 0,
      amountPaidCents: 2000 - 300,
    });
    // Manually redeem, matching what placeOrder would have done, so
    // release has something real to decrement.
    await adminDb.collection("coupons").doc(code).update({usedCount: 1});
    await adminDb.collection("coupons").doc(code).collection("redemptions").doc(customerId).set({
      count: 1, lastOrderId: orderId, lastRedeemedAt: new Date(), tenantId: 1, isDeleted: false,
    });

    // Partial return of 1 of the 2 units — isFullReturn: false.
    const partialReturnId = await seedReturn(orderId, customerId, {
      isFullReturn: false,
      amountCents: 1000,
      items: [lineItem(productId, 1, 1000)],
    });
    await signInStaff({role: "admin"});
    await callApproveReturn({returnId: partialReturnId, restoreStock: true});

    expect((await getCoupon(code))["usedCount"]).toBe(1); // untouched by a partial return
    let order = (await adminDb.collection("orders").doc(orderId).get()).data()!;
    expect(order["appliedCoupons"]).toHaveLength(1); // untouched
    expect(order["couponsReleasedAt"]).toBeUndefined();

    // Full return of the remaining unit — isFullReturn: true.
    const fullReturnId = await seedReturn(orderId, customerId, {
      isFullReturn: true,
      amountCents: 1000,
      items: [lineItem(productId, 1, 1000)],
    });
    await callApproveReturn({returnId: fullReturnId, restoreStock: true});

    expect((await getCoupon(code))["usedCount"]).toBe(0); // released on the full return
    expect((await getRedemption(code, customerId))!["count"]).toBe(0);
    order = (await adminDb.collection("orders").doc(orderId).get()).data()!;
    expect(order["couponsReleasedAt"]).toBeTruthy();
  });

  it("an admin-created full return via submitReturn (not a direct client write) also releases the coupon", async () => {
    // Before consolidating the admin "create return" modal onto
    // submitReturn, it wrote return docs straight from the client and
    // never computed isFullReturn — so a full return an admin created
    // silently never released the coupon's redemption slot. This drives
    // the whole flow through the real callable, as staff, so isFullReturn
    // is genuinely derived server-side rather than hand-seeded.
    const productId = await seedProduct();
    const code = uid("ADMINRETURN").toUpperCase();
    await seedCoupon(code, {type: "fixed", value: 300});
    const customerId = await seedCustomer();

    const orderId = await seedOrder(customerId, {
      status: "delivered",
      items: [lineItem(productId, 2, 1000)],
      subtotalCents: 2000,
      discountCents: 300,
      couponDiscountCents: 300,
      appliedCoupons: [{couponId: code, code, type: "fixed", value: 300, discountCents: 300}],
      totalCents: 2000 - 300,
      balanceCents: 0,
      amountPaidCents: 2000 - 300,
    });
    await adminDb.collection("coupons").doc(code).update({usedCount: 1});
    await adminDb.collection("coupons").doc(code).collection("redemptions").doc(customerId).set({
      count: 1, lastOrderId: orderId, lastRedeemedAt: new Date(), tenantId: 1, isDeleted: false,
    });

    await signInStaff({role: "admin"});
    const submitRes = await callSubmitReturn({
      orderId,
      items: [{productId, quantity: 2}], // the whole order — a full return
      returnType: "credit_note",
      reasonCode: "wrong_item",
      notes: "Admin-created return",
    });
    const returnId = submitRes.data.returnId;

    const returnSnap = await adminDb.collection("returns").doc(returnId).get();
    expect(returnSnap.data()!["isFullReturn"]).toBe(true); // derived, not hand-seeded
    expect(returnSnap.data()!["source"]).toBe("admin");

    await callApproveReturn({returnId, restoreStock: true});

    expect((await getCoupon(code))["usedCount"]).toBe(0); // released
    expect((await getRedemption(code, customerId))!["count"]).toBe(0);
    const order = (await adminDb.collection("orders").doc(orderId).get()).data()!;
    expect(order["couponsReleasedAt"]).toBeTruthy();
  });
});

describe("recomputeCouponUsage (drift-safety sweep)", () => {
  it("recomputes usedCount from redemption docs and is a no-op the second time it's run", async () => {
    const code = uid("SWEEP").toUpperCase();
    await seedCoupon(code, {usedCount: 999}); // deliberately wrong
    const custA = uid("cust-a");
    const custB = uid("cust-b");
    const redemptionsRef = adminDb.collection("coupons").doc(code).collection("redemptions");
    await redemptionsRef.doc(custA).set({count: 2, tenantId: 1, isDeleted: false});
    await redemptionsRef.doc(custB).set({count: 3, tenantId: 1, isDeleted: false});
    await signInStaff({role: "admin"});

    const first = await callRecomputeCouponUsage({couponId: code});
    expect(first.data.usedCount).toBe(5);
    expect((await getCoupon(code))["usedCount"]).toBe(5);

    const second = await callRecomputeCouponUsage({couponId: code});
    expect(second.data.usedCount).toBe(5); // idempotent — no change on the second pass
  });

  it("is staff-only", async () => {
    await seedCustomerAndAuth();
    const code = uid("STAFFONLY").toUpperCase();
    await seedCoupon(code);
    await expect(callRecomputeCouponUsage({couponId: code}))
      .rejects.toMatchObject({code: "functions/permission-denied"});
  });
});
