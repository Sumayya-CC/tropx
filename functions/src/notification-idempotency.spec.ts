import * as admin from "firebase-admin";
import {randomUUID} from "crypto";

/**
 * Phase 4 (security hardening) — idempotency guards on the reactive
 * notification triggers that hang off primary business documents (orders/
 * returns/payments/accessRequestApprovals), not a job-queue request doc.
 * Each stamps a narrow *SentAt/*NotificationSentFor marker on the same
 * document and checks it before sending, guarding against Cloud Functions'
 * at-least-once redelivery re-sending the same email — see the comment
 * block above onOrderNotification in index.ts for the full reasoning.
 *
 * There's no direct hook into "did resend.emails.send get called," so
 * these tests use a document's own `updateTime`: if the guard fires, the
 * handler returns before reaching its final `ref.update(...)` call, so the
 * document is never written again after the seed and updateTime stays
 * byte-identical. If the guard were broken, the handler would run through
 * to that update regardless of the marker's value, bumping updateTime —
 * detectable without needing to observe the email provider at all.
 *
 * Three representative shapes are covered rather than all nine guarded
 * functions, since the pattern is mechanically identical across the rest:
 * a simple onCreate marker (onOrderNotification), a per-value onUpdate
 * marker (onOrderStatusChanged), and a job-queue `processed` flag
 * (onAccessRequestApproved).
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
    "notification-idempotency-spec-admin",
  );
  db = app.firestore();
  db.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
});

describe("onOrderNotification — onCreate marker guard", () => {
  it("does not re-send when adminNotifiedAt is already set at creation", async () => {
    const orderId = uid("order");
    const ref = db.collection("orders").doc(orderId);
    await ref.set({
      orderNumber: `TRX-2026-${orderId.slice(-4)}`,
      customerName: "Test Business",
      source: "customer_portal",
      items: [],
      totalCents: 1000,
      // Simulates a redelivered onDocumentCreated event for a doc a prior
      // invocation already handled.
      adminNotifiedAt: admin.firestore.Timestamp.now(),
      tenantId: 1,
      isDeleted: false,
    });
    const seededUpdateTime = (await ref.get()).updateTime!;

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const after = await ref.get();
    expect(after.updateTime!.isEqual(seededUpdateTime)).toBe(true);
  });
});

describe("onOrderStatusChanged — per-status onUpdate marker guard", () => {
  it("does not re-send when lastStatusNotificationSentFor already matches the new status", async () => {
    const orderId = uid("order");
    const ref = db.collection("orders").doc(orderId);
    await ref.set({
      orderNumber: `TRX-2026-${orderId.slice(-4)}`,
      customerEmail: "test@example.com",
      status: "confirmed",
      items: [],
      totalCents: 1000,
      balanceCents: 1000,
      tenantId: 1,
      isDeleted: false,
    });

    // Transition to "delivered" while simultaneously pre-marking it as
    // already notified — simulates a redelivered onDocumentUpdated event
    // replaying the identical before/after pair a prior invocation
    // already handled.
    await ref.update({
      status: "delivered",
      lastStatusNotificationSentFor: "delivered",
    });
    const seededUpdateTime = (await ref.get()).updateTime!;

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const after = await ref.get();
    expect(after.updateTime!.isEqual(seededUpdateTime)).toBe(true);
  });
});

describe("onAccessRequestApproved — job-queue processed guard", () => {
  it("does not re-attempt account creation when the approval doc is already processed", async () => {
    const approvalId = uid("approval");
    const ref = db.collection("accessRequestApprovals").doc(approvalId);
    await ref.set({
      email: "already-processed@example.com",
      businessName: "Test Business",
      processed: true, // simulates a redelivered/retried trigger event
      tenantId: 1,
    });
    const seededUpdateTime = (await ref.get()).updateTime!;

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const after = await ref.get();
    expect(after.updateTime!.isEqual(seededUpdateTime)).toBe(true);
  });
});
