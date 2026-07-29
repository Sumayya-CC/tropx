import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.4 stock-write migration, manual
 * correction tier, site 1 of 2. stock-adjustment-modal.component.ts
 * saveSingle() had NO read at all before this migration — previousStock
 * came straight off a live-listener signal, an even wider staleness
 * window than the getDoc-then-batch sites elsewhere in 5H (see the
 * 2026-07-28 re-audit finding). This is the one manual-correction site
 * that HARD-BLOCKS a would-go-negative result rather than clamping —
 * preserved as a reject here, not loosened. Same emulator setup as
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
    stock: 20, active: true, isDeleted: false, tenantId: 1,
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

async function callSaveStockAdjustment(data: unknown) {
  const callable = httpsCallable(clientFunctions, "saveStockAdjustment");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "save-stock-adj-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "save-stock-adj-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("saveStockAdjustment", () => {
  it("applies an 'in' fixed-direction type (received)", async () => {
    const productId = await seedProduct({stock: 20});
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callSaveStockAdjustment({
      productId, type: "received", quantity: 30, reason: "Supplier delivery",
    });
    const data = res.data as {newStock: number};
    expect(data.newStock).toBe(50);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(50);

    const adjSnap = await adminDb.collection("stockAdjustments")
      .where("productId", "==", productId).where("reason", "==", "Supplier delivery").get();
    expect(adjSnap.size).toBe(1);
    expect(adjSnap.docs[0].data()["quantity"]).toBe(30);
    expect(adjSnap.docs[0].data()["adjustedBy"]).toMatchObject({firstName: "Ada"});
  });

  it("applies an 'out' fixed-direction type (damaged)", async () => {
    const productId = await seedProduct({stock: 20});
    await signInStaff({role: "manager"});

    await callSaveStockAdjustment({productId, type: "damaged", quantity: 5, reason: "Water damage"});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(15);

    const adjSnap = await adminDb.collection("stockAdjustments")
      .where("productId", "==", productId).where("reason", "==", "Water damage").get();
    expect(adjSnap.docs[0].data()["quantity"]).toBe(-5);
  });

  it("respects the client-chosen direction for 'correction' (the one 'either' type)", async () => {
    const productId = await seedProduct({stock: 20});
    await signInStaff({role: "admin"});

    await callSaveStockAdjustment({
      productId, type: "correction", quantity: 20, direction: "out", reason: "Recount",
    });

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(0); // exactly zero, still valid
  });

  it("ignores a tampered direction for a fixed-direction type", async () => {
    const productId = await seedProduct({stock: 20});
    await signInStaff({role: "admin"});

    // 'received' is always 'in' — a client claiming 'out' must be ignored.
    await callSaveStockAdjustment({
      productId, type: "received", quantity: 10, direction: "out", reason: "Tamper attempt",
    });

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(30); // 20 + 10, not 20 - 10
  });

  it("rejects (does not clamp) an adjustment that would take stock negative", async () => {
    const productId = await seedProduct({stock: 20});
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustment({
      productId, type: "damaged", quantity: 25, reason: "Too much",
    })).rejects.toMatchObject({code: "functions/failed-precondition"});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(20); // untouched
  });

  it("rejects a missing reason", async () => {
    const productId = await seedProduct();
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustment({productId, type: "received", quantity: 5, reason: "  "}))
      .rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects an invalid adjustment type", async () => {
    const productId = await seedProduct();
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustment({productId, type: "not_a_real_type", quantity: 5, reason: "x"}))
      .rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects a nonexistent product", async () => {
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustment({productId: "does-not-exist", type: "received", quantity: 5, reason: "x"}))
      .rejects.toMatchObject({code: "functions/not-found"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const productId = await seedProduct();
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", tenantId: 1}),
    );

    await expect(callSaveStockAdjustment({productId, type: "received", quantity: 5, reason: "x"}))
      .rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const productId = await seedProduct();
    await signOut(clientAuth);

    await expect(callSaveStockAdjustment({productId, type: "received", quantity: 5, reason: "x"}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
