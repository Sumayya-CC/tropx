import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.1 stock-write migration, restock tier.
 * po-receive.component.ts saveReceive() used to be a client writeBatch
 * (getDoc-then-batch race on each product) preceded by a *separate*
 * runTransaction for the receive-number sequence — so a receive-number
 * could be consumed even if the batch that followed it failed. Moved to a
 * single runTransaction: sequence, PO status, and every product's stock
 * now commit atomically together. Same emulator setup as
 * approve-return.spec.ts.
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
 * users/{uid} profile doc (receivePurchaseOrder reads it for the
 * createdBy/adjustedBy actor snapshot).
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

async function seedPurchaseOrder(overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("po");
  await adminDb.collection("purchaseOrders").doc(id).set({
    poNumber: `PO-${id.slice(-4)}`,
    supplierId: "supplier-1",
    supplierName: "Test Supplier",
    warehouseId: "warehouse-main",
    warehouseName: "Main Warehouse",
    status: "sent",
    items: [],
    subtotalCents: 0,
    totalCents: 0,
    tenantId: 1,
    isDeleted: false,
    orderDate: new Date(),
    ...overrides,
  });
  return id;
}

async function callReceivePurchaseOrder(data: unknown) {
  const callable = httpsCallable(clientFunctions, "receivePurchaseOrder");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "receive-po-spec-admin",
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
    "receive-po-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("receivePurchaseOrder", () => {
  it("receives a full delivery: stock, PO status, and the receive record all move together", async () => {
    const productId = await seedProduct({stock: 20, costCents: 500});
    const poId = await seedPurchaseOrder({
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantityOrdered: 10,
        quantityReceived: 0,
        unitCostCents: 600,
        lineTotalCents: 6000,
      }],
    });
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callReceivePurchaseOrder({
      purchaseOrderId: poId,
      rows: [{productId, receiveNow: 10}],
      notes: "Full delivery",
      receivedDate: "2026-07-28",
      warehouseId: "",
    });

    const data = res.data as {receiveNumber: string};
    expect(data.receiveNumber).toMatch(/^GRN-\d{5}$/);

    const poSnap = await adminDb.collection("purchaseOrders").doc(poId).get();
    const po = poSnap.data()!;
    expect(po["status"]).toBe("received");
    expect(po["receivedAt"]).toBeTruthy();
    expect((po["items"] as Array<Record<string, unknown>>)[0]["quantityReceived"]).toBe(10);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(30); // 20 + 10
    expect(productSnap.data()!["costCents"]).toBe(600); // updated to the PO's unit cost

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedPoId", "==", poId)
      .get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["type"]).toBe("received");
    expect(adjSnap.docs[0].data()["previousStock"]).toBe(20);
    expect(adjSnap.docs[0].data()["newStock"]).toBe(30);

    const recSnap = await adminDb
      .collection("purchaseReceives")
      .where("purchaseOrderId", "==", poId)
      .get();
    expect(recSnap.size).toBe(1);
    expect(recSnap.docs[0].data()["receiveNumber"]).toBe(data.receiveNumber);
  });

  it("marks the PO partially_received when quantities are short of the full order", async () => {
    const productId = await seedProduct({stock: 5});
    const poId = await seedPurchaseOrder({
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantityOrdered: 10,
        quantityReceived: 0,
        unitCostCents: 500,
        lineTotalCents: 5000,
      }],
    });
    await signInStaff({role: "warehouse"});

    await callReceivePurchaseOrder({
      purchaseOrderId: poId,
      rows: [{productId, receiveNow: 4}],
      notes: "",
      receivedDate: "",
      warehouseId: "",
    });

    const poSnap = await adminDb.collection("purchaseOrders").doc(poId).get();
    expect(poSnap.data()!["status"]).toBe("partially_received");
    expect(poSnap.data()!["receivedAt"]).toBeUndefined();
  });

  it("two sequential receipts against the same PO both land, sequence and stock intact", async () => {
    const productId = await seedProduct({stock: 0});
    const poId = await seedPurchaseOrder({
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantityOrdered: 10,
        quantityReceived: 0,
        unitCostCents: 500,
        lineTotalCents: 5000,
      }],
    });
    await signInStaff({role: "admin"});

    const first = await callReceivePurchaseOrder({
      purchaseOrderId: poId, rows: [{productId, receiveNow: 4}], notes: "", receivedDate: "", warehouseId: "",
    });
    const second = await callReceivePurchaseOrder({
      purchaseOrderId: poId, rows: [{productId, receiveNow: 6}], notes: "", receivedDate: "", warehouseId: "",
    });

    expect((first.data as {receiveNumber: string}).receiveNumber)
      .not.toBe((second.data as {receiveNumber: string}).receiveNumber);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(10); // 0 + 4 + 6

    const poSnap = await adminDb.collection("purchaseOrders").doc(poId).get();
    expect(poSnap.data()!["status"]).toBe("received"); // 4 + 6 = 10 ordered
  });

  it("rejects receiving more than what's remaining on the PO line, ignoring a tampered client quantity", async () => {
    const productId = await seedProduct();
    const poId = await seedPurchaseOrder({
      items: [{
        productId,
        productName: "Test Product",
        productSku: "SKU-TEST",
        quantityOrdered: 5,
        quantityReceived: 3,
        unitCostCents: 500,
        lineTotalCents: 2500,
      }],
    });
    await signInStaff({role: "admin"});

    await expect(callReceivePurchaseOrder({
      purchaseOrderId: poId,
      rows: [{productId, receiveNow: 5}], // only 2 remaining (5 - 3)
      notes: "", receivedDate: "", warehouseId: "",
    })).rejects.toMatchObject({code: "functions/invalid-argument"});

    const poSnap = await adminDb.collection("purchaseOrders").doc(poId).get();
    expect((poSnap.data()!["items"] as Array<Record<string, unknown>>)[0]["quantityReceived"]).toBe(3); // untouched
  });

  it("rejects a purchase order that's already fully received", async () => {
    const productId = await seedProduct();
    const poId = await seedPurchaseOrder({
      status: "received",
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantityOrdered: 5, quantityReceived: 5, unitCostCents: 500, lineTotalCents: 2500,
      }],
    });
    await signInStaff({role: "admin"});

    await expect(callReceivePurchaseOrder({
      purchaseOrderId: poId, rows: [{productId, receiveNow: 1}], notes: "", receivedDate: "", warehouseId: "",
    })).rejects.toMatchObject({code: "functions/failed-precondition"});
  });

  it("rejects a customer caller", async () => {
    const productId = await seedProduct();
    const poId = await seedPurchaseOrder({
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantityOrdered: 5, quantityReceived: 0, unitCostCents: 500, lineTotalCents: 2500,
      }],
    });
    const customerUid = (await adminAuth.createUser({})).uid;
    const customToken = await adminAuth.createCustomToken(customerUid, {role: "customer", tenantId: 1});
    await signInWithCustomToken(clientAuth, customToken);

    await expect(callReceivePurchaseOrder({
      purchaseOrderId: poId, rows: [{productId, receiveNow: 1}], notes: "", receivedDate: "", warehouseId: "",
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const productId = await seedProduct();
    const poId = await seedPurchaseOrder({
      items: [{
        productId, productName: "Test Product", productSku: "SKU-TEST",
        quantityOrdered: 5, quantityReceived: 0, unitCostCents: 500, lineTotalCents: 2500,
      }],
    });
    await signOut(clientAuth);

    await expect(callReceivePurchaseOrder({
      purchaseOrderId: poId, rows: [{productId, receiveNow: 1}], notes: "", receivedDate: "", warehouseId: "",
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
