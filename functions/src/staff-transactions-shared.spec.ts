import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {
  buildStaffActionBy,
  allocateOrderNumber,
  allocateReturnNumber,
  computeOrderTotals,
} from "./staff-transactions-shared";

/**
 * Prompt 5 (file split) phase 5.7 — equivalence tests for the shared
 * helpers extracted from 10 duplicated call sites in the transactional
 * onCall group. These exist to prove the extraction didn't change
 * behavior (or, where it deliberately did — the two divergences resolved
 * in staff-transactions-shared.ts's doc comments — that the new behavior
 * is exactly the intended one), BEFORE any of phase 5.8/5.9's call sites
 * are wired to use these helpers instead of their own inline copies.
 *
 * computeOrderTotals is pure — fixture-based exact-cents assertions, the
 * highest-value kind of test per CLAUDE.md's testing philosophy.
 * allocateOrderNumber/allocateReturnNumber/buildStaffActionBy all read
 * inside a Firestore transaction, so they're tested against the real
 * emulator via db.runTransaction, same as every other transactional
 * helper in this codebase.
 */

const DATABASE_ID = "tropx-dev";
const FIRESTORE_PORT = 8080;

let db: admin.firestore.Firestore;

function uid(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

beforeAll(() => {
  const app = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "staff-transactions-shared-spec-admin",
  );
  db = app.firestore();
  db.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
});

describe("computeOrderTotals", () => {
  it("computes taxable/tax/total for a normal order (13% HST, no discount)", () => {
    // subtotal $100.00, no discount, 13% HST -> tax $13.00, total $113.00
    expect(computeOrderTotals(10000, 0, 13)).toEqual({
      taxableCents: 10000,
      taxCents: 1300,
      totalCents: 11300,
    });
  });

  it("applies a discount before tax, matching CLAUDE.md's tax = (subtotal - discount) * rate", () => {
    // subtotal $100.00, $20.00 discount -> taxable $80.00, tax $10.40, total $90.40
    expect(computeOrderTotals(10000, 2000, 13)).toEqual({
      taxableCents: 8000,
      taxCents: 1040,
      totalCents: 9040,
    });
  });

  it("clamps taxableCents at zero when the discount exceeds the subtotal", () => {
    // This is the one behavioral change from placeOrder's pre-extraction
    // formula (which had no clamp) — inert in practice because placeOrder
    // hardcodes discountCents=0, but the shared helper is deliberately
    // the safer of the two original formulas. subtotal $10, discount $50.
    expect(computeOrderTotals(1000, 5000, 13)).toEqual({
      taxableCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it("rounds tax to the nearest cent", () => {
    // subtotal $10.01, 13% -> raw tax = 130.13 cents, rounds to 130
    expect(computeOrderTotals(1001, 0, 13)).toEqual({
      taxableCents: 1001,
      taxCents: 130,
      totalCents: 1131,
    });
  });

  it("handles a zero tax rate", () => {
    expect(computeOrderTotals(5000, 0, 0)).toEqual({
      taxableCents: 5000,
      taxCents: 0,
      totalCents: 5000,
    });
  });
});

describe("allocateOrderNumber", () => {
  // settings/orderSequence is a single real doc shared across the whole
  // suite (place-order.spec.ts, create-admin-order.spec.ts, etc. all
  // increment it), so these tests assert the invariant against its
  // current live state rather than seeding absolute values — seeding
  // would either collide with other spec files' assumptions or require
  // clearing a doc other tests depend on.
  it("produces a well-formed order number using Math.max(sequence, lastNumber) + 1", async () => {
    // This is the exact divergence this helper resolved: placeOrder's
    // pre-extraction formula read only `sequence`, ignoring `lastNumber`
    // entirely — this asserts the implementation really does take the max
    // of both fields (re-derived independently here, not just re-reading
    // the function's own output) rather than silently regressing to the
    // simpler form.
    const before = await db.collection("settings").doc("orderSequence").get();
    const beforeMax = before.exists ?
      Math.max(before.data()?.["sequence"] || 0, before.data()?.["lastNumber"] || 0) :
      0;

    const result = await db.runTransaction((tx) => allocateOrderNumber(tx));
    expect(result.number).toMatch(/^[A-Z]+-\d{4}-\d{4,}$/);
    expect(result.nextSeq).toBe(beforeMax + 1);
  });
});

describe("allocateReturnNumber", () => {
  it("increments settings/returnSequence and reads the prefix from settings/ordering.returnPrefix", async () => {
    const orderingSnap = await db.collection("settings").doc("ordering").get();
    const expectedPrefix = orderingSnap.data()?.["returnPrefix"] || "RET";
    const seqSnap = await db.collection("settings").doc("returnSequence").get();
    const beforeSeq = seqSnap.exists ? (seqSnap.data()?.["sequence"] || 0) : 0;

    const result = await db.runTransaction((tx) => allocateReturnNumber(tx));
    expect(result.nextSeq).toBe(beforeSeq + 1);
    expect(result.number.startsWith(`${expectedPrefix}-`)).toBe(true);
  });
});

describe("buildStaffActionBy", () => {
  it("reads the staff member's users/{uid} doc and builds the actionBy snapshot", async () => {
    const userId = uid("user");
    await db.collection("users").doc(userId).set({
      firstName: "Jamie",
      lastName: "Rivera",
      role: "manager",
      tenantId: 1,
    });

    const result = await db.runTransaction((tx) => buildStaffActionBy(tx, userId));
    expect(result).toEqual({uid: userId, firstName: "Jamie", lastName: "Rivera"});
  });

  it("falls back to 'Staff'/'' when the users/{uid} doc doesn't exist", async () => {
    const missingUid = uid("missing-user");
    const result = await db.runTransaction((tx) => buildStaffActionBy(tx, missingUid));
    expect(result).toEqual({uid: missingUid, firstName: "Staff", lastName: ""});
  });

  it("falls back to 'Staff' when firstName is present but empty/missing on the doc", async () => {
    const userId = uid("user");
    await db.collection("users").doc(userId).set({lastName: "OnlyLastName", tenantId: 1});

    const result = await db.runTransaction((tx) => buildStaffActionBy(tx, userId));
    expect(result).toEqual({uid: userId, firstName: "Staff", lastName: "OnlyLastName"});
  });
});
