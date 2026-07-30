import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {recomputeCustomerCounters} from "./index";

/**
 * Phase 3.4 — idempotency. recomputeCustomerCounters is exported
 * specifically so both the real-time triggers and the scheduled sweeps can
 * share one implementation (see the comment above it in index.ts) — this
 * test is the executable proof that calling it twice is safe.
 *
 * Imported directly rather than invoked through the Functions Emulator's
 * onCall/HTTP layer: it's a plain exported async function, and — unlike
 * placeOrder — calling it as a normal Node import sidesteps the Functions-
 * Emulator-sandbox FieldValue bug entirely (that bug is specific to code
 * running inside functionsEmulatorRuntime.js's request handling, not to
 * plain Node execution of the same module — confirmed during the placeOrder
 * investigation). Only the Firestore emulator is needed here, not the
 * Functions emulator.
 */

const DATABASE_ID = "tropx-dev";
const FIRESTORE_PORT = 8080;

let db: admin.firestore.Firestore;

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

beforeAll(() => {
  const app = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "recompute-spec-admin",
  );
  db = app.firestore();
  db.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
});

describe("recomputeCustomerCounters — idempotency", () => {
  it("corrects drifted counters on the first run, then is a no-op on the second", async () => {
    const customerId = uid("customer");
    // Seeded with WRONG counters — simulates drift between the cache and
    // source-of-truth orders/payments.
    await db.collection("customers").doc(customerId).set({
      businessName: "Drift Test Co",
      totalOwingCents: 10000, // drift, but within autoCorrectMaxCents below
      totalOrderedCents: 10000,
      totalPaidCents: 10000,
      tenantId: 1,
      isDeleted: false,
    });

    await db.collection("orders").doc(uid("order")).set({
      customerId,
      status: "confirmed",
      totalCents: 5000,
      balanceCents: 3000,
      tenantId: 1,
      isDeleted: false,
    });
    // A cancelled order must NOT count toward the recomputed totals.
    await db.collection("orders").doc(uid("order")).set({
      customerId,
      status: "cancelled",
      totalCents: 100000,
      balanceCents: 100000,
      tenantId: 1,
      isDeleted: false,
    });

    await db.collection("payments").doc(uid("payment")).set({
      customerId,
      amountCents: 2000,
      tenantId: 1,
      isDeleted: false,
    });

    const thresholds = {
      notifyThresholdCents: 100,
      autoCorrectMaxCents: 500000,
      autoCorrectEnabled: true,
      notifyAdmin: false,
    };

    // ── First run: corrects the drift ──
    const first = await recomputeCustomerCounters(customerId, thresholds);
    expect(first.action).toBe("corrected");

    const afterFirst = (await db.collection("customers").doc(customerId).get()).data()!;
    expect(afterFirst["totalOrderedCents"]).toBe(5000); // cancelled order excluded
    expect(afterFirst["totalOwingCents"]).toBe(3000);
    expect(afterFirst["totalPaidCents"]).toBe(2000);

    // ── Second run: same source data, should be a true no-op ──
    const second = await recomputeCustomerCounters(customerId, thresholds);
    expect(second.action).toBe("none");
    expect(second.drifts).toEqual([]);

    const afterSecond = (await db.collection("customers").doc(customerId).get()).data()!;
    expect(afterSecond["totalOrderedCents"]).toBe(afterFirst["totalOrderedCents"]);
    expect(afterSecond["totalOwingCents"]).toBe(afterFirst["totalOwingCents"]);
    expect(afterSecond["totalPaidCents"]).toBe(afterFirst["totalPaidCents"]);
  });

  it("freezes (does not overwrite) drift above the auto-correct max, " +
    "logging each undismissed detection", async () => {
    const customerId = uid("customer");
    await db.collection("customers").doc(customerId).set({
      businessName: "Freeze Test Co",
      totalOwingCents: 0,
      totalOrderedCents: 0,
      totalPaidCents: 0,
      tenantId: 1,
      isDeleted: false,
    });
    await db.collection("orders").doc(uid("order")).set({
      customerId,
      status: "confirmed",
      totalCents: 999999, // far above autoCorrectMaxCents below
      balanceCents: 999999,
      tenantId: 1,
      isDeleted: false,
    });

    const thresholds = {
      notifyThresholdCents: 100,
      autoCorrectMaxCents: 5000, // drift of 999999 exceeds this
      autoCorrectEnabled: true,
      notifyAdmin: false,
    };

    const first = await recomputeCustomerCounters(customerId, thresholds);
    expect(first.action).toBe("frozen");
    const afterFirst = (await db.collection("customers").doc(customerId).get()).data()!;
    expect(afterFirst["totalOwingCents"]).toBe(0); // untouched — frozen, not corrected

    const logAfterFirst = await db
      .collection("reconciliationLog")
      .where("customerId", "==", customerId)
      .get();
    expect(logAfterFirst.size).toBe(1);

    // Second run on identical, still-drifted data. The COUNTER VALUES are
    // the idempotency claim this test exists to prove — they must stay
    // untouched (frozen means never write the corrected value). The log
    // is a different story on purpose: suppression only kicks in once a
    // human explicitly dismisses this exact drift value via the admin
    // review UI (which stamps reconciliationDismissedValue on the customer
    // doc — a write this function never makes itself). Nothing dismissed
    // it here, so re-detecting the same undismissed drift logs it again —
    // an audit trail of "still broken as of this sweep", not a bug. So:
    // counters idempotent, logging deliberately not.
    const second = await recomputeCustomerCounters(customerId, thresholds);
    expect(second.action).toBe("frozen");
    const afterSecond = (await db.collection("customers").doc(customerId).get()).data()!;
    expect(afterSecond["totalOwingCents"]).toBe(0);

    const logAfterSecond = await db
      .collection("reconciliationLog")
      .where("customerId", "==", customerId)
      .get();
    expect(logAfterSecond.size).toBe(2); // one needs_review row per undismissed detection
  });
});
