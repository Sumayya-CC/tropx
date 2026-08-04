import * as admin from "firebase-admin";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {Resend} from "resend";
import * as logger from "../logger";
import {db, DATABASE_ID, sentryDsn, resendApiKey, fromEmail, getAdminEmail} from "../core";

// ─── Reconciliation: shared counter recompute ──────────────────────────────
// Recomputes a single customer's denormalized counters from the
// source-of-truth order and payment documents, compares to the
// stored values, and applies drift banding read from
// settings/reconciliation. This is called BOTH by real-time
// triggers (one customer) and the scheduled sweeps (many
// customers) — same math either way, so it is idempotent and
// safe to run repeatedly.

interface ReconThresholds {
  notifyThresholdCents: number;
  autoCorrectMaxCents: number;
  autoCorrectEnabled: boolean;
  notifyAdmin: boolean;
}

async function getReconThresholds(): Promise<ReconThresholds> {
  try {
    const doc = await db
      .collection("settings")
      .doc("reconciliation")
      .get();
    const d = doc.data() || {};
    return {
      notifyThresholdCents: d.notifyThresholdCents ?? 100, // $1
      autoCorrectMaxCents: d.autoCorrectMaxCents ?? 5000, // $50
      autoCorrectEnabled: d.autoCorrectEnabled !== false, // default on
      notifyAdmin: d.notifyAdmin !== false, // default on
    };
  } catch {
    return {
      notifyThresholdCents: 100,
      autoCorrectMaxCents: 5000,
      autoCorrectEnabled: true,
      notifyAdmin: true,
    };
  }
}

interface CounterDrift {
  counter: "totalOwingCents" | "totalOrderedCents" | "totalPaidCents";
  stored: number;
  correct: number;
  delta: number; // correct - stored
}

// Result of reconciling one customer. `drifts` are only the
// entries at/above the notify threshold. `action` describes
// what was done to the counters as a whole.
interface ReconResult {
  customerId: string;
  businessName: string;
  drifts: CounterDrift[];
  action: "none" | "corrected" | "frozen";
  maxAbsDelta: number;
}

export async function recomputeCustomerCounters(
  customerId: string,
  thresholds?: ReconThresholds
): Promise<ReconResult> {
  const t = thresholds ?? (await getReconThresholds());

  const customerRef = db.collection("customers").doc(customerId);
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists) {
    return {
      customerId,
      businessName: "(deleted)",
      drifts: [],
      action: "none",
      maxAbsDelta: 0,
    };
  }
  const customer = customerSnap.data() || {};
  const businessName = customer.businessName || customerId;

  // ── Recompute from source of truth ──
  // Owing: sum balanceCents of non-deleted, non-cancelled orders
  //        (mirrors the aging report rule exactly).
  // Ordered: sum totalCents of the same order set.
  const ordersSnap = await db
    .collection("orders")
    .where("customerId", "==", customerId)
    .where("tenantId", "==", 1)
    .get();

  let correctOwing = 0;
  let correctOrdered = 0;
  for (const o of ordersSnap.docs) {
    const od = o.data();
    if (od.isDeleted) continue;
    if (od.status === "cancelled") continue;
    correctOwing += od.balanceCents || 0;
    correctOrdered += od.totalCents || 0;
  }

  // Paid: sum amountCents of non-deleted payments.
  const paymentsSnap = await db
    .collection("payments")
    .where("customerId", "==", customerId)
    .where("tenantId", "==", 1)
    .get();

  let correctPaid = 0;
  for (const p of paymentsSnap.docs) {
    const pd = p.data();
    if (pd.isDeleted) continue;
    correctPaid += pd.amountCents || 0;
  }

  const storedOwing = customer.totalOwingCents || 0;
  const storedOrdered = customer.totalOrderedCents || 0;
  const storedPaid = customer.totalPaidCents || 0;

  const candidates: CounterDrift[] = [
    {
      counter: "totalOwingCents",
      stored: storedOwing,
      correct: correctOwing,
      delta: correctOwing - storedOwing,
    },
    {
      counter: "totalOrderedCents",
      stored: storedOrdered,
      correct: correctOrdered,
      delta: correctOrdered - storedOrdered,
    },
    {
      counter: "totalPaidCents",
      stored: storedPaid,
      correct: correctPaid,
      delta: correctPaid - storedPaid,
    },
  ];

  // Only drifts at/above the notify threshold are "material".
  const drifts = candidates.filter(
    (c) => Math.abs(c.delta) >= t.notifyThresholdCents
  );

  const maxAbsDelta = drifts.reduce(
    (m, c) => Math.max(m, Math.abs(c.delta)), 0
  );

  // ── Decide action ──
  // Below notify threshold on ALL counters → still silently
  // correct sub-threshold drift so counters stay accurate, but
  // don't log/notify. (Correcting is cheap and keeps the cache
  // honest; the threshold only governs what's worth telling you.)
  //
  // Material drift, all within autoCorrectMax AND auto-correct
  // enabled → correct + log + notify.
  //
  // Any material drift ABOVE autoCorrectMax (option A: freeze) OR
  // auto-correct disabled → do NOT write; log as needs_review and
  // notify.

  const anyAboveMax = drifts.some(
    (c) => Math.abs(c.delta) > t.autoCorrectMaxCents
  );

  const stamp = admin.firestore.FieldValue.serverTimestamp();

  // Case: no material drift at all.
  if (drifts.length === 0) {
    // Silently correct any sub-threshold drift + mark reconciled.
    const subThresholdExists = candidates.some((c) => c.delta !== 0);
    const update: any = {
      countersReconciledAt: stamp,
    };
    if (subThresholdExists) {
      update.totalOwingCents = correctOwing;
      update.totalOrderedCents = correctOrdered;
      update.totalPaidCents = correctPaid;
    }
    await customerRef.update(update);
    return {
      customerId,
      businessName,
      drifts: [],
      action: "none",
      maxAbsDelta: 0,
    };
  }

  // Case: FREEZE — material drift above max, or auto-correct off.
  if (anyAboveMax || !t.autoCorrectEnabled) {
    // Do NOT touch the counters. Log each drift as needs_review,
    // unless this exact drift was already dismissed (same stored
    // value as when dismissed → stay silent to avoid re-nagging).
    const dismissedValue = customer.reconciliationDismissedValue;
    const dismissedOwing = dismissedValue?.totalOwingCents;

    // Suppress re-alert only if the owing counter — the one that
    // matters most — is unchanged since dismissal. If it moved,
    // it's new information; re-alert.
    const alreadyDismissed =
      dismissedValue != null &&
      dismissedOwing === storedOwing;

    // Still stamp reconciledAt so the incremental sweep watermark
    // advances (we HAVE looked at this customer).
    await customerRef.update({countersReconciledAt: stamp});

    if (alreadyDismissed) {
      return {
        customerId,
        businessName,
        drifts,
        action: "none", // suppressed
        maxAbsDelta,
      };
    }

    // Write a needs_review log entry capturing both values.
    await db.collection("reconciliationLog").add({
      customerId,
      businessName,
      status: "needs_review",
      drifts: drifts.map((d) => ({
        counter: d.counter,
        stored: d.stored,
        correct: d.correct,
        delta: d.delta,
      })),
      maxAbsDelta,
      reason: !t.autoCorrectEnabled ?
        "auto_correct_disabled" : "above_max_threshold",
      tenantId: 1,
      detectedAt: stamp,
      resolvedAt: null,
      resolvedBy: null,
    });

    return {
      customerId,
      businessName,
      drifts,
      action: "frozen",
      maxAbsDelta,
    };
  }

  // Case: AUTO-CORRECT — material drift, all within max.
  await customerRef.update({
    totalOwingCents: correctOwing,
    totalOrderedCents: correctOrdered,
    totalPaidCents: correctPaid,
    countersReconciledAt: stamp,
    // A fresh correction clears any prior dismissed marker, since
    // the counter is now truthful again.
    reconciliationDismissedValue:
      admin.firestore.FieldValue.delete(),
  });

  await db.collection("reconciliationLog").add({
    customerId,
    businessName,
    status: "resolved", // auto-corrected, no human action needed
    drifts: drifts.map((d) => ({
      counter: d.counter,
      stored: d.stored,
      correct: d.correct,
      delta: d.delta,
    })),
    maxAbsDelta,
    reason: "auto_corrected",
    tenantId: 1,
    detectedAt: stamp,
    resolvedAt: stamp,
    resolvedBy: {type: "system", label: "auto-reconciler"},
  });

  return {
    customerId,
    businessName,
    drifts,
    action: "corrected",
    maxAbsDelta,
  };
}

// ─── Reconciliation: real-time triggers ─────────────────────────────────────
// On any order or payment write, recompute the affected
// customer's counters immediately so they are never more than
// seconds stale, and stamp countersDirtyAt so the nightly sweep
// knows this customer changed since it last reconciled.

// Extract the customerId from an order or payment doc snapshot.
function customerIdFrom(data: any): string | null {
  return data?.customerId || null;
}

async function markDirtyAndRecompute(customerId: string) {
  try {
    // Stamp dirty FIRST, so even if the recompute below fails,
    // the nightly sweep will still pick this customer up (dirty >
    // reconciled). recomputeCustomerCounters stamps reconciledAt
    // on success, which clears the dirty flag by making them equal.
    await db.collection("customers").doc(customerId).update({
      countersDirtyAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Customer doc may not exist (deleted) — nothing to do.
    logger.info(
      `Could not stamp dirty for ${customerId}: ` +
      `${(err as Error).message}`
    );
    return;
  }

  try {
    const result = await recomputeCustomerCounters(customerId);
    if (result.action === "frozen") {
      logger.info(
        "Reconcile (trigger) FROZE customer counters — needs review",
        {customerId}
      );
    } else if (result.action === "corrected") {
      logger.info(
        "Reconcile (trigger) corrected customer counters",
        {customerId}
      );
    }
  } catch (err) {
    await logger.error(
      `Reconcile (trigger) failed for ${customerId}:`, err
    );
    // Left dirty on purpose — nightly sweep will retry.
  }
}

export const onOrderWriteReconcile = onDocumentWritten(
  {
    document: "orders/{orderId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
  },
  async (event) => {
    const after = event.data?.after.data();
    const before = event.data?.before.data();
    // Prefer the after-state customerId; fall back to before
    // (e.g. on delete). If both missing, nothing to do.
    const customerId =
      customerIdFrom(after) || customerIdFrom(before);
    if (!customerId) return;
    await markDirtyAndRecompute(customerId);
  }
);

export const onPaymentWriteReconcile = onDocumentWritten(
  {
    document: "payments/{paymentId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
  },
  async (event) => {
    const after = event.data?.after.data();
    const before = event.data?.before.data();
    const customerId =
      customerIdFrom(after) || customerIdFrom(before);
    if (!customerId) return;
    await markDirtyAndRecompute(customerId);
  }
);

// ─── Reconciliation: shared sweep helpers ───────────────────────────────────

// Build the admin summary email from a set of reconcile results.
// Two sections: frozen (needs review, shown first) and
// auto-corrected (informational). Returns null if nothing
// material happened (caller then sends no email).
function buildReconEmail(
  results: ReconResult[],
  sweepLabel: string
): {subject: string; html: string} | null {
  const frozen = results.filter((r) => r.action === "frozen");
  const corrected = results.filter((r) => r.action === "corrected");

  if (frozen.length === 0 && corrected.length === 0) {
    return null; // silent when clean
  }

  const fmt = (cents: number) =>
    (cents < 0 ? "-" : "") + "$" +
    (Math.abs(cents) / 100).toFixed(2);

  const counterLabel: Record<string, string> = {
    totalOwingCents: "Owing",
    totalOrderedCents: "Ordered",
    totalPaidCents: "Paid",
  };

  const driftRows = (r: ReconResult) =>
    r.drifts.map((d) =>
      `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">
          ${counterLabel[d.counter] || d.counter}
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:#8a94a6;">
          ${fmt(d.stored)}
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#0a2d4a;">
          ${fmt(d.correct)}
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;
          font-weight:600;color:${d.delta < 0 ? "#e7222e" : "#1a7c4a"};">
          ${fmt(d.delta)}
        </td>
      </tr>`
    ).join("");

  const customerBlock = (r: ReconResult, flagged: boolean) =>
    `<div style="margin-bottom:1.25rem;padding:1rem 1.25rem;
      border:1px solid ${flagged ? "#f0c0c0" : "#e8eaed"};
      border-left:4px solid ${flagged ? "#e7222e" : "#c9952a"};
      border-radius:0 8px 8px 0;background:${flagged ? "#fff8f8" : "#fffdf7"};">
      <div style="font-weight:700;color:#0a2d4a;margin-bottom:2px;">
        ${r.businessName}
      </div>
      <div style="font-size:0.75rem;color:#8a94a6;
        font-family:monospace;margin-bottom:8px;">
        ${r.customerId}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
        <thead>
          <tr style="color:#8a94a6;text-transform:uppercase;font-size:0.65rem;letter-spacing:0.05em;">
            <th style="padding:4px 12px;text-align:left;">Counter</th>
            <th style="padding:4px 12px;text-align:right;">Stored</th>
            <th style="padding:4px 12px;text-align:right;">Correct</th>
            <th style="padding:4px 12px;text-align:right;">Delta</th>
          </tr>
        </thead>
        <tbody>${driftRows(r)}</tbody>
      </table>
    </div>`;

  const frozenSection = frozen.length > 0 ?
    `<div style="margin-bottom:1.5rem;">
      <div style="font-size:1rem;font-weight:800;color:#e7222e;margin-bottom:0.75rem;">
        ⚠️ ${frozen.length} discrepanc${frozen.length === 1 ? "y" : "ies"} need review
      </div>
      <div style="font-size:0.85rem;color:#555;margin-bottom:1rem;">
        Drift exceeded the auto-correct limit — counters were
        <strong>left unchanged</strong> so you can investigate
        the cause. Review and apply corrections from the
        dashboard.
      </div>
      ${frozen.map((r) => customerBlock(r, true)).join("")}
    </div>` : "";

  const correctedSection = corrected.length > 0 ?
    `<div>
      <div style="font-size:1rem;font-weight:700;color:#c9952a;margin-bottom:0.75rem;">
        ${corrected.length} counter${corrected.length === 1 ? "" : "s"} auto-corrected
      </div>
      <div style="font-size:0.85rem;color:#555;margin-bottom:1rem;">
        Small drift within the auto-correct limit — fixed
        automatically, no action needed.
      </div>
      ${corrected.map((r) => customerBlock(r, false)).join("")}
    </div>` : "";

  const subject = frozen.length > 0 ?
    `⚠️ ${frozen.length} balance discrepanc${frozen.length === 1 ? "y needs" : "ies need"} review — Tropx` :
    `${corrected.length} counter${corrected.length === 1 ? "" : "s"} auto-corrected — Tropx`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
    <div style="background:#0a2d4a;border-radius:12px 12px 0 0;padding:24px 32px;">
      <div style="font-size:1.25rem;font-weight:800;color:white;">
        Reconciliation Report
      </div>
      <div style="font-size:0.8rem;color:#f0c040;margin-top:2px;">
        ${sweepLabel}
      </div>
    </div>
    <div style="background:white;padding:32px;border:1px solid #e8eaed;border-top:none;border-radius:0 0 12px 12px;">
      ${frozenSection}
      ${correctedSection}
      <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #f0f0f0;font-size:0.75rem;color:#9ca3af;">
        Tropx Wholesale — automated counter reconciliation.
        Frozen items appear on the admin dashboard under
        "Needs attention".
      </div>
    </div>
  </div>
</body>
</html>`;

  return {subject, html};
}

// Run reconciliation over a set of customer IDs, send one
// summary email if anything material happened. Shared by both
// the incremental and full sweeps.
async function runReconSweep(
  customerIds: string[],
  sweepLabel: string
): Promise<void> {
  const thresholds = await getReconThresholds();

  const results: ReconResult[] = [];
  for (const id of customerIds) {
    try {
      const r = await recomputeCustomerCounters(id, thresholds);
      results.push(r);
    } catch (err) {
      await logger.error(`Sweep reconcile failed for ${id}:`, err);
    }
  }

  const frozen = results.filter((r) => r.action === "frozen").length;
  const corrected = results.filter((r) => r.action === "corrected").length;
  logger.info(
    `${sweepLabel}: checked ${results.length}, ` +
    `corrected ${corrected}, frozen ${frozen}`
  );

  if (!thresholds.notifyAdmin) return;

  const email = buildReconEmail(results, sweepLabel);
  if (!email) return; // silent when clean

  try {
    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();
    await resend.emails.send({
      from: `Tropx Wholesale <${from}>`,
      to: adminEmail,
      subject: email.subject,
      html: email.html,
    });
    logger.info(`${sweepLabel}: summary emailed to admin`);
  } catch (err) {
    await logger.error(`${sweepLabel}: failed to email summary:`, err);
  }
}

// ─── Reconciliation: nightly incremental sweep ──────────────────────────────
// Reconciles only customers touched since their last reconcile
// (countersReconciledAt < countersDirtyAt). This is the retry
// net for any real-time trigger that failed or was skipped.

export const nightlyReconcileSweep = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async () => {
    // A customer is "dirty" if it was written since last reconcile.
    // We can't compare two fields directly in a Firestore query, so
    // fetch customers with a dirty stamp and filter in memory.
    // At national scale this should be batched/paginated; the set
    // of recently-active customers per night stays modest.
    const snap = await db
      .collection("customers")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .orderBy("countersDirtyAt", "desc")
      .limit(500)
      .get();

    const dirty: string[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const dirtyAt = d.countersDirtyAt?.toMillis?.() ?? 0;
      const reconciledAt = d.countersReconciledAt?.toMillis?.() ?? 0;
      if (dirtyAt > reconciledAt) {
        dirty.push(doc.id);
      }
    }

    if (dirty.length === 0) {
      logger.info("Nightly reconcile: nothing dirty, skipping");
      return;
    }

    await runReconSweep(dirty, "Nightly incremental sweep");
  }
);

// ─── Reconciliation: weekly full sweep ──────────────────────────────────────
// Reconciles EVERY non-deleted customer regardless of the dirty
// watermark. This is the backstop that catches drift in dormant
// accounts — ones with no recent order/payment activity, which
// the nightly incremental sweep never revisits. Runs weekly
// because dormant drift is rare and low-urgency; the incremental
// sweep handles everything active.

export const weeklyReconcileSweep = onSchedule(
  {
    schedule: "every sunday 04:00",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async () => {
    // Full scan of all active customers. Paginated so it scales
    // past a single query's document cap. At national scale this
    // may need to run in chunks across multiple invocations, but
    // paginating in-function covers thousands of customers fine.
    const all: string[] = [];
    const pageSize = 500;
    let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    // Cap total pages so a runaway can't exceed the timeout.
    // 10 pages × 500 = 5000 customers per run; raise when needed.
    for (let page = 0; page < 10; page++) {
      let q = db
        .collection("customers")
        .where("tenantId", "==", 1)
        .where("isDeleted", "==", false)
        .orderBy("businessName")
        .limit(pageSize);

      if (last) {
        q = q.startAfter(last);
      }

      const snap = await q.get();
      if (snap.empty) break;

      for (const doc of snap.docs) {
        all.push(doc.id);
      }

      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < pageSize) break; // last page
    }

    if (all.length === 0) {
      logger.info("Weekly reconcile: no customers, skipping");
      return;
    }


    await runReconSweep(all, "Weekly full sweep");
  }
);
