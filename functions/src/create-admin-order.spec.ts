import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.2 stock-write migration, money-coupled
 * tier, site 1 of 4. order-form.component.ts saveOrder() (create mode)
 * used to be a client writeBatch (getDoc-then-batch race on each product,
 * same defect class as the 5H.1 sites) preceded by its own order-number
 * sequence read against a field (`lastNumber`) that placeOrder never
 * touches (it uses `sequence`) — both on the same settings/orderSequence
 * document, so a portal order and an admin-created order could land on
 * the same order number. Moved to a single runTransaction reusing
 * placeOrder's `sequence` field, taking the max of the two legacy
 * counters as the safe starting point. Same emulator setup as
 * approve-return.spec.ts / receive-purchase-order.spec.ts.
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

/**
 * Signs the client SDK in as a fresh staff user, seeding a matching
 * users/{uid} profile doc (createAdminOrder reads it for the
 * confirmedBy/createdBy/adjustedBy actor snapshot).
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
  await cred.user.getIdToken(true);
  return userRecord.uid;
}

async function seedCustomer(overrides: Partial<Record<string, unknown>> = {}) {
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
  return customerId;
}

async function callCreateAdminOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "createAdminOrder");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "create-admin-order-spec-admin",
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
    "create-admin-order-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("createAdminOrder", () => {
  it("creates an order: totals, customer counters, and stock all move together", async () => {
    const productId = await seedProduct({stock: 20, priceCents: 1000, costCents: 500});
    const customerId = await seedCustomer({totalOrderedCents: 1000, totalOwingCents: 1000});
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callCreateAdminOrder({
      customerId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 3, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0,
      taxRatePercent: 13,
      deliveryType: "delivery",
      customerNotes: "",
      internalNotes: "",
      expectedDeliveryDateMs: null,
    });

    const data = res.data as {orderId: string; orderNumber: string};
    expect(data.orderNumber).toMatch(/^TRX-\d{4}-\d{4}$/);

    const orderSnap = await adminDb.collection("orders").doc(data.orderId).get();
    const order = orderSnap.data()!;
    expect(order["subtotalCents"]).toBe(3000);
    expect(order["taxCents"]).toBe(390); // 3000 * 13%
    expect(order["totalCents"]).toBe(3390);
    expect(order["status"]).toBe("confirmed");
    expect(order["source"]).toBe("admin_created");
    expect(order["confirmedBy"]).toMatchObject({firstName: "Ada", lastName: "Admin"});

    const custSnap = await adminDb.collection("customers").doc(customerId).get();
    expect(custSnap.data()!["totalOrderedCents"]).toBe(4390); // 1000 + 3390
    expect(custSnap.data()!["totalOwingCents"]).toBe(4390);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(17); // 20 - 3

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedOrderId", "==", data.orderId)
      .get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("sold");
    expect(adjSnap.docs[0].data()["quantity"]).toBe(-3);
  });

  it("takes the order number one past whichever legacy counter (lastNumber vs sequence) is higher", async () => {
    await adminDb.collection("settings").doc("orderSequence").set({
      prefix: "TRX", lastNumber: 41, sequence: 17,
    });
    const productId = await seedProduct();
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});

    const res = await callCreateAdminOrder({
      customerId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 1, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    const data = res.data as {orderNumber: string};
    const seqSnap = await adminDb.collection("settings").doc("orderSequence").get();
    const finalSequence = seqSnap.data()!["sequence"] as number;

    // Asserted against the ACTUAL resulting state rather than a value
    // predicted from our own seed (`max(41,17)+1=42`): settings/orderSequence
    // is one real doc shared across spec files run in parallel Jest workers
    // (place-order.spec.ts also allocates against it), so another file's
    // transaction can land between our seed and our own call and claim the
    // number we'd have predicted, pushing ours one further — a real,
    // root-caused race (see the memory entry this comment restates), not a
    // flaky-test dismissal. These assertions instead check invariants that
    // hold no matter how many concurrent allocations interleaved:
    // self-consistent with whatever sequence ended up at
    const expectedNumber = `TRX-${new Date().getFullYear()}-${String(finalSequence).padStart(4, "0")}`;
    expect(data.orderNumber).toBe(expectedNumber);
    // only possible if lastNumber(41), not sequence(17), was the max-logic's base
    expect(finalSequence).toBeGreaterThan(41);
    expect(seqSnap.data()!["lastNumber"]).toBe(41); // legacy field frozen, untouched
  });

  it("allows a staff-negotiated price that differs from the product's own priceCents", async () => {
    const productId = await seedProduct({priceCents: 1000});
    const customerId = await seedCustomer();
    await signInStaff({role: "manager"});

    const res = await callCreateAdminOrder({
      customerId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 2, unitPriceCents: 800, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    const orderId = (res.data as {orderId: string}).orderId;
    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    const items = orderSnap.data()!["items"] as Array<Record<string, unknown>>;
    expect(items[0]["unitPriceCents"]).toBe(800); // staff override, not the product's 1000
    expect(items[0]["lineTotalCents"]).toBe(1600);
  });

  it("clamps stock at 0 on oversell rather than rejecting (staff already confirmed client-side)", async () => {
    const productId = await seedProduct({stock: 2});
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});

    await callCreateAdminOrder({
      customerId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 5, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(0); // clamped, never negative
  });

  it("skips the stock write for a product that no longer exists, but keeps the order line", async () => {
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});

    const res = await callCreateAdminOrder({
      customerId,
      items: [{
        productId: "does-not-exist", productName: "Ghost Product", productSku: "GHOST",
        quantity: 1, unitPriceCents: 500, unitCostCents: 200,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    });

    const orderId = (res.data as {orderId: string}).orderId;
    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    expect((orderSnap.data()!["items"] as Array<Record<string, unknown>>).length).toBe(1);

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedOrderId", "==", orderId)
      .get();
    expect(adjSnap.empty).toBe(true);
  });

  it("stores expectedDeliveryDate at the exact client-supplied instant", async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});
    const ms = new Date(2026, 7, 15).getTime(); // browser-local midnight, Aug 15 2026

    const res = await callCreateAdminOrder({
      customerId,
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantity: 1, unitPriceCents: 1000, unitCostCents: 500,
      }],
      discountCents: 0, taxRatePercent: 0, deliveryType: "pickup",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: ms,
    });

    const orderId = (res.data as {orderId: string}).orderId;
    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    const stored = orderSnap.data()!["expectedDeliveryDate"] as admin.firestore.Timestamp;
    expect(stored.toDate().getTime()).toBe(ms);
    expect(orderSnap.data()!["deliveryType"]).toBe("pickup");
  });

  it("rejects an empty item list", async () => {
    const customerId = await seedCustomer();
    await signInStaff({role: "admin"});

    await expect(callCreateAdminOrder({
      customerId, items: [], discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const customerId = await seedCustomer();
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", linkedCustomerId: customerId, tenantId: 1}),
    );

    await expect(callCreateAdminOrder({
      customerId,
      items: [{productId: "x", productName: "x", productSku: "x", quantity: 1, unitPriceCents: 100, unitCostCents: 50}],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const customerId = await seedCustomer();
    await signOut(clientAuth);

    await expect(callCreateAdminOrder({
      customerId,
      items: [{productId: "x", productName: "x", productSku: "x", quantity: 1, unitPriceCents: 100, unitCostCents: 50}],
      discountCents: 0, taxRatePercent: 0, deliveryType: "delivery",
      customerNotes: "", internalNotes: "", expectedDeliveryDateMs: null,
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
