import * as admin from "firebase-admin";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.3 stock-write migration, sample-paths
 * tier, site 2 of 2 (last site in the tier). visit.service.ts
 * deleteVisit() used to be a client writeBatch with a getDoc-then-batch
 * race per sample item, and no guard against a repeated delete call
 * double-reversing stock. Moved to a runTransaction, plus an
 * already-deleted check that makes a repeat call a no-op. Same emulator
 * setup as save-visit.spec.ts.
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

async function seedVisit(shopId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("visit");
  await adminDb.collection("visits").doc(id).set({
    shopId, visitDate: new Date(), items: [],
    tenantId: 1, isDeleted: false, createdAt: new Date(),
    ...overrides,
  });
  return id;
}

async function signInStaff(claims: Record<string, unknown>, profile: Record<string, unknown> = {}) {
  const userRecord = await adminAuth.createUser({});
  await adminDb.collection("users").doc(userRecord.uid).set({
    firstName: "Staff", lastName: "Member", role: claims["role"] || "sales_rep", tenantId: 1,
    ...profile,
  });
  const customToken = await adminAuth.createCustomToken(userRecord.uid, claims);
  const cred = await signInWithCustomToken(clientAuth, customToken);
  await cred.user.getIdToken(true);
  return userRecord.uid;
}

async function callDeleteVisit(data: unknown) {
  const callable = httpsCallable(clientFunctions, "deleteVisit");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "delete-visit-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "delete-visit-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("deleteVisit", () => {
  it("soft-deletes the visit and reverses sample stock when reverseStock is true", async () => {
    const productId = await seedProduct({stock: 5});
    const shopId = uid("shop");
    const visitId = await seedVisit(shopId, {
      items: [{productId, productName: "Test Product", isSample: true, sampleQty: 3}],
    });
    await signInStaff({role: "sales_rep"}, {firstName: "Sam", lastName: "Rep"});

    const res = await callDeleteVisit({visitId, reverseStock: true});
    expect((res.data as {alreadyDeleted: boolean}).alreadyDeleted).toBe(false);

    const visitSnap = await adminDb.collection("visits").doc(visitId).get();
    expect(visitSnap.data()!["isDeleted"]).toBe(true);
    expect(visitSnap.data()!["deletedBy"]).toMatchObject({firstName: "Sam"});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(8); // 5 + 3 restored

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedVisitId", "==", visitId).get();
    expect(adjSnap.size).toBe(1);
    const adj = adjSnap.docs[0].data();
    expect(adj["type"]).toBe("sample_reversal");
    expect(adj["quantity"]).toBe(3);
    expect(adj["previousStock"]).toBe(5);
    expect(adj["newStock"]).toBe(8);
  });

  it("does not touch stock when reverseStock is false", async () => {
    const productId = await seedProduct({stock: 5});
    const shopId = uid("shop");
    const visitId = await seedVisit(shopId, {
      items: [{productId, productName: "Test Product", isSample: true, sampleQty: 3}],
    });
    await signInStaff({role: "admin"});

    await callDeleteVisit({visitId, reverseStock: false});

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(5); // untouched

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedVisitId", "==", visitId).get();
    expect(adjSnap.empty).toBe(true);
  });

  it("a repeated delete call is a no-op, not a second reversal", async () => {
    const productId = await seedProduct({stock: 5});
    const shopId = uid("shop");
    const visitId = await seedVisit(shopId, {
      items: [{productId, productName: "Test Product", isSample: true, sampleQty: 3}],
    });
    await signInStaff({role: "admin"});

    const first = await callDeleteVisit({visitId, reverseStock: true});
    expect((first.data as {alreadyDeleted: boolean}).alreadyDeleted).toBe(false);

    const second = await callDeleteVisit({visitId, reverseStock: true});
    expect((second.data as {alreadyDeleted: boolean}).alreadyDeleted).toBe(true);

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(8); // 5 + 3, NOT 5 + 3 + 3

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedVisitId", "==", visitId).get();
    expect(adjSnap.size).toBe(1); // still just the one reversal record
  });

  it("rejects a nonexistent visit", async () => {
    await signInStaff({role: "admin"});

    await expect(callDeleteVisit({visitId: "does-not-exist", reverseStock: false}))
      .rejects.toMatchObject({code: "functions/not-found"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const shopId = uid("shop");
    const visitId = await seedVisit(shopId);
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", tenantId: 1}),
    );

    await expect(callDeleteVisit({visitId, reverseStock: false}))
      .rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const shopId = uid("shop");
    const visitId = await seedVisit(shopId);
    await signOut(clientAuth);

    await expect(callDeleteVisit({visitId, reverseStock: false}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
