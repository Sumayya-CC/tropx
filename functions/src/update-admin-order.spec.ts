import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.2 stock-write migration, money-coupled
 * tier, site 2 of 4. order-form.component.ts saveEditedOrder() used to be
 * a client writeBatch keyed off originalOrder() — a live listener
 * snapshot that could be stale by the time save ran — plus a
 * getDoc()-then-batch race on the customer doc and every touched
 * product. Moved to a runTransaction: the diff baseline (originalItems,
 * totalCents, amountPaidCents, status) now all come from the
 * transaction's own fresh read. Same emulator setup as
 * create-admin-order.spec.ts.
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

/**
 * Unique-per-test id. Uses randomUUID() rather than Date.now()+counter —
 * spec files run in parallel Jest workers against one shared emulator
 * Firestore instance, so a timestamp+per-file-counter scheme can produce
 * the same id from two different files in the same millisecond, causing
 * one test to read back another test's fixture.
 * @param {string} prefix Label prepended to the generated id.
 * @return {string} A unique id like "product-<uuid>".
 */
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
    stock: 20,
    active: true,
    isDeleted: false,
    tenantId: 1,
    ...overrides,
  });
  return id;
}

async function signInStaff(
  claims: Record<string, unknown>,
  profile: Record<string, unknown> = {},
) {
  const userRecord = await adminAuth.createUser({});
  await adminDb.collection("users").doc(userRecord.uid).set({
    firstName: "Staff",
    lastName: "Member",
    role: claims["role"] || "admin",
    tenantId: 1,
    ...profile,
  });
  const customToken = await adminAuth.createCustomToken(userRecord.uid, claims);
  const cred = await signInWithCustomToken(clientAuth, customToken);
  await cred.user.getIdToken(true);
  return userRecord.uid;
}

async function seedCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  const customerId = uid("customer");
  await adminDb.collection("customers").doc(customerId).set({
    businessName: "Test Business",
    totalOrderedCents: 0,
    totalOwingCents: 0,
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
    status: "confirmed",
    items: [],
    subtotalCents: 0,
    totalCents: 0,
    amountPaidCents: 0,
    balanceCents: 0,
    tenantId: 1,
    isDeleted: false,
    createdAt: new Date(),
    ...overrides,
  });
  return id;
}

async function callUpdateAdminOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "updateAdminOrder");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "update-admin-order-spec-admin",
  );
  adminDb = adminApp.firestore();
  adminDb.settings({
    host: `127.0.0.1:${FIRESTORE_PORT}`,
    ssl: false,
    databaseId: DATABASE_ID,
  });
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "update-admin-order-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("updateAdminOrder", () => {
  it("increasing a line quantity deducts more stock and increases customer counters", async () => {
    const productId = await seedProduct({stock: 20});
    const customerId = await seedCustomer({totalOrderedCents: 1130, totalOwingCents: 1130});
    const orderId = await seedOrder(customerId, {
      totalCents: 1130, // 2 x 1000 = 2000 subtotal? use simple numbers below
      amountPaidCents: 0,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callUpdateAdminOrder({
      orderId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 5, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });
    expect((res.data as {orderId: string}).orderId).toBe(orderId);

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["totalCents"]).toBe(5000); // 5 x 1000
    expect(orderSnap.data()!["updatedBy"]).toMatchObject({firstName: "Ada"});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(17); // 20 - (5-2) more deducted

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    // totalDiff = 5000 - 1130 = 3870
    expect(custSnap.data()!["totalOrderedCents"]).toBe(5000); // 1130 + 3870
    expect(custSnap.data()!["totalOwingCents"]).toBe(5000);

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedOrderId", "==", orderId).get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("sold");
    expect(adjSnap.docs[0].data()["quantity"]).toBe(-3); // 3 more sold
  });

  it("reducing a line quantity restores stock and decreases customer counters", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer({totalOrderedCents: 5000, totalOwingCents: 5000});
    const orderId = await seedOrder(customerId, {
      totalCents: 5000,
      amountPaidCents: 2000,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 5, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 5000, lineCostCents: 2500, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "manager"});

    await callUpdateAdminOrder({
      orderId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["totalCents"]).toBe(2000);
    expect(orderSnap.data()!["balanceCents"]).toBe(0); // max(0, 2000 - 2000 paid)

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(13); // 10 + 3 restored

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedOrderId", "==", orderId).get();
    expect(adjSnap.docs[0].data()["type"]).toBe("returned");
    expect(adjSnap.docs[0].data()["quantity"]).toBe(3);

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    // totalDiff = 2000 - 5000 = -3000
    expect(custSnap.data()!["totalOrderedCents"]).toBe(2000);
    expect(custSnap.data()!["totalOwingCents"]).toBe(2000);
  });

  it("removing a line entirely restores its full stock", async () => {
    const productA = await seedProduct({stock: 10});
    const productB = await seedProduct({stock: 10});
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      totalCents: 3000,
      items: [
        {
          productId: productA, productName: "A", productSku: "A-SKU",
          quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
          lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
        },
        {
          productId: productB, productName: "B", productSku: "B-SKU",
          quantity: 1, unitPriceCents: 1000, unitCostCents: 500,
          lineTotalCents: 1000, lineCostCents: 500, currencyCode: "CAD",
        },
      ],
    });
    await signInStaff({role: "admin"});

    await callUpdateAdminOrder({
      orderId,
      items: [{
        productId: productA, productName: "A", productSku: "A-SKU",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    const bSnap = await adminDb.collection("products").doc(productB).get();
    expect(bSnap.data()!["stock"]).toBe(11); // fully restored

    const aSnap = await adminDb.collection("products").doc(productA).get();
    expect(aSnap.data()!["stock"]).toBe(10); // unchanged, quantity 2 -> 2
  });

  it("uses the transaction's own fresh read as the diff baseline, not a stale client snapshot", async () => {
    // Simulates two staff tabs: this test just asserts the server computes
    // the diff from whatever is actually stored right now, which is the
    // entire point of the migration — there's no client "original" input
    // to the callable at all, so a stale open tab can't feed a wrong base.
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer({totalOrderedCents: 1000, totalOwingCents: 1000});
    const orderId = await seedOrder(customerId, {
      totalCents: 1000,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 1, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 1000, lineCostCents: 500, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"});

    // Someone else already bumped the order to qty 4 out-of-band.
    await adminDb.collection("orders").doc(orderId).update({
      totalCents: 4000,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 4, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 4000, lineCostCents: 2000, currencyCode: "CAD",
      }],
    });
    await adminDb.collection("products").doc(productId).update({stock: 7}); // 10 - 3 already deducted

    await callUpdateAdminOrder({
      orderId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 5, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    // diff should be 5 - 4 = 1 (against the fresh stored qty of 4), not 5 - 1 = 4.
    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(6); // 7 - 1
  });

  it("rejects editing an order that's no longer confirmed", async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {status: "out_for_delivery"});
    await signInStaff({role: "admin"});

    await expect(callUpdateAdminOrder({
      orderId,
      items: [{productId, productName: "x", productSku: "x", quantity: 1, unitPriceCents: 100, unitCostCents: 50}],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("rejects an empty item list", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    await signInStaff({role: "admin"});

    await expect(callUpdateAdminOrder({
      orderId, items: [], discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects a nonexistent order", async () => {
    await signInStaff({role: "admin"});

    await expect(callUpdateAdminOrder({
      orderId: "does-not-exist",
      items: [{productId: "x", productName: "x", productSku: "x", quantity: 1, unitPriceCents: 100, unitCostCents: 50}],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/not-found"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", linkedCustomerId: customerId, tenantId: 1}),
    );

    await expect(callUpdateAdminOrder({
      orderId,
      items: [{productId: "x", productName: "x", productSku: "x", quantity: 1, unitPriceCents: 100, unitCostCents: 50}],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    await signOut(clientAuth);

    await expect(callUpdateAdminOrder({
      orderId,
      items: [{productId: "x", productName: "x", productSku: "x", quantity: 1, unitPriceCents: 100, unitCostCents: 50}],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
