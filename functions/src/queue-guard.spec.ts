import * as admin from "firebase-admin";
import {randomUUID} from "crypto";

/**
 * Phase 3.4 — idempotency, queue-consumer guard. Firestore-as-job-queue
 * triggers (see CLAUDE.md) must not re-execute their side effect if the
 * request doc somehow already has `processed: true` on it — e.g. a
 * redelivered/retried trigger event. Tested against the real deployed
 * onDocumentCreated trigger via the Functions emulator (not a direct
 * import — Firestore triggers only fire through the emulator's listener,
 * unlike the plain exported functions in the other Phase 3.4 specs).
 *
 * sendPasswordResetEmail (passwordResetRequests/{id}) is used here
 * because its guard is the first thing in the handler, before any
 * Firestore write or admin.firestore.FieldValue use — the earliest-return
 * queue guard in the file, and one with no FieldValue-in-emulator risk
 * for this specific (short-circuited) path.
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
    "queue-guard-spec-admin",
  );
  db = app.firestore();
  db.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
});

describe("sendPasswordResetEmail — queue-consumer guard", () => {
  it("does not attempt to process a request doc already marked processed", async () => {
    const requestId = uid("request");
    await db.collection("passwordResetRequests").doc(requestId).set({
      email: "already-processed@example.com",
      processed: true, // simulates a redelivered/retried trigger event
      tenantId: 1,
    });

    // No direct hook into "the trigger ran and returned early" — give the
    // emulator's trigger listener a window to fire, then assert neither
    // success (sentAt) nor failure (error) side effect was written. If the
    // guard were broken, the handler would reach either the success path
    // (event.data?.ref.update({processed:true, sentAt})) or the
    // generatePasswordResetLink failure path
    // (event.data?.ref.update({processed:true, error:true})) — both are
    // detectable even without a matching Auth user or a real email send.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const after = (await db.collection("passwordResetRequests").doc(requestId).get()).data()!;
    expect(after["sentAt"]).toBeUndefined();
    expect(after["error"]).toBeUndefined();
    expect(after["processed"]).toBe(true); // unchanged from what we seeded
  });
});
