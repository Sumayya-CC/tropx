import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.2 stock-write migration, money-coupled
 * tier, site 3 of 4. order-detail.component.ts confirmCancel() (the staff
 * path, distinct from the portal's self-service cancelOrder) used to be a
 * client writeBatch keyed off live-listener snapshots plus a
 * getDoc-then-batch race on the customer doc and every touched product.
 * Moved to a runTransaction. Same emulator setup as
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
    businessName: "Test Business",
    totalOrderedCents: 0, totalOwingCents: 0, totalPaidCents: 0, creditBalanceCents: 0,
    tenantId: 1, isDeleted: false,
    ...overrides,
  });
  return customerId;
}

async function seedOrder(customerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("order");
  await adminDb.collection("orders").doc(id).set({
    orderNumber: `TRX-2026-${id.slice(-4)}`,
    customerId, status: "confirmed", items: [],
    totalCents: 0, amountPaidCents: 0, balanceCents: 0,
    tenantId: 1, isDeleted: false, createdAt: new Date(),
    ...overrides,
  });
  return id;
}

async function callCancelAdminOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "cancelAdminOrder");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "cancel-admin-order-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "cancel-admin-order-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("cancelAdminOrder", () => {
  it("cancels a confirmed order: status, customer counters, and stock all reverse together", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer({totalOrderedCents: 5000, totalOwingCents: 5000});
    const orderId = await seedOrder(customerId, {
      totalCents: 5000, amountPaidCents: 0,
      items: [{productId, productName: "Test Product", productSku: "SKU-TEST", quantity: 3}],
    });
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callCancelAdminOrder({orderId, reason: "Customer changed mind"});
    expect((res.data as {orderNumber: string}).orderNumber).toBeTruthy();

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["status"]).toBe("cancelled");
    expect(orderSnap.data()!["balanceCents"]).toBe(0);
    expect(orderSnap.data()!["cancellationReason"]).toBe("Customer changed mind");
    expect(orderSnap.data()!["cancelledBy"]).toMatchObject({firstName: "Ada"});

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalOrderedCents"]).toBe(0); // 5000 - 5000
    expect(custSnap.data()!["totalOwingCents"]).toBe(0);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(13); // 10 + 3 restored

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedOrderId", "==", orderId).get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("returned");
  });

  it("reverses paid amounts into store credit when the order was already paid", async () => {
    const customerId = await seedCustomer({
      totalOrderedCents: 2000, totalOwingCents: 0, totalPaidCents: 2000, creditBalanceCents: 0,
    });
    const orderId = await seedOrder(customerId, {
      totalCents: 2000, amountPaidCents: 2000, items: [],
    });
    await signInStaff({role: "manager"});

    await callCancelAdminOrder({orderId, reason: "Duplicate order"});

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalPaidCents"]).toBe(0); // 2000 - 2000
    expect(custSnap.data()!["creditBalanceCents"]).toBe(2000);
  });

  it("allows cancelling a preparing or out_for_delivery order, matching the button visibility", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {status: "preparing", items: []});
    await signInStaff({role: "warehouse"});

    const res = await callCancelAdminOrder({orderId, reason: "Warehouse issue"});
    expect((res.data as {orderNumber: string}).orderNumber).toBeTruthy();

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["status"]).toBe("cancelled");
  });

  it("rejects cancelling an order that's already delivered", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, {status: "delivered", items: []});
    await signInStaff({role: "admin"});

    await expect(callCancelAdminOrder({orderId, reason: "Too late"}))
      .rejects.toMatchObject({code: "functions/failed-precondition"});

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["status"]).toBe("delivered"); // untouched
  });

  it("rejects a request with no reason", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    await signInStaff({role: "admin"});

    await expect(callCancelAdminOrder({orderId, reason: "   "}))
      .rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects a nonexistent order", async () => {
    await signInStaff({role: "admin"});

    await expect(callCancelAdminOrder({orderId: "does-not-exist", reason: "x"}))
      .rejects.toMatchObject({code: "functions/not-found"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", linkedCustomerId: customerId, tenantId: 1}),
    );

    await expect(callCancelAdminOrder({orderId, reason: "x"}))
      .rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    await signOut(clientAuth);

    await expect(callCancelAdminOrder({orderId, reason: "x"}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
