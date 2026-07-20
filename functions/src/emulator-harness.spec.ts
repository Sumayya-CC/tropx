import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

/**
 * Phase 3.0 — proves the Firestore emulator harness boots, a client can
 * connect and round-trip a document, and teardown is clean. This is
 * infrastructure-only: no business invariants are asserted here (that
 * starts in Phase 3.1). Run via `npm run test:emulator` (from the repo
 * root), which boots the emulators, runs this, and tears them down.
 */
describe("emulator harness", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "tropx-harness-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it("round-trips a document through the Firestore emulator", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const ref = db.collection("_harness_check").doc("ping");
      await ref.set({ok: true});
      const snap = await ref.get();
      expect(snap.data()).toEqual({ok: true});
    });
  });
});
