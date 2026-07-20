import * as admin from "firebase-admin";
import {stampAllShopHealth, stampAllPipelineStuck, reconcileShopLinks} from "./index";

/**
 * Phase 3.4 — idempotency, continued. stampAllShopHealth, stampAllPipelineStuck,
 * and reconcileShopLinks were module-private until this phase — exported for
 * the same reason recomputeCustomerCounters already was: they're shared
 * between a nightly sweep and an on-demand callable, so idempotency needs
 * to be directly provable. Same direct-import approach as
 * recompute-idempotency.spec.ts — sidesteps the Functions-Emulator
 * FieldValue bug entirely (Firestore emulator only, no Functions emulator
 * call needed for these).
 *
 * Assertions read specific documents by id rather than trusting the
 * returned scanned/updated/healed counts — those are collection-wide and
 * would be polluted by fixtures from other spec files sharing this
 * emulator session.
 */

const DATABASE_ID = "tropx-dev";
const FIRESTORE_PORT = 8080;

let db: admin.firestore.Firestore;

let seq = 0;
/**
 * Unique-per-test id so tests never collide on shared fixtures.
 * @param {string} prefix Label prepended to the generated id.
 * @return {string} A unique id like "shop-<timestamp>-<n>".
 */
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

beforeAll(() => {
  const app = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "stamp-spec-admin",
  );
  db = app.firestore();
  db.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
});

describe("stampAllShopHealth — idempotency", () => {
  it("produces identical healthBand/healthDays/healthKind on a second run", async () => {
    const shopId = uid("shop");
    const fortyEightDaysAgo = new Date(Date.now() - 48 * 86400000);
    await db.collection("shops").doc(shopId).set({
      name: "Cold Prospect Shop",
      status: "prospect",
      lastVisitDate: fortyEightDaysAgo, // exceeds the default 45-day prospectColdDays
      createdAt: fortyEightDaysAgo, // real Shop docs always have this; see the
      // stampAllPipelineStuck bug this test's first draft accidentally
      // surfaced when this field was missing (documented below)
      tenantId: 1,
      isDeleted: false,
    });

    await stampAllShopHealth();
    const afterFirst = (await db.collection("shops").doc(shopId).get()).data()!;
    expect(afterFirst["healthBand"]).toBe("cold");
    expect(afterFirst["healthKind"]).toBe("prospect");
    expect(afterFirst["healthDays"]).toBeGreaterThanOrEqual(48);

    await stampAllShopHealth();
    const afterSecond = (await db.collection("shops").doc(shopId).get()).data()!;
    // healthComputedAt is deliberately NOT compared — stampAllShopHealth
    // always re-stamps it (see the comment in index.ts: "Manual refresh
    // writes even if band unchanged, so healthDays reflects the true
    // current day count on demand"). The band/kind/days values are the
    // idempotency claim, not the timestamp.
    expect(afterSecond["healthBand"]).toBe(afterFirst["healthBand"]);
    expect(afterSecond["healthKind"]).toBe(afterFirst["healthKind"]);
    expect(afterSecond["healthDays"]).toBe(afterFirst["healthDays"]);
  });
});

describe("stampAllPipelineStuck — idempotency", () => {
  it("does not re-write a shop's stuck fields on a second run when nothing changed", async () => {
    const shopId = uid("shop");
    const twentyDaysAgo = new Date(Date.now() - 20 * 86400000);
    await db.collection("shops").doc(shopId).set({
      name: "Stuck Prospect Shop",
      status: "prospect",
      pipelineStage: "first_contact", // default threshold: 7 days
      pipelineEnteredStageAt: twentyDaysAgo,
      tenantId: 1,
      isDeleted: false,
    });

    await stampAllPipelineStuck();
    const afterFirst = (await db.collection("shops").doc(shopId).get()).data()!;
    expect(afterFirst["pipelineStuck"]).toBe(true); // 20 days > 7-day threshold
    expect(afterFirst["daysInStage"]).toBeGreaterThanOrEqual(20);
    const computedAtFirst = afterFirst["pipelineStuckComputedAt"];
    expect(computedAtFirst).toBeTruthy();

    // Unlike shop health, this function only writes when something is
    // actually different (see the `if (shop.pipelineStuck !== stuck || ...)`
    // guard in index.ts) — so on a second run, moments later, with
    // pipelineEnteredStageAt unchanged, daysInStage is the same integer
    // and pipelineStuck is still true: no write should happen at all.
    await stampAllPipelineStuck();
    const afterSecond = (await db.collection("shops").doc(shopId).get()).data()!;
    expect(afterSecond["pipelineStuck"]).toBe(true);
    expect(afterSecond["daysInStage"]).toBe(afterFirst["daysInStage"]);
    // The strongest possible idempotency assertion here: the computed-at
    // timestamp itself is byte-identical, proving the doc was never
    // re-written on the second pass, not just that the values happen to
    // still match.
    expect(afterSecond["pipelineStuckComputedAt"]).toEqual(computedAtFirst);
  });
});

describe("reconcileShopLinks — idempotency", () => {
  it("heals and flags nothing new on already-consistent data", async () => {
    const shopId = uid("shop");
    const customerId = uid("customer");
    const businessName = "Already Linked Co";
    const searchName = "already linked co"; // matches normalizeSearchNameFn's output for plain ASCII

    await db.collection("shops").doc(shopId).set({
      name: businessName,
      status: "customer",
      linkedCustomerId: customerId,
      hasCustomer: true,
      searchName,
      tenantId: 1,
      isDeleted: false,
    });
    await db.collection("customers").doc(customerId).set({
      businessName,
      linkedShopId: shopId,
      hasShop: true,
      searchName,
      tenantId: 1,
      isDeleted: false,
    });

    // mode "full" (not "incremental") so the healing logic itself runs
    // both times — "incremental" would skip the second pass entirely via
    // its own watermark, which proves the watermark works but not that
    // the healing logic is idempotent when it does run.
    const first = await reconcileShopLinks("full");
    expect(first.scanned).toBeGreaterThanOrEqual(1);

    const custAfterFirst = (await db.collection("customers").doc(customerId).get()).data()!;
    const shopAfterFirst = (await db.collection("shops").doc(shopId).get()).data()!;
    expect(custAfterFirst["hasShop"]).toBe(true);
    expect(custAfterFirst["linkedShopId"]).toBe(shopId);
    expect(shopAfterFirst["hasCustomer"]).toBe(true);
    expect(shopAfterFirst["status"]).toBe("customer");

    const second = await reconcileShopLinks("full");
    expect(second.flagged).toBe(0); // never any three-way mismatch on consistent data

    const custAfterSecond = (await db.collection("customers").doc(customerId).get()).data()!;
    const shopAfterSecond = (await db.collection("shops").doc(shopId).get()).data()!;
    expect(custAfterSecond["hasShop"]).toBe(custAfterFirst["hasShop"]);
    expect(custAfterSecond["linkedShopId"]).toBe(custAfterFirst["linkedShopId"]);
    expect(custAfterSecond["searchName"]).toBe(custAfterFirst["searchName"]);
    expect(shopAfterSecond["hasCustomer"]).toBe(shopAfterFirst["hasCustomer"]);
    expect(shopAfterSecond["status"]).toBe(shopAfterFirst["status"]);
  });
});
