import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {createHash} from "crypto";
import * as logger from "./logger";
import {db} from "./core";

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
// doesn't control. `requestPasswordReset` (onCall, in domains/auth-lifecycle.ts)
// is the front door for this collection instead of a direct client write: it
// rate-limits by a hash of `request.rawRequest.ip` — real requester signal an
// onDocumentCreated trigger structurally cannot see — before ever writing
// the request doc, then writes it itself via the Admin SDK. firestore.rules
// denies public `create` on this collection now that the callable is the
// only sanctioned writer.
export interface RateLimitConfig {
  maxPerWindow: number;
  windowMinutes: number;
}

export const RATE_LIMIT_DEFAULTS: Record<string, RateLimitConfig> = {
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
