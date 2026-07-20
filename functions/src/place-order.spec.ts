import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, Auth} from "firebase/auth";
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

  const userRecord = await adminAuth.createUser({});
  const customToken = await adminAuth.createCustomToken(userRecord.uid, {
    role: "customer",
    linkedCustomerId: customerId,
    tenantId: 1,
  });
  const cred = await signInWithCustomToken(clientAuth, customToken);
  await cred.user.getIdToken(true); // force a fresh token carrying the custom claims
  return {customerId, uid: userRecord.uid};
}

async function callPlaceOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "placeOrder");
  return callable(data);
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
});
