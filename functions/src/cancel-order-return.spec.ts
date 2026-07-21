import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — cancelOrder / submitReturn. Both used to
 * be a direct client Firestore batch write from the portal (orders,
 * customers, settings/returnSequence, products, stockAdjustments — all
 * staff-only or narrowly-scoped under firestore.rules), which meant every
 * write in the batch had to independently pass rules or the whole batch
 * was denied — so neither feature actually worked for a real customer.
 * Moved server-side, same reasoning and same emulator setup as
 * place-order.spec.ts: a genuine onCall invocation through the Functions
 * emulator against real Firestore/Auth emulators, not a re-implementation.
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
    totalPaidCents: 0,
    creditBalanceCents: 0,
    tenantId: 1,
    isDeleted: false,
    ...overrides,
  });

  const authUid = await signInWithClaims({role: "customer", linkedCustomerId: customerId, tenantId: 1});
  return {customerId, uid: authUid};
}

async function seedOrder(
  customerId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const id = uid("order");
  await adminDb.collection("orders").doc(id).set({
    orderNumber: `TRX-2026-${id.slice(-4)}`,
    customerId,
    customerName: "Test Business",
    customerEmail: "test@example.com",
    status: "confirmed",
    source: "customer_portal",
    items: [],
    subtotalCents: 0,
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

async function callCancelOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "cancelOrder");
  return callable(data);
}

async function callSubmitReturn(data: unknown) {
  const callable = httpsCallable(clientFunctions, "submitReturn");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "cancel-order-return-spec-admin",
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
    "cancel-order-return-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("cancelOrder", () => {
  it("cancels a confirmed order: status, customer counters, and stock all reverse together", async () => {
    const productId = await seedProduct({stock: 10});
    const {customerId} = await seedCustomerAndAuth({
      totalOrderedCents: 5000,
      totalOwingCents: 5000,
    });
    const orderId = await seedOrder(customerId, {
      totalCents: 5000,
      balanceCents: 5000,
      amountPaidCents: 0,
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 3,
        unitPriceCents: 1000,
        lineTotalCents: 3000,
      }],
    });

    const res = await callCancelOrder({orderId, reason: "Changed my mind"});
    expect((res.data as {orderNumber: string}).orderNumber).toBeTruthy();

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    const order = orderSnap.data()!;
    expect(order["status"]).toBe("cancelled");
    expect(order["balanceCents"]).toBe(0);
    expect(order["cancellationReason"]).toBe("Changed my mind");

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalOrderedCents"]).toBe(0); // 5000 - 5000
    expect(custSnap.data()!["totalOwingCents"]).toBe(0); // 5000 - 5000

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(13); // 10 + 3 restored

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedOrderId", "==", orderId)
      .get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("returned");
    expect(adjSnap.docs[0].data()["quantity"]).toBe(3);

    // No money changed hands on this order, so no credit/refund record.
    const returnsSnap = await adminDb
      .collection("returns")
      .where("orderId", "==", orderId)
      .get();
    expect(returnsSnap.empty).toBe(true);
  });

  it("creates a store-credit record and reverses paid amounts when the order was already paid", async () => {
    const {customerId} = await seedCustomerAndAuth({
      totalOrderedCents: 2000,
      totalOwingCents: 0,
      totalPaidCents: 2000,
      creditBalanceCents: 0,
    });
    const orderId = await seedOrder(customerId, {
      totalCents: 2000,
      balanceCents: 0,
      amountPaidCents: 2000,
      items: [],
    });

    await callCancelOrder({orderId, reason: "No longer needed"});

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalPaidCents"]).toBe(0); // 2000 - 2000
    expect(custSnap.data()!["creditBalanceCents"]).toBe(2000);

    const returnsSnap = await adminDb
      .collection("returns")
      .where("orderId", "==", orderId)
      .get();
    expect(returnsSnap.size).toBe(1);
    const credit = returnsSnap.docs[0].data();
    expect(credit["type"]).toBe("refund");
    expect(credit["status"]).toBe("approved");
    expect(credit["source"]).toBe("cancellation");
    expect(credit["amountCents"]).toBe(2000);
    expect(credit["returnNumber"]).toMatch(/^RET-\d{4}-\d{4}$/);
  });

  it("rejects cancelling an order that belongs to a different customer", async () => {
    const {customerId: ownerCustomerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(ownerCustomerId);
    await seedCustomerAndAuth(); // signs in as a second, unrelated customer

    await expect(callCancelOrder({orderId, reason: "Not mine"}))
      .rejects.toMatchObject({code: "functions/permission-denied"});

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["status"]).toBe("confirmed"); // untouched
  });

  it("rejects cancelling an order that is no longer confirmed", async () => {
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId, {status: "out_for_delivery"});

    await expect(callCancelOrder({orderId, reason: "Too late"}))
      .rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("rejects an unauthenticated caller", async () => {
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId);
    await signOut(clientAuth);

    await expect(callCancelOrder({orderId, reason: "x"}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });

  it("rejects a request with no reason", async () => {
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId);

    await expect(callCancelOrder({orderId, reason: "   "}))
      .rejects.toMatchObject({code: "functions/invalid-argument"});
  });
});

describe("submitReturn", () => {
  it("submits a pending return for a delivered order without touching stock or counters", async () => {
    const productId = await seedProduct({stock: 20});
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId, {
      status: "delivered",
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 5,
        unitPriceCents: 1000,
        lineTotalCents: 5000,
      }],
    });

    const res = await callSubmitReturn({
      orderId,
      items: [{productId, quantity: 2}],
      returnType: "credit_note",
      reasonCode: "damaged",
      notes: "Two units arrived damaged",
    });

    const data = res.data as {returnId: string; returnNumber: string};
    expect(data.returnNumber).toMatch(/^RET-\d{4}-\d{4}$/);

    const returnSnap = await adminDb.collection("returns").doc(data.returnId).get();
    const ret = returnSnap.data()!;
    expect(ret["status"]).toBe("pending");
    expect(ret["stockRestored"]).toBe(false);
    expect(ret["amountCents"]).toBe(2000); // 2 x 1000, server-derived
    expect((ret["items"] as Array<Record<string, unknown>>)[0]["quantity"]).toBe(2);

    // Stock and customer counters are untouched — restoration only
    // happens at admin approval time (see admin-returns.component.ts).
    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(20);
  });

  it("derives the return amount from the stored order price, ignoring any price the client sends", async () => {
    const productId = await seedProduct();
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId, {
      status: "delivered",
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 4,
        unitPriceCents: 1500,
        lineTotalCents: 6000,
      }],
    });

    const res = await callSubmitReturn({
      orderId,
      // A tampered payload smuggling a lower price — mirrors the
      // placeOrder tamper test. submitReturn only ever reads
      // productId/quantity per item from the client.
      items: [{productId, quantity: 1, unitPriceCents: 1}],
      returnType: "refund",
      reasonCode: "other",
      notes: "",
    });

    const data = res.data as {returnId: string};
    const returnSnap = await adminDb.collection("returns").doc(data.returnId).get();
    const item = (returnSnap.data()!["items"] as Array<Record<string, unknown>>)[0];
    expect(item["unitPriceCents"]).toBe(1500); // the real ordered price, not 1
    expect(returnSnap.data()!["amountCents"]).toBe(1500);
  });

  it("rejects a return quantity greater than what was actually ordered", async () => {
    const productId = await seedProduct();
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId, {
      status: "delivered",
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 2,
        unitPriceCents: 1000,
        lineTotalCents: 2000,
      }],
    });

    await expect(callSubmitReturn({
      orderId,
      items: [{productId, quantity: 5}], // more than the 2 ordered
      returnType: "credit_note",
      reasonCode: "other",
      notes: "",
    })).rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects a return for an order that hasn't been delivered yet", async () => {
    const productId = await seedProduct();
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId, {
      status: "confirmed",
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 1,
        unitPriceCents: 1000,
        lineTotalCents: 1000,
      }],
    });

    await expect(callSubmitReturn({
      orderId,
      items: [{productId, quantity: 1}],
      returnType: "credit_note",
      reasonCode: "other",
      notes: "",
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("rejects a return for an order belonging to a different customer", async () => {
    const productId = await seedProduct();
    const {customerId: ownerCustomerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(ownerCustomerId, {
      status: "delivered",
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 1,
        unitPriceCents: 1000,
        lineTotalCents: 1000,
      }],
    });
    await seedCustomerAndAuth(); // second, unrelated customer

    await expect(callSubmitReturn({
      orderId,
      items: [{productId, quantity: 1}],
      returnType: "credit_note",
      reasonCode: "other",
      notes: "",
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const productId = await seedProduct();
    const {customerId} = await seedCustomerAndAuth();
    const orderId = await seedOrder(customerId, {status: "delivered"});
    await signOut(clientAuth);

    await expect(callSubmitReturn({
      orderId,
      items: [{productId, quantity: 1}],
      returnType: "credit_note",
      reasonCode: "other",
      notes: "",
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
