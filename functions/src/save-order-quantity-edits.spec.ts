import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.2 stock-write migration, money-coupled
 * tier, site 4 of 4 (last site in the tier). order-detail.component.ts
 * saveOrderEdits() — the inline quick-edit on the order detail page,
 * distinct from order-form's full edit (updateAdminOrder) — used to be a
 * client writeBatch keyed off live-listener snapshots plus a
 * getDoc-then-batch race on the customer doc and every touched product.
 * This flow is reduce-only: quantities can only go down from what was
 * ordered (stock is already committed), never up. Moved to a
 * runTransaction. Same emulator setup as create-admin-order.spec.ts.
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

let seq = 0;
/**
 * Unique-per-test id so tests never collide on shared fixtures.
 * @param {string} prefix Label prepended to the generated id.
 * @return {string} A unique id like "product-<timestamp>-<n>".
 */
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

async function seedProduct(overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("product");
  await adminDb.collection("products").doc(id).set({
    name: "Test Product", sku: "SKU-TEST", priceCents: 1000, costCents: 500,
    stock: 10, active: true, isDeleted: false, tenantId: 1,
    ...overrides,
  });
  return id;
}

async function signInStaff(claims: Record<string, unknown>, profile: Record<string, unknown> = {}) {
  const userRecord = await adminAuth.createUser({});
  await adminDb.collection("users").doc(userRecord.uid).set({
    firstName: "Staff", lastName: "Member", role: claims["role"] || "admin", tenantId: 1,
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
    businessName: "Test Business", totalOrderedCents: 0, totalOwingCents: 0,
    tenantId: 1, isDeleted: false,
    ...overrides,
  });
  return customerId;
}

async function seedOrder(customerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("order");
  await adminDb.collection("orders").doc(id).set({
    orderNumber: `TRX-2026-${id.slice(-4)}`,
    customerId, status: "confirmed", items: [], taxRatePercent: 13,
    totalCents: 0, amountPaidCents: 0, balanceCents: 0,
    tenantId: 1, isDeleted: false, createdAt: new Date(),
    ...overrides,
  });
  return id;
}

async function callSaveOrderQuantityEdits(data: unknown) {
  const callable = httpsCallable(clientFunctions, "saveOrderQuantityEdits");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "save-order-qty-edits-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "save-order-qty-edits-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("saveOrderQuantityEdits", () => {
  it("reducing a quantity restores stock, recomputes totals, and reverses customer counters", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer({totalOrderedCents: 5650, totalOwingCents: 5650});
    const orderId = await seedOrder(customerId, {
      totalCents: 5650, amountPaidCents: 0, taxRatePercent: 13,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 5, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 5000, lineCostCents: 2500, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callSaveOrderQuantityEdits({
      orderId,
      items: [{productId, quantity: 2, unitPriceCents: 1000}],
      discountCents: 0,
    });
    expect((res.data as {orderId: string}).orderId).toBe(orderId);

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["subtotalCents"]).toBe(2000); // 2 x 1000
    expect(orderSnap.data()!["taxCents"]).toBe(260); // 2000 * 13%
    expect(orderSnap.data()!["totalCents"]).toBe(2260);
    expect(orderSnap.data()!["lastEditedBy"]).toMatchObject({firstName: "Ada"});
    const items = orderSnap.data()!["items"] as Array<Record<string, unknown>>;
    expect(items[0]["unitCostCents"]).toBe(500); // carried from the original line, not re-derived

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(13); // 10 + 3 restored

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedOrderId", "==", orderId).get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("adjustment");
    expect(adjSnap.docs[0].data()["quantity"]).toBe(3);

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    // totalDiff = 2260 - 5650 = -3390
    expect(custSnap.data()!["totalOrderedCents"]).toBe(2260);
    expect(custSnap.data()!["totalOwingCents"]).toBe(2260);
  });

  it("clamps an attempted quantity increase back down to the original — never deducts more stock", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      totalCents: 2000,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"});

    // Tampered request: tries to raise quantity from 2 to 9.
    await callSaveOrderQuantityEdits({
      orderId, items: [{productId, quantity: 9, unitPriceCents: 1000}], discountCents: 0,
    });

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    const items = orderSnap.data()!["items"] as Array<Record<string, unknown>>;
    expect(items[0]["quantity"]).toBe(2); // clamped back to original, not 9

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(10); // untouched — no reduction occurred
  });

  it("allows a price change alongside a quantity reduction", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      totalCents: 2000,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "manager"});

    await callSaveOrderQuantityEdits({
      orderId, items: [{productId, quantity: 1, unitPriceCents: 800}], discountCents: 0,
    });

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    const items = orderSnap.data()!["items"] as Array<Record<string, unknown>>;
    expect(items[0]["unitPriceCents"]).toBe(800);
    expect(items[0]["lineTotalCents"]).toBe(800);
  });

  it("rejects an item list that doesn't match the order's existing lines", async () => {
    const productId = await seedProduct();
    const otherProductId = await seedProduct();
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"});

    await expect(callSaveOrderQuantityEdits({
      orderId, items: [{productId: otherProductId, quantity: 1, unitPriceCents: 1000}], discountCents: 0,
    })).rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects editing an order that's no longer editable", async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      status: "delivered",
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"});

    await expect(callSaveOrderQuantityEdits({
      orderId, items: [{productId, quantity: 1, unitPriceCents: 1000}], discountCents: 0,
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("allows editing from preparing or out_for_delivery, matching canEditOrder()", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      status: "out_for_delivery",
      totalCents: 2000,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    await signInStaff({role: "admin"});

    const res = await callSaveOrderQuantityEdits({
      orderId, items: [{productId, quantity: 1, unitPriceCents: 1000}], discountCents: 0,
    });
    expect((res.data as {orderId: string}).orderId).toBe(orderId);
  });

  it("rejects a customer (non-staff) caller", async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 1000, unitCostCents: 500,
        lineTotalCents: 2000, lineCostCents: 1000, currencyCode: "CAD",
      }],
    });
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", linkedCustomerId: customerId, tenantId: 1}),
    );

    await expect(callSaveOrderQuantityEdits({
      orderId, items: [{productId, quantity: 1, unitPriceCents: 1000}], discountCents: 0,
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    await signOut(clientAuth);

    await expect(callSaveOrderQuantityEdits({
      orderId, items: [], discountCents: 0,
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
