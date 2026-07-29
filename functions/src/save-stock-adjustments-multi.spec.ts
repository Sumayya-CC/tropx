import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.4 stock-write migration, manual
 * correction tier, site 2 of 2 (last site in the tier). This closes out
 * 5H entirely. stock-adjustment-modal.component.ts saveMulti() had the
 * same no-read-at-all gap as saveSingle — previousStock came from each
 * item's captured allProducts() snapshot from add-time. One transaction
 * now spans every product in the batch: all-or-nothing, same as the
 * original single writeBatch. Same emulator setup as
 * save-stock-adjustment.spec.ts.
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
  return `${prefix}-${Date.now()}-${seq}-multi`;
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

async function callSaveStockAdjustments(data: unknown) {
  const callable = httpsCallable(clientFunctions, "saveStockAdjustments");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "save-stock-adj-multi-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "save-stock-adj-multi-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("saveStockAdjustments", () => {
  it("applies a fixed-direction type to multiple products in one call", async () => {
    const productA = await seedProduct({stock: 20});
    const productB = await seedProduct({stock: 10});
    await signInStaff({role: "admin"}, {firstName: "Ada", lastName: "Admin"});

    const res = await callSaveStockAdjustments({
      items: [
        {productId: productA, quantity: 5, direction: "in"},
        {productId: productB, quantity: 3, direction: "in"},
      ],
      type: "received",
      reason: "Bulk delivery",
    });
    expect((res.data as {count: number}).count).toBe(2);

    const aSnap = await adminDb.collection("products").doc(productA).get();
    const bSnap = await adminDb.collection("products").doc(productB).get();
    expect(aSnap.data()!["stock"]).toBe(25);
    expect(bSnap.data()!["stock"]).toBe(13);

    const adjSnap = await adminDb.collection("stockAdjustments").where("reason", "==", "Bulk delivery").get();
    expect(adjSnap.size).toBe(2);
  });

  it("respects per-item direction for the 'correction' type", async () => {
    const productA = await seedProduct({stock: 20});
    const productB = await seedProduct({stock: 20});
    await signInStaff({role: "admin"});

    await callSaveStockAdjustments({
      items: [
        {productId: productA, quantity: 5, direction: "in"},
        {productId: productB, quantity: 5, direction: "out"},
      ],
      type: "correction",
      reason: "Cycle count",
    });

    const aSnap = await adminDb.collection("products").doc(productA).get();
    const bSnap = await adminDb.collection("products").doc(productB).get();
    expect(aSnap.data()!["stock"]).toBe(25);
    expect(bSnap.data()!["stock"]).toBe(15);
  });

  it("rejects the WHOLE batch when any single item would go negative — none of it applies", async () => {
    const productA = await seedProduct({stock: 20});
    const productB = await seedProduct({stock: 3});
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustments({
      items: [
        {productId: productA, quantity: 5, direction: "out"}, // fine on its own
        {productId: productB, quantity: 10, direction: "out"}, // would go negative
      ],
      type: "damaged",
      reason: "Damaged batch",
    })).rejects.toMatchObject({code: "functions/failed-precondition"});

    const aSnap = await adminDb.collection("products").doc(productA).get();
    expect(aSnap.data()!["stock"]).toBe(20); // untouched — all-or-nothing
  });

  it("ignores a tampered per-item direction for a fixed-direction type", async () => {
    const productId = await seedProduct({stock: 20});
    await signInStaff({role: "admin"});

    await callSaveStockAdjustments({
      items: [{productId, quantity: 5, direction: "out"}], // 'received' is always 'in'
      type: "received",
      reason: "Tamper attempt",
    });

    const snap = await adminDb.collection("products").doc(productId).get();
    expect(snap.data()!["stock"]).toBe(25); // 20 + 5, not 20 - 5
  });

  it("rejects an empty item list", async () => {
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustments({items: [], type: "received", reason: "x"}))
      .rejects.toMatchObject({code: "functions/invalid-argument"});
  });

  it("rejects a nonexistent product in the batch", async () => {
    const productId = await seedProduct();
    await signInStaff({role: "admin"});

    await expect(callSaveStockAdjustments({
      items: [
        {productId, quantity: 1, direction: "in"},
        {productId: "does-not-exist", quantity: 1, direction: "in"},
      ],
      type: "received", reason: "x",
    })).rejects.toMatchObject({code: "functions/not-found"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const productId = await seedProduct();
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", tenantId: 1}),
    );

    await expect(callSaveStockAdjustments({
      items: [{productId, quantity: 1, direction: "in"}], type: "received", reason: "x",
    })).rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const productId = await seedProduct();
    await signOut(clientAuth);

    await expect(callSaveStockAdjustments({
      items: [{productId, quantity: 1, direction: "in"}], type: "received", reason: "x",
    })).rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
