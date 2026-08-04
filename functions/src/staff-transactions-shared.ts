import * as admin from "firebase-admin";
import {db} from "./core";

/**
 * Shared helpers for the staff-facing transactional onCall group
 * (domains/orders.ts, domains/field-ops-transactions.ts,
 * domains/purchasing.ts's receivePurchaseOrder). Extracted in Prompt 5
 * phase 5.7 after finding real duplication across 10 call sites: the same
 * ~7-line "build actionBy from users/{uid}" block copy-pasted verbatim,
 * order/return-sequence allocation duplicated with a genuine behavioral
 * divergence, and subtotal/tax/discount math reimplemented 4 times (also
 * with a small divergence). Both divergences were resolved by adopting the
 * more defensive of the two existing behaviors — see the doc comments on
 * `allocateOrderNumber` and `computeOrderTotals` below — not by inventing
 * new behavior. Confirmed byte-identical (actionBy) or formula-equivalent
 * (totals/sequencing) against every call site before extracting; see
 * staff-transactions-shared.spec.ts for the equivalence tests.
 */

export interface ActionBySnapshot {
  uid: string;
  firstName: string;
  lastName: string;
}

/**
 * Reads users/{uid} inside the given transaction and builds the staff
 * actionBy snapshot stamped on money/stock-affecting documents
 * (orders/returns/visits/stockAdjustments). Was duplicated verbatim at 10
 * call sites before this extraction — confirmed byte-identical across all
 * 10 (including receivePurchaseOrder in domains/purchasing.ts) via direct
 * diff, not assumed.
 * @param {admin.firestore.Transaction} tx The in-flight transaction to
 *   read users/{uid} through — must be the same transaction the caller
 *   commits its writes in, so the read is consistent with everything else
 *   the transaction touches.
 * @param {string} uid The staff member's Auth uid (from `request.auth`).
 * @return {Promise<ActionBySnapshot>} The actionBy snapshot to stamp.
 */
export async function buildStaffActionBy(
  tx: admin.firestore.Transaction,
  uid: string
): Promise<ActionBySnapshot> {
  const userSnap = await tx.get(db.collection("users").doc(uid));
  const userProfile = userSnap.exists ? userSnap.data()! : {};
  return {
    uid,
    firstName: userProfile["firstName"] || "Staff",
    lastName: userProfile["lastName"] || "",
  };
}

export interface SequenceAllocation {
  number: string;
  nextSeq: number;
}

/**
 * Allocates the next order number from settings/orderSequence inside the
 * given transaction. `placeOrder` and `createAdminOrder` diverged here
 * before this extraction: placeOrder read only `sequence`, while
 * createAdminOrder read `Math.max(sequence, lastNumber)` — a difference
 * traced back to the 5H.2 fix that unified order numbering onto
 * `sequence` after finding portal and admin orders could collide;
 * `lastNumber` was left frozen (not deleted) as a forensic trail. Nothing
 * writes `lastNumber` anymore, so `sequence` alone is safe in today's
 * data, but this helper adopts the defensive `Math.max` form as canonical
 * — a strict superset of the simpler form, costs nothing, and closes a
 * latent (if currently inert) gap in what was placeOrder's logic.
 * @param {admin.firestore.Transaction} tx The in-flight transaction.
 * @return {Promise<SequenceAllocation>} The formatted order number
 *   (`{prefix}-{year}-{0000}`) and the raw next sequence value.
 */
export async function allocateOrderNumber(
  tx: admin.firestore.Transaction
): Promise<SequenceAllocation> {
  const seqRef = db.collection("settings").doc("orderSequence");
  const seqSnap = await tx.get(seqRef);
  const seqData = seqSnap.exists ? seqSnap.data()! : {};
  const nextSeq = Math.max(seqData["sequence"] || 0, seqData["lastNumber"] || 0) + 1;
  const prefix = seqData["prefix"] || "TRX";
  const year = new Date().getFullYear();
  return {
    number: `${prefix}-${year}-${String(nextSeq).padStart(4, "0")}`,
    nextSeq,
  };
}

/**
 * Allocates the next return number from settings/returnSequence inside
 * the given transaction. Not the same shape as `allocateOrderNumber`'s
 * doc structure — deliberately kept as a separate function rather than a
 * shared parameterized helper, since the return prefix lives on a
 * *different* document (`settings/ordering.returnPrefix`) than the
 * sequence counter itself, unlike orderSequence's self-contained
 * `prefix` field. `cancelOrder` and `submitReturn` already agreed on this
 * exact formula (no divergence found) — extracted as-is.
 * @param {admin.firestore.Transaction} tx The in-flight transaction.
 * @return {Promise<SequenceAllocation>} The formatted return number
 *   (`{prefix}-{year}-{0000}`) and the raw next sequence value.
 */
export async function allocateReturnNumber(
  tx: admin.firestore.Transaction
): Promise<SequenceAllocation> {
  const [seqSnap, orderingSnap] = await Promise.all([
    tx.get(db.collection("settings").doc("returnSequence")),
    tx.get(db.collection("settings").doc("ordering")),
  ]);
  const currentSeq = seqSnap.exists ? (seqSnap.data()?.["sequence"] || 0) : 0;
  const nextSeq = currentSeq + 1;
  const prefix = orderingSnap.data()?.["returnPrefix"] || "RET";
  const year = new Date().getFullYear();
  return {
    number: `${prefix}-${year}-${String(nextSeq).padStart(4, "0")}`,
    nextSeq,
  };
}

export interface OrderTotals {
  taxableCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Canonical subtotal → tax → total formula, per CLAUDE.md: `tax =
 * (subtotal − discount) × rate`. Before this extraction, `placeOrder`'s
 * `taxableCents` had no `Math.max(0, ...)` clamp while the other 3 sites
 * (createAdminOrder/updateAdminOrder/saveOrderQuantityEdits) did — inert
 * today since placeOrder hardcodes `discountCents = 0` (no portal
 * self-checkout discounts exist), but this helper carries the clamp as
 * the strictly safer canonical form, matching CLAUDE.md's documented
 * reasoning (never let a discount push a computed field negative).
 * @param {number} subtotalCents Sum of line-item totals, before discount.
 * @param {number} discountCents Flat discount applied before tax.
 * @param {number} taxRatePercent Tax rate as a percent (e.g. 13 for 13%
 *   HST), not a fraction.
 * @return {OrderTotals} taxableCents/taxCents/totalCents.
 */
export function computeOrderTotals(
  subtotalCents: number,
  discountCents: number,
  taxRatePercent: number
): OrderTotals {
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round(taxableCents * (taxRatePercent / 100));
  const totalCents = taxableCents + taxCents;
  return {taxableCents, taxCents, totalCents};
}
