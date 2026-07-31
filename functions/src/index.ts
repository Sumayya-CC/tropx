import * as admin from "firebase-admin";
// Modular import, used only in placeOrder (see the comment at that call
// site). The other 22 admin.firestore.FieldValue/.Timestamp sites in this
// file are intentionally left as-is — that cleanup belongs to the Phase 5
// index.ts split, not scattered into this testing phase.
import {FieldValue} from "firebase-admin/firestore";
import {onDocumentCreated, onDocumentUpdated, onDocumentWritten} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {createHash} from "crypto";
import {Resend} from "resend";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "./logger";

// Structured logging + error reporting. See logger.ts: never pass PII or
// *Cents amounts to logger.error/logger.info — a doc id or order/invoice
// number is enough for traceability.
const sentryDsn = defineSecret("SENTRY_DSN");

admin.initializeApp();

// Database name resolves based on which
// Firebase project this is deployed to.
// GCLOUD_PROJECT is automatically set by
// Cloud Functions at runtime — no manual
// config needed per environment.
const PROJECT_ID = process.env.GCLOUD_PROJECT || "";
const DATABASE_ID = PROJECT_ID === "tropx-wholesale-prod" ?
  "tropx-prod" : "tropx-dev";

const db = admin.firestore();
db.settings({databaseId: DATABASE_ID});

logger.info(
  "Cloud Functions initialized — project: " +
  `${PROJECT_ID}, database: ${DATABASE_ID}`
);

async function getAdminEmail(): Promise<string> {
  try {
    const doc = await db
      .collection("settings")
      .doc("business")
      .get();
    return doc.data()?.email || "admin@tropxwholesale.ca";
  } catch {
    return "admin@tropxwholesale.ca";
  }
}

async function isNotificationEnabled(
  key: string
): Promise<boolean> {
  try {
    const doc = await db
      .collection("settings")
      .doc("notifications")
      .get();
    if (!doc.exists) return true; // default on
    const data = doc.data();
    if (!data) return true;
    return data[key] !== false; // default true
  } catch {
    return true;
  }
}

// ─── Rate limiting: public-create job-queue collections ───────────────────
// contactInquiries/accessRequests are writable by anyone (firestore.rules:
// `allow create: if true`) to support public-facing forms — see CLAUDE.md's
// Firestore-as-job-queue pattern. Firestore rules have no visibility into
// IP address or request velocity, so rate limiting can't live there; it
// lives here instead, gating the actual side effect (the outbound email via
// Resend) rather than the Firestore write itself. An over-limit submission
// still creates its request document (a minor storage/read-quota cost) but
// never triggers a real email. These two scopes are keyed by the submitted
// email (sha256'd before use as a Firestore doc id) — acceptable here
// because worst case is spam noise to staff, not harm to the email's real
// owner.
//
// passwordResetRequests is different and does NOT follow this pattern: an
// email-keyed limiter on password-reset is a denial-of-service against the
// exact person it's meant to protect (an attacker who doesn't own the
// victim's inbox can still burn the victim's limit and lock out their real
// reset attempts). `sendPasswordResetEmail` calls
// `admin.auth().generatePasswordResetLink` for whatever email is in the
// payload, so unrestricted-by-anything-else it's also a mass-email-bombing
// vector — the fix isn't a looser email key, it's a key the attacker
// doesn't control. `requestPasswordReset` (onCall, below) is the front door
// for this collection instead of a direct client write: it rate-limits by
// a hash of `request.rawRequest.ip` — real requester signal an
// onDocumentCreated trigger structurally cannot see — before ever writing
// the request doc, then writes it itself via the Admin SDK. firestore.rules
// denies public `create` on this collection now that the callable is the
// only sanctioned writer.
interface RateLimitConfig {
  maxPerWindow: number;
  windowMinutes: number;
}

const RATE_LIMIT_DEFAULTS: Record<string, RateLimitConfig> = {
  passwordResetRequests: {maxPerWindow: 3, windowMinutes: 15},
  contactInquiries: {maxPerWindow: 5, windowMinutes: 60},
  accessRequests: {maxPerWindow: 5, windowMinutes: 60},
};

/**
 * Checks and atomically consumes one slot in the rate-limit window for
 * `scope` (a job-queue collection name) + `identifier` (an email for
 * contactInquiries/accessRequests, an IP hash for passwordResetRequests —
 * see the comment block above). Config is read from `settings/rateLimits`
 * per-scope, falling back to RATE_LIMIT_DEFAULTS when unset (`??` fallback
 * per the project's settings-field convention) — `settings/rateLimits.
 * enabled === false` is a kill switch that always returns "not limited,"
 * mirroring the notifications enable-toggle pattern above.
 *
 * Counter docs are stamped with `expiresAt` (48h out — well past every
 * scope's window) so a Firestore TTL policy on that field bounds long-term
 * storage growth from an attacker cycling through many identifiers; see
 * ARCHITECTURE.md's rate-limiting section for why a per-identifier counter
 * (rather than a single global circuit breaker) was judged proportionate
 * for this threat model.
 * @param {string} scope Job-queue collection name (matches a
 *   RATE_LIMIT_DEFAULTS key).
 * @param {string} identifier The signal to key the window on — an email or
 *   an IP hash, depending on scope (see comment block above).
 * @return {Promise<boolean>} true if this request is over the limit (or the
 *   check itself failed) and should be silently dropped rather than acted
 *   on.
 */
export async function isRateLimited(
  scope: string,
  identifier: string
): Promise<boolean> {
  let config: RateLimitConfig = RATE_LIMIT_DEFAULTS[scope];

  try {
    const settingsDoc = await db.collection("settings").doc("rateLimits").get();
    const data = settingsDoc.data();
    if (data?.enabled === false) return false;
    const override = data?.[scope];
    if (override) {
      config = {
        maxPerWindow: override.maxPerWindow ?? config.maxPerWindow,
        windowMinutes: override.windowMinutes ?? config.windowMinutes,
      };
    }
  } catch {
    // Settings unreadable — fall through with the hardcoded default rather
    // than failing open (unlimited) or closed (blocking every submission).
  }

  const key = createHash("sha256")
    .update(`${scope}:${identifier.trim().toLowerCase()}`)
    .digest("hex");
  const ref = db.collection("rateLimitCounters").doc(key);
  const windowMs = config.windowMinutes * 60_000;

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      const windowStartMs = data?.windowStart ?
        (data.windowStart as admin.firestore.Timestamp).toMillis() :
        0;
      const now = Date.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        now + 48 * 60 * 60 * 1000
      );

      if (!data || now - windowStartMs > windowMs) {
        tx.set(ref, {
          scope,
          windowStart: FieldValue.serverTimestamp(),
          count: 1,
          tenantId: 1,
          expiresAt,
        });
        return false;
      }

      if (data.count < config.maxPerWindow) {
        tx.update(ref, {count: FieldValue.increment(1), expiresAt});
        return false;
      }

      return true;
    });
  } catch (err) {
    // Fail closed BY DESIGN: a transient Firestore failure here means we
    // cannot prove this request is under the limit, so treat it as
    // over-limit (skip the send) rather than letting the exception
    // propagate uncaught. Deliberate, not incidental — see the isRateLimited
    // doc comment history for why this matters (an uncaught throw happened
    // to abort before reaching Resend today, but that was an accident of
    // control flow, not a guarantee a future refactor would preserve).
    await logger.error("Rate-limit check failed — failing closed", err);
    return true;
  }
}

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

const resendApiKey = defineSecret("RESEND_API_KEY");
const fromEmail = defineSecret("FROM_EMAIL");

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

// ═══ Shop↔Customer Link Reconciliation ═══════════════════════════════════
// Keeps the bidirectional Shop/Customer link and its denormalized flags
// honest. Heals unambiguous drift automatically; logs ambiguous conflicts
// for manual review. The link WRITES (client-side ShopLinkService + the
// approval batch) remain the source of truth — this is the safety net for
// partial failures, manual console edits, and legacy records.

// normalizeSearchName — MUST match src/app/shared/utils/text.utils.ts exactly.
function normalizeSearchNameFn(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface HealthThresholds {
  customerWatchDays: number;
  customerAtRiskDays: number;
  prospectCoolingDays: number;
  prospectColdDays: number;
}

async function getHealthThresholds(): Promise<HealthThresholds> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const sh = (doc.data() || {}).shopHealth || {};
    return {
      customerWatchDays: sh.customerWatchDays ?? 30,
      customerAtRiskDays: sh.customerAtRiskDays ?? 60,
      prospectCoolingDays: sh.prospectCoolingDays ?? 14,
      prospectColdDays: sh.prospectColdDays ?? 45,
    };
  } catch {
    return {customerWatchDays: 30, customerAtRiskDays: 60, prospectCoolingDays: 14, prospectColdDays: 45};
  }
}

async function isShopHealthEnabled(): Promise<boolean> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const sh = (doc.data() || {}).shopHealth || {};
    return sh.enabled !== false;
  } catch {
    return true;
  }
}

function daysSinceMs(value: any): number | null {
  if (!value) return null;
  const then = value?.toMillis ? value.toMillis() :
    (value instanceof Date ? value.getTime() : new Date(value).getTime());
  if (isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

type HealthBand = "healthy"|"watch"|"at_risk"|"warm"|"cooling"|"cold"|"unknown";

function computeCustomerBand(days: number | null, t: HealthThresholds, atRiskOverride?: number): HealthBand {
  if (days == null) return "unknown";
  const atRisk = atRiskOverride ?? t.customerAtRiskDays;
  if (days >= atRisk) return "at_risk";
  if (days >= t.customerWatchDays) return "watch";
  return "healthy";
}
function computeProspectBand(days: number | null, t: HealthThresholds): HealthBand {
  if (days == null) return "unknown";
  if (days >= t.prospectColdDays) return "cold";
  if (days >= t.prospectCoolingDays) return "cooling";
  return "warm";
}

interface LinkReconSummary {
  scanned: number;
  healed: number;
  flagged: number;
  backfilled: number;
}

interface LinkReconConfig {
  enabled: boolean;
}

async function getLinkReconConfig(): Promise<LinkReconConfig> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const d = doc.data() || {};
    const s = d.shopLink || {};
    return {enabled: s.enabled !== false}; // default ON
  } catch {
    return {enabled: true};
  }
}

// Reconcile ONE customer + its linked shop. Returns which buckets it touched.
// Auto-heals: flag↔link agreement, dangling pointer, missing back-pointer,
// stale searchName, shop status coherence. Flags (no write): three-way
// mismatch (cust→shopA but shopA→custB), and shop claimed by another customer.
async function reconcileOneCustomer(
  customerId: string, healthT: HealthThresholds
): Promise<{healed: boolean; flagged: boolean; backfilled: boolean}> {
  const custRef = db.collection("customers").doc(customerId);
  const custSnap = await custRef.get();
  if (!custSnap.exists) return {healed: false, flagged: false, backfilled: false};
  const cust = custSnap.data() || {};
  if (cust.isDeleted) return {healed: false, flagged: false, backfilled: false};

  const custUpdate: Record<string, any> = {};
  let flagged = false;
  let backfilled = false;
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  // searchName backfill/refresh (first-run migration + drift).
  const wantSearch = normalizeSearchNameFn(cust.businessName);
  if ((cust.searchName || "") !== wantSearch) {
    custUpdate.searchName = wantSearch;
    if (cust.searchName === undefined) backfilled = true;
  }

  const linkedShopId: string | null = cust.linkedShopId ?? null;

  if (!linkedShopId) {
    // No shop link → hasShop must be false.
    if (cust.hasShop !== false) {
      custUpdate.hasShop = false;
      if (cust.hasShop === undefined) backfilled = true;
    }
  } else {
    const shopRef = db.collection("shops").doc(linkedShopId);
    const shopSnap = await shopRef.get();

    if (!shopSnap.exists || shopSnap.data()?.isDeleted) {
      // Dangling pointer → clear it, hasShop false. (Unambiguous heal.)
      custUpdate.linkedShopId = admin.firestore.FieldValue.delete();
      custUpdate.hasShop = false;
    } else {
      const shop = shopSnap.data() || {};
      const backRef: string | null = shop.linkedCustomerId ?? null;

      if (backRef === customerId) {
        // Healthy link. Ensure flags + shop coherence.
        if (cust.hasShop !== true) {
          custUpdate.hasShop = true;
          if (cust.hasShop === undefined) backfilled = true;
        }
        const shopUpdate: Record<string, any> = {};
        if (shop.hasCustomer !== true) {
          shopUpdate.hasCustomer = true;
          if (shop.hasCustomer === undefined) backfilled = true;
        }
        if (shop.status !== "customer") shopUpdate.status = "customer";
        const shopWantSearch = normalizeSearchNameFn(shop.name);
        if ((shop.searchName || "") !== shopWantSearch) {
          shopUpdate.searchName = shopWantSearch;
          if (shop.searchName === undefined) backfilled = true;
        }
        const custDays = daysSinceMs(cust.lastOrderAt);
        const band = computeCustomerBand(custDays, healthT, shop.inactiveDaysOverride);
        const prevBand = shop.healthBand;
        const staleMs = daysSinceMs(shop.healthComputedAt);
        if (band !== prevBand || (staleMs != null && staleMs >= 1) || shop.healthComputedAt == null) {
          shopUpdate.healthBand = band;
          shopUpdate.healthDays = custDays;
          shopUpdate.healthKind = "customer";
          shopUpdate.healthComputedAt = stamp;
        }
        if (Object.keys(shopUpdate).length > 0) {
          await shopRef.update(shopUpdate);
        }
      } else if (backRef == null) {
        // One-way link (cust→shop, shop has no back-pointer). Heal: set back-pointer.
        await shopRef.update({
          linkedCustomerId: customerId,
          hasCustomer: true,
          status: "customer",
        });
        if (cust.hasShop !== true) custUpdate.hasShop = true;
      } else {
        // Three-way mismatch: cust→shop, but shop→someone else. AMBIGUOUS.
        flagged = true;
        await db.collection("reconciliationLog").add({
          kind: "shop_link",
          status: "needs_review",
          reason: "three_way_mismatch",
          customerId,
          shopId: linkedShopId,
          shopLinkedCustomerId: backRef,
          tenantId: 1,
          detectedAt: stamp,
          resolvedAt: null,
          resolvedBy: null,
        });
        // Do NOT touch either side.
      }
    }
  }

  const healed = Object.keys(custUpdate).length > 0;
  if (healed) {
    custUpdate.linkReconciledAt = stamp;
    await custRef.update(custUpdate);
  } else {
    // Still stamp watermark so we don't reprocess a clean doc every incremental run.
    await custRef.update({linkReconciledAt: stamp});
  }

  return {healed, flagged, backfilled};
}

// Reconcile shops that have NO customer link (the customer loop above only
// visits shops reachable from a customer). Catches orphan flags on prospect
// shops + backfills their searchName/hasCustomer.
async function reconcileOrphanShops(
  shopIds: string[], healthT: HealthThresholds
): Promise<{healed: number; backfilled: number}> {
  let healed = 0;
  let backfilled = 0;
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  for (const id of shopIds) {
    const ref = db.collection("shops").doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const shop = snap.data() || {};
    if (shop.isDeleted) continue;
    if (shop.linkedCustomerId) continue; // handled via customer loop

    const update: Record<string, any> = {};
    if (shop.hasCustomer !== false) {
      update.hasCustomer = false;
      if (shop.hasCustomer === undefined) backfilled++;
    }
    const wantSearch = normalizeSearchNameFn(shop.name);
    if ((shop.searchName || "") !== wantSearch) {
      update.searchName = wantSearch;
      if (shop.searchName === undefined) backfilled++;
    }
    const days = daysSinceMs(shop.lastVisitDate);
    const band = computeProspectBand(days, healthT);
    const prevBand = shop.healthBand;
    const staleMs = daysSinceMs(shop.healthComputedAt);
    if (band !== prevBand || (staleMs != null && staleMs >= 1) || shop.healthComputedAt == null) {
      update.healthBand = band;
      update.healthDays = days;
      update.healthKind = "prospect";
      update.healthComputedAt = stamp;
    }
    if (Object.keys(update).length > 0) {
      await ref.update(update);
      healed++;
    }
  }
  return {healed, backfilled};
}

// Core sweep. mode 'full' scans everything; 'incremental' only customers
// whose doc changed since their last link-reconcile watermark. Exported
// for the same reason recomputeCustomerCounters is: shared by the
// nightly/weekly sweeps and the on-demand callable, so it needs to be
// directly testable for idempotency.
export async function reconcileShopLinks(
  mode: "full" | "incremental"
): Promise<LinkReconSummary> {
  const summary: LinkReconSummary = {scanned: 0, healed: 0, flagged: 0, backfilled: 0};
  const healthT = await getHealthThresholds();

  // ── customers ──
  const customerIds: string[] = [];
  const pageSize = 500;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (let page = 0; page < 20; page++) {
    let q = db.collection("customers")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .orderBy("businessName")
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (mode === "incremental") {
        const d = doc.data();
        const changed = d.updatedAt?.toMillis?.() ??
          d.createdAt?.toMillis?.() ?? 0;
        const reconciled = d.linkReconciledAt?.toMillis?.() ?? 0;
        // First-run (no watermark) always qualifies → doubles as backfill.
        if (reconciled !== 0 && changed <= reconciled) continue;
      }
      customerIds.push(doc.id);
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }

  for (const id of customerIds) {
    try {
      const r = await reconcileOneCustomer(id, healthT);
      summary.scanned++;
      if (r.healed) summary.healed++;
      if (r.flagged) summary.flagged++;
      if (r.backfilled) summary.backfilled++;
    } catch (err) {
      await logger.error(`Link reconcile failed for customer ${id}:`, err);
    }
  }

  // ── orphan shops (full sweep only — cheap enough, and where legacy prospect
  //    shops get their flags backfilled) ──
  if (mode === "full") {
    const shopIds: string[] = [];
    last = null;
    for (let page = 0; page < 20; page++) {
      let q = db.collection("shops")
        .where("tenantId", "==", 1)
        .where("isDeleted", "==", false)
        .orderBy("name")
        .limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) shopIds.push(doc.id);
      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < pageSize) break;
    }
    const orphan = await reconcileOrphanShops(shopIds, healthT);
    summary.healed += orphan.healed;
    summary.backfilled += orphan.backfilled;
    summary.scanned += shopIds.length;
  }

  logger.info(
    `Link reconcile (${mode}): scanned ${summary.scanned}, ` +
    `healed ${summary.healed}, flagged ${summary.flagged}, ` +
    `backfilled ${summary.backfilled}`
  );
  return summary;
}

// Nightly incremental — only recently-changed customers.
export const nightlyLinkReconcile = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const cfg = await getLinkReconConfig();
    if (!cfg.enabled) {
      logger.info("Link reconcile disabled — skipping nightly");
      return;
    }
    await reconcileShopLinks("incremental");
  }
);

// Exported for the same reason as reconcileShopLinks above — shared by
// the nightly sweep and the on-demand callable, testable directly.
export async function stampAllShopHealth(): Promise<{scanned: number; updated: number}> {
  const t = await getHealthThresholds();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  const pageSize = 500;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0; let updated = 0;

  for (let page = 0; page < 40; page++) {
    let q = db.collection("shops")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .orderBy("name")
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const shop = doc.data();
      scanned++;
      let band: HealthBand; let days: number | null; let kind: "customer"|"prospect";
      if (shop.linkedCustomerId) {
        let lastOrderAt: any = null;
        try {
          const c = await db.collection("customers").doc(shop.linkedCustomerId).get();
          lastOrderAt = c.exists ? c.data()?.lastOrderAt : null;
        } catch {/* null */}
        days = daysSinceMs(lastOrderAt);
        band = computeCustomerBand(days, t, shop.inactiveDaysOverride);
        kind = "customer";
      } else {
        days = daysSinceMs(shop.lastVisitDate);
        band = computeProspectBand(days, t);
        kind = "prospect";
      }
      // Manual refresh writes even if band unchanged, so healthDays reflects the true current day count on demand.
      await doc.ref.update({healthBand: band, healthDays: days, healthKind: kind, healthComputedAt: stamp});
      updated++;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  logger.info(`Shop health stamp: scanned ${scanned}, updated ${updated}`);
  return {scanned, updated};
}

export const nightlyShopHealthStamp = onSchedule(
  {
    schedule: "every day 03:45",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const enabled = await isShopHealthEnabled();
    if (!enabled) {
      logger.info("Shop health computation disabled — skipping nightly");
      return;
    }
    await stampAllShopHealth();
  }
);

export const refreshShopHealthNow = onCall(
  {region: "northamerica-northeast2", cors: true, secrets: [sentryDsn]},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be authenticated");
    if (request.auth.token["role"] !== "admin") throw new HttpsError("permission-denied", "Admin only");
    return await stampAllShopHealth();
  }
);

interface StuckThresholds {
  to_visit: number; first_contact: number; manager_meeting: number; sample_left: number;
  decision: number; opened: number;
}

async function getPipelineConfig(): Promise<{enabled: boolean; thresholds: StuckThresholds}> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const p = (doc.data() || {}).pipeline || {};
    const st = p.stuckThresholds || {};
    return {
      enabled: p.enabled !== false, // default ON
      thresholds: {
        to_visit: st.to_visit ?? 10,
        first_contact: st.first_contact ?? 7,
        manager_meeting: st.manager_meeting ?? 10,
        sample_left: st.sample_left ?? 14,
        decision: st.decision ?? 7,
        opened: st.opened ?? 3,
      },
    };
  } catch {
    return {
      enabled: true,
      thresholds: {to_visit: 10, first_contact: 7, manager_meeting: 10, sample_left: 14, decision: 7, opened: 3},
    };
  }
}

// Exported for the same reason as reconcileShopLinks/stampAllShopHealth
// above — shared by the nightly sweep and the on-demand callable,
// testable directly.
export async function stampAllPipelineStuck(): Promise<{scanned: number; updated: number; backfilled: number}> {
  const {thresholds} = await getPipelineConfig();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  const pageSize = 500;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0; let updated = 0; let backfilled = 0;

  for (let page = 0; page < 40; page++) {
    let q = db.collection("shops")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .where("status", "==", "prospect")
      .orderBy("name")
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const shop = doc.data();
      scanned++;
      const stage = shop.pipelineStage || "first_contact";

      let enteredAt = shop.pipelineEnteredStageAt;
      const update: Record<string, any> = {};
      if (!enteredAt) {
        enteredAt = shop.createdAt || stamp;
        update.pipelineEnteredStageAt = enteredAt;
        if (!shop.pipelineHistory || shop.pipelineHistory.length === 0) {
          update.pipelineHistory = [{stage, enteredAt: enteredAt, by: null}];
        }
        backfilled++;
      }

      const days = daysSinceMs(enteredAt);
      const threshold = (thresholds as any)[stage] ?? 14;
      const stuck = days != null && days > threshold;

      if (shop.pipelineStuck !== stuck || shop.daysInStage !== days || update.pipelineEnteredStageAt) {
        update.pipelineStuck = stuck;
        update.daysInStage = days;
        update.pipelineStuckComputedAt = stamp;
      }

      if (Object.keys(update).length > 0) {
        await doc.ref.update(update);
        updated++;
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  logger.info(`Pipeline stuck stamp: scanned ${scanned}, updated ${updated}, backfilled ${backfilled}`);
  return {scanned, updated, backfilled};
}

export const nightlyPipelineStuckStamp = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const {enabled} = await getPipelineConfig();
    if (!enabled) {
      logger.info("Pipeline stamping disabled — skipping"); return;
    }
    await stampAllPipelineStuck();
  }
);

export const refreshPipelineStuckNow = onCall(
  {region: "northamerica-northeast2", cors: true, secrets: [sentryDsn]},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be authenticated");
    if (request.auth.token["role"] !== "admin") throw new HttpsError("permission-denied", "Admin only");
    return await stampAllPipelineStuck();
  }
);

// Weekly full — backstop that catches dormant/legacy drift the incremental misses.
export const weeklyLinkReconcile = onSchedule(
  {
    schedule: "every sunday 04:30",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const cfg = await getLinkReconConfig();
    if (!cfg.enabled) {
      logger.info("Link reconcile disabled — skipping weekly");
      return;
    }
    await reconcileShopLinks("full");
  }
);

// On-demand "Reconcile Now" — always a FULL sweep. Region matches app.config
// (northamerica-northeast2) so the callable resolves.
export const reconcileShopLinksNow = onCall(
  {
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }
    if (request.auth.token["role"] !== "admin") {
      throw new HttpsError("permission-denied", "Admin only");
    }
    // Manual runs ignore the enabled flag — pressing the button IS intent.
    const summary = await reconcileShopLinks("full");
    return summary;
  }
);

// ─── Welcome Email ─────────────────────────────────────────────────────────
export const onAccessRequestApproved = onDocumentCreated(
  {
    document: "accessRequestApprovals/{approvalId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    // Matches the guard on sendPasswordResetEmail/onAdminPasswordReset —
    // this doc is a job-queue request, and a redelivered trigger event
    // would otherwise create a duplicate Auth user attempt and re-send
    // the welcome email.
    if (!data || data.processed) return;

    const {email, ownerFirstName, ownerLastName, businessName} = data;

    if (!email) {
      await logger.error("No email found on approval");
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const firstName = ownerFirstName ?? "";
    const lastName = ownerLastName ?? null;
    const fullDisplayName = [firstName, lastName]
      .filter(Boolean)
      .join(" ");

    let resetLink = "";
    try {
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        userRecord = await admin.auth().createUser({
          email,
          displayName: fullDisplayName,
          emailVerified: false,
        });
      }

      await db.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        firstName,
        lastName,
        email,
        role: "customer",
        tenantId: data.tenantId ?? 1,
        linkedCustomerId: data.customerId ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isDeleted: false,
      }, {merge: true});

      // Stamp the role as a custom claim so Firestore
      // security rules can check request.auth.token.role
      // without an extra DB read.
      await admin.auth().setCustomUserClaims(
        userRecord.uid, {
          role: "customer",
          tenantId: 1,
          linkedCustomerId: data.customerId ?? null,
        }
      );

      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );

      await event.data?.ref.update({
        linkedUserId: userRecord.uid,
        processed: true,
        processedAt: new Date(),
      });
    } catch (err) {
      await logger.error("Error creating user or reset link:", err);
      await event.data?.ref.update({processed: true, error: true});
      return;
    }

    const html = welcomeEmailHtml(
      firstName || "there",
      businessName ?? "Valued Partner",
      resetLink
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: email,
        subject: "Welcome to Tropx Wholesale — Set Up Your Account",
        html,
      });
      logger.info("Welcome email sent");
    } catch (err) {
      await logger.error("Error sending welcome email:", err);
    }
  }
);

export const onCustomerDeleted = onDocumentUpdated(
  {
    document: "customers/{customerId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // Only trigger when isDeleted changes to true
    if (before.isDeleted === after.isDeleted) return;
    if (!after.isDeleted) return;

    const email = after.email;
    if (!email) return;

    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(userRecord.uid, {disabled: true});
      logger.info("Disabled Auth user for deleted customer", {uid: userRecord.uid});

      // Also mark user doc as deleted
      await db.collection("users").doc(userRecord.uid).update({
        isDeleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      await logger.error("Error disabling auth user:", err);
    }
  }
);

// ─── Password Reset Request (public entry point) ───────────────────────────
// The only sanctioned writer of passwordResetRequests — firestore.rules
// denies public `create` on this collection (see the rate-limiting comment
// block near isRateLimited for why). An onCall function, not a direct
// client write, specifically so this has access to `request.rawRequest.ip`:
// a signal the attacker doesn't control, unlike the submitted email. Always
// resolves {success: true} regardless of whether the request was rate-
// limited or the email belongs to a real account — both are exactly the
// kind of thing that must not be observable from the response, or the
// endpoint becomes an email-enumeration or rate-limit oracle.
export const requestPasswordReset = onCall(
  {
    region: "northamerica-northeast2",
  },
  async (request) => {
    const email = (request.data?.email || "").trim().toLowerCase();
    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required");
    }

    const ip = request.rawRequest.ip || "unknown";
    if (await isRateLimited("passwordResetRequests", ip)) {
      return {success: true};
    }

    await db.collection("passwordResetRequests").add({
      email,
      processed: false,
      createdAt: FieldValue.serverTimestamp(),
      tenantId: 1,
    });

    return {success: true};
  }
);

// ─── Password Reset Email ───────────────────────────────────────────────────
export const sendPasswordResetEmail = onDocumentCreated(
  {
    document: "passwordResetRequests/{requestId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.processed) return;

    const {email} = data;
    if (!email) return;

    // No isRateLimited call here: the only writer of this collection is
    // requestPasswordReset (above), which already rate-limits by IP before
    // ever creating this doc. A second, email-keyed check here would
    // reintroduce the exact victim-lockout vulnerability that moved this
    // collection off the trigger-gate pattern in the first place.

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let resetLink = "";
    try {
      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );
    } catch (err) {
      await logger.error("Error generating reset link:", err);
      await event.data?.ref.update({processed: true, error: true});
      return;
    }

    const html = passwordResetEmailHtml(resetLink);

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: email,
        subject: "Reset Your Tropx Wholesale Password",
        html,
      });
      await event.data?.ref.update({
        processed: true,
        sentAt: new Date(),
      });
      logger.info("Password reset email sent");
    } catch (err) {
      await logger.error("Error sending password reset email:", err);
    }
  }
);

// ─── Admin-Triggered Password Reset ─────────────────────────────────────────
export const onAdminPasswordReset = onDocumentCreated(
  {
    document: "adminPasswordResets/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.processed) return;

    const {email} = data;
    if (!email) {
      await event.data?.ref.update({processed: true, error: "No email"});
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let resetLink = "";
    try {
      // Ensure Auth user exists — create if not
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        // User doesn't exist in Auth yet — create them
        userRecord = await admin.auth().createUser({
          email,
          emailVerified: false,
        });
        logger.info("Created Auth user", {uid: userRecord.uid});
      }

      // Ensure userProfiles doc exists
      const userProfileRef = db.collection("users").doc(userRecord.uid);
      const userProfileSnap = await userProfileRef.get();
      if (!userProfileSnap.exists) {
        // Try to get customer info to populate the profile
        let firstName = "";
        let lastName = null;
        const customerId = data.customerId || null;

        if (customerId) {
          try {
            const customerSnap = await db.collection("customers").doc(customerId).get();
            if (customerSnap.exists) {
              const customer = customerSnap.data() || {};
              firstName = customer.ownerFirstName || "";
              lastName = customer.ownerLastName || null;

              // Also patch externalCustomerId back on customer if missing
              const customerData = customerSnap.data() || {};
              if (!customerData.linkedUserId) {
                await db.collection("customers").doc(customerId).update({
                  linkedUserId: userRecord.uid,
                });
              }
            }
          } catch (err) {
            await logger.error("Could not fetch customer for profile:", err);
          }
        }

        await userProfileRef.set({
          uid: userRecord.uid,
          firstName,
          lastName,
          email,
          role: "customer",
          tenantId: data.tenantId ?? 1,
          linkedCustomerId: customerId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isDeleted: false,
        });
        logger.info("Created userProfiles doc", {customerId});
      }

      // Stamp role claim — determines Firestore rule access.
      // Always customer for admin-triggered resets since this
      // path is used exclusively for customer account setup.
      await admin.auth().setCustomUserClaims(
        userRecord.uid, {
          role: "customer",
          tenantId: 1,
          linkedCustomerId: data.customerId ?? null,
        }
      );

      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );
    } catch (err: any) {
      await logger.error("Error generating reset link:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed to generate link",
      });
      return;
    }

    const html = passwordResetEmailHtml(resetLink);

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: email,
        subject: "Reset Your Tropx Wholesale Password",
        html,
      });
      await event.data?.ref.update({
        processed: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info("Admin-triggered password reset sent");
    } catch (err: any) {
      await logger.error("Error sending admin password reset:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed to send email",
      });
    }
  }
);

// ─── Contact Form Notification ──────────────────────────────────────────────
export const onContactInquiry = onDocumentCreated(
  {
    document: "contactInquiries/{inquiryId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    // Guards against a redelivered trigger event re-sending the admin
    // notification — see the "idempotency" comment block above
    // onOrderNotification for the shared reasoning across these
    // business-doc-triggered notification functions. rateLimited is a
    // separate terminal marker (see isRateLimited above) — either one
    // means this doc is already handled, don't reprocess.
    if (!data || data.notificationSentAt || data.rateLimited) return;

    const {name, email, phone, businessName, message} = data;

    if (email && (await isRateLimited("contactInquiries", email))) {
      await event.data?.ref.update({rateLimited: true});
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const html = contactInquiryEmailHtml(
      name, email, phone, businessName, message
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: "admin@tropxwholesale.ca",
        replyTo: email,
        subject: `New Contact Inquiry from ${businessName ?? name}`,
        html,
      });
      await event.data?.ref.update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      logger.info("Contact inquiry notification sent");
    } catch (err) {
      await logger.error("Error sending contact notification:", err);
    }
  }
);

// ─── Employee Management ────────────────────────────────────────────────────

export const onEmployeeInvitation = onDocumentCreated(
  {
    document: "employeeInvitations/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "pending") return;

    const {email, firstName, lastName, phone, role,
      temporaryPassword, tenantId} = data;

    // Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        password: temporaryPassword,
        displayName: `${firstName} ${lastName}`.trim(),
        emailVerified: false,
      });
    } catch (err: any) {
      await logger.error("Error creating auth user:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
      return;
    }

    // Create Firestore user doc
    await db.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      firstName,
      lastName: lastName || null,
      phone: phone || null,
      role,
      status: "active",
      tenantId: tenantId ?? 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: data.createdBy || null,
      isDeleted: false,
    });

    // Stamp role as custom claim. Employee roles:
    // admin | manager | sales_rep | warehouse.
    // These map directly to Firestore rule checks.
    await admin.auth().setCustomUserClaims(
      userRecord.uid,
      {role: role, tenantId: tenantId ?? 1}
    );
    logger.info(
      `Set custom claim role=${role}`, {uid: userRecord.uid}
    );

    // Update invitation doc
    await event.data?.ref.update({
      status: "processed",
      linkedUid: userRecord.uid,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      temporaryPassword: admin.firestore.FieldValue.delete(),
    });

    // Send invitation email
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();
    const roleLabels: Record<string, string> = {
      admin: "Administrator",
      manager: "Manager",
      sales_rep: "Sales Representative",
      warehouse: "Warehouse Staff",
      customer: "Customer",
    };
    const roleLabel = roleLabels[role] || role;

    await resend.emails.send({
      from: `Tropx Wholesale <${from}>`,
      to: email,
      subject: "Your Tropx Wholesale Staff Account",
      html: employeeInvitationEmailHtml(
        firstName, roleLabel, email, temporaryPassword
      ),
    });

    logger.info("Employee invitation processed");
  }
);

export const onAuthAction = onDocumentCreated(
  {
    document: "authActions/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const {action, email} = data;
    let {uid} = data;

    try {
      // Resolve uid from email if uid not provided. Email is the
      // reliable identifier since linkedUserId is not always
      // populated on customer docs.
      if (!uid && email) {
        try {
          const userRecord = await admin.auth().getUserByEmail(email);
          uid = userRecord.uid;
        } catch {
          // No Auth account exists for this email — nothing to
          // disable. The customer status flip alone blocks them.
          logger.info("No Auth user for this email, skipping");
          await event.data?.ref.update({
            processed: true,
            note: "no-auth-account",
          });
          return;
        }
      }

      if (!uid) {
        await event.data?.ref.update({
          processed: true,
          error: "No uid or email provided",
        });
        return;
      }

      if (action === "disable") {
        await admin.auth().updateUser(uid, {disabled: true});
        logger.info("Disabled auth user", {uid});
      } else if (action === "enable") {
        await admin.auth().updateUser(uid, {disabled: false});
        logger.info("Enabled auth user", {uid});

        // Re-stamp the claim on re-enable in case it was
        // cleared. Look up role from the users collection.
        try {
          const userDocs = await db
            .collection("users")
            .where("uid", "==", uid)
            .limit(1)
            .get();
          if (!userDocs.empty) {
            const userData = userDocs.docs[0].data();
            const role = userData.role || "customer";
            const tenantId = userData.tenantId ?? 1;
            const linkedCustomerId =
              userData.linkedCustomerId ?? null;
            await admin.auth().setCustomUserClaims(
              uid, {role, tenantId, linkedCustomerId}
            );
            logger.info(
              `Restored claim role=${role} for ${uid}`
            );
          }
        } catch (claimErr) {
          await logger.error(
            "Could not restore claim on enable:", claimErr
          );
        }
      }
      await event.data?.ref.update({processed: true, resolvedUid: uid});
    } catch (err: any) {
      await logger.error("Error processing auth action:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed",
      });
    }
  }
);

// ─── Invoice Requests ─────────────────────────────────────────────────────────

export const onInvoiceRequest = onDocumentCreated(
  {
    document: "invoiceRequests/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "pending") return;

    const {
      customerEmail,
      orderNumber,
      invoiceHtml,
    } = data;

    if (!customerEmail || !invoiceHtml) {
      await event.data?.ref.update({
        status: "error",
        error: "Missing email or HTML",
      });
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject: `Order Confirmation ${orderNumber} — Tropx Wholesale`,
        html: invoiceHtml,
      });

      await event.data?.ref.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(
        `Invoice ${orderNumber} sent to ${customerEmail}`
      );
    } catch (err: any) {
      await logger.error("Error sending invoice email:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
    }
  }
);

// The next several triggers fire a customer- or admin-facing email off a
// primary business document (orders/returns/payments), not a job-queue
// request doc — so there's no natural "processed" field to check. Each
// stamps its own narrow *SentAt marker on the same doc and checks it
// before sending, guarding specifically against Cloud Functions'
// at-least-once redelivery re-sending the same email. The marker write
// happens only after a successful send, so a genuinely failed send is
// still eligible to be retried (mirrors onProductRestocked's per-
// recipient "notified" pattern above). Writing back to the same doc can
// re-trigger sibling *WriteReconcile functions on that collection — safe,
// since those are already idempotent by design (see recomputeCustomerCounters).
export const onOrderNotification = onDocumentCreated(
  {
    document: "orders/{orderId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.adminNotifiedAt) return;

    // Check toggle
    const enabled = await isNotificationEnabled(
      "newOrderAlert"
    );
    if (!enabled) return;

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      orderNumber,
      customerName,
      customerPhone,
      totalCents,
      items,
      deliveryType,
      serviceAreaName,
      source,
    } = data;

    // Format items list
    const itemsHtml = (items || []).map((item: any) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
          <span style="color:#8a94a6;font-size:0.8rem;
            display:block;font-family:monospace;">
            ${item.productSku}
          </span>
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;
          font-weight:600;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const totalFormatted =
      `$${((totalCents || 0) / 100).toFixed(2)}`;

    const html = orderNotificationEmailHtml(
      orderNumber,
      customerName,
      customerPhone,
      totalFormatted,
      itemsHtml,
      deliveryType,
      serviceAreaName,
      source
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        subject: `🛒 New Order ${orderNumber} — ${customerName}`,
        html,
      });
      await event.data?.ref.update({adminNotifiedAt: FieldValue.serverTimestamp()});
      logger.info(
        `Order notification sent for ${orderNumber}`
      );
    } catch (err) {
      await logger.error("Error sending order notification:", err);
    }
  }
);

export const onAccessRequestNotification = onDocumentCreated(
  {
    document: "accessRequests/{requestId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.notificationSentAt || data.rateLimited) return;

    const enabled = await isNotificationEnabled(
      "accessRequestAlert"
    );
    if (!enabled) return;

    const {
      businessName,
      ownerFirstName,
      ownerLastName,
      email,
      phone,
      businessType,
      address,
    } = data;

    if (email && (await isRateLimited("accessRequests", email))) {
      await event.data?.ref.update({rateLimited: true});
      return;
    }

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const ownerFullName = [ownerFirstName, ownerLastName]
      .filter(Boolean)
      .join(" ");

    const html = accessRequestNotificationEmailHtml(
      businessName,
      ownerFullName,
      email,
      phone,
      businessType,
      address
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        replyTo: email,
        subject: `🏪 New Access Request — ${businessName}`,
        html,
      });
      await event.data?.ref.update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      logger.info("Access request notification sent");
    } catch (err) {
      await logger.error(
        "Error sending access request notification:", err
      );
    }
  }
);

export const onReturnNotification = onDocumentCreated(
  {
    document: "returns/{returnId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.notificationSentAt) return;

    const enabled = await isNotificationEnabled(
      "returnSubmittedAlert"
    );
    if (!enabled) return;

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      returnNumber,
      orderNumber,
      customerName,
      type,
      amountCents,
      reasonCode,
      reason,
      items,
    } = data;

    const typeLabel = type === "credit_note" ?
      "Credit Note" : "Refund";

    const reasonLabels: Record<string, string> = {
      damaged: "Damaged / Defective",
      wrong_item: "Wrong Item",
      customer_changed_mind: "Customer Changed Mind",
      expired: "Expired / Past Best Before",
      quality_issue: "Quality Issue",
      other: "Other",
    };

    const itemsHtml = (items || []).map((item: any) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const amountFormatted =
      `$${((amountCents || 0) / 100).toFixed(2)}`;

    const html = returnNotificationEmailHtml(
      returnNumber,
      orderNumber,
      customerName,
      typeLabel,
      amountFormatted,
      reasonLabels[reasonCode] || reasonCode,
      reason,
      itemsHtml
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        subject: `↩️ Return ${returnNumber} — ${customerName}`,
        html,
      });
      await event.data?.ref.update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      logger.info(
        `Return notification sent for ${returnNumber}`
      );
    } catch (err) {
      await logger.error(
        "Error sending return notification:", err
      );
    }
  }
);

// ─── Back-in-Stock Notifications ────────────────────────────────────────────
// Fires when a product's stock crosses from out-of-stock (<=0) to in-stock (>0)
// — e.g. via a stock adjustment or PO receive. Emails every customer with a
// pending stockNotificationRequest for that product, then marks them notified.
export const onProductRestocked = onDocumentUpdated(
  {
    document: "products/{productId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const prevStock = before.stock || 0;
    const newStock = after.stock || 0;

    // Only when crossing from out-of-stock into in-stock.
    if (!(prevStock <= 0 && newStock > 0)) return;
    if (after.isDeleted || after.active === false) return;

    const productId = event.params.productId;
    const productName = after.name || "A product";

    // Pending requests for this product.
    const reqSnap = await db
      .collection("stockNotificationRequests")
      .where("productId", "==", productId)
      .where("status", "==", "pending")
      .get();

    if (reqSnap.empty) {
      logger.info(`Restock: ${productName} back in stock, no pending requests`);
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let sent = 0;
    for (const doc of reqSnap.docs) {
      const req = doc.data();
      const email = req.customerEmail;
      if (!email) {
        await doc.ref.update({
          status: "notified",
          notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: "no-email",
        });
        continue;
      }
      try {
        await resend.emails.send({
          from: `Tropx Wholesale <${from}>`,
          to: email,
          subject: `Back in stock: ${productName}`,
          html: backInStockEmailHtml(
            req.customerName || "there",
            productName,
            after.sku || req.productSku || "",
          ),
        });
        await doc.ref.update({
          status: "notified",
          notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        sent++;
      } catch (err) {
        await logger.error("Restock email failed", err);
        // Leave as pending so a future restock/backfill can retry.
      }
    }
    logger.info(`Restock: ${productName} — notified ${sent}/${reqSnap.size} customers`);
  }
);

export const onLowStockAlert = onDocumentCreated(
  {
    document: "stockAdjustments/{adjustmentId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const enabled = await isNotificationEnabled(
      "lowStockAlert"
    );
    if (!enabled) return;

    const {productId, productName, productSku, newStock} =
      data;

    if (!productId) return;

    // Get product to check threshold
    const productDoc = await db
      .collection("products")
      .doc(productId)
      .get();

    if (!productDoc.exists) return;

    const product = productDoc.data()!;
    const threshold = product.lowStockThreshold || 5;

    // Compute committed stock: sum quantities from
    // orders with status confirmed or out_for_delivery
    // for this product
    let committedQty = 0;
    try {
      const committedSnap = await db
        .collection("orders")
        .where("status", "in", ["confirmed", "out_for_delivery"])
        .where("isDeleted", "==", false)
        .get();

      for (const orderDoc of committedSnap.docs) {
        const orderData = orderDoc.data();
        const items: any[] = orderData.items || [];
        for (const item of items) {
          if (item.productId === productId) {
            committedQty += item.quantity || 0;
          }
        }
      }
    } catch (err) {
      await logger.error("Error computing committed stock:", err);
      // Fall back to raw stock if query fails
    }

    const atp = Math.max(0, newStock - committedQty);

    logger.info(
      `Low stock check for ${productName}: ` +
      `stock=${newStock}, committed=${committedQty}, atp=${atp}, ` +
      `threshold=${threshold}`
    );

    // Only alert if ATP is at or below threshold
    if (atp > threshold) return;

    // Check last alert time — max once per 24h per product
    const lastAlert = product.lastLowStockAlertAt;
    if (lastAlert) {
      const lastAlertDate = lastAlert.toDate ?
        lastAlert.toDate() :
        new Date(lastAlert);
      const hoursSince = (Date.now() -
        lastAlertDate.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        logger.info(
          `Low stock alert for ${productName} 
           suppressed — sent ${hoursSince.toFixed(1)}h ago`
        );
        return;
      }
    }

    // Update lastLowStockAlertAt to suppress future alerts
    await db.collection("products").doc(productId).update({
      lastLowStockAlertAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const isOutOfStock = atp <= 0;

    const html = lowStockAlertEmailHtml(
      productName,
      productSku,
      atp,
      threshold,
      isOutOfStock,
      data.linkedOrderNumber || null,
      committedQty
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        subject: isOutOfStock ?
          `🔴 Out of Stock: ${productName}` :
          `🟡 Low Stock: ${productName} (${atp} available)`,
        html,
      });
      logger.info(
        `Low stock alert sent for ${productName}: 
         ${newStock} remaining`
      );
    } catch (err) {
      await logger.error(
        "Error sending low stock alert:", err
      );
    }
  }
);

export const onOrderStatusChanged = onDocumentUpdated(
  {
    document: "orders/{orderId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const prevStatus = before.status;
    const newStatus = after.status;

    // Only fire when status actually changes
    if (prevStatus === newStatus) return;

    // Only handle these status transitions
    const handledStatuses = [
      "confirmed",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];
    if (!handledStatuses.includes(newStatus)) return;

    // A redelivered trigger event replays the identical before/after
    // pair, so prevStatus !== newStatus alone doesn't protect against a
    // duplicate send — each of these statuses is only reached once per
    // order in practice, so comparing against the last status this
    // function actually emailed for is enough.
    if (after.lastStatusNotificationSentFor === newStatus) return;

    // Map status to notification key
    const notifKeyMap: Record<string, string> = {
      confirmed: "customerOrderConfirmed",
      out_for_delivery: "customerOutForDelivery",
      delivered: "customerOrderDelivered",
      cancelled: "customerOrderCancelled",
    };

    const notifKey = notifKeyMap[newStatus];
    const enabled = await isNotificationEnabled(notifKey);
    if (!enabled) return;

    // Get customer email — from order doc directly
    const customerEmail = after.customerEmail;
    if (!customerEmail) {
      logger.info(
        `No customer email on order ${after.orderNumber}, ` +
        "skipping notification"
      );
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      orderNumber,
      customerName,
      totalCents,
      balanceCents,
      items,
      deliveryType,
      expectedDeliveryDate,
      cancellationReason,
    } = after;

    const itemsHtml = (items || []).map((item: {
      productName: string;
      productSku: string;
      quantity: number;
      lineTotalCents: number;
    }) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
          <span style="color:#8a94a6;font-size:0.8rem;
            display:block;font-family:monospace;">
            ${item.productSku}
          </span>
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;
          font-weight:600;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const totalFormatted =
      `$${((totalCents || 0) / 100).toFixed(2)}`;
    const balanceFormatted =
      `$${((balanceCents || 0) / 100).toFixed(2)}`;

    let deliveryDateStr = "";
    if (expectedDeliveryDate) {
      try {
        const d = expectedDeliveryDate.toDate ?
          expectedDeliveryDate.toDate() :
          new Date(expectedDeliveryDate);
        deliveryDateStr = d.toLocaleDateString("en-CA", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      } catch {
        deliveryDateStr = "";
      }
    }

    const html = orderStatusEmailHtml(
      newStatus,
      orderNumber,
      customerName,
      totalFormatted,
      balanceFormatted,
      balanceCents || 0,
      itemsHtml,
      deliveryType,
      deliveryDateStr,
      cancellationReason || ""
    );

    const subjectMap: Record<string, string> = {
      confirmed:
        `✅ Order Confirmed — ${orderNumber}`,
      out_for_delivery:
        `🚚 Your Order Is On Its Way — ${orderNumber}`,
      delivered:
        `📦 Order Delivered — ${orderNumber}`,
      cancelled:
        `❌ Order Cancelled — ${orderNumber}`,
    };

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject: subjectMap[newStatus],
        html,
      });
      await event.data?.after.ref.update({
        lastStatusNotificationSentFor: newStatus,
      });
      logger.info(
        `Order status email sent: ${orderNumber} → ${newStatus}`
      );
    } catch (err) {
      await logger.error(
        "Error sending order status email:", err
      );
    }
  }
);

export const onReturnStatusChanged = onDocumentUpdated(
  {
    document: "returns/{returnId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const prevStatus = before.status;
    const newStatus = after.status;

    if (prevStatus === newStatus) return;

    if (newStatus !== "approved" &&
        newStatus !== "rejected") return;

    // Same reasoning as onOrderStatusChanged above — guards a redelivered
    // trigger event from re-sending, since each of these statuses is only
    // reached once per return in practice.
    if (after.lastStatusNotificationSentFor === newStatus) return;

    const notifKey = newStatus === "approved" ?
      "customerReturnApproved" :
      "customerReturnRejected";

    const enabled = await isNotificationEnabled(notifKey);
    if (!enabled) return;

    // Get customer email from linked order
    const customerEmail = after.customerEmail;
    if (!customerEmail) {
      logger.info(
        "No customer email on return " +
        `${after.returnNumber}, skipping`
      );
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      returnNumber,
      orderNumber,
      customerName,
      type,
      amountCents,
      rejectionReason,
      items,
      stockRestored,
    } = after;

    const typeLabel = type === "credit_note" ?
      "Credit Note" : "Refund";

    const amountFormatted =
      `$${((amountCents || 0) / 100).toFixed(2)}`;

    const itemsHtml = (items || []).map((item: {
      productName: string;
      quantity: number;
      lineTotalCents: number;
    }) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const html = returnStatusEmailHtml(
      newStatus,
      returnNumber,
      orderNumber,
      customerName,
      typeLabel,
      amountFormatted,
      itemsHtml,
      rejectionReason || "",
      stockRestored || false
    );

    const subject = newStatus === "approved" ?
      `✅ Return Approved — ${returnNumber}` :
      `❌ Return Not Approved — ${returnNumber}`;

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject,
        html,
      });
      await event.data?.after.ref.update({
        lastStatusNotificationSentFor: newStatus,
      });
      logger.info(
        `Return status email sent: ${returnNumber} → ${newStatus}`
      );
    } catch (err) {
      await logger.error(
        "Error sending return status email:", err
      );
    }
  }
);

export const onPaymentReceipt = onDocumentCreated(
  {
    document: "payments/{paymentId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.receiptSentAt) return;

    const enabled = await isNotificationEnabled(
      "customerPaymentReceipt"
    );
    if (!enabled) return;

    const customerEmail = data.customerEmail;
    if (!customerEmail) {
      logger.info(
        "No customer email on payment " +
        `${data.paymentNumber}, skipping`
      );
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      paymentNumber,
      orderNumber,
      orderId,
      customerName,
      amountCents,
      method,
      referenceNumber,
      receivedDate,
    } = data;

    // Get remaining balance from order
    let remainingBalanceCents = 0;
    let orderTotalCents = 0;
    try {
      const orderDoc = await db
        .collection("orders")
        .doc(orderId)
        .get();
      if (orderDoc.exists) {
        remainingBalanceCents =
          orderDoc.data()?.balanceCents || 0;
        orderTotalCents =
          orderDoc.data()?.totalCents || 0;
      }
    } catch {
      logger.info("Could not fetch order for receipt");
    }

    const methodLabels: Record<string, string> = {
      cash: "Cash",
      e_transfer: "E-Transfer",
      cheque: "Cheque",
      other: "Other",
    };

    const amountFormatted =
      `$${((amountCents || 0) / 100).toFixed(2)}`;
    const balanceFormatted =
      `$${(remainingBalanceCents / 100).toFixed(2)}`;
    const totalFormatted =
      `$${(orderTotalCents / 100).toFixed(2)}`;
    const methodLabel =
      methodLabels[method] || method;

    const html = paymentReceiptEmailHtml(
      paymentNumber,
      orderNumber,
      customerName,
      amountFormatted,
      methodLabel,
      referenceNumber || "",
      receivedDate || "",
      balanceFormatted,
      totalFormatted,
      remainingBalanceCents
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject:
          `💳 Payment Received — ${orderNumber}`,
        html,
      });
      await event.data?.ref.update({
        receiptSentAt: FieldValue.serverTimestamp(),
      });
      logger.info(
        `Payment receipt sent: ${paymentNumber} ` +
        `→ ${customerEmail}`
      );
    } catch (err) {
      await logger.error(
        "Error sending payment receipt:", err
      );
    }
  }
);

// ─── Email Templates ────────────────────────────────────────────────────────

function welcomeEmailHtml(
  ownerName: string,
  businessName: string,
  resetLink: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Tropx Wholesale</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 2rem 2.5rem;
      text-align: center;
    }
    .header h1 {
      color: #ffffff; font-size: 1.5rem;
      margin: 0; font-weight: 700;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }
    .body { padding: 2.5rem; }
    .greeting {
      font-size: 1.1rem; color: #1c1c1c;
      margin-bottom: 1rem;
    }
    .message {
      color: #444; line-height: 1.7;
      margin-bottom: 1.5rem; font-size: 0.95rem;
    }
    .highlight-box {
      background: #f0f7ff;
      border-left: 4px solid #16588e;
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem; margin-bottom: 2rem;
    }
    .highlight-box p {
      margin: 0; color: #0a2d4a;
      font-size: 0.9rem; line-height: 1.6;
    }
    .btn {
      display: block; width: fit-content;
      margin: 0 auto 2rem; background: #0a2d4a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 0.875rem 2.5rem; border-radius: 8px;
      font-weight: 600; font-size: 1rem;
      text-align: center;
    }
    .feature-item {
      display: flex; align-items: flex-start;
      gap: 0.75rem; margin-bottom: 0.5rem;
    }
    .feature-icon {
      color: #1a7c4a; font-weight: 700;
      font-size: 1rem;
    }
    .feature-text {
      color: #444; font-size: 0.875rem;
      line-height: 1.5;
    }
    .divider {
      border: none; border-top: 1px solid #eee;
      margin: 1.5rem 0;
    }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2.5rem; text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.8rem;
      margin: 0.25rem 0; line-height: 1.6;
    }
    .footer a { color: #16588e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Your Wholesale Partner</p>
    </div>
    <div class="body">
      <p class="greeting">Welcome, ${ownerName}! 🎉</p>
      <p class="message">
        Congratulations — <strong>${businessName}</strong> has been
        approved as a Tropx Wholesale partner. We're excited to
        work with you and help keep your shelves stocked with
        quality products at competitive prices.
      </p>
      <div class="highlight-box">
        <p>
          <strong>Your account is ready.</strong> Click the button
          below to set your password and access your wholesale
          portal. This link expires in 24 hours.
        </p>
      </div>
      <a href="${resetLink}" class="btn">
        Set Up Your Account →
      </a>
      <div style="margin-bottom: 2rem;">
        <p style="color:#0a2d4a;font-size:0.95rem;font-weight:600;">
          What you can do in your portal:
        </p>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            Browse our full product catalog with wholesale pricing
          </span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            Place and track orders anytime, 24/7
          </span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            View your order history and payment records
          </span>
        </div>
      </div>
      <hr class="divider">
      <p class="message" style="font-size:0.875rem;color:#666;">
        If you have any questions, don't hesitate to reach out.
        We're here to help.
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca
      </a></p>
      <p style="margin-top:1rem;font-size:0.75rem;">
        You received this email because your wholesale access
        request was approved.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function passwordResetEmailHtml(resetLink: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 2rem 2.5rem;
      text-align: center;
    }
    .header h1 {
      color: #ffffff; font-size: 1.5rem;
      margin: 0; font-weight: 700;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }
    .body { padding: 2.5rem; }
    .message {
      color: #444; line-height: 1.7;
      margin-bottom: 1.5rem; font-size: 0.95rem;
    }
    .highlight-box {
      background: #fff8f0;
      border-left: 4px solid #c9952a;
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem; margin-bottom: 2rem;
    }
    .highlight-box p {
      margin: 0; color: #6b4c00;
      font-size: 0.9rem; line-height: 1.6;
    }
    .btn {
      display: block; width: fit-content;
      margin: 0 auto 2rem; background: #0a2d4a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 0.875rem 2.5rem; border-radius: 8px;
      font-weight: 600; font-size: 1rem;
      text-align: center;
    }
    .divider {
      border: none; border-top: 1px solid #eee;
      margin: 1.5rem 0;
    }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2.5rem; text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.8rem;
      margin: 0.25rem 0; line-height: 1.6;
    }
    .footer a { color: #16588e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Your Wholesale Partner</p>
    </div>
    <div class="body">
      <p class="message" style="font-size:1.05rem;
        font-weight:600;color:#0a2d4a;">
        Password Reset Request
      </p>
      <p class="message">
        We received a request to reset the password for your
        Tropx Wholesale account. Click the button below to
        choose a new password.
      </p>
      <div class="highlight-box">
        <p>
          ⏱ This link expires in <strong>1 hour</strong>.
          If you didn't request a password reset, you can
          safely ignore this email.
        </p>
      </div>
      <a href="${resetLink}" class="btn">
        Reset My Password →
      </a>
      <hr class="divider">
      <p class="message" style="font-size:0.875rem;color:#666;">
        If the button doesn't work, copy and paste this link:<br>
        <a href="${resetLink}"
          style="color:#16588e;word-break:break-all;">
          ${resetLink}
        </a>
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca
      </a></p>
      <p style="margin-top:1rem;font-size:0.75rem;">
        If you did not request a password reset, please
        ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function contactInquiryEmailHtml(
  name: string,
  email: string,
  phone: string,
  businessName: string,
  message: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 1.5rem 2rem;
    }
    .header h1 {
      color: #ffffff; font-size: 1.1rem; margin: 0;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.8rem;
    }
    .body { padding: 2rem; }
    .field {
      margin-bottom: 1.25rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #f0f0f0;
    }
    .field:last-child { border-bottom: none; }
    .label {
      font-size: 0.75rem; font-weight: 600;
      color: #8a94a6; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.35rem;
    }
    .value {
      font-size: 0.95rem; color: #1c1c1c;
      line-height: 1.6;
    }
    .footer {
      background: #f8f9fa; padding: 1rem 2rem;
      text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.78rem; margin: 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>New Contact Inquiry</h1>
      <p>Tropx Wholesale — tropxwholesale.ca</p>
    </div>
    <div class="body">
      <div class="field">
        <div class="label">Name</div>
        <div class="value">${name ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Business Name</div>
        <div class="value">${businessName ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value">${email ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${phone ?? "Not provided"}</div>
      </div>
      <div class="field">
        <div class="label">Message</div>
        <div class="value">${message ?? "—"}</div>
      </div>
    </div>
    <div class="footer">
      <p>Sent from tropxwholesale.ca contact form</p>
    </div>
  </div>
</body>
</html>`;
}

function employeeInvitationEmailHtml(
  firstName: string,
  roleLabel: string,
  email: string,
  tempPassword: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Your Staff Account</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont,
      'Segoe UI', sans-serif; background:#f5f5f5; 
      margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px; overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a; padding:2rem 2.5rem;
      text-align:center; }
    .header h1 { color:#fff; font-size:1.5rem; margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.875rem; }
    .body { padding:2.5rem; }
    .message { color:#444; line-height:1.7;
      margin-bottom:1.5rem; font-size:0.95rem; }
    .credentials-box { background:#f0f7ff;
      border-left:4px solid #16588e;
      border-radius:0 8px 8px 0;
      padding:1.25rem 1.5rem; margin-bottom:2rem; }
    .credentials-box p { margin:0.25rem 0; 
      font-size:0.9rem; color:#0a2d4a; }
    .credentials-box strong { font-family:monospace;
      font-size:1rem; }
    .btn { display:block; width:fit-content;
      margin:0 auto 2rem; background:#0a2d4a;
      color:#fff !important; text-decoration:none;
      padding:0.875rem 2.5rem; border-radius:8px;
      font-weight:600; font-size:1rem; text-align:center; }
    .footer { background:#f8f9fa; padding:1.5rem 2.5rem;
      text-align:center; }
    .footer p { color:#8a94a6; font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Staff Portal Access</p>
    </div>
    <div class="body">
      <p class="message">
        Hi ${firstName}, a staff account has been created 
        for you on the Tropx Wholesale platform. 
        Your role is <strong>${roleLabel}</strong>.
      </p>
      <div class="credentials-box">
        <p>Email: <strong>${email}</strong></p>
        <p>Temporary Password: 
          <strong>${tempPassword}</strong></p>
      </div>
      <a href="https://tropxwholesale.ca/login" class="btn">
        Sign In →
      </a>
      <p class="message" style="font-size:0.875rem;
        color:#666;">
        Please change your password after signing in.
        If you have questions, contact your administrator.
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca</a></p>
    </div>
  </div>
</body>
</html>`;
}

function orderNotificationEmailHtml(
  orderNumber: string,
  customerName: string,
  customerPhone: string,
  total: string,
  itemsHtml: string,
  deliveryType: string,
  serviceAreaName: string,
  source: string
): string {
  const deliveryLabel = deliveryType === "pickup" ?
    "📦 Pickup" : "🚚 Delivery";
  const sourceLabel = source === "customer_portal" ?
    "Customer Portal" : "Admin";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.85rem; }
    .body { padding:1.75rem 2rem; }
    .order-num { font-family:monospace;
      font-size:1.5rem; font-weight:800;
      color:#0a2d4a; margin:0 0 1rem; }
    .meta-grid { display:grid;
      grid-template-columns:1fr 1fr;
      gap:1rem; margin-bottom:1.5rem; }
    .meta-item .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:#8a94a6;
      margin-bottom:0.25rem; }
    .meta-item .value { font-size:0.9rem;
      color:#1c1c1c; font-weight:500; }
    table { width:100%; border-collapse:collapse;
      margin-bottom:1rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px; font-size:0.75rem;
      font-weight:700; text-transform:uppercase;
      color:white; text-align:left; }
    .total-row { background:#f8f9fa;
      border-top:2px solid #0a2d4a; }
    .total-row td { padding:12px;
      font-weight:700; font-size:1rem;
      color:#0a2d4a; }
    .action-btn { display:inline-block;
      margin-top:1.5rem; background:#0a2d4a;
      color:#fff !important; text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🛒 New Order Received</h1>
      <p>Tropx Wholesale Admin Alert</p>
    </div>
    <div class="body">
      <div class="order-num">${orderNumber}</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Customer</div>
          <div class="value">${customerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">Phone</div>
          <div class="value">
            ${customerPhone || "—"}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Delivery</div>
          <div class="value">${deliveryLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Service Area</div>
          <div class="value">
            ${serviceAreaName || "—"}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Source</div>
          <div class="value">${sourceLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Order Total</div>
          <div class="value" 
            style="font-size:1.1rem;font-weight:700;
              color:#0a2d4a;">
            ${total}
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tr class="total-row">
          <td colspan="2">Order Total</td>
          <td style="text-align:right;">${total}</td>
        </tr>
      </table>
      <a href="https://tropxwholesale.ca/admin/orders"
        class="action-btn">
        View Order →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

function accessRequestNotificationEmailHtml(
  businessName: string,
  ownerName: string,
  email: string,
  phone: string,
  businessType: string,
  address: any
): string {
  const addressStr = address ?
    [address.city, address.province, address.country]
      .filter(Boolean).join(", ") :
    "—";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.85rem; }
    .body { padding:1.75rem 2rem; }
    .business-name { font-size:1.375rem;
      font-weight:800; color:#0a2d4a;
      margin:0 0 1.25rem; }
    .field { margin-bottom:1rem;
      padding-bottom:1rem;
      border-bottom:1px solid #f0f0f0; }
    .field:last-of-type { border-bottom:none; }
    .label { font-size:0.7rem; font-weight:700;
      text-transform:uppercase; letter-spacing:0.05em;
      color:#8a94a6; margin-bottom:0.25rem; }
    .value { font-size:0.925rem; color:#1c1c1c; }
    .action-btn { display:inline-block;
      margin-top:1.5rem; background:#1a7c4a;
      color:#fff !important; text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🏪 New Access Request</h1>
      <p>Tropx Wholesale — Review Required</p>
    </div>
    <div class="body">
      <div class="business-name">${businessName}</div>
      <div class="field">
        <div class="label">Owner Name</div>
        <div class="value">${ownerName || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value">${email || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${phone || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Business Type</div>
        <div class="value">${businessType || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Location</div>
        <div class="value">${addressStr}</div>
      </div>
      <a href="https://tropxwholesale.ca/admin/access-requests"
        class="action-btn">
        Review Request →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

function returnNotificationEmailHtml(
  returnNumber: string,
  orderNumber: string,
  customerName: string,
  typeLabel: string,
  amount: string,
  reasonLabel: string,
  reason: string,
  itemsHtml: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#c9952a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#fff9ee; margin:0.25rem 0 0;
      font-size:0.85rem; opacity:0.85; }
    .body { padding:1.75rem 2rem; }
    .return-num { font-family:monospace;
      font-size:1.375rem; font-weight:800;
      color:#0a2d4a; margin:0 0 0.25rem; }
    .order-ref { font-size:0.875rem; color:#8a94a6;
      margin:0 0 1.25rem; }
    .meta-grid { display:grid;
      grid-template-columns:1fr 1fr;
      gap:1rem; margin-bottom:1.5rem; }
    .meta-item .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:#8a94a6;
      margin-bottom:0.25rem; }
    .meta-item .value { font-size:0.9rem;
      color:#1c1c1c; font-weight:500; }
    .reason-box { background:#fff8f0;
      border-left:4px solid #c9952a;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      color:#8a94a6; margin-bottom:0.375rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    table { width:100%; border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px; font-size:0.75rem;
      font-weight:700; text-transform:uppercase;
      color:white; text-align:left; }
    .action-btn { display:inline-block;
      background:#c9952a; color:#fff !important;
      text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>↩️ Return Submitted</h1>
      <p>Tropx Wholesale — Action Required</p>
    </div>
    <div class="body">
      <div class="return-num">${returnNumber}</div>
      <div class="order-ref">
        Order: ${orderNumber}
      </div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Customer</div>
          <div class="value">${customerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">Return Type</div>
          <div class="value">${typeLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Return Value</div>
          <div class="value"
            style="font-size:1.1rem;font-weight:700;
              color:#e7222e;">
            ${amount}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Reason</div>
          <div class="value">${reasonLabel}</div>
        </div>
      </div>
      <div class="reason-box">
        <div class="label">Customer Description</div>
        <div class="value">${reason || "—"}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Value
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <a href="https://tropxwholesale.ca/admin/returns"
        class="action-btn">
        Review Return →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

function backInStockEmailHtml(
  customerName: string,
  productName: string,
  productSku: string,
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:580px;margin:40px auto;background:#fff;border-radius:12px;
    overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a7c4a;padding:2rem 2.5rem;text-align:center;">
      <span style="font-size:2.5rem;display:block;margin-bottom:0.5rem;">📦</span>
      <h1 style="color:#fff;font-size:1.375rem;margin:0;font-weight:800;">Back in Stock!</h1>
      <p style="color:#fff;margin:0.25rem 0 0;font-size:0.875rem;opacity:0.85;">
        The item you wanted is available again
      </p>
    </div>
    <div style="padding:2rem 2.5rem;">
      <p style="font-size:1rem;color:#1c1c1c;margin-bottom:0.75rem;">Hi ${customerName},</p>
      <p style="color:#555;line-height:1.7;font-size:0.95rem;margin-bottom:1.5rem;">
        Good news — <strong>${productName}</strong>${productSku ? ` (SKU ${productSku})` : ""} 
        is back in stock and ready to order. Popular items go quickly, so order soon to secure yours.
      </p>
      <div style="text-align:center;">
        <a href="https://tropxwholesale.ca/portal/catalog" 
           style="display:inline-block;background:#1a7c4a;color:#fff !important;
           text-decoration:none;padding:0.875rem 2.5rem;border-radius:8px;
           font-weight:600;font-size:1rem;">
           Order Now →
        </a>
      </div>
    </div>
    <div style="background:#f8f9fa;padding:1.5rem 2.5rem;text-align:center;">
      <p style="color:#8a94a6;font-size:0.8rem;margin:0.25rem 0;">
        <strong>Tropx Enterprises Inc.</strong><br>Kitchener, Ontario, Canada
      </p>
      <p style="color:#8a94a6;font-size:0.8rem;margin:0.25rem 0;">
        <a href="https://tropxwholesale.ca" style="color:#16588e;text-decoration:none;">tropxwholesale.ca</a>
      </p>
      <p style="margin-top:0.75rem;font-size:0.72rem;color:#9ca3af;">
        You asked to be notified when this item returned. 
        You won't receive further emails about it unless you request again.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function lowStockAlertEmailHtml(
  productName: string,
  productSku: string,
  atp: number,
  threshold: number,
  isOutOfStock: boolean,
  linkedOrderNumber: string | null,
  committedQty = 0
): string {
  const headerColor = isOutOfStock ?
    "#e7222e" : "#c9952a";
  const statusText = isOutOfStock ?
    "Out of Stock" : "Low Stock";
  const emoji = isOutOfStock ? "🔴" : "🟡";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${headerColor};
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#fff; margin:0.25rem 0 0;
      font-size:0.85rem; opacity:0.85; }
    .body { padding:1.75rem 2rem; }
    .product-name { font-size:1.375rem;
      font-weight:800; color:#0a2d4a;
      margin:0 0 0.25rem; }
    .product-sku { font-family:monospace;
      font-size:0.875rem; color:#8a94a6;
      margin:0 0 1.5rem; }
    .stock-display { text-align:center;
      padding:1.5rem; background:#f8f9fa;
      border-radius:10px; margin-bottom:1.5rem; }
    .stock-number { font-size:3rem; font-weight:800;
      color:${headerColor}; line-height:1; }
    .stock-label { font-size:0.875rem; color:#8a94a6;
      margin-top:0.25rem; }
    .threshold-note { font-size:0.875rem;
      color:#8a94a6; margin-top:0.5rem; }
    .context-box { background:#f0f7ff;
      border-left:4px solid #16588e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .context-box p { margin:0; font-size:0.875rem;
      color:#0a2d4a; }
    .action-btn { display:inline-block;
      background:#0a2d4a; color:#fff !important;
      text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${emoji} ${statusText} Alert</h1>
      <p>Tropx Wholesale Inventory Warning</p>
    </div>
    <div class="body">
      <div class="product-name">${productName}</div>
      <div class="product-sku">SKU: ${productSku}</div>
      <div class="stock-display">
        <div class="stock-number">
          ${atp}
        </div>
        <div class="stock-label">
          units available to promise
        </div>
        <div class="threshold-note">
          Low stock threshold: ${threshold} units
          ${committedQty > 0 ?
    `· ${committedQty} committed to open orders` :
    ""}
        </div>
      </div>
      ${linkedOrderNumber ? `
        <div class="context-box">
          <p>
            This alert was triggered by order
            <strong>${linkedOrderNumber}</strong>.
          </p>
        </div>
      ` : ""}
      <p style="color:#444;font-size:0.9rem;
        margin-bottom:1.5rem;line-height:1.6;">
        ${isOutOfStock ?
    "This product is now <strong>out of stock</strong>. " +
          "Please reorder as soon as possible." :
    "This product is running low. Consider restocking soon."
}
      </p>
      <a href="https://tropxwholesale.ca/admin/products"
        class="action-btn">
        View Products →
      </a>
    </div>
  </div>
</body>
</html>`;
}

function orderStatusEmailHtml(
  status: string,
  orderNumber: string,
  customerName: string,
  total: string,
  balance: string,
  balanceCents: number,
  itemsHtml: string,
  deliveryType: string,
  deliveryDateStr: string,
  cancellationReason: string
): string {
  const configs: Record<string, {
    headerBg: string;
    emoji: string;
    title: string;
    subtitle: string;
    message: string;
    btnColor: string;
    btnText: string;
  }> = {
    confirmed: {
      headerBg: "#1a7c4a",
      emoji: "✅",
      title: "Order Confirmed",
      subtitle: "Your order has been received",
      message: "Great news! Your order has been " +
        "confirmed and is being prepared. " +
        "We will notify you when it is on its way.",
      btnColor: "#1a7c4a",
      btnText: "View Order →",
    },
    out_for_delivery: {
      headerBg: "#16588e",
      emoji: "🚚",
      title: "Out for Delivery",
      subtitle: "Your order is on its way",
      message: "Your order is on its way to you. " +
        "Please ensure someone is available " +
        "to receive the delivery.",
      btnColor: "#16588e",
      btnText: "View Order →",
    },
    delivered: {
      headerBg: "#0a2d4a",
      emoji: "📦",
      title: "Order Delivered",
      subtitle: "Your order has arrived",
      message: "Your order has been marked as " +
        "delivered. Thank you for your business! " +
        "If you have any issues with your order, " +
        "please contact us.",
      btnColor: "#0a2d4a",
      btnText: "View Invoice →",
    },
    cancelled: {
      headerBg: "#e7222e",
      emoji: "❌",
      title: "Order Cancelled",
      subtitle: "Your order has been cancelled",
      message: "Your order has been cancelled. " +
        "If you have any questions or would like " +
        "to place a new order, please contact us.",
      btnColor: "#e7222e",
      btnText: "Contact Us →",
    },
  };

  const cfg = configs[status] || configs["confirmed"];

  const deliverySection = deliveryDateStr ?
    `<div class="info-box">
      <div class="info-label">
        ${status === "out_for_delivery" ?
    "Expected Delivery" : "Delivery Date"}
      </div>
      <div class="info-value">${deliveryDateStr}</div>
    </div>` : "";

  const cancellationSection = (
    status === "cancelled" && cancellationReason
  ) ?
    `<div class="reason-box">
      <div class="label">Reason</div>
      <div class="value">${cancellationReason}</div>
    </div>` : "";

  const balanceSection = (
    status === "delivered" && balanceCents > 0
  ) ?
    `<div class="balance-box">
      <p>
        <strong>Outstanding Balance: ${balance}</strong>
        <br>
        <span style="font-size:0.875rem;color:#666;">
          Please arrange payment at your earliest
          convenience.
        </span>
      </p>
    </div>` : "";

  const btnHref = status === "cancelled" ?
    "https://tropxwholesale.ca/contact" :
    "https://tropxwholesale.ca/portal/orders";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${cfg.headerBg};
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#fff;margin:0.25rem 0 0;
      font-size:0.875rem;opacity:0.85; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .order-num { font-family:monospace;
      font-size:1.25rem;font-weight:800;
      color:#0a2d4a;margin-bottom:1.5rem; }
    .info-box { background:#f8f9fa;
      border-radius:8px;padding:1rem 1.25rem;
      margin-bottom:1rem; }
    .info-label { font-size:0.7rem;font-weight:700;
      text-transform:uppercase;letter-spacing:0.05em;
      color:#8a94a6;margin-bottom:0.25rem; }
    .info-value { font-size:0.95rem;
      color:#1c1c1c;font-weight:600; }
    .reason-box { background:#fff0f0;
      border-left:4px solid #e7222e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    .balance-box { background:#fff8f0;
      border-left:4px solid #c9952a;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .balance-box p { margin:0;color:#1c1c1c;
      font-size:0.9rem;line-height:1.6; }
    table { width:100%;border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px;font-size:0.75rem;
      font-weight:700;text-transform:uppercase;
      color:white;text-align:left; }
    tbody td { border-bottom:1px solid #f0f0f0; }
    .total-row { background:#f8f9fa; }
    .total-row td { padding:12px;font-weight:700;
      font-size:1rem;color:#0a2d4a; }
    .btn { display:inline-block;
      background:${cfg.btnColor};
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">${cfg.emoji}</span>
      <h1>${cfg.title}</h1>
      <p>${cfg.subtitle}</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">${cfg.message}</p>
      <div class="order-num">
        Order: ${orderNumber}
      </div>
      ${deliverySection}
      ${cancellationSection}
      ${balanceSection}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tr class="total-row">
          <td colspan="2"
            style="padding:12px;">
            Order Total
          </td>
          <td style="padding:12px;
            text-align:right;">
            ${total}
          </td>
        </tr>
      </table>
      <a href="${btnHref}" class="btn">
        ${cfg.btnText}
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function returnStatusEmailHtml(
  status: string,
  returnNumber: string,
  orderNumber: string,
  customerName: string,
  typeLabel: string,
  amount: string,
  itemsHtml: string,
  rejectionReason: string,
  stockRestored: boolean
): string {
  const isApproved = status === "approved";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${isApproved ?
    "#1a7c4a" : "#e7222e"};
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#fff;margin:0.25rem 0 0;
      font-size:0.875rem;opacity:0.85; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .ref-row { display:flex;gap:1.5rem;
      margin-bottom:1.5rem;flex-wrap:wrap; }
    .ref-item .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      letter-spacing:0.05em;color:#8a94a6;
      margin-bottom:0.25rem; }
    .ref-item .value { font-size:0.95rem;
      color:#1c1c1c;font-weight:600;
      font-family:monospace; }
    .amount-box { background:${isApproved ?
    "rgba(26,124,74,0.06)" :
    "rgba(231,34,46,0.06)"};
      border-left:4px solid ${isApproved ?
    "#1a7c4a" : "#e7222e"};
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .amount-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .amount-box .value { font-size:1.25rem;
      font-weight:800;
      color:${isApproved ? "#1a7c4a" : "#e7222e"}; }
    .reason-box { background:#fff0f0;
      border-left:4px solid #e7222e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    table { width:100%;border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px;font-size:0.75rem;
      font-weight:700;text-transform:uppercase;
      color:white;text-align:left; }
    tbody td { border-bottom:1px solid #f0f0f0; }
    .btn { display:inline-block;
      background:${isApproved ?
    "#1a7c4a" : "#0a2d4a"};
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">
        ${isApproved ? "✅" : "❌"}
      </span>
      <h1>
        Return ${isApproved ? "Approved" : "Not Approved"}
      </h1>
      <p>
        ${isApproved ?
    "Your return has been processed" :
    "We could not approve your return"}
      </p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">
        ${isApproved ?
    "Your return request has been approved. " +
          `A <strong>${typeLabel}</strong> of ` +
          `<strong>${amount}</strong> has been ` +
          "processed for your account." :
    "Unfortunately we were unable to approve " +
          "your return request at this time. " +
          "Please contact us if you have questions."
}
      </p>
      <div class="ref-row">
        <div class="ref-item">
          <div class="label">Return</div>
          <div class="value">${returnNumber}</div>
        </div>
        <div class="ref-item">
          <div class="label">Order</div>
          <div class="value">${orderNumber}</div>
        </div>
      </div>
      ${isApproved ? `
        <div class="amount-box">
          <div class="label">
            ${typeLabel} Amount
          </div>
          <div class="value">${amount}</div>
        </div>
        ${stockRestored ? `
          <p style="font-size:0.875rem;
            color:#666;margin-bottom:1.5rem;">
            ℹ️ The returned items have been added
            back to inventory.
          </p>
        ` : ""}
      ` : `
        ${rejectionReason ? `
          <div class="reason-box">
            <div class="label">Reason</div>
            <div class="value">
              ${rejectionReason}
            </div>
          </div>
        ` : ""}
      `}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Value
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <a href="https://tropxwholesale.ca/portal/orders"
        class="btn">
        View My Orders →
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function paymentReceiptEmailHtml(
  paymentNumber: string,
  orderNumber: string,
  customerName: string,
  amount: string,
  methodLabel: string,
  referenceNumber: string,
  receivedDate: string,
  balance: string,
  orderTotal: string,
  remainingBalanceCents: number
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#f0c040;margin:0.25rem 0 0;
      font-size:0.875rem; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .amount-display { text-align:center;
      padding:1.5rem;background:#f0f7f3;
      border-radius:10px;margin-bottom:1.5rem;
      border:1px solid rgba(26,124,74,0.2); }
    .amount-num { font-size:2.5rem;font-weight:800;
      color:#1a7c4a;line-height:1; }
    .amount-label { font-size:0.875rem;
      color:#8a94a6;margin-top:0.25rem; }
    .details-table { width:100%;
      border-collapse:collapse;
      margin-bottom:1.5rem; }
    .details-table tr { border-bottom:
      1px solid #f0f0f0; }
    .details-table tr:last-child {
      border-bottom:none; }
    .details-table td { padding:0.75rem 0;
      font-size:0.9rem; }
    .details-table td:first-child {
      color:#8a94a6;font-weight:500; }
    .details-table td:last-child {
      color:#1c1c1c;font-weight:600;
      text-align:right; }
    .balance-box { padding:1rem 1.25rem;
      border-radius:8px;margin-bottom:1.5rem;
      background:${remainingBalanceCents > 0 ?
    "rgba(231,34,46,0.06)" :
    "rgba(26,124,74,0.06)"};
      border:1px solid ${remainingBalanceCents > 0 ?
    "rgba(231,34,46,0.2)" :
    "rgba(26,124,74,0.2)"}; }
    .balance-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .balance-box .value { font-size:1.125rem;
      font-weight:800;
      color:${remainingBalanceCents > 0 ?
    "#e7222e" : "#1a7c4a"}; }
    .balance-box .sub { font-size:0.8rem;
      color:#8a94a6;margin-top:0.25rem; }
    .btn { display:inline-block;background:#0a2d4a;
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">💳</span>
      <h1>Payment Received</h1>
      <p>Tropx Wholesale — Payment Confirmation</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">
        We have received your payment. Here is your
        receipt for your records.
      </p>
      <div class="amount-display">
        <div class="amount-num">${amount}</div>
        <div class="amount-label">
          Payment received
        </div>
      </div>
      <table class="details-table">
        <tr>
          <td>Payment #</td>
          <td style="font-family:monospace;">
            ${paymentNumber}
          </td>
        </tr>
        <tr>
          <td>Order #</td>
          <td style="font-family:monospace;">
            ${orderNumber}
          </td>
        </tr>
        <tr>
          <td>Payment Method</td>
          <td>${methodLabel}</td>
        </tr>
        ${referenceNumber ? `
          <tr>
            <td>Reference #</td>
            <td style="font-family:monospace;">
              ${referenceNumber}
            </td>
          </tr>
        ` : ""}
        <tr>
          <td>Date</td>
          <td>${receivedDate}</td>
        </tr>
        <tr>
          <td>Order Total</td>
          <td>${orderTotal}</td>
        </tr>
      </table>
      <div class="balance-box">
        <div class="label">
          ${remainingBalanceCents > 0 ?
    "Remaining Balance" :
    "Account Status"}
        </div>
        <div class="value">
          ${remainingBalanceCents > 0 ?
    balance : "Paid in Full ✓"}
        </div>
        ${remainingBalanceCents > 0 ? `
          <div class="sub">
            Balance remaining on this order
          </div>
        ` : `
          <div class="sub">
            This order is fully paid — thank you!
          </div>
        `}
      </div>
      <a href="https://tropxwholesale.ca/portal/orders"
        class="btn">
        View My Orders →
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
      <p style="margin-top:0.75rem;font-size:0.75rem;">
        This is an automated payment confirmation.
        Please keep this email for your records.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export const checkAbandonedCarts =
  onSchedule({
    schedule: "every 60 minutes",
    region: "northamerica-northeast1",
    timeoutSeconds: 300,
    secrets: [resendApiKey, fromEmail, sentryDsn],
  }, async () => {
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    const HOUR = 60 * 60 * 1000;
    const thresholds = [
      {
        key: "abandonedCart24h",
        field: "abandonedEmailSent24h",
        ms: 24 * HOUR,
        subject: (name: string) =>
          `You left something behind, ${name}`,
        headline: "Your cart is waiting",
        subtext: "You left some items in your " +
        "cart. Complete your order whenever " +
        "you're ready.",
      },
      {
        key: "abandonedCart72h",
        field: "abandonedEmailSent72h",
        ms: 72 * HOUR,
        subject: (name: string) =>
          `Still thinking it over, ${name}?`,
        headline: "Still thinking it over?",
        subtext: "Your cart is still saved. " +
        "Place your order when ready and " +
        "we'll get it to you fast.",
      },
      {
        key: "abandonedCart7d",
        field: "abandonedEmailSent7d",
        ms: 7 * 24 * HOUR,
        subject: (name: string) =>
          `Your cart is still saved, ${name}`,
        headline: "Your cart is still here",
        subtext: "It's been a week since you " +
        "added items to your cart. " +
        "Complete your order today.",
      },
    ];

    // Load notification settings
    const settingsDoc = await db
      .doc("settings/notifications")
      .get();
    const notifSettings =
    settingsDoc.data() || {};

    // Load all carts with items
    const cartsSnap = await db
      .collection("portalCarts")
      .get();

    const resend = new Resend(resendApiKey.value());

    for (const cartDoc of cartsSnap.docs) {
      const cart = cartDoc.data();
      const items = cart.items || [];

      // Skip empty carts
      if (!items.length) continue;

      // Get last updated time
      const updatedAt = cart.updatedAt?.toMillis ?
        cart.updatedAt.toMillis() :
        cart.updatedAt;
      if (!updatedAt) continue;

      const ageMs = nowMs - updatedAt;

      // Get customer info
      const customerId = cartDoc.id;
      const customerSnap = await db
        .doc(`customers/${customerId}`)
        .get();
      if (!customerSnap.exists) continue;

      const customer = customerSnap.data();
      if (!customer) continue;
      const email = customer.email;
      const firstName = customer.ownerFirstName || "there";

      if (!email) continue;

      // Get linked user for portal access
      const userSnap = await db
        .collection("users")
        .where("linkedCustomerId", "==", customerId)
        .limit(1)
        .get();
      if (userSnap.empty) continue;

      for (const threshold of thresholds) {
      // Check if setting enabled
        if (!notifSettings[threshold.key]) continue;

        // Check if already sent
        if (cart[threshold.field]) continue;

        // Check if cart is old enough
        if (ageMs < threshold.ms) continue;

        // Check if newer threshold was already
        // handled (don't send 24h after 72h sent)
        // by checking the age falls in the right
        // window (within 2x the threshold)
        if (ageMs > threshold.ms * 3) continue;

        // Build items HTML
        const itemsHtml = items.map((item: any) =>
          `<tr>
          <td style="padding:10px 16px;
            border-bottom:1px solid #f0f0f0;
            font-size:14px;color:#1c1c1c;">
            ${item.productName}
          </td>
          <td style="padding:10px 16px;
            border-bottom:1px solid #f0f0f0;
            text-align:center;font-size:14px;
            color:#1c1c1c;">
            ×${item.quantity}
          </td>
          <td style="padding:10px 16px;
            border-bottom:1px solid #f0f0f0;
            text-align:right;font-size:14px;
            font-weight:600;color:#0a2d4a;">
            $${((item.priceCents *
              item.quantity) / 100)
    .toFixed(2)}
          </td>
        </tr>`
        ).join("");

        const subtotalCents = items.reduce(
          (sum: number, i: any) =>
            sum + (i.priceCents * i.quantity), 0
        );

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,
    initial-scale=1.0">
</head>
<body style="margin:0;padding:0;
  background:#f4f5f7;
  font-family:-apple-system,BlinkMacSystemFont,
  'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;
    padding:32px 16px;">

    <!-- Header -->
    <div style="background:#0a2d4a;
      border-radius:12px 12px 0 0;
      padding:28px 32px;text-align:center;">
      <div style="font-size:1.5rem;
        font-weight:800;color:white;
        letter-spacing:-0.02em;">
        Tropx Wholesale
      </div>
    </div>

    <!-- Body -->
    <div style="background:white;
      padding:32px;
      border:1px solid #e8eaed;
      border-top:none;">

      <h2 style="font-size:1.25rem;
        font-weight:700;color:#0a2d4a;
        margin:0 0 8px;">
        ${threshold.headline}
      </h2>
      <p style="font-size:0.9375rem;
        color:#6b7280;margin:0 0 24px;
        line-height:1.6;">
        Hi ${firstName}, ${threshold.subtext}
      </p>

      <!-- Cart items -->
      <table style="width:100%;
        border-collapse:collapse;
        border:1px solid #f0f0f0;
        border-radius:8px;overflow:hidden;
        margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;
              text-align:left;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:#6b7280;
              border-bottom:
                1px solid #f0f0f0;">
              Product
            </th>
            <th style="padding:10px 16px;
              text-align:center;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:#6b7280;
              border-bottom:
                1px solid #f0f0f0;">
              Qty
            </th>
            <th style="padding:10px 16px;
              text-align:right;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:#6b7280;
              border-bottom:
                1px solid #f0f0f0;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          <tr style="background:#f8fafc;">
            <td colspan="2"
              style="padding:12px 16px;
              font-weight:700;
              font-size:0.9375rem;
              color:#0a2d4a;">
              Subtotal
            </td>
            <td style="padding:12px 16px;
              text-align:right;
              font-weight:800;
              font-size:1rem;
              color:#0a2d4a;">
              $${(subtotalCents / 100)
    .toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>

      <!-- CTA -->
      <div style="text-align:center;
        margin-bottom:24px;">
        <a href="https://tropxwholesale.ca/portal/cart"
          style="display:inline-block;
          background:#0a2d4a;color:white;
          text-decoration:none;
          padding:14px 32px;
          border-radius:10px;
          font-weight:700;
          font-size:1rem;">
          Complete Your Order →
        </a>
      </div>

      <p style="font-size:0.8125rem;
        color:#9ca3af;text-align:center;
        margin:0;line-height:1.6;">
        Questions? Reply to this email or
        contact us at info@tropxwholesale.ca
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;
      text-align:center;">
      <p style="font-size:0.75rem;
        color:#9ca3af;margin:0;">
        © Tropx Enterprises Inc. ·
        Kitchener, Ontario, Canada
      </p>
    </div>

  </div>
</body>
</html>`;

        // Send email via Resend
        await resend.emails.send({
          from: `Tropx Wholesale <${fromEmail.value()}>`,
          to: email,
          subject: threshold.subject(firstName),
          html: emailHtml,
        });

        // Mark as sent on cart doc
        await db
          .doc(`portalCarts/${customerId}`)
          .update({
            [threshold.field]: true,
            [`${threshold.field}SentAt`]:
            admin.firestore.FieldValue
              .serverTimestamp(),
          });

        logger.info(
          `Abandoned cart email sent: ${threshold.key}`, {customerId}
        );

        // Only send one threshold per run
        // per customer to avoid flooding
        break;
      }
    }
  });

export const onPortalOrderConfirmation =
  onDocumentCreated(
    {
      document: "orders/{orderId}",
      database: DATABASE_ID,
      region: "northamerica-northeast2",
      secrets: [resendApiKey, fromEmail, sentryDsn],
    },
    async (event) => {
      const order = event.data?.data();
      if (!order || order.portalConfirmationSentAt) return;

      // Only fire for portal orders
      if (order.source !== "customer_portal") {
        return;
      }

      // Check notification setting
      const isEnabled = await isNotificationEnabled(
        "customerOrderConfirmed"
      );
      if (!isEnabled) return;

      const customerEmail = order.customerEmail;
      if (!customerEmail) return;

      const firstName = order.customerName
        ?.split(" ")[0] || "there";

      // Build invoice HTML inline in email
      // (same structure as generateInvoiceHtml
      // in order-detail.component.ts)

      const formatCurrency = (cents: number) =>
        "$" + (cents / 100).toFixed(2);

      const formatDate = (ts: any) => {
        if (!ts) return "—";
        const d = ts.toDate ?
          ts.toDate() : new Date(ts);
        return d.toLocaleDateString("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      };

      // Load business settings
      const settingsDoc = await admin
        .firestore()
        .doc("settings/business")
        .get();
      const business = settingsDoc.data() || {};

      const invoiceSettingsDoc = await admin
        .firestore()
        .doc("settings/invoice")
        .get();
      const invoiceSettings =
        invoiceSettingsDoc.data() || {};

      const companyName =
        business.tradingName || "Tropx Wholesale";
      const etransferEmail =
        invoiceSettings.etransferEmail ||
        "tropxenterprises@gmail.com";
      const paymentTermsDays =
        invoiceSettings.paymentTermsDays || 30;
      const hstNumber =
        business.hstNumber || "793273830 RT 0001";
      const logoUrl = business.logoUrl || "";

      const dueDate = (() => {
        if (!order.confirmedAt) return "—";
        const d = order.confirmedAt.toDate ?
          order.confirmedAt.toDate() :
          new Date(order.confirmedAt);
        const due = new Date(d);
        due.setDate(
          due.getDate() + paymentTermsDays
        );
        return due.toLocaleDateString("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      })();

      const itemRows = (order.items || [])
        .map((item: any) => `
          <tr>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              font-size:14px;">
              <div style="font-weight:600;
                color:#1c1c1c;">
                ${item.productName}
              </div>
              <div style="font-size:12px;
                color:#8a94a6;
                font-family:monospace;">
                ${item.productSku}
              </div>
            </td>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              text-align:center;font-size:14px;">
              ${item.quantity}
            </td>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              text-align:right;font-size:14px;">
              ${formatCurrency(item.unitPriceCents)}
            </td>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              text-align:right;font-size:14px;
              font-weight:600;color:#0a2d4a;">
              ${formatCurrency(item.lineTotalCents)}
            </td>
          </tr>
        `).join("");

      const portalOrderUrl =
        "https://tropxwholesale.ca/portal/orders/" +
        event.params.orderId;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,
    initial-scale=1.0">
  <title>Order Confirmation</title>
</head>
<body style="margin:0;padding:0;
  background:#f4f5f7;
  font-family:-apple-system,
  BlinkMacSystemFont,'Segoe UI',
  Arial,sans-serif;">
  <div style="max-width:680px;
    margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="background:#0a2d4a;
      border-radius:12px 12px 0 0;
      padding:28px 32px;">
      <div style="display:flex;
        justify-content:space-between;
        align-items:center;">
        <div>
          ${logoUrl ?
    `<img src="${logoUrl}"
              alt="${companyName}"
              style="height:40px;
              object-fit:contain;">` :
    `<div style="font-size:1.5rem;
              font-weight:800;color:white;">
              ${companyName}
            </div>`
}
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.75rem;
            color:rgba(255,255,255,0.6);
            text-transform:uppercase;
            letter-spacing:0.08em;">
            Order Confirmation
          </div>
          <div style="font-size:1.25rem;
            font-weight:800;color:white;
            font-family:monospace;">
            ${order.orderNumber}
          </div>
        </div>
      </div>
    </div>

    <!-- Confirmation banner -->
    <div style="background:#1a7c4a;
      padding:16px 32px;
      display:flex;align-items:center;
      gap:12px;">
      <div style="width:28px;height:28px;
        border-radius:50%;
        background:rgba(255,255,255,0.2);
        display:flex;align-items:center;
        justify-content:center;
        flex-shrink:0;">
        <span style="color:white;
          font-size:16px;">✓</span>
      </div>
      <div>
        <div style="font-weight:700;
          color:white;font-size:0.9375rem;">
          Order Confirmed!
        </div>
        <div style="font-size:0.8125rem;
          color:rgba(255,255,255,0.8);">
          Hi ${firstName}, your order has been
          received and is being processed.
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="background:white;
      padding:32px;
      border:1px solid #e8eaed;
      border-top:none;">

      <!-- Order meta -->
      <div style="display:grid;
        grid-template-columns:1fr 1fr;
        gap:24px;margin-bottom:28px;">
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            Order Date
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${formatDate(order.confirmedAt)}
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            Payment Due
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${dueDate}
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            Delivery Method
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${order.deliveryType === "pickup" ?
    "📦 Pickup" : "🚚 Delivery"}
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            HST Number
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${hstNumber}
          </div>
        </div>
      </div>

      <!-- Items table -->
      <table style="width:100%;
        border-collapse:collapse;
        margin-bottom:0;">
        <thead>
          <tr style="background:#0a2d4a;">
            <th style="padding:10px 12px;
              text-align:left;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Product
            </th>
            <th style="padding:10px 12px;
              text-align:center;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Qty
            </th>
            <th style="padding:10px 12px;
              text-align:right;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Unit Price
            </th>
            <th style="padding:10px 12px;
              text-align:right;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Totals -->
      <div style="border:1px solid #f0f0f0;
        border-top:none;
        margin-bottom:24px;">
        <div style="display:flex;
          justify-content:space-between;
          padding:8px 12px;font-size:14px;
          color:#444;
          border-bottom:1px solid #f0f0f0;">
          <span>Subtotal</span>
          <span>
            ${formatCurrency(order.subtotalCents)}
          </span>
        </div>
        ${order.discountCents > 0 ? `
          <div style="display:flex;
            justify-content:space-between;
            padding:8px 12px;font-size:14px;
            color:#e7222e;
            border-bottom:1px solid #f0f0f0;">
            <span>Discount</span>
            <span>
              -${formatCurrency(
    order.discountCents
  )}
            </span>
          </div>
        ` : ""}
        <div style="display:flex;
          justify-content:space-between;
          padding:8px 12px;font-size:14px;
          color:#444;
          border-bottom:1px solid #f0f0f0;">
          <span>HST (${order.taxRatePercent}%)</span>
          <span>
            ${formatCurrency(order.taxCents)}
          </span>
        </div>
        <div style="display:flex;
          justify-content:space-between;
          padding:14px 12px;
          background:#0a2d4a;
          font-size:1rem;font-weight:700;
          color:white;">
          <span>Total</span>
          <span>
            ${formatCurrency(order.totalCents)}
          </span>
        </div>
      </div>

      <!-- Payment instructions -->
      <div style="background:#f0f7ff;
        border-left:4px solid #16588e;
        border-radius:0 8px 8px 0;
        padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:0.75rem;
          font-weight:700;
          text-transform:uppercase;
          letter-spacing:0.08em;
          color:#16588e;margin-bottom:8px;">
          Payment Instructions
        </div>
        <div style="font-size:0.875rem;
          color:#0a2d4a;margin-bottom:4px;">
          💳 E-Transfer to:
          <strong>${etransferEmail}</strong>
        </div>
        <div style="font-size:0.875rem;
          color:#0a2d4a;margin-bottom:8px;">
          💵 Cash on delivery accepted
        </div>
        <div style="font-size:0.75rem;
          color:#6b7280;">
          Please reference order number
          <strong>${order.orderNumber}</strong>
          in your payment.
          Payment due within
          ${paymentTermsDays} days.
        </div>
      </div>

      ${order.customerNotes ? `
        <div style="background:#f8fafc;
          border-radius:8px;padding:16px;
          margin-bottom:24px;">
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:8px;">
            Your Notes
          </div>
          <div style="font-size:0.875rem;
            color:#444;">
            ${order.customerNotes}
          </div>
        </div>
      ` : ""}

      <!-- View order CTA -->
      <div style="text-align:center;">
        <a href="${portalOrderUrl}"
          style="display:inline-block;
          background:#0a2d4a;color:white;
          text-decoration:none;
          padding:14px 32px;
          border-radius:10px;
          font-weight:700;font-size:1rem;">
          View Order Details →
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;
      text-align:center;
      border:1px solid #e8eaed;
      border-top:none;
      background:#f8fafc;
      border-radius:0 0 12px 12px;">
      <p style="font-size:0.75rem;
        color:#9ca3af;margin:0 0 4px;">
        © Tropx Enterprises Inc. ·
        Kitchener, Ontario, Canada
      </p>
      <p style="font-size:0.75rem;
        color:#9ca3af;margin:0;">
        <a href="https://tropxwholesale.ca"
          style="color:#16588e;
          text-decoration:none;">
          tropxwholesale.ca
        </a>
      </p>
    </div>

  </div>
</body>
</html>`;

      const resend = new Resend(resendApiKey.value());

      await resend.emails.send({
        from: `${companyName} <${fromEmail.value()}>`,
        to: customerEmail,
        subject:
          `Order Confirmed — ${order.orderNumber}`,
        html: emailHtml,
      });

      await event.data?.ref.update({
        portalConfirmationSentAt: FieldValue.serverTimestamp(),
      });

      logger.info(
        "Portal order confirmation sent: " +
        `${order.orderNumber} → ${customerEmail}`
      );
    }
  );

// ─── Purchase Order Requests ────────────────────────────────────────────────

export const onPoRequest = onDocumentCreated(
  {
    document: "poRequests/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "pending") return;

    const {supplierEmail, poNumber, poHtml} = data;

    if (!supplierEmail || !poHtml) {
      await event.data?.ref.update({
        status: "error",
        error: "Missing email or HTML",
      });
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: supplierEmail,
        subject: `Purchase Order ${poNumber} — Tropx Wholesale`,
        html: poHtml,
      });

      await event.data?.ref.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`PO ${poNumber} sent to supplier`);
    } catch (err: any) {
      await logger.error("Error sending PO email:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
    }
  }
);

// ── Popular Products ─────────────────────────────────
// Counts distinct customers who ordered each product
// within a configurable window of delivered orders.
// Writes ranked results into settings/storefront so
// all storefront config stays in one document.
//
// Formula:
//   percent = distinct customers who ordered product
//           ÷ distinct customers with at least one
//             delivered order in window
//           × 100

async function computePopularProducts(): Promise<void> {
  const sfDoc = await db
    .doc("settings/storefront")
    .get();
  const sf = sfDoc.exists ? sfDoc.data() : {};
  const cfg = sf?.["popularProductsSettings"] ?? {
    windowDays: 90,
    topN: 10,
    minPercent: 0,
  };

  const windowDays: number = cfg.windowDays ?? 90;
  const topN: number = cfg.topN ?? 10;
  const minPercent: number = cfg.minPercent ?? 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const ordersSnap = await db
    .collection("orders")
    .where("tenantId", "==", 1)
    .where("status", "==", "delivered")
    .where("deliveredAt", ">=", cutoff)
    .get();

  const productCustomers =
    new Map<string, Set<string>>();
  const activeCustomers = new Set<string>();

  for (const doc of ordersSnap.docs) {
    const order = doc.data();
    const customerId: string = order["customerId"];
    if (!customerId) continue;

    activeCustomers.add(customerId);

    const items: any[] = order["items"] || [];
    for (const item of items) {
      const pid: string = item["productId"];
      if (!pid) continue;
      if (!productCustomers.has(pid)) {
        productCustomers.set(pid, new Set());
      }
      productCustomers.get(pid)!.add(customerId);
    }
  }

  const totalCustomers = activeCustomers.size;
  const stamp =
    admin.firestore.FieldValue.serverTimestamp();

  if (totalCustomers === 0) {
    await db.doc("settings/storefront").update({
      popularProductEntries: [],
      popularProductsComputedAt: stamp,
      popularProductsTotalCustomers: 0,
      popularProductsWindowDays: windowDays,
    });
    logger.info(
      "computePopularProducts: no delivered " +
      `orders in last ${windowDays} days`
    );
    return;
  }

  const entries: {
    productId: string;
    customerCount: number;
    totalCustomers: number;
    percent: number;
  }[] = [];

  for (
    const [productId, customers]
    of productCustomers
  ) {
    const customerCount = customers.size;
    const percent = Math.round(
      (customerCount / totalCustomers) * 100
    );
    if (percent >= minPercent) {
      entries.push({
        productId,
        customerCount,
        totalCustomers,
        percent,
      });
    }
  }

  entries.sort((a, b) => b.percent - a.percent);
  const top = entries.slice(0, topN);

  await db.doc("settings/storefront").update({
    popularProductEntries: top,
    popularProductsComputedAt: stamp,
    popularProductsTotalCustomers: totalCustomers,
    popularProductsWindowDays: windowDays,
  });

  logger.info(
    "computePopularProducts: " +
    `${top.length} products ranked, ` +
    `${totalCustomers} active customers, ` +
    `${windowDays}d window`
  );
}

// Scheduled: nightly at 2am Toronto time.
export const computePopularProductsScheduled =
  onSchedule(
    {
      schedule: "0 2 * * *",
      timeZone: "America/Toronto",
      region: "northamerica-northeast1",
      timeoutSeconds: 120,
      secrets: [sentryDsn],
    },
    async () => {
      await computePopularProducts();
    }
  );

// HTTP callable: admin triggers manual recompute
// from settings page without waiting for nightly.
export const computePopularProductsNow = onCall(
  {
    region: "northamerica-northeast1",
    secrets: [sentryDsn],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Must be authenticated"
      );
    }
    await computePopularProducts();
    return {success: true};
  }
);

// ── TEMPORARY — Sentry backend verification ─────
// One-time check that a real prod SENTRY_DSN secret
// actually delivers events, tagged correctly, before
// trusting it ahead of the Phase 5 function split.
// Logs a controlled, clearly-labeled test error via
// the shared logger (same path every real error goes
// through) and returns success either way — the point
// is to inspect the Sentry dashboard afterward, not
// the callable's return value. Delete this function
// once verified.
export const testSentryReporting =
  onCall(
    {
      region: "northamerica-northeast2",
      secrets: [sentryDsn],
      cors: true,
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "Must be authenticated"
        );
      }
      if (request.auth.token["role"] !== "admin") {
        throw new HttpsError(
          "permission-denied",
          "Admin only"
        );
      }
      await logger.error(
        "testSentryReporting: deliberate test error — " +
        "safe to ignore, confirms Sentry backend wiring",
        new Error("Sentry backend verification test")
      );
      return {sent: true};
    }
  );

// ═══ Order Placement (transactional) ═════════════════════════════════════
// Replaces client-side placeOrder. A Firestore transaction re-reads stock and
// the order sequence at commit time, so concurrent orders cannot oversell or
// collide on order numbers. Pulls real cost from products for correct margin.
// Stock floors at 0 for every item; backorder shortfall is captured explicitly.

interface PlaceOrderItem { productId: string; quantity: number; }

export const placeOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const linkedCustomerId = auth.token["linkedCustomerId"] as string | undefined;
    const role = (auth.token["role"] as string) || "none";
    const isCustomer = role === "customer";
    if (!isCustomer || !linkedCustomerId) {
      throw new HttpsError("permission-denied", "Only customers can place portal orders");
    }

    const data = request.data || {};
    const deliveryType: "delivery" | "pickup" = data.deliveryType === "pickup" ? "pickup" : "delivery";
    const notes: string = (data.notes || "").toString().slice(0, 2000);
    const rawItems: PlaceOrderItem[] = Array.isArray(data.items) ? data.items : [];

    if (rawItems.length === 0) {
      throw new HttpsError("invalid-argument", "Cart is empty");
    }
    // Collapse duplicate productIds, coerce qty to positive ints.
    const wanted = new Map<string, number>();
    for (const it of rawItems) {
      const pid = (it.productId || "").toString();
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!pid || qty <= 0) continue;
      wanted.set(pid, (wanted.get(pid) || 0) + qty);
    }
    if (wanted.size === 0) throw new HttpsError("invalid-argument", "No valid items");

    const result = await db.runTransaction(async (tx) => {
      // ── customer ──
      const custRef = db.collection("customers").doc(linkedCustomerId);
      const custSnap = await tx.get(custRef);
      if (!custSnap.exists) throw new HttpsError("not-found", "Customer not found");
      const cust = custSnap.data() || {};

      // ── ordering settings ──
      const orderingSnap = await tx.get(db.collection("settings").doc("ordering"));
      const ordering = orderingSnap.data() || {};
      const prefix = ordering["orderPrefix"] || "TRX";
      const taxRatePercent = ordering["defaultTaxRatePercent"] ?? 13;
      const outOfStockBehavior = ordering["outOfStockBehavior"] || "show_disabled";

      // ── read all products FIRST (transaction rule: all reads before writes) ──
      const productRefs = [...wanted.keys()].map((pid) => db.collection("products").doc(pid));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      const lineItems: any[] = [];
      let subtotalCents = 0;
      let costTotalCents = 0;

      for (let i = 0; i < productSnaps.length; i++) {
        const snap = productSnaps[i];
        const pid = productRefs[i].id;
        const qty = wanted.get(pid)!;
        if (!snap.exists) {
          throw new HttpsError("failed-precondition", "A product is no longer available");
        }
        const p = snap.data() || {};
        if (p["isDeleted"] || p["active"] === false) {
          throw new HttpsError("failed-precondition", `${p["name"] || "An item"} is no longer available`);
        }

        const stock = p["stock"] || 0;
        const perProductBehavior = p["outOfStockBehaviorOverride"] ?? outOfStockBehavior;
        const allowBackorder = perProductBehavior === "allow_backorder";

        // Oversell guard — re-checked at commit time. Backorder items are exempt.
        if (!allowBackorder && qty > stock) {
          throw new HttpsError(
            "failed-precondition",
            `${p["name"] || "An item"} — only ${stock} left (you asked for ${qty})`,
            {productId: pid, available: stock, requested: qty, name: p["name"] || ""},
          );
        }

        const unitPriceCents = p["priceCents"] ?? 0;
        const unitCostCents = p["costCents"] ?? 0;
        const lineTotal = unitPriceCents * qty;
        subtotalCents += lineTotal;
        costTotalCents += unitCostCents * qty;

        // Stock floors at 0 for ALL items (keeps the app-wide stock>=0 invariant).
        // For backorder items exceeding stock, record the shortfall explicitly so
        // it's queryable and surfaced — never left implicit.
        const backorderedQty = allowBackorder ? Math.max(0, qty - stock) : 0;

        lineItems.push({
          productId: pid,
          productName: p["name"] || "Unnamed product",
          productSku: p["sku"] || "",
          quantity: qty,
          unitPriceCents,
          lineTotalCents: lineTotal,
          costCents: unitCostCents,
          lineCostCents: unitCostCents * qty,
          lineMarginCents: lineTotal - unitCostCents * qty,
          backorderedQty, // 0 when fully in stock
          _newStock: Math.max(0, stock - qty), // never negative
          _prevStock: stock,
        });
      }

      // ── order sequence (transactional) ──
      const seqRef = db.collection("settings").doc("orderSequence");
      const seqSnap = await tx.get(seqRef);
      const currentSeq = seqSnap.exists ? (seqSnap.data()?.["sequence"] || 0) : 0;
      const nextSeq = currentSeq + 1;
      const year = new Date().getFullYear();
      const orderNumber = `${prefix}-${year}-${String(nextSeq).padStart(4, "0")}`;

      // ── totals ──
      const discountCents = 0;
      const taxableCents = subtotalCents - discountCents;
      const taxCents = Math.round((taxableCents * taxRatePercent) / 100);
      const totalCents = taxableCents + taxCents;
      const marginCents = subtotalCents - costTotalCents;

      const hasBackorder = lineItems.some((li) => li.backorderedQty > 0);
      const totalBackorderedUnits = lineItems.reduce((s, li) => s + li.backorderedQty, 0);

      // Modular import (not admin.firestore.FieldValue) — the old
      // namespace-style static access crashes inside the Functions
      // Emulator when combined with this file's named-database
      // db.settings() call; see the import comment at the top of this
      // file and place-order.spec.ts for the full diagnosis. Production
      // (real Cloud Functions runtime, not the local emulator) is
      // unaffected either way — this only matters for local testing.
      const now = FieldValue.serverTimestamp();
      const orderRef = db.collection("orders").doc();

      // Strip internal _newStock/_prevStock; backorderedQty stays on the stored line.
      const orderItems = lineItems.map(({_newStock, _prevStock, ...rest}) => rest);

      // ── WRITES (all reads are done) ──
      tx.set(orderRef, {
        orderNumber,
        customerId: linkedCustomerId,
        customerName: cust["businessName"] ||
          `${cust["ownerFirstName"] || ""} ${cust["ownerLastName"] || ""}`.trim(),
        customerEmail: cust["email"] || "",
        customerPhone: cust["phone"] || "",
        serviceAreaId: cust["serviceAreaId"] || null,
        serviceAreaName: cust["serviceAreaName"] || cust["serviceAreaCustom"] || "",
        status: "confirmed",
        source: "customer_portal",
        deliveryType,
        items: orderItems,
        subtotalCents,
        discountCents,
        taxRatePercent,
        taxCents,
        totalCents,
        costTotalCents,
        marginCents,
        hasBackorder,
        totalBackorderedUnits,
        amountPaidCents: 0,
        balanceCents: totalCents,
        paymentStatus: "unpaid",
        customerNotes: notes,
        tenantId: 1,
        isDeleted: false,
        confirmedAt: now,
        createdAt: now,
      });

      tx.update(custRef, {
        lastOrderAt: now,
        totalOrderedCents: (cust["totalOrderedCents"] || 0) + totalCents,
        totalOwingCents: (cust["totalOwingCents"] || 0) + totalCents,
      });

      tx.set(seqRef, {sequence: nextSeq}, {merge: true});

      for (const li of lineItems) {
        tx.update(db.collection("products").doc(li.productId), {stock: li._newStock});
        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: li.productId,
          productName: li.productName,
          productSku: li.productSku,
          type: "sold",
          quantity: -li.quantity,
          previousStock: li._prevStock,
          newStock: li._newStock,
          reason: `Order ${orderNumber} (portal)`,
          adjustedBy: {
            uid: auth.uid,
            firstName: cust["ownerFirstName"] || cust["businessName"] || "Portal customer",
            lastName: cust["ownerLastName"] || "",
          },
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderRef.id,
          linkedOrderNumber: orderNumber,
        });
      }

      return {orderId: orderRef.id, orderNumber, hasBackorder, totalBackorderedUnits};
    });

    return result;
  }
);

// ── cancelOrder / submitReturn ──────────────────────────────────────────
// Portal self-service cancellation and returns used to write directly from
// the client via a Firestore batch touching orders/customers/settings/
// products/stockAdjustments — all staff-only or narrowly-scoped collections
// under firestore.rules. That batch was permission-denied for every real
// customer (Firestore batches are all-or-nothing across every write), so
// these two features never actually worked end to end. Moved server-side,
// same reasoning as placeOrder: re-validate ownership/state against the
// stored order rather than trusting the client, and use the Admin SDK for
// the writes rules correctly keep staff-only.

export const cancelOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const linkedCustomerId = auth.token["linkedCustomerId"] as string | undefined;
    const role = (auth.token["role"] as string) || "none";
    if (role !== "customer" || !linkedCustomerId) {
      throw new HttpsError("permission-denied", "Only customers can cancel their own orders");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const reason = (data.reason || "").toString().trim().slice(0, 2000);
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (!reason) throw new HttpsError("invalid-argument", "A cancellation reason is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;

      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (order["customerId"] !== linkedCustomerId) {
        throw new HttpsError("permission-denied", "This order does not belong to you");
      }
      // Portal can only cancel while still confirmed — matches the
      // client-side canCancel gate, re-checked here server-side rather
      // than trusted from the client.
      if (order["status"] !== "confirmed") {
        throw new HttpsError(
          "failed-precondition",
          "Only orders that haven't shipped yet can be cancelled"
        );
      }

      const custRef = db.collection("customers").doc(linkedCustomerId);
      const custSnap = await tx.get(custRef);
      const cust = custSnap.exists ? custSnap.data()! : {};

      const items: any[] = order["items"] || [];
      const productRefs = items.map((it) => db.collection("products").doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      const amountPaid = order["amountPaidCents"] || 0;

      // A credit/refund audit record is only needed when money already
      // changed hands — reserve a return number for it now (read before
      // write) so the whole thing stays one atomic transaction.
      let returnNumber = "";
      let nextRetSeq = 0;
      const retSeqRef = db.collection("settings").doc("returnSequence");
      if (amountPaid > 0) {
        const [retSeqSnap, orderingSnap] = await Promise.all([
          tx.get(retSeqRef),
          tx.get(db.collection("settings").doc("ordering")),
        ]);
        const currentSeq = retSeqSnap.exists ? (retSeqSnap.data()?.["sequence"] || 0) : 0;
        nextRetSeq = currentSeq + 1;
        const retPrefix = orderingSnap.data()?.["returnPrefix"] || "RET";
        const year = new Date().getFullYear();
        returnNumber = `${retPrefix}-${year}-${String(nextRetSeq).padStart(4, "0")}`;
      }

      const now = FieldValue.serverTimestamp();
      const actionBy = {
        uid: auth.uid,
        firstName: cust["ownerFirstName"] || cust["businessName"] || "Portal customer",
        lastName: cust["ownerLastName"] || "",
      };

      // ── writes ──
      tx.update(orderRef, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actionBy,
        cancellationReason: reason,
        cancelledByPortal: true,
        balanceCents: 0,
        paymentStatus: "unpaid",
      });

      const totalOrdered = (cust["totalOrderedCents"] || 0) - (order["totalCents"] || 0);
      const totalOwing = (cust["totalOwingCents"] || 0) - (order["balanceCents"] || 0);
      const custUpdates: Record<string, unknown> = {
        totalOrderedCents: Math.max(0, totalOrdered),
        totalOwingCents: Math.max(0, totalOwing),
      };
      if (amountPaid > 0) {
        custUpdates["totalPaidCents"] =
          Math.max(0, (cust["totalPaidCents"] || 0) - amountPaid);
        custUpdates["creditBalanceCents"] =
          (cust["creditBalanceCents"] || 0) + amountPaid;
      }
      tx.update(custRef, custUpdates);

      if (amountPaid > 0) {
        tx.set(retSeqRef, {sequence: nextRetSeq}, {merge: true});
        const creditRef = db.collection("returns").doc();
        tx.set(creditRef, {
          returnNumber,
          orderId,
          orderNumber: order["orderNumber"],
          customerId: linkedCustomerId,
          customerName: order["customerName"],
          customerEmail: order["customerEmail"] || "",
          customerPhone: order["customerPhone"] || "",
          type: "refund",
          status: "approved",
          source: "cancellation",
          reasonCode: "order_cancelled",
          reason: `Order cancelled by customer. Reason: ${reason}`,
          items: items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents,
          })),
          amountCents: amountPaid,
          stockRestored: true,
          stockAdjustmentIds: [],
          refundMethod: "store_credit",
          tenantId: 1,
          isDeleted: false,
          createdAt: now,
          createdBy: actionBy,
          processedAt: now,
          processedBy: actionBy,
        });
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;
        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + item.quantity;

        tx.update(productRefs[i], {stock: newStock});
        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          type: "returned",
          quantity: item.quantity,
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} cancelled by customer`,
          notes: `Reason: ${reason}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderRef.id,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

interface SubmitReturnItem {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
}

export const submitReturn = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const linkedCustomerId = auth.token["linkedCustomerId"] as string | undefined;
    const role = (auth.token["role"] as string) || "none";
    if (role !== "customer" || !linkedCustomerId) {
      throw new HttpsError("permission-denied", "Only customers can submit returns");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const returnType = data.returnType === "refund" ? "refund" : "credit_note";
    const reasonCode = (data.reasonCode || "other").toString();
    const notes = (data.notes || "").toString().slice(0, 2000);
    const rawItems: SubmitReturnItem[] = Array.isArray(data.items) ? data.items : [];

    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Select at least one item to return");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;

      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (order["customerId"] !== linkedCustomerId) {
        throw new HttpsError("permission-denied", "This order does not belong to you");
      }
      // Matches the client-side canSubmitReturn gate — a return can only
      // be requested once the order has actually been delivered.
      if (order["status"] !== "delivered") {
        throw new HttpsError(
          "failed-precondition",
          "Returns can only be submitted for delivered orders"
        );
      }

      const orderItems: any[] = order["items"] || [];
      const orderItemsByProduct = new Map(orderItems.map((it) => [it.productId, it]));

      // Server-authoritative: quantity and price come from the stored
      // order line, never from the client — a return can't be padded
      // past what was actually ordered or priced differently.
      const returnItems: any[] = [];
      let amountCents = 0;
      for (const raw of rawItems) {
        const pid = (raw.productId || "").toString();
        const orderLine = orderItemsByProduct.get(pid);
        if (!orderLine) {
          throw new HttpsError("invalid-argument", "One of the return items wasn't part of this order");
        }
        const qty = Math.floor(Number(raw.quantity) || 0);
        if (qty <= 0 || qty > orderLine.quantity) {
          throw new HttpsError(
            "invalid-argument",
            `Return quantity for ${orderLine.productName} must be between 1 and ${orderLine.quantity}`
          );
        }
        const lineTotalCents = orderLine.unitPriceCents * qty;
        amountCents += lineTotalCents;
        returnItems.push({
          productId: pid,
          productName: orderLine.productName,
          productSku: orderLine.productSku,
          quantity: qty,
          unitPriceCents: orderLine.unitPriceCents,
          lineTotalCents,
        });
      }

      const [seqSnap, orderingSnap, custSnap] = await Promise.all([
        tx.get(db.collection("settings").doc("returnSequence")),
        tx.get(db.collection("settings").doc("ordering")),
        tx.get(db.collection("customers").doc(linkedCustomerId)),
      ]);
      const currentSeq = seqSnap.exists ? (seqSnap.data()?.["sequence"] || 0) : 0;
      const nextSeq = currentSeq + 1;
      const prefix = orderingSnap.data()?.["returnPrefix"] || "RET";
      const year = new Date().getFullYear();
      const returnNumber = `${prefix}-${year}-${String(nextSeq).padStart(4, "0")}`;
      const cust = custSnap.exists ? custSnap.data()! : {};

      const now = FieldValue.serverTimestamp();
      const returnRef = db.collection("returns").doc();

      // ── writes ──
      tx.set(returnRef, {
        returnNumber,
        orderId,
        orderNumber: order["orderNumber"],
        customerId: linkedCustomerId,
        customerName: order["customerName"],
        customerEmail: order["customerEmail"] || "",
        type: returnType,
        status: "pending",
        source: "customer_portal",
        reasonCode,
        reason: notes || reasonCode,
        items: returnItems,
        amountCents,
        stockRestored: false,
        tenantId: 1,
        isDeleted: false,
        createdAt: now,
        createdBy: {
          uid: auth.uid,
          firstName: cust["ownerFirstName"] || cust["businessName"] || "Portal customer",
          lastName: cust["ownerLastName"] || "",
        },
      });
      tx.set(db.collection("settings").doc("returnSequence"), {sequence: nextSeq}, {merge: true});

      return {returnId: returnRef.id, returnNumber};
    });

    return result;
  }
);

// ── approveReturn ────────────────────────────────────────────────────────
// Staff-only admin action (admin-returns.component.ts). Used to be a
// client Firestore writeBatch that took a getDoc() read of the order/
// customer/product docs, then committed the batch — the read is never
// re-validated at commit time, so two concurrent approvals (two staff
// tabs, a retry) can race on the same product's stock. Same defect class
// as placeOrder pre-migration; moved to a runTransaction so every read is
// re-taken atomically with the write. Money/customer-counter logic is
// unchanged from the original component method — see git history on
// admin-returns.component.ts for the pre-migration version this mirrors.
const STAFF_ROLES = ["admin", "manager", "sales_rep", "warehouse"];

export const approveReturn = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const returnId = (data.returnId || "").toString();
    const restoreStock = data.restoreStock !== false; // defaults true, matches the component signal
    const refundMethod = (data.refundMethod || "").toString();
    const refundReferenceNumber = (data.refundReferenceNumber || "").toString().trim();

    if (!returnId) throw new HttpsError("invalid-argument", "returnId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const returnRef = db.collection("returns").doc(returnId);
      const returnSnap = await tx.get(returnRef);
      if (!returnSnap.exists) throw new HttpsError("not-found", "Return not found");
      const ret = returnSnap.data()!;
      if (ret["isDeleted"]) throw new HttpsError("not-found", "Return not found");

      if (ret["type"] === "refund" && !refundMethod) {
        throw new HttpsError("invalid-argument", "refundMethod is required for a refund");
      }

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const orderRef = db.collection("orders").doc(ret["orderId"]);
      const orderSnap = await tx.get(orderRef);

      const customerRef = db.collection("customers").doc(ret["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const items: Array<Record<string, any>> = ret["items"] || [];
      const productRefs = items.map((it) => db.collection("products").doc(it["productId"]));
      const productSnaps = restoreStock ?
        await Promise.all(productRefs.map((r) => tx.get(r))) :
        [];

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const returnUpdates: Record<string, unknown> = {
        status: "approved",
        processedBy: actionBy,
        processedAt: now,
        stockRestored: restoreStock,
      };

      if (ret["type"] === "refund") {
        returnUpdates["refundMethod"] = refundMethod;
        returnUpdates["refundedAt"] = now;
        returnUpdates["refundedBy"] = actionBy;
        if (refundReferenceNumber) returnUpdates["refundReferenceNumber"] = refundReferenceNumber;
      }

      if (orderSnap.exists) {
        const order = orderSnap.data()!;
        const amountCents = ret["amountCents"] || 0;
        const newTotal = Math.max(0, (order["totalCents"] || 0) - amountCents);
        const newBalance = Math.max(0, (order["balanceCents"] || 0) - amountCents);
        const newAmountPaid = Math.min(newTotal, order["amountPaidCents"] || 0);
        const newPaymentStatus = newBalance <= 0 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";

        tx.update(orderRef, {
          totalCents: newTotal,
          balanceCents: newBalance,
          amountPaidCents: newAmountPaid,
          paymentStatus: newPaymentStatus,
        });
      }

      if (customerSnap.exists) {
        const cust = customerSnap.data()!;
        const amountCents = ret["amountCents"] || 0;
        const custUpdates: Record<string, unknown> = {
          totalOrderedCents: Math.max(0, (cust["totalOrderedCents"] || 0) - amountCents),
        };
        if (ret["type"] === "credit_note") {
          custUpdates["totalOwingCents"] = Math.max(0, (cust["totalOwingCents"] || 0) - amountCents);
        } else if (ret["type"] === "refund") {
          custUpdates["totalPaidCents"] = Math.max(0, (cust["totalPaidCents"] || 0) - amountCents);
        }
        tx.update(customerRef, custUpdates);
      }

      if (restoreStock) {
        const stockAdjustmentIds: string[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const snap = productSnaps[i];
          if (!snap.exists) continue;
          const p = snap.data()!;
          const currentStock = p["stock"] || 0;
          const newStock = currentStock + (item["quantity"] || 0);

          tx.update(productRefs[i], {stock: newStock});

          const adjRef = db.collection("stockAdjustments").doc();
          stockAdjustmentIds.push(adjRef.id);
          tx.set(adjRef, {
            productId: item["productId"],
            productName: item["productName"],
            productSku: item["productSku"],
            type: "returned",
            quantity: item["quantity"],
            previousStock: currentStock,
            newStock,
            reason: `Return ${ret["returnNumber"]} approved`,
            notes: `Return reason: ${ret["reason"]}`,
            adjustedBy: actionBy,
            createdAt: now,
            tenantId: 1,
            isDeleted: false,
            linkedOrderId: ret["orderId"],
            linkedOrderNumber: ret["orderNumber"],
          });
        }
        returnUpdates["stockAdjustmentIds"] = stockAdjustmentIds;
      }

      tx.update(returnRef, returnUpdates);

      return {returnNumber: ret["returnNumber"]};
    });

    return result;
  }
);

// ── receivePurchaseOrder ────────────────────────────────────────────────
// Staff-only admin action (po-receive.component.ts saveReceive()). Used to
// be a client writeBatch that took a getDoc() read of each product before
// committing, plus a *separate* runTransaction (getNextReceiveNumber) run
// before the batch even started — so a receive-number could be consumed
// even if the batch that followed it failed, and two concurrent receipts
// against the same product could race on stock, same defect class as
// approveReturn. Moved to a single runTransaction: the receive-number
// sequence, PO status, and every product's stock now commit atomically
// together. Money/stock logic is otherwise unchanged from the original
// component method.
interface ReceivePoRow {
  productId: string;
  receiveNow: number;
}

export const receivePurchaseOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const purchaseOrderId = (data.purchaseOrderId || "").toString();
    const rawRows: ReceivePoRow[] = Array.isArray(data.rows) ? data.rows : [];
    const notes = (data.notes || "").toString().slice(0, 2000);
    const receivedDate = (data.receivedDate || "").toString();
    const warehouseId = (data.warehouseId || "").toString();

    if (!purchaseOrderId) throw new HttpsError("invalid-argument", "purchaseOrderId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const poRef = db.collection("purchaseOrders").doc(purchaseOrderId);
      const poSnap = await tx.get(poRef);
      if (!poSnap.exists) throw new HttpsError("not-found", "Purchase order not found");
      const po = poSnap.data()!;
      if (po["isDeleted"]) throw new HttpsError("not-found", "Purchase order not found");
      if (po["status"] !== "sent" && po["status"] !== "partially_received") {
        throw new HttpsError(
          "failed-precondition",
          "Only sent or partially received purchase orders can be received"
        );
      }

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const inventorySnap = await tx.get(db.collection("settings").doc("inventory"));
      const inventory = inventorySnap.data() || {};
      const multiWarehouseEnabled = inventory["multiWarehouseEnabled"] === true;

      let finalWarehouseId: string;
      let finalWarehouseName: string;
      let warehouseSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (multiWarehouseEnabled) {
        if (!warehouseId) throw new HttpsError("invalid-argument", "Select a warehouse");
        warehouseSnap = await tx.get(db.collection("warehouses").doc(warehouseId));
        finalWarehouseId = warehouseId;
        finalWarehouseName = warehouseSnap.exists ?
          (warehouseSnap.data()!["name"] || po["warehouseName"]) :
          po["warehouseName"];
      } else {
        finalWarehouseId = inventory["defaultWarehouseId"] || po["warehouseId"];
        finalWarehouseName = inventory["defaultWarehouseName"] || po["warehouseName"];
      }

      const seqRef = db.collection("settings").doc("receiveSequence");
      const seqSnap = await tx.get(seqRef);
      const seqData = seqSnap.exists ?
        seqSnap.data()! :
        {prefix: "GRN", nextNumber: 1, padding: 5};
      const nextNum = seqData["nextNumber"] || 1;
      const prefix = seqData["prefix"] || "GRN";
      const padding = seqData["padding"] || 5;
      const receiveNumber = `${prefix}-${String(nextNum).padStart(padding, "0")}`;

      // Server-authoritative: quantityOrdered/quantityReceived/unitCostCents
      // come from the stored PO line, never from the client — a receipt
      // can't be padded past what's actually remaining on the order, and
      // the cost recorded can't be tampered with (the client UI never lets
      // it be edited either — see po-receive.component.ts).
      const poItems: Array<Record<string, any>> = po["items"] || [];
      const poItemsByProduct = new Map(poItems.map((it) => [it["productId"], it]));

      const validRows: Array<{
        productId: string; productName: string; productSku: string;
        qty: number; unitCostCents: number;
      }> = [];
      for (const raw of rawRows) {
        const pid = (raw.productId || "").toString();
        const poItem = poItemsByProduct.get(pid);
        if (!poItem) {
          throw new HttpsError("invalid-argument", "One of the items wasn't part of this purchase order");
        }
        const qty = Math.floor(Number(raw.receiveNow) || 0);
        if (qty <= 0) continue;
        const remaining = (poItem["quantityOrdered"] || 0) - (poItem["quantityReceived"] || 0);
        if (qty > remaining) {
          throw new HttpsError(
            "invalid-argument",
            `Cannot receive more than the ${remaining} remaining for ${poItem["productName"]}`
          );
        }
        validRows.push({
          productId: pid,
          productName: poItem["productName"],
          productSku: poItem["productSku"],
          qty,
          unitCostCents: poItem["unitCostCents"] || 0,
        });
      }
      if (validRows.length === 0) {
        throw new HttpsError("invalid-argument", "Must receive at least one item");
      }

      const productRefs = validRows.map((r) => db.collection("products").doc(r.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const receiveItems: Array<Record<string, unknown>> = [];
      const poItemsUpdate = poItems.map((it) => ({...it}));

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const snap = productSnaps[i];
        const currentStock = snap.exists ? (snap.data()!["stock"] || 0) : 0;
        const newStock = currentStock + row.qty;

        if (snap.exists) {
          tx.update(productRefs[i], {stock: newStock, costCents: row.unitCostCents});
        }

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          type: "received",
          quantity: row.qty,
          previousStock: currentStock,
          newStock,
          reason: `PO ${po["poNumber"]} received (${receiveNumber})`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedPoId: purchaseOrderId,
          linkedPoNumber: po["poNumber"],
          warehouseId: finalWarehouseId,
        });

        receiveItems.push({
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          quantityReceived: row.qty,
          previousStock: currentStock,
          newStock,
        });

        const idx = poItemsUpdate.findIndex((it) => it["productId"] === row.productId);
        if (idx >= 0) {
          poItemsUpdate[idx]["quantityReceived"] = (poItemsUpdate[idx]["quantityReceived"] || 0) + row.qty;
        }
      }

      const recRef = db.collection("purchaseReceives").doc();
      tx.set(recRef, {
        receiveNumber,
        purchaseOrderId,
        poNumber: po["poNumber"],
        supplierId: po["supplierId"],
        supplierName: po["supplierName"],
        warehouseId: finalWarehouseId,
        warehouseName: finalWarehouseName,
        items: receiveItems,
        receivedDate: receivedDate ? new Date(`${receivedDate}T12:00:00Z`) : now,
        notes,
        createdAt: now,
        createdBy: actionBy,
        tenantId: 1,
        isDeleted: false,
      });

      tx.set(seqRef, {...seqData, nextNumber: nextNum + 1});

      const allReceived = poItemsUpdate.every(
        (it) => (it["quantityReceived"] || 0) >= (it["quantityOrdered"] || 0)
      );
      const poUpdate: Record<string, unknown> = {
        items: poItemsUpdate,
        status: allReceived ? "received" : "partially_received",
      };
      if (allReceived) poUpdate["receivedAt"] = now;
      tx.update(poRef, poUpdate);

      return {receiveNumber, purchaseOrderId};
    });

    return result;
  }
);

// ── createAdminOrder ─────────────────────────────────────────────────────
// Staff-only admin action (order-form.component.ts saveOrder(), create
// mode). Used to be a client writeBatch that took a getDoc() read of each
// product before committing (same race as approveReturn/
// receivePurchaseOrder), preceded by its own order-number sequence read —
// and that sequence tracked a *different* field (`lastNumber`) than the
// one placeOrder uses (`sequence`) on the very same settings/orderSequence
// document, so a portal order and an admin-created order could land on
// the identical order number. Moved to a single runTransaction reusing
// placeOrder's `sequence` field: nextSeq is one past whichever of the two
// legacy counters is higher, so nothing already issued under either
// scheme can collide, and both paths share `sequence` from here on.
// Unlike placeOrder, staff may still set a custom unitPriceCents per line
// (negotiated pricing, a pre-existing capability) — that trust boundary
// is unchanged; this migration only fixes the stock/sequence race.
interface AdminOrderItemInput {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export const createAdminOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const customerId = (data.customerId || "").toString();
    const rawItems: AdminOrderItemInput[] = Array.isArray(data.items) ? data.items : [];
    const discountCents = Math.floor(Number(data.discountCents) || 0);
    const taxRatePercent = Number(data.taxRatePercent) || 0;
    const deliveryType: "delivery" | "pickup" = data.deliveryType === "pickup" ? "pickup" : "delivery";
    const customerNotes = (data.customerNotes || "").toString().slice(0, 2000) || null;
    const internalNotes = (data.internalNotes || "").toString().slice(0, 2000) || null;
    // Epoch ms computed client-side from the browser's local midnight
    // (dateInputToLocalDate) — recomputing "local midnight" here would
    // use the Functions runtime's timezone (UTC), not the browser's, and
    // silently shift the stored date by the offset between them.
    const expectedDeliveryDateMs = typeof data.expectedDeliveryDateMs === "number" ?
      data.expectedDeliveryDateMs :
      null;

    if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");
    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Add at least one item");
    for (const it of rawItems) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.productId || qty <= 0) {
        throw new HttpsError("invalid-argument", "All items must have a quantity greater than 0");
      }
    }

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const custRef = db.collection("customers").doc(customerId);
      const custSnap = await tx.get(custRef);
      if (!custSnap.exists) throw new HttpsError("not-found", "Customer not found");
      const cust = custSnap.data()!;

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      let serviceAreaName = "";
      if (cust["serviceAreaId"]) {
        const saSnap = await tx.get(db.collection("serviceAreas").doc(cust["serviceAreaId"]));
        if (saSnap.exists && !saSnap.data()!["isDeleted"]) {
          serviceAreaName = saSnap.data()!["name"] || "";
        }
      }

      const seqRef = db.collection("settings").doc("orderSequence");
      const seqSnap = await tx.get(seqRef);
      const seqData = seqSnap.exists ? seqSnap.data()! : {};
      const nextSeq = Math.max(seqData["sequence"] || 0, seqData["lastNumber"] || 0) + 1;
      const prefix = seqData["prefix"] || "TRX";
      const year = new Date().getFullYear();
      const orderNumber = `${prefix}-${year}-${String(nextSeq).padStart(4, "0")}`;

      // Products: read fresh inside the transaction (the race this
      // migration exists to fix) — but item name/sku/price/cost stay
      // client-supplied; staff pricing overrides are unchanged.
      const productRefs = rawItems.map((it) => db.collection("products").doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const orderRef = db.collection("orders").doc();

      const items = rawItems.map((it) => {
        const qty = Math.floor(Number(it.quantity) || 0);
        const unitPriceCents = Math.floor(Number(it.unitPriceCents) || 0);
        const unitCostCents = Math.floor(Number(it.unitCostCents) || 0);
        return {
          productId: it.productId,
          productName: it.productName,
          productSku: it.productSku,
          quantity: qty,
          unitPriceCents,
          unitCostCents,
          lineTotalCents: qty * unitPriceCents,
          lineCostCents: qty * unitCostCents,
          currencyCode: "CAD",
        };
      });

      const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
      const taxableCents = Math.max(0, subtotalCents - discountCents);
      const taxCents = Math.round(taxableCents * (taxRatePercent / 100));
      const totalCents = taxableCents + taxCents;
      const totalCostCents = items.reduce((sum, i) => sum + i.lineCostCents, 0);

      tx.set(orderRef, {
        orderNumber,
        customerId,
        customerName: cust["businessName"] || "",
        customerPhone: cust["phone"] ?? null,
        customerEmail: cust["email"] || "",
        serviceAreaId: cust["serviceAreaId"] || null,
        serviceAreaName: serviceAreaName || null,
        items,
        subtotalCents,
        taxRatePercent,
        taxCents,
        discountCents,
        totalCents,
        currencyCode: "CAD",
        totalCostCents,
        marginCents: totalCents - totalCostCents,
        status: "confirmed",
        paymentStatus: "unpaid",
        amountPaidCents: 0,
        balanceCents: totalCents,
        source: "admin_created",
        deliveryType,
        customerNotes,
        internalNotes,
        expectedDeliveryDate: expectedDeliveryDateMs != null ? new Date(expectedDeliveryDateMs) : null,
        confirmedAt: now,
        confirmedBy: actionBy,
        tenantId: 1,
        createdAt: now,
        createdBy: actionBy,
        isDeleted: false,
      });

      tx.update(custRef, {
        totalOrderedCents: (cust["totalOrderedCents"] || 0) + totalCents,
        totalOwingCents: (cust["totalOwingCents"] || 0) + totalCents,
        lastOrderAt: now,
      });

      tx.set(seqRef, {sequence: nextSeq}, {merge: true});

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue; // matches original: skip stock entirely if the product doc is gone

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        // Clamp at 0, oversell allowed — staff already confirmed via the
        // client-side warning dialog; no server-side oversell block for
        // admin-created orders (unlike placeOrder's portal guard).
        const newStock = Math.max(0, currentStock - item.quantity);

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          type: "sold",
          quantity: -item.quantity,
          previousStock: currentStock,
          newStock,
          reason: `Order ${orderNumber}`,
          notes: null,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderRef.id,
          linkedOrderNumber: orderNumber,
        });
      }

      return {orderId: orderRef.id, orderNumber};
    });

    return result;
  }
);

// ── updateAdminOrder ─────────────────────────────────────────────────────
// Staff-only admin action (order-form.component.ts saveEditedOrder()).
// Used to be a client writeBatch keyed off originalOrder() — a live
// listener snapshot that could be stale by the time save ran — plus a
// getDoc()-then-batch race on the customer doc and every touched product,
// same defect class as the other 5H sites. Moved to a runTransaction that
// re-reads the order fresh: the diff baseline (originalItems, totalCents,
// amountPaidCents, status) all come from the transaction's own read, never
// from whatever the client had open. New item data (name/sku/qty/price/
// cost) stays client-supplied, same trust boundary as createAdminOrder.
interface AdminOrderItemInput2 {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export const updateAdminOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const rawItems: AdminOrderItemInput2[] = Array.isArray(data.items) ? data.items : [];
    const discountCents = Math.floor(Number(data.discountCents) || 0);
    const taxRatePercent = Number(data.taxRatePercent) || 0;
    const deliveryType: "delivery" | "pickup" = data.deliveryType === "pickup" ? "pickup" : "delivery";
    const customerNotes = (data.customerNotes || "").toString().slice(0, 2000) || null;
    const internalNotes = (data.internalNotes || "").toString().slice(0, 2000) || null;
    const expectedDeliveryDateMs = typeof data.expectedDeliveryDateMs === "number" ?
      data.expectedDeliveryDateMs :
      null;

    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Add at least one item");
    for (const it of rawItems) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.productId || qty <= 0) {
        throw new HttpsError("invalid-argument", "All items must have a quantity greater than 0");
      }
    }

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;
      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      // Matches the client-side load-time gate in loadOrderForEdit — only
      // 'confirmed' orders are editable via this form (narrower than the
      // general edit-window documented for order status elsewhere; this
      // migration preserves the existing gate as-is, not broaden it).
      if (order["status"] !== "confirmed") {
        throw new HttpsError("failed-precondition", "Only confirmed orders can be edited");
      }

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const customerRef = db.collection("customers").doc(order["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const newItems = rawItems.map((it) => {
        const qty = Math.floor(Number(it.quantity) || 0);
        const unitPriceCents = Math.floor(Number(it.unitPriceCents) || 0);
        const unitCostCents = Math.floor(Number(it.unitCostCents) || 0);
        return {
          productId: it.productId,
          productName: it.productName,
          productSku: it.productSku,
          quantity: qty,
          unitPriceCents,
          unitCostCents,
          lineTotalCents: qty * unitPriceCents,
          lineCostCents: qty * unitCostCents,
          currencyCode: "CAD",
        };
      });

      const originalItems: Array<Record<string, any>> = order["items"] || [];
      const originalMap = new Map(originalItems.map((it) => [it["productId"], it["quantity"] || 0]));
      const newMap = new Map(newItems.map((it) => [it.productId, it.quantity]));
      const allProductIds = new Set([...originalMap.keys(), ...newMap.keys()]);

      const productRefs = [...allProductIds].map((pid) => db.collection("products").doc(pid));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));
      const productSnapByPid = new Map([...allProductIds].map((pid, i) => [pid, productSnaps[i]]));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      const subtotalCents = newItems.reduce((sum, i) => sum + i.lineTotalCents, 0);
      const taxableCents = Math.max(0, subtotalCents - discountCents);
      const taxCents = Math.round(taxableCents * (taxRatePercent / 100));
      const totalCents = taxableCents + taxCents;
      const totalCostCents = newItems.reduce((sum, i) => sum + i.lineCostCents, 0);
      const totalDiff = totalCents - (order["totalCents"] || 0);

      tx.update(orderRef, {
        items: newItems,
        subtotalCents,
        taxRatePercent,
        taxCents,
        discountCents,
        totalCents,
        totalCostCents,
        marginCents: totalCents - totalCostCents,
        balanceCents: Math.max(0, totalCents - (order["amountPaidCents"] || 0)),
        deliveryType,
        customerNotes,
        internalNotes,
        expectedDeliveryDate: expectedDeliveryDateMs != null ? new Date(expectedDeliveryDateMs) : null,
        updatedAt: now,
        updatedBy: actionBy,
      });

      if (totalDiff !== 0 && customerSnap.exists) {
        const cd = customerSnap.data()!;
        tx.update(customerRef, {
          totalOrderedCents: Math.max(0, (cd["totalOrderedCents"] || 0) + totalDiff),
          totalOwingCents: Math.max(0, (cd["totalOwingCents"] || 0) + totalDiff),
        });
      }

      for (const productId of allProductIds) {
        const originalQty = originalMap.get(productId) || 0;
        const newQty = newMap.get(productId) || 0;
        const diff = newQty - originalQty;
        if (diff === 0) continue;

        const snap = productSnapByPid.get(productId)!;
        if (!snap.exists) continue;

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        // diff > 0: more ordered, deduct more. diff < 0: less ordered, restore some.
        const newStock = Math.max(0, currentStock - diff);
        tx.update(db.collection("products").doc(productId), {stock: newStock});

        const itemSnapshot = newItems.find((i) => i.productId === productId) ||
          originalItems.find((i) => i["productId"] === productId);

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId,
          productName: itemSnapshot?.["productName"] || productId,
          productSku: itemSnapshot?.["productSku"] || "",
          type: diff > 0 ? "sold" : "returned",
          quantity: -diff,
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} edited`,
          notes: `Quantity changed from ${originalQty} to ${newQty}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderId,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderId, orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

// ── cancelAdminOrder ─────────────────────────────────────────────────────
// Staff-only admin action (order-detail.component.ts confirmCancel()).
// Used to be a client writeBatch keyed off the order()/customer live-
// listener snapshots plus a getDoc-then-batch race on every touched
// product, same defect class as the other 5H sites. Moved to a
// runTransaction: order, customer, and every product read fresh. Named
// distinctly from the portal's own cancelOrder (self-service, confirmed-
// only, no reason-required UI) — this is the staff path, reachable from
// confirmed/preparing/out_for_delivery, matching the "Cancel Order"
// button's visibility in order-detail.component.html exactly.
export const cancelAdminOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const reason = (data.reason || "").toString().trim();
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (!reason) throw new HttpsError("invalid-argument", "Please provide a reason for cancellation");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;
      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (!["confirmed", "preparing", "out_for_delivery"].includes(order["status"])) {
        throw new HttpsError("failed-precondition", "This order can no longer be cancelled");
      }

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const customerRef = db.collection("customers").doc(order["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const items: Array<Record<string, any>> = order["items"] || [];
      const productRefs = items.map((it) => db.collection("products").doc(it["productId"]));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      tx.update(orderRef, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actionBy,
        cancellationReason: reason,
        balanceCents: 0,
      });

      if (customerSnap.exists) {
        const cd = customerSnap.data()!;
        const amountPaid = order["amountPaidCents"] || 0;
        const totalOrdered = (cd["totalOrderedCents"] || 0) - (order["totalCents"] || 0);
        const totalOwing = (cd["totalOwingCents"] || 0) - ((order["totalCents"] || 0) - amountPaid);

        const custUpdates: Record<string, unknown> = {
          totalOrderedCents: Math.max(0, totalOrdered),
          totalOwingCents: Math.max(0, totalOwing),
        };
        if (amountPaid > 0) {
          custUpdates["totalPaidCents"] = Math.max(0, (cd["totalPaidCents"] || 0) - amountPaid);
          custUpdates["creditBalanceCents"] = (cd["creditBalanceCents"] || 0) + amountPaid;
        }
        tx.update(customerRef, custUpdates);
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + (item["quantity"] || 0);

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: item["productId"],
          productName: item["productName"],
          productSku: item["productSku"],
          type: "returned",
          quantity: item["quantity"],
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} cancelled`,
          notes: `Cancellation reason: ${reason}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderId,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

// ── saveOrderQuantityEdits ───────────────────────────────────────────────
// Staff-only admin action (order-detail.component.ts saveOrderEdits()) —
// the inline quick-edit on the order detail page, distinct from
// updateAdminOrder (order-form's full edit form). This flow only ever
// REDUCES quantities on the order's existing lines (stock is already
// committed; a reduction returns the diff — see CLAUDE.md "Order
// editing"), never adds/removes lines or raises a quantity above what
// was ordered. It also has its own, broader status gate than
// updateAdminOrder (confirmed/preparing/out_for_delivery via
// canEditOrder(), not confirmed-only) — preserved as-is, not unified.
// Used to be a client writeBatch keyed off the order()/customer live-
// listener snapshots plus a getDoc-then-batch race on every touched
// product. Moved to a runTransaction re-reading everything fresh.
interface OrderQuantityEditInput {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export const saveOrderQuantityEdits = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const rawItems: OrderQuantityEditInput[] = Array.isArray(data.items) ? data.items : [];
    const discountCents = Math.floor(Number(data.discountCents) || 0);
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;
      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (!["confirmed", "preparing", "out_for_delivery"].includes(order["status"])) {
        throw new HttpsError("failed-precondition", "This order can no longer be edited");
      }

      const originalItems: Array<Record<string, any>> = order["items"] || [];
      const originalByPid = new Map(originalItems.map((it) => [it["productId"], it]));

      // This flow can only adjust existing lines — no adding/removing —
      // so the incoming set of productIds must exactly match the order's.
      const incomingPids = new Set(rawItems.map((it) => it.productId));
      const originalPids = new Set(originalByPid.keys());
      const setsMatch = incomingPids.size === originalPids.size &&
        [...incomingPids].every((pid) => originalPids.has(pid));
      if (rawItems.length === 0 || !setsMatch) {
        throw new HttpsError("invalid-argument", "Items must match the order's existing lines");
      }

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const customerRef = db.collection("customers").doc(order["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const productRefs = [...originalPids].map((pid) => db.collection("products").doc(pid));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));
      const productSnapByPid = new Map([...originalPids].map((pid, i) => [pid, productSnaps[i]]));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      // Reduce-only clamp, re-derived server-side rather than trusted from
      // the client — mirrors updateItemQuantity's client clamp exactly.
      const editedItems = rawItems.map((it) => {
        const original = originalByPid.get(it.productId)!;
        const originalQty = original["quantity"] || 0;
        const quantity = Math.max(1, Math.min(Math.floor(Number(it.quantity) || 0), originalQty));
        const unitPriceCents = Math.floor(Number(it.unitPriceCents) || 0);
        const unitCostCents = original["unitCostCents"] || 0;
        return {
          productId: it.productId,
          productName: original["productName"],
          productSku: original["productSku"],
          quantity,
          unitPriceCents,
          lineTotalCents: quantity * unitPriceCents,
          unitCostCents,
          lineCostCents: quantity * unitCostCents,
          currencyCode: "CAD",
        };
      });

      const subtotalCents = editedItems.reduce((sum, i) => sum + i.lineTotalCents, 0);
      const taxRatePercent = order["taxRatePercent"] || 0;
      const taxableCents = Math.max(0, subtotalCents - discountCents);
      const taxCents = Math.round(taxableCents * (taxRatePercent / 100));
      const totalCents = taxableCents + taxCents;
      const totalCostCents = editedItems.reduce((sum, i) => sum + i.lineCostCents, 0);
      const balanceCents = Math.max(0, totalCents - (order["amountPaidCents"] || 0));
      const totalDiff = totalCents - (order["totalCents"] || 0);

      tx.update(orderRef, {
        items: editedItems,
        subtotalCents,
        discountCents,
        taxCents,
        totalCents,
        balanceCents,
        totalCostCents,
        lastEditedAt: now,
        lastEditedBy: actionBy,
      });

      if (totalDiff !== 0 && customerSnap.exists) {
        const cd = customerSnap.data()!;
        tx.update(customerRef, {
          totalOrderedCents: Math.max(0, (cd["totalOrderedCents"] || 0) + totalDiff),
          totalOwingCents: Math.max(0, (cd["totalOwingCents"] || 0) + totalDiff),
        });
      }

      for (const editItem of editedItems) {
        const original = originalByPid.get(editItem.productId)!;
        const qtyDiff = (original["quantity"] || 0) - editItem.quantity;
        if (qtyDiff <= 0) continue; // only reductions restore stock

        const snap = productSnapByPid.get(editItem.productId)!;
        if (!snap.exists) continue;

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + qtyDiff;
        tx.update(db.collection("products").doc(editItem.productId), {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: editItem.productId,
          productName: editItem.productName,
          productSku: editItem.productSku,
          type: "adjustment",
          quantity: qtyDiff,
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} quantity reduced by ${qtyDiff}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderId,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderId, orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

// ── saveVisit ─────────────────────────────────────────────────────────
// Staff-only field-ops action (visit.service.ts saveVisit()). Used to be
// a client writeBatch with a getDoc-then-batch race per sample item, same
// defect class as the other 5H sites — lower urgency than the order/
// return/PO sites (single-user-initiated, not concurrent-admin-prone),
// but the same fix. shopName is now re-derived from a fresh read rather
// than trusted from the client, since it only ever fed an audit-trail
// reason string — cheap to make correct while already reading the shop
// doc to validate shopId exists.
interface VisitItemInput {
  productId?: string;
  productName: string;
  left?: number;
  found?: number;
  added?: number;
  isSample?: boolean;
  sampleQty?: number;
}

export const saveVisit = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const shopId = (data.shopId || "").toString();
    const rawItems: VisitItemInput[] = Array.isArray(data.items) ? data.items : [];
    const outcome = data.outcome ?? null;
    const managerAvailable = data.managerAvailable ?? null;
    const notes = data.notes ?? null;
    const markedConversion = data.markedConversion ?? false;
    const visitDateMs = typeof data.visitDateMs === "number" ? data.visitDateMs : Date.now();

    if (!shopId) throw new HttpsError("invalid-argument", "shopId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const shopRef = db.collection("shops").doc(shopId);
      const shopSnap = await tx.get(shopRef);
      if (!shopSnap.exists) throw new HttpsError("not-found", "Shop not found");
      const shop = shopSnap.data()!;
      const shopName = shop["name"] || "";

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      // Compute soldSinceLastVisit per item (left - found, floored at 0),
      // stripping undefined keys — matches the original client mapping.
      const items = rawItems.map((it) => {
        const sold = (it.left != null && it.found != null) ?
          Math.max(0, it.left - it.found) :
          undefined;
        const item: Record<string, unknown> = {...it, soldSinceLastVisit: sold};
        for (const key of Object.keys(item)) {
          if (item[key] === undefined) delete item[key];
        }
        return item;
      });

      const sampleItems = items.filter((it) =>
        it["isSample"] && it["productId"] && (it["sampleQty"] as number) > 0);
      const productRefs = sampleItems.map((it) => db.collection("products").doc(it["productId"] as string));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const visitDate = new Date(visitDateMs);
      const visitRef = db.collection("visits").doc();

      tx.set(visitRef, {
        shopId,
        visitDate,
        items,
        outcome,
        managerAvailable,
        notes,
        markedConversion,
        visitedBy: actionBy,
        tenantId: 1,
        createdAt: now,
        isDeleted: false,
      });

      tx.update(shopRef, {lastVisitDate: visitDate});

      for (let i = 0; i < sampleItems.length; i++) {
        const it = sampleItems[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;

        const sampleQty = it["sampleQty"] as number;
        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = Math.max(0, currentStock - sampleQty);

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: it["productId"],
          productName: it["productName"],
          productSku: p["sku"] || "",
          type: "sample",
          quantity: -sampleQty,
          previousStock: currentStock,
          newStock,
          reason: `Sample given at ${shopName}`,
          notes: sampleQty > currentStock ?
            `Sampled ${sampleQty}, stock was ${currentStock}` :
            null,
          linkedShopId: shopId,
          linkedVisitId: visitRef.id,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
        });
      }

      return {visitId: visitRef.id};
    });

    return result;
  }
);

// ── deleteVisit ───────────────────────────────────────────────────────
// Staff-only field-ops action (visit.service.ts deleteVisit()). Same
// getDoc-then-batch race per sample item as saveVisit, same fix. Also
// closes the same race for the delete path itself: the original code had
// no guard against a repeated/double delete call, so a double-click could
// double-reverse stock (soft-delete update — like every soft delete in
// this app, see FirestoreService.softDelete — would just silently
// re-stamp isDeletedAt/deletedBy, but the reversal loop underneath it had
// no such protection). Re-reading the visit fresh inside the transaction
// makes the already-deleted check free — a repeat call is now a no-op
// instead of a second reversal, matching this codebase's stated
// idempotency requirement for anything that could plausibly be invoked
// twice on the same data.
export const deleteVisit = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const visitId = (data.visitId || "").toString();
    const reverseStock = data.reverseStock === true;
    if (!visitId) throw new HttpsError("invalid-argument", "visitId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const visitRef = db.collection("visits").doc(visitId);
      const visitSnap = await tx.get(visitRef);
      if (!visitSnap.exists) throw new HttpsError("not-found", "Visit not found");
      const visit = visitSnap.data()!;

      if (visit["isDeleted"]) {
        // Already deleted — idempotent no-op, not a second reversal.
        return {shopId: visit["shopId"], alreadyDeleted: true};
      }

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const items: Array<Record<string, any>> = visit["items"] || [];
      const sampleItems = reverseStock ?
        items.filter((it) => it["isSample"] && it["productId"] && (it["sampleQty"] || 0) > 0) :
        [];
      const productRefs = sampleItems.map((it) => db.collection("products").doc(it["productId"]));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      tx.update(visitRef, {
        isDeleted: true,
        isDeletedAt: now,
        deletedBy: actionBy,
      });

      for (let i = 0; i < sampleItems.length; i++) {
        const it = sampleItems[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;

        const sampleQty = it["sampleQty"] as number;
        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + sampleQty;

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: it["productId"],
          productName: it["productName"],
          productSku: p["sku"] || "",
          type: "sample_reversal",
          quantity: sampleQty,
          previousStock: currentStock,
          newStock,
          reason: "Reversed sample from deleted visit",
          notes: null,
          linkedShopId: visit["shopId"],
          linkedVisitId: visitId,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
        });
      }

      return {shopId: visit["shopId"], alreadyDeleted: false};
    });

    return result;
  }
);

// ── saveStockAdjustment ──────────────────────────────────────────────────
// Staff-only admin action (stock-adjustment-modal.component.ts
// saveSingle()). This site had NO read at all before — previousStock came
// straight off a live-listener signal (this.product(), fed by a
// getDocument() subscription), which can be arbitrarily stale relative to
// the actual write with no fresh-read step whatsoever — a WIDER race
// window than the getDoc-then-batch sites elsewhere in 5H, not a
// narrower one (see the 2026-07-28 re-audit). This migration adds the
// read that never existed, rather than converting an existing one.
//
// Direction is re-derived server-side from `type` via the same
// ADJUSTMENT_TYPE_DIRECTION mapping the client uses (stock-adjustment.
// model.ts) — for fixed-direction types the client's direction is
// ignored entirely, only trusted for 'correction' (the one type marked
// 'either'). This blocks a tampered request from flipping the sign on a
// type that has no legitimate "which way" ambiguity.
//
// Unlike order/sample paths, this type of manual correction has never
// clamped-and-recorded-full on an oversell — the original client blocked
// the save entirely if the result would go negative (isValid()'s
// noNegativeStock check). That's preserved as a hard reject here, not
// loosened into a clamp.
const ADJUSTMENT_TYPE_DIRECTION: Record<string, "in" | "out" | "either"> = {
  received: "in",
  sold: "out",
  damaged: "out",
  returned: "in",
  correction: "either",
  transfer: "out",
  sample: "out",
  sample_reversal: "in",
  opening_balance: "in",
};

export const saveStockAdjustment = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const productId = (data.productId || "").toString();
    const type = (data.type || "").toString();
    const quantity = Math.floor(Number(data.quantity) || 0);
    const clientDirection = data.direction === "out" ? "out" : "in";
    const reason = (data.reason || "").toString().trim();
    const notes = (data.notes || "").toString().trim();

    if (!productId) throw new HttpsError("invalid-argument", "productId is required");
    if (!ADJUSTMENT_TYPE_DIRECTION[type]) throw new HttpsError("invalid-argument", "Invalid adjustment type");
    if (quantity <= 0) throw new HttpsError("invalid-argument", "Quantity must be at least 1");
    if (!reason) throw new HttpsError("invalid-argument", "Please provide a reason");

    const mappedDirection = ADJUSTMENT_TYPE_DIRECTION[type];
    const direction = mappedDirection === "either" ? clientDirection : mappedDirection;

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const productRef = db.collection("products").doc(productId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists) throw new HttpsError("not-found", "Product not found");
      const product = productSnap.data()!;
      if (product["isDeleted"]) throw new HttpsError("not-found", "Product not found");

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      const currentStock = product["stock"] || 0;
      const signedQty = direction === "in" ? quantity : -quantity;
      const newStock = currentStock + signedQty;
      if (newStock < 0) {
        throw new HttpsError("failed-precondition", "Cannot reduce stock below 0");
      }

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const adjRef = db.collection("stockAdjustments").doc();

      tx.set(adjRef, {
        productId,
        productName: product["name"] || "",
        productSku: product["sku"] || "",
        type,
        quantity: signedQty,
        previousStock: currentStock,
        newStock,
        reason,
        notes,
        adjustedBy: actionBy,
        createdAt: now,
        tenantId: 1,
        isDeleted: false,
      });

      tx.update(productRef, {stock: newStock, updatedAt: now});

      return {adjustmentId: adjRef.id, newStock};
    });

    return result;
  }
);

// ── saveStockAdjustments (multi-product) ─────────────────────────────────
// Staff-only admin action (stock-adjustment-modal.component.ts
// saveMulti()) — the multi-product variant of saveStockAdjustment, same
// migration reasoning: no read at all before (previousStock came off
// each item's captured allProducts() snapshot from add-time). One
// transaction spans every product in the batch — all-or-nothing, matching
// the original single writeBatch's atomicity. If ANY item would go
// negative, the WHOLE adjustment is rejected (not just that item),
// consistent with this being one save action, not N independent ones.
interface MultiStockAdjustmentItemInput {
  productId: string;
  quantity: number;
  direction: "in" | "out";
}

export const saveStockAdjustments = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const rawItems: MultiStockAdjustmentItemInput[] = Array.isArray(data.items) ? data.items : [];
    const type = (data.type || "").toString();
    const reason = (data.reason || "").toString().trim();
    const notes = (data.notes || "").toString().trim();

    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Add at least one product");
    if (!ADJUSTMENT_TYPE_DIRECTION[type]) throw new HttpsError("invalid-argument", "Invalid adjustment type");
    if (!reason) throw new HttpsError("invalid-argument", "Please provide a reason");
    for (const it of rawItems) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.productId || qty <= 0) {
        throw new HttpsError("invalid-argument", "Every item needs a quantity of at least 1");
      }
    }

    const mappedDirection = ADJUSTMENT_TYPE_DIRECTION[type];

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const productRefs = rawItems.map((it) => db.collection("products").doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      const userSnap = await tx.get(db.collection("users").doc(auth.uid));
      const userProfile = userSnap.exists ? userSnap.data()! : {};
      const actionBy = {
        uid: auth.uid,
        firstName: userProfile["firstName"] || "Staff",
        lastName: userProfile["lastName"] || "",
      };

      // Resolve every item before writing anything — an all-or-nothing
      // save, so any missing product or would-go-negative result rejects
      // the whole adjustment rather than partially applying it.
      const resolved = rawItems.map((it, i) => {
        const snap = productSnaps[i];
        if (!snap.exists) {
          throw new HttpsError("not-found", "One of the selected products no longer exists");
        }
        const product = snap.data()!;
        const direction = mappedDirection === "either" ?
          (it.direction === "out" ? "out" : "in") :
          mappedDirection;
        const qty = Math.floor(Number(it.quantity) || 0);
        const currentStock = product["stock"] || 0;
        const signedQty = direction === "in" ? qty : -qty;
        const newStock = currentStock + signedQty;
        if (newStock < 0) {
          throw new HttpsError(
            "failed-precondition",
            `${product["name"] || "A product"}: cannot reduce below 0`
          );
        }
        return {
          productId: it.productId,
          productName: product["name"] || "",
          productSku: product["sku"] || "",
          signedQty,
          currentStock,
          newStock,
        };
      });

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      for (const r of resolved) {
        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: r.productId,
          productName: r.productName,
          productSku: r.productSku,
          type,
          quantity: r.signedQty,
          previousStock: r.currentStock,
          newStock: r.newStock,
          reason,
          notes,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
        });

        tx.update(db.collection("products").doc(r.productId), {stock: r.newStock, updatedAt: now});
      }

      return {count: resolved.length};
    });

    return result;
  }
);
