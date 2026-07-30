import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.1 stock-write migration, restock tier.
 * admin-returns.component.ts approveReturn() used to be a client
 * writeBatch that took a getDoc() read of the order/customer/product docs
 * before committing — the read is never re-validated at commit time, so
 * two concurrent approvals (two staff tabs, a retry) can race on the same
 * product's stock, or partially apply if one write in the batch fails.
 * Moved to a runTransaction, same reasoning and emulator setup as
 * place-order.spec.ts / cancel-order-return.spec.ts.
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
    stock: 50,
    active: true,
    isDeleted: false,
    tenantId: 1,
    ...overrides,
  });
  return id;
}

/**
 * Signs the client SDK in as a fresh user carrying the given custom claims,
 * and seeds a matching users/{uid} profile doc (approveReturn reads it for
 * the processedBy/adjustedBy snapshot).
 * @param {Record<string, unknown>} claims Custom claims to mint on the token.
 * @param {Record<string, unknown>} profile Fields for the users/{uid} doc.
 * @return {Promise<string>} The new user's Auth uid.
 */
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
  await cred.user.getIdToken(true); // force a fresh token carrying the custom claims
  return userRecord.uid;
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

async function seedOrder(
  customerId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const id = uid("order");
  await adminDb.collection("orders").doc(id).set({
    orderNumber: `TRX-2026-${id.slice(-4)}`,
    customerId,
    customerName: "Test Business",
    status: "delivered",
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

async function seedReturn(
  orderId: string,
  customerId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
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
    reason: "Two units arrived damaged",
    items: [],
    amountCents: 0,
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

async function callApproveReturn(data: unknown) {
  const callable = httpsCallable(clientFunctions, "approveReturn");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "approve-return-spec-admin",
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
    "approve-return-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("approveReturn", () => {
  it("approves a credit-note return: order/customer financials and stock all move together", async () => {
    const productId = await seedProduct({stock: 10});
    const customerId = await seedCustomer({
      totalOrderedCents: 5000,
      totalOwingCents: 5000,
    });
    const orderId = await seedOrder(customerId, {
      totalCents: 5000,
      balanceCents: 5000,
      amountPaidCents: 0,
    });
    const returnId = await seedReturn(orderId, customerId, {
      type: "credit_note",
      amountCents: 2000,
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 2,
        unitPriceCents: 1000,
        lineTotalCents: 2000,
      }],
    });
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callApproveReturn({returnId, restoreStock: true});
    expect((res.data as {returnNumber: string}).returnNumber).toBeTruthy();

    const returnSnap = await adminDb.collection("returns").doc(returnId).get();
    const ret = returnSnap.data()!;
    expect(ret["status"]).toBe("approved");
    expect(ret["stockRestored"]).toBe(true);
    expect(ret["processedBy"]).toMatchObject({firstName: "Ada", lastName: "Admin"});
    expect((ret["stockAdjustmentIds"] as string[]).length).toBe(1);

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect(orderSnap.data()!["totalCents"]).toBe(3000); // 5000 - 2000
    expect(orderSnap.data()!["balanceCents"]).toBe(3000);
    expect(orderSnap.data()!["paymentStatus"]).toBe("unpaid");

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalOrderedCents"]).toBe(3000); // 5000 - 2000
    expect(custSnap.data()!["totalOwingCents"]).toBe(3000); // 5000 - 2000

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(12); // 10 + 2 restored

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedOrderId", "==", orderId)
      .get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("returned");
    expect(adjSnap.docs[0].data()["previousStock"]).toBe(10);
    expect(adjSnap.docs[0].data()["newStock"]).toBe(12);
  });

  it("approves a refund return: refund fields stamped, totalPaidCents reversed, not totalOwingCents", async () => {
    const customerId = await seedCustomer({
      totalOrderedCents: 4000,
      totalOwingCents: 0,
      totalPaidCents: 4000,
    });
    const orderId = await seedOrder(customerId, {
      totalCents: 4000,
      balanceCents: 0,
      amountPaidCents: 4000,
    });
    const returnId = await seedReturn(orderId, customerId, {
      type: "refund",
      amountCents: 1500,
    });
    await signInStaff({role: "manager"});

    await callApproveReturn({
      returnId,
      restoreStock: false,
      refundMethod: "e_transfer",
      refundReferenceNumber: "ET-12345",
    });

    const returnSnap = await adminDb.collection("returns").doc(returnId).get();
    const ret = returnSnap.data()!;
    expect(ret["refundMethod"]).toBe("e_transfer");
    expect(ret["refundReferenceNumber"]).toBe("ET-12345");
    expect(ret["refundedBy"]).toBeTruthy();
    expect(ret["stockRestored"]).toBe(false);
    // stockAdjustmentIds is only written when restoreStock is true — this
    // field is untouched, staying at whatever it was seeded with.
    expect(ret["stockAdjustmentIds"]).toEqual([]);

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalPaidCents"]).toBe(2500); // 4000 - 1500
    expect(custSnap.data()!["totalOwingCents"]).toBe(0); // untouched — refund, not credit
  });

  it("does not restore stock or write an adjustment when restoreStock is false", async () => {
    const productId = await seedProduct({stock: 30});
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    const returnId = await seedReturn(orderId, customerId, {
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantity: 5,
        unitPriceCents: 1000,
        lineTotalCents: 5000,
      }],
    });
    await signInStaff({role: "warehouse"});

    await callApproveReturn({returnId, restoreStock: false});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(30); // untouched

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedOrderId", "==", orderId)
      .get();
    expect(adjSnap.empty).toBe(true);
  });

  it("rejects a refund approval with no refundMethod", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    const returnId = await seedReturn(orderId, customerId, {type: "refund", amountCents: 1000});
    await signInStaff({role: "admin"});

    await expect(callApproveReturn({returnId, restoreStock: false}))
      .rejects.toMatchObject({code: "functions/invalid-argument"});

    const returnSnap = await adminDb.collection("returns").doc(returnId).get();
    expect(returnSnap.data()!["status"]).toBe("pending"); // untouched
  });

  it("rejects a customer caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    const returnId = await seedReturn(orderId, customerId);
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(
        (await adminAuth.createUser({})).uid,
        {role: "customer", linkedCustomerId: customerId, tenantId: 1},
      ),
    );

    await expect(callApproveReturn({returnId, restoreStock: false}))
      .rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId);
    const returnId = await seedReturn(orderId, customerId);
    await signOut(clientAuth);

    await expect(callApproveReturn({returnId, restoreStock: false}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });

  it("rejects a nonexistent return", async () => {
    await signInStaff({role: "admin"});

    await expect(callApproveReturn({returnId: "does-not-exist", restoreStock: false}))
      .rejects.toMatchObject({code: "functions/not-found"});
  });
});
