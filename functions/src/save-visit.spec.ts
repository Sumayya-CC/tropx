import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {initializeApp as initClientApp, deleteApp, FirebaseApp} from "firebase/app";
import {getAuth, connectAuthEmulator, signInWithCustomToken, signOut, Auth} from "firebase/auth";
import {getFunctions, connectFunctionsEmulator, httpsCallable, Functions} from "firebase/functions";

/**
 * Phase 4 (security hardening) — 5H.3 stock-write migration, sample-paths
 * tier, site 1 of 2. visit.service.ts saveVisit() used to be a client
 * writeBatch with a getDoc-then-batch race per sample item, same defect
 * class as the other 5H sites — lower urgency (single-user-initiated),
 * same fix. Moved to a runTransaction. Same emulator setup as
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

async function seedShop(overrides: Partial<Record<string, unknown>> = {}) {
  const id = uid("shop");
  await adminDb.collection("shops").doc(id).set({
    name: "Test Shop", tenantId: 1, isDeleted: false, status: "prospect",
    createdAt: new Date(), // real Shop docs always have this — see stamp-idempotency.spec.ts
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

async function callSaveVisit(data: unknown) {
  const callable = httpsCallable(clientFunctions, "saveVisit");
  return callable(data);
}

beforeAll(async () => {
  const adminApp = admin.initializeApp({projectId: "tropx-wholesale-dev"}, "save-visit-spec-admin");
  adminDb = adminApp.firestore();
  adminDb.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
  adminAuth = adminApp.auth();

  clientApp = initClientApp(
    {projectId: "tropx-wholesale-dev", apiKey: "fake-api-key-for-emulator"},
    "save-visit-spec-client",
  );
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://127.0.0.1:${AUTH_PORT}`, {disableWarnings: true});
  clientFunctions = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(clientFunctions, "127.0.0.1", FUNCTIONS_PORT);
});

afterAll(async () => {
  await deleteApp(clientApp);
});

describe("saveVisit", () => {
  it("logs a visit and clamps sample stock, recording the full sampled quantity", async () => {
    const productId = await seedProduct({stock: 3});
    const shopId = await seedShop({name: "Corner Store"});
    await signInStaff({role: "sales_rep"}, {firstName: "Sam", lastName: "Rep"});

    const res = await callSaveVisit({
      shopId,
      items: [{
        productId, productName: "Test Product",
        isSample: true, sampleQty: 5, // oversamples relative to stock 3
      }],
      outcome: "sample_left",
      visitDateMs: new Date(2026, 6, 15).getTime(),
    });

    const data = res.data as {visitId: string};
    expect(data.visitId).toBeTruthy();

    const visitSnap = await adminDb.collection("visits").doc(data.visitId).get();
    const visit = visitSnap.data()!;
    expect(visit["shopId"]).toBe(shopId);
    expect(visit["outcome"]).toBe("sample_left");
    expect(visit["visitedBy"]).toMatchObject({firstName: "Sam"});

    const shopSnap = await adminDb.collection("shops").doc(shopId).get();
    expect((shopSnap.data()!["lastVisitDate"] as admin.firestore.Timestamp).toDate().getTime())
      .toBe(new Date(2026, 6, 15).getTime());

    const productSnap = await adminDb.collection("products").doc(productId).get();
    expect(productSnap.data()!["stock"]).toBe(0); // clamped at 0, never negative

    const adjSnap = await adminDb.collection("stockAdjustments").where("linkedVisitId", "==", data.visitId).get();
    expect(adjSnap.size).toBe(1);
    const adj = adjSnap.docs[0].data();
    expect(adj["type"]).toBe("sample");
    expect(adj["quantity"]).toBe(-5); // full honest amount, not clamped
    expect(adj["previousStock"]).toBe(3);
    expect(adj["newStock"]).toBe(0);
    expect(adj["reason"]).toBe("Sample given at Corner Store"); // re-derived server-side
    expect(adj["notes"]).toBe("Sampled 5, stock was 3");
  });

  it("computes soldSinceLastVisit from left/found and strips undefined keys", async () => {
    const shopId = await seedShop();
    await signInStaff({role: "sales_rep"});

    const res = await callSaveVisit({
      shopId,
      items: [{productId: "free-text-item", productName: "Loose item", left: 10, found: 4}],
      visitDateMs: Date.now(),
    });

    const visitSnap = await adminDb.collection("visits").doc((res.data as {visitId: string}).visitId).get();
    const items = visitSnap.data()!["items"] as Array<Record<string, unknown>>;
    expect(items[0]["soldSinceLastVisit"]).toBe(6); // 10 - 4
    expect(items[0]).not.toHaveProperty("sampleQty"); // undefined key stripped
  });

  it("skips a non-catalog item with no productId — no stock write, no adjustment", async () => {
    const shopId = await seedShop();
    await signInStaff({role: "sales_rep"});

    const res = await callSaveVisit({
      shopId,
      items: [{productName: "Free text note item", isSample: true, sampleQty: 2}],
      visitDateMs: Date.now(),
    });

    const adjSnap = await adminDb
      .collection("stockAdjustments")
      .where("linkedVisitId", "==", (res.data as {visitId: string}).visitId)
      .get();
    expect(adjSnap.empty).toBe(true);
  });

  it("rejects a nonexistent shop", async () => {
    await signInStaff({role: "sales_rep"});

    await expect(callSaveVisit({shopId: "does-not-exist", items: [], visitDateMs: Date.now()}))
      .rejects.toMatchObject({code: "functions/not-found"});
  });

  it("rejects a customer (non-staff) caller", async () => {
    const shopId = await seedShop();
    const custUid = (await adminAuth.createUser({})).uid;
    await signInWithCustomToken(
      clientAuth,
      await adminAuth.createCustomToken(custUid, {role: "customer", tenantId: 1}),
    );

    await expect(callSaveVisit({shopId, items: [], visitDateMs: Date.now()}))
      .rejects.toMatchObject({code: "functions/permission-denied"});
  });

  it("rejects an unauthenticated caller", async () => {
    const shopId = await seedShop();
    await signOut(clientAuth);

    await expect(callSaveVisit({shopId, items: [], visitDateMs: Date.now()}))
      .rejects.toMatchObject({code: "functions/unauthenticated"});
  });
});
