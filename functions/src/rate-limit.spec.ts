import * as admin from "firebase-admin";
import {randomUUID, createHash} from "crypto";
import {FirestoreEvent, QueryDocumentSnapshot} from "firebase-functions/v2/firestore";
import {CallableRequest} from "firebase-functions/v2/https";
import {
  isRateLimited,
  onContactInquiry,
  onAccessRequestNotification,
  requestPasswordReset,
} from "./index";

/**
 * Phase 4 (security hardening) — rate limiting on the public-create
 * job-queue collections (contactInquiries/accessRequests) plus
 * requestPasswordReset, the callable front door for passwordResetRequests.
 * See the comment block above isRateLimited in index.ts for the full
 * design reasoning, including why passwordResetRequests specifically
 * cannot use the email-keyed trigger-gate pattern the other two scopes
 * use (an email-keyed limiter on password reset is a denial-of-service
 * against the account owner, since the attacker doesn't need to own the
 * victim's inbox to burn their limit) — requestPasswordReset rate-limits
 * by a hash of the caller's IP instead, a signal only a real onCall
 * request exposes.
 *
 * isRateLimited is tested directly (like recomputeCustomerCounters) for
 * the counter logic itself. The trigger-level wiring (does the handler
 * actually skip sending when rate-limited) is tested by calling the
 * exported CloudFunction's own `.run(event)` directly — the officially
 * documented way to unit test a v2 Cloud Function (see the doc comment
 * on `CloudFunction.run` in firebase-functions' core.d.ts: "Use `run` to
 * test a function"). This was originally written against the real
 * Functions-Emulator trigger-delivery path (create a doc, wait, assert),
 * matching notification-idempotency.spec.ts's style — but that pattern
 * only works because those tests assert a "never writes" invariant,
 * which holds regardless of how long the trigger takes to actually run.
 * These tests assert the opposite ("does write, eventually"), which is
 * inherently timing-dependent: confirmed flaky under full-suite parallel
 * load (19 other spec files' Jest workers competing for the same
 * Functions Emulator caused cold-start delivery latency past even a 20s
 * wait, though an isolated run of just this file was reliably fast).
 * `.run()` sidesteps that entirely — no emulator trigger delivery
 * involved, fully deterministic, and still exercises the real exported
 * handler code. The same `.run()` approach is used for requestPasswordReset
 * (a callable, not a trigger) so each test can supply its own fake
 * `rawRequest.ip` — a real Functions-emulator httpsCallable invocation
 * would give every test in this file the same loopback IP, making the
 * per-IP isolation this design relies on untestable in-process.
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

/**
 * Mirrors isRateLimited's internal key derivation so a test can seed (or
 * inspect) the exact counter document the function under test will use.
 * @param {string} scope Job-queue collection name.
 * @param {string} identifier The submitter's email.
 * @return {string} The sha256 hex doc id isRateLimited would compute.
 */
function counterKey(scope: string, identifier: string): string {
  return createHash("sha256")
    .update(`${scope}:${identifier.trim().toLowerCase()}`)
    .digest("hex");
}

/**
 * Builds a fake FirestoreEvent for onDocumentCreated by reading back a
 * real document snapshot — real data, real `.ref`, just not delivered
 * through the emulator's own trigger-detection pipeline. Good enough for
 * `CloudFunction.run()`, which only ever touches `event.data`.
 * @param {admin.firestore.DocumentReference} ref Document that was just
 *   created via the admin SDK.
 * @return {Promise<FirestoreEvent<QueryDocumentSnapshot | undefined>>} A
 *   fake event carrying that document's real snapshot.
 */
async function fakeCreateEvent(
  ref: admin.firestore.DocumentReference,
): Promise<FirestoreEvent<QueryDocumentSnapshot | undefined>> {
  const snap = await ref.get();
  return {
    data: snap as unknown as QueryDocumentSnapshot,
    id: uid("event"),
    source: "test",
    specversion: "1.0",
    time: new Date().toISOString(),
    type: "test",
    params: {},
  } as unknown as FirestoreEvent<QueryDocumentSnapshot | undefined>;
}

beforeAll(() => {
  const app = admin.initializeApp(
    {projectId: "tropx-wholesale-dev"},
    "rate-limit-spec-admin",
  );
  db = app.firestore();
  db.settings({host: `127.0.0.1:${FIRESTORE_PORT}`, ssl: false, databaseId: DATABASE_ID});
});

describe("isRateLimited — counter logic", () => {
  it("allows requests under the configured max, blocks at the limit", async () => {
    const email = `${uid("user")}@example.com`;
    await db.collection("settings").doc("rateLimits").set({
      contactInquiries: {maxPerWindow: 2, windowMinutes: 60},
    });

    expect(await isRateLimited("contactInquiries", email)).toBe(false); // 1st
    expect(await isRateLimited("contactInquiries", email)).toBe(false); // 2nd
    expect(await isRateLimited("contactInquiries", email)).toBe(true); // 3rd — over limit
  });

  it("keeps independent counters per identifier within the same scope", async () => {
    await db.collection("settings").doc("rateLimits").set({
      contactInquiries: {maxPerWindow: 1, windowMinutes: 60},
    });
    const emailA = `${uid("user")}@example.com`;
    const emailB = `${uid("user")}@example.com`;

    expect(await isRateLimited("contactInquiries", emailA)).toBe(false);
    expect(await isRateLimited("contactInquiries", emailA)).toBe(true); // A now over
    expect(await isRateLimited("contactInquiries", emailB)).toBe(false); // B unaffected
  });

  it("keeps independent counters per scope for the same identifier", async () => {
    await db.collection("settings").doc("rateLimits").set({
      contactInquiries: {maxPerWindow: 1, windowMinutes: 60},
      accessRequests: {maxPerWindow: 1, windowMinutes: 60},
    });
    const email = `${uid("user")}@example.com`;

    expect(await isRateLimited("contactInquiries", email)).toBe(false);
    expect(await isRateLimited("contactInquiries", email)).toBe(true); // this scope exhausted
    expect(await isRateLimited("accessRequests", email)).toBe(false); // different scope, fresh
  });

  it("kill switch: enabled: false never rate-limits, even past the max", async () => {
    const email = `${uid("user")}@example.com`;
    await db.collection("settings").doc("rateLimits").set({
      enabled: false,
      contactInquiries: {maxPerWindow: 1, windowMinutes: 60},
    });

    expect(await isRateLimited("contactInquiries", email)).toBe(false);
    expect(await isRateLimited("contactInquiries", email)).toBe(false);
    expect(await isRateLimited("contactInquiries", email)).toBe(false);
  });

  it("falls back to hardcoded defaults when settings/rateLimits doesn't override the scope", async () => {
    await db.collection("settings").doc("rateLimits").set({}); // no per-scope override at all
    const email = `${uid("user")}@example.com`;

    // Default for passwordResetRequests is maxPerWindow: 3 — 3 allowed, 4th blocked.
    expect(await isRateLimited("passwordResetRequests", email)).toBe(false);
    expect(await isRateLimited("passwordResetRequests", email)).toBe(false);
    expect(await isRateLimited("passwordResetRequests", email)).toBe(false);
    expect(await isRateLimited("passwordResetRequests", email)).toBe(true);
  });

  it("resets the counter once the window has expired", async () => {
    await db.collection("settings").doc("rateLimits").set({
      contactInquiries: {maxPerWindow: 1, windowMinutes: 60},
    });
    const email = `${uid("user")}@example.com`;

    expect(await isRateLimited("contactInquiries", email)).toBe(false);
    expect(await isRateLimited("contactInquiries", email)).toBe(true); // exhausted

    // Simulate the window having expired 2 hours ago (window is 60 min).
    const key = counterKey("contactInquiries", email);
    await db.collection("rateLimitCounters").doc(key).update({
      windowStart: admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
    });

    expect(await isRateLimited("contactInquiries", email)).toBe(false); // fresh window
  });
});

describe("requestPasswordReset — IP-keyed rate limiting at the front door", () => {
  function fakeCallableRequest(email: string, ip: string): CallableRequest<{email: string}> {
    return {
      data: {email},
      rawRequest: {ip} as unknown as CallableRequest<{email: string}>["rawRequest"],
      auth: undefined,
    } as CallableRequest<{email: string}>;
  }

  it("writes the request doc when the requester IP is under the limit", async () => {
    await db.collection("settings").doc("rateLimits").set({
      passwordResetRequests: {maxPerWindow: 1, windowMinutes: 60},
    });
    const ip = uid("ip");
    const email = `${uid("user")}@example.com`;

    const result = await requestPasswordReset.run(fakeCallableRequest(email, ip));

    expect(result).toEqual({success: true});
    const snap = await db.collection("passwordResetRequests").where("email", "==", email).get();
    expect(snap.size).toBe(1);
  });

  it("silently skips writing the request doc once the requester IP is over the limit", async () => {
    await db.collection("settings").doc("rateLimits").set({
      passwordResetRequests: {maxPerWindow: 1, windowMinutes: 60},
    });
    const ip = uid("ip");
    const firstEmail = `${uid("user")}@example.com`;
    const secondEmail = `${uid("user")}@example.com`;

    await requestPasswordReset.run(fakeCallableRequest(firstEmail, ip));
    const result = await requestPasswordReset.run(fakeCallableRequest(secondEmail, ip));

    // Still reports success — the response must not leak rate-limit state.
    expect(result).toEqual({success: true});
    const snap = await db.collection("passwordResetRequests").where("email", "==", secondEmail).get();
    expect(snap.empty).toBe(true);
  });

  it("does not let one requester IP exhaust another target email's limit (the victim-lockout fix)", async () => {
    await db.collection("settings").doc("rateLimits").set({
      passwordResetRequests: {maxPerWindow: 1, windowMinutes: 60},
    });
    const victimEmail = `${uid("victim")}@example.com`;
    const attackerIp = uid("ip");
    const victimIp = uid("ip");

    // Attacker burns their own IP's limit submitting the victim's email.
    await requestPasswordReset.run(fakeCallableRequest(victimEmail, attackerIp));
    const blocked = await requestPasswordReset.run(fakeCallableRequest(victimEmail, attackerIp));
    expect(blocked).toEqual({success: true});

    // The victim's own request, from their own IP, for their own email,
    // still goes through — it isn't keyed on the email at all.
    await requestPasswordReset.run(fakeCallableRequest(victimEmail, victimIp));

    const snap = await db.collection("passwordResetRequests").where("email", "==", victimEmail).get();
    expect(snap.size).toBe(2); // attacker's first (allowed) + victim's own
  });

  it("rejects a missing email with invalid-argument", async () => {
    await expect(
      requestPasswordReset.run(fakeCallableRequest("", uid("ip")))
    ).rejects.toThrow();
  });
});

describe("trigger wiring: rate-limited submissions skip the email, not the write", () => {
  it("onContactInquiry stamps rateLimited without sending, when already over the limit", async () => {
    const email = `${uid("user")}@example.com`;
    await db.collection("settings").doc("rateLimits").set({
      contactInquiries: {maxPerWindow: 1, windowMinutes: 60},
    });
    expect(await isRateLimited("contactInquiries", email)).toBe(false);

    const ref = db.collection("contactInquiries").doc(uid("inquiry"));
    await ref.set({
      name: "Test",
      email,
      phone: "555-0100",
      businessName: "Test Co",
      message: "hi",
      tenantId: 1,
    });
    await onContactInquiry.run(await fakeCreateEvent(ref));

    const after = (await ref.get()).data()!;
    expect(after["rateLimited"]).toBe(true);
    expect(after["notificationSentAt"]).toBeUndefined();
  });

  it("onAccessRequestNotification stamps rateLimited without sending, when already over the limit", async () => {
    const email = `${uid("user")}@example.com`;
    await db.collection("settings").doc("rateLimits").set({
      accessRequests: {maxPerWindow: 1, windowMinutes: 60},
    });
    expect(await isRateLimited("accessRequests", email)).toBe(false);

    const ref = db.collection("accessRequests").doc(uid("request"));
    await ref.set({
      businessName: "Test Co",
      ownerFirstName: "A",
      ownerLastName: "B",
      email,
      phone: "555-0100",
      businessType: "retail",
      address: "1 Main St",
      tenantId: 1,
    });
    await onAccessRequestNotification.run(await fakeCreateEvent(ref));

    const after = (await ref.get()).data()!;
    expect(after["rateLimited"]).toBe(true);
    expect(after["notificationSentAt"]).toBeUndefined();
  });
});
