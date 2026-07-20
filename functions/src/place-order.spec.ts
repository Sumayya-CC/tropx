import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 3.3 — transactional integrity. placeOrder tested as a real black
 * box: a genuine onCall invocation through the Functions emulator against
 * real Firestore/Auth emulators, using the same named database ("tropx-dev")
 * and region ("northamerica-northeast2") the deployed function actually
 * uses — not a re-implementation, not a mocked transaction.
 *
 * Run via `npm run test:ci` (functions/), which builds and boots
 * auth+firestore+storage+functions emulators via `firebase emulators:exec`
 * before this file's tests run, and tears everything down after.
 */

const REGION = "northamerica-northeast2";
const DATABASE_ID = "tropx-dev"; // matches index.ts's GCLOUD_PROJECT resolution for any non-prod project
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
    name: "Test Product",
    sku: "SKU-TEST",
    priceCents: 1000,
    costCents: 500,
    stock: 50,
    active: true,
    isDeleted: false,
    tenantId: 1,
    ...overrides,
  });
  return id;
}

/**
 * Signs the client SDK in as a fresh user carrying the given custom claims.
 * @param {Record<string, unknown>} claims Custom claims to mint on the token.
 * @return {Promise<string>} The new user's Auth uid.
 */
async function signInWithClaims(claims: Record<string, unknown>) {
  const userRecord = await adminAuth.createUser({});
  const customToken = await adminAuth.createCustomToken(userRecord.uid, claims);
  const cred = await signInWithCustomToken(clientAuth, customToken);
  await cred.user.getIdToken(true); // force a fresh token carrying the custom claims
  return userRecord.uid;
}

async function seedCustomerAndAuth(overrides: Partial<Record<string, unknown>> = {}) {
  const customerId = uid("customer");
  await adminDb.collection("customers").doc(customerId).set({
    businessName: "Test Business",
    ownerFirstName: "Test",
    ownerLastName: "Owner",
    email: "test@example.com",
    phone: "5551234567",
    totalOrderedCents: 0,
    totalOwingCents: 0,
    tenantId: 1,
    isDeleted: false,
    ...overrides,
  });

  const authUid = await signInWithClaims({role: "customer", linkedCustomerId: customerId, tenantId: 1});
  return {customerId, uid: authUid};
}

async function callPlaceOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "placeOrder");
  return callable(data);
}

/**
 * Narrows a caught error to the shape httpsCallable throws.
 * @param {unknown} err The value caught from a rejected callable call.
 * @return {{code: string, message: string}} Error with a code like
 *   "functions/failed-precondition".
 */
function asFunctionsError(err: unknown): {code: string; message: string} {
  return err as {code: string; message: string};
}

beforeAll(async () => {
  const adminApp = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "place-order-spec-admin",
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
    "place-order-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

// Previously blocked on a Functions Emulator bug: the old namespace-style
// `admin.firestore.FieldValue` static access crashes inside the emulator
// sandbox specifically when combined with this file's named-database
// db.settings() call (confirmed via a plain-Node repro that the identical
// code works fine outside the emulator — production, on the real Cloud
// Functions runtime, was never affected). Fixed by switching placeOrder's
// one usage to the modular `firebase-admin/firestore` import (see index.ts).
// The other 22 admin.firestore.FieldValue/.Timestamp sites elsewhere in
// index.ts are left as-is on purpose — that cleanup is scoped to the
// Phase 5 index.ts split, not this testing phase.
describe("placeOrder", () => {
  it("places an order end-to-end: order, counters, sequence, stock, " +
    "and stockAdjustments all commit together", async () => {
    const productId = await seedProduct({priceCents: 1500, costCents: 700, stock: 20});
    const {customerId} = await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery",
      notes: "test order",
      items: [{productId, quantity: 3}],
    });

    const data = res.data as {orderId: string; orderNumber: string};
    expect(data.orderId).toBeTruthy();
    expect(data.orderNumber).toMatch(/^TRX-\d{4}-\d{4}$/);

    const orderSnap = await adminDb.collection("orders").doc(data.orderId).get();
    const order = orderSnap.data()!;
    expect(order["subtotalCents"]).toBe(4500); // 3 x 1500
    expect(order["taxCents"]).toBe(585); // 4500 * 13%
    expect(order["totalCents"]).toBe(5085);
    expect(order["status"]).toBe("confirmed");
    expect(order["source"]).toBe("customer_portal");
    expect(order["customerId"]).toBe(customerId);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(17); // 20 - 3

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalOwingCents"]).toBe(5085);
    expect(custSnap.data()!["totalOrderedCents"]).toBe(5085);

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedOrderId", "==", data.orderId)
      .get();
    expect(adjSnap.size).toBe(1);
    const adj = adjSnap.docs[0].data();
    expect(adj["type"]).toBe("sold");
    expect(adj["quantity"]).toBe(-3);
    expect(adj["previousStock"]).toBe(20);
    expect(adj["newStock"]).toBe(17);
  });

  it("derives totals from the server-side product price, ignoring any price the client sends", async () => {
    const productId = await seedProduct({priceCents: 2000, costCents: 900, stock: 10});
    await seedCustomerAndAuth();

    // A client payload only ever carries {productId, quantity} in the real
    // app (see PortalService.placeOrder) — this simulates a tampered
    // request that also smuggles a price, to prove the server never reads
    // it. placeOrder's PlaceOrderItem parsing only extracts productId/
    // quantity from each item, so this also documents that any extra
    // field is silently ignored rather than trusted.
    const res = await callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1, unitPriceCents: 1, priceCents: 1}],
    });

    const data = res.data as {orderId: string};
    const orderSnap = await adminDb.collection("orders").doc(data.orderId).get();
    const order = orderSnap.data()!;
    const item = (order["items"] as Array<Record<string, unknown>>)[0];
    expect(item["unitPriceCents"]).toBe(2000); // the real seeded price, not 1
    expect(order["subtotalCents"]).toBe(2000);
  });

  it("blocks an oversell when the product does not allow backorder", async () => {
    const productId = await seedProduct({stock: 5, outOfStockBehaviorOverride: "show_disabled"});
    await seedCustomerAndAuth();

    await expect(callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 10}],
    })).rejects.toMatchObject({code: "functions/failed-precondition"});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(5); // untouched — the whole call was rejected
  });

  it("allows an oversell when the product allows backorder, floors stock at 0, and records the shortfall", async () => {
    const productId = await seedProduct({
      priceCents: 1000,
      stock: 5,
      outOfStockBehaviorOverride: "allow_backorder",
    });
    await seedCustomerAndAuth();

    const res = await callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 8}], // 3 more than the 5 in stock
    });

    const data = res.data as {orderId: string; hasBackorder: boolean; totalBackorderedUnits: number};
    expect(data.hasBackorder).toBe(true);
    expect(data.totalBackorderedUnits).toBe(3);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(0); // floored, never negative

    const orderSnap = await adminDb.collection("orders").doc(data.orderId).get();
    const item = (orderSnap.data()!["items"] as Array<Record<string, unknown>>)[0];
    expect(item["backorderedQty"]).toBe(3);
    expect(item["quantity"]).toBe(8); // the full requested amount is still recorded honestly
  });

  it("rejects a caller whose role is not customer", async () => {
    const productId = await seedProduct();
    await signInWithClaims({role: "admin", linkedCustomerId: "someone", tenantId: 1});

    await expect(callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects a customer-role caller with no linkedCustomerId claim", async () => {
    const productId = await seedProduct();
    await signInWithClaims({role: "customer", tenantId: 1}); // no linkedCustomerId

    await expect(callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const productId = await seedProduct();
    await signOut(clientAuth); // no user signed in at all

    await expect(callPlaceOrder({
      deliveryType: "delivery",
      items: [{productId, quantity: 1}],
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });

  it("commits nothing when one item in a multi-item cart fails mid-transaction", async () => {
    const goodProductId = await seedProduct({priceCents: 1000, stock: 20});
    const missingProductId = uid("product"); // never written to Firestore
    const {customerId} = await seedCustomerAndAuth();

    let caught: unknown;
    try {
      await callPlaceOrder({
        deliveryType: "delivery",
        items: [
          {productId: goodProductId, quantity: 2},
          {productId: missingProductId, quantity: 1},
        ],
      });
    } catch (err) {
      caught = err;
    }

    expect(asFunctionsError(caught).code).toBe("functions/failed-precondition");

    // All reads happen before any write inside the transaction, and the
    // whole callback throws before reaching the writes section — nothing
    // should have committed for the GOOD item either.
    const productSnap = await adminDb.collection("products").doc(goodProductId).get();
    expect(productSnap.data()!["stock"]).toBe(20); // untouched

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalOwingCents"]).toBe(0); // untouched

    const ordersSnap = await adminDb
      .collection("orders")
      .where("customerId", "==", customerId)
      .get();
    expect(ordersSnap.empty).toBe(true); // no partial order was created

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("productId", "==", goodProductId)
      .get();
    expect(adjSnap.empty).toBe(true); // no stray adjustment for the good item either
  });
});
