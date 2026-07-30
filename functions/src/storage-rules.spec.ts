import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {ref, uploadBytes, getBytes} from "firebase/storage";

/**
 * Phase 3.5 — Storage security rules, tested against the real rules file
 * via the Storage emulator's rules engine. Dedicated projectId, isolated
 * from every other functions/ spec file (see firestore-rules.spec.ts for
 * why: no shared fixtures, no id-collision class of problem at all).
 */

const BYTES = new Uint8Array([1, 2, 3]);

describe("storage.rules", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "tropx-rules-storage-test",
      storage: {
        host: "127.0.0.1",
        port: 9199,
        rules: fs.readFileSync(
          path.join(__dirname, "../../storage.rules"),
          "utf8",
        ),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearStorage();
  });

  function staffCtx(role: string, uidVal = "staff-1") {
    return testEnv.authenticatedContext(uidVal, {role});
  }

  function customerCtx(linkedCustomerId: string, uidVal = "cust-1") {
    return testEnv.authenticatedContext(uidVal, {
      role: "customer",
      linkedCustomerId,
    });
  }

  function anon() {
    return testEnv.unauthenticatedContext();
  }

  async function seed(storagePath: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), storagePath), BYTES);
    });
  }

  describe("public storefront-facing paths", () => {
    const paths = [
      "settings/logo.png",
      "products/p1/photo.jpg",
      "categories/c1/icon.png",
      "brands/b1/logo.png",
      "storefront/banner1.jpg",
      "content/showcase1.jpg",
    ];

    for (const p of paths) {
      it(`${p}: anyone can read`, async () => {
        await seed(p);
        await assertSucceeds(getBytes(ref(anon().storage(), p)));
      });

      it(`${p}: unauthenticated cannot write`, async () => {
        await assertFails(uploadBytes(ref(anon().storage(), p), BYTES));
      });

      it(`${p}: customer cannot write`, async () => {
        await assertFails(
          uploadBytes(ref(customerCtx("cust-1").storage(), p), BYTES),
        );
      });

      it(`${p}: staff can write`, async () => {
        await assertSucceeds(
          uploadBytes(ref(staffCtx("admin").storage(), p), BYTES),
        );
      });
    }
  });

  describe("customers/{customerId}/: staff full access, self-scoped for the owning customer", () => {
    it("a customer can read and write their own logo path", async () => {
      const storage = customerCtx("cust-1").storage();
      await assertSucceeds(
        uploadBytes(ref(storage, "customers/cust-1/logo.png"), BYTES),
      );
      await assertSucceeds(getBytes(ref(storage, "customers/cust-1/logo.png")));
    });

    // The named Phase 3.5 regression test: a customer must never be able
    // to write outside their own linkedCustomerId path segment.
    it("REGRESSION: a customer cannot write to another customer's storage path", async () => {
      await assertFails(
        uploadBytes(
          ref(customerCtx("cust-1").storage(), "customers/cust-2/logo.png"),
          BYTES,
        ),
      );
    });

    it("REGRESSION: a customer cannot read another customer's storage path", async () => {
      await seed("customers/cust-2/logo.png");
      await assertFails(
        getBytes(ref(customerCtx("cust-1").storage(), "customers/cust-2/logo.png")),
      );
    });

    it("staff can read/write any customer's logo path", async () => {
      const storage = staffCtx("admin").storage();
      await assertSucceeds(
        uploadBytes(ref(storage, "customers/cust-9/logo.png"), BYTES),
      );
      await assertSucceeds(getBytes(ref(storage, "customers/cust-9/logo.png")));
    });

    it("unauthenticated cannot read or write any customer's logo path", async () => {
      await seed("customers/cust-1/logo.png");
      await assertFails(
        getBytes(ref(anon().storage(), "customers/cust-1/logo.png")),
      );
      await assertFails(
        uploadBytes(ref(anon().storage(), "customers/cust-1/logo.png"), BYTES),
      );
    });
  });

  describe("userProfiles/{uid}/: staff read, self-write only", () => {
    it("a staff member can write their own avatar path", async () => {
      const storage = staffCtx("admin", "staff-1").storage();
      await assertSucceeds(
        uploadBytes(ref(storage, "userProfiles/staff-1/avatar.png"), BYTES),
      );
    });

    it("REGRESSION: a staff member cannot write another staff member's avatar path", async () => {
      await assertFails(
        uploadBytes(
          ref(staffCtx("admin", "staff-1").storage(), "userProfiles/staff-2/avatar.png"),
          BYTES,
        ),
      );
    });

    it("staff can read any avatar path", async () => {
      await seed("userProfiles/staff-2/avatar.png");
      await assertSucceeds(
        getBytes(
          ref(staffCtx("admin", "staff-1").storage(), "userProfiles/staff-2/avatar.png"),
        ),
      );
    });

    it("a customer cannot read or write any avatar path", async () => {
      await seed("userProfiles/staff-1/avatar.png");
      const storage = customerCtx("cust-1").storage();
      await assertFails(getBytes(ref(storage, "userProfiles/staff-1/avatar.png")));
      await assertFails(
        uploadBytes(ref(storage, "userProfiles/staff-1/avatar.png"), BYTES),
      );
    });
  });

  describe("expenses/receipts/: staff only, never public", () => {
    it("staff can read/write", async () => {
      const storage = staffCtx("admin").storage();
      await assertSucceeds(
        uploadBytes(ref(storage, "expenses/receipts/r1.pdf"), BYTES),
      );
      await assertSucceeds(getBytes(ref(storage, "expenses/receipts/r1.pdf")));
    });

    it("customer and unauthenticated cannot read or write", async () => {
      await seed("expenses/receipts/r1.pdf");
      for (const storage of [customerCtx("cust-1").storage(), anon().storage()]) {
        await assertFails(getBytes(ref(storage, "expenses/receipts/r1.pdf")));
        await assertFails(uploadBytes(ref(storage, "expenses/receipts/r1.pdf"), BYTES));
      }
    });
  });

  describe("fallback: unlisted path denies everyone, including staff", () => {
    it("staff cannot read or write an unlisted path", async () => {
      const storage = staffCtx("admin").storage();
      await assertFails(uploadBytes(ref(storage, "someFuturePath/file.bin"), BYTES));
    });

    it("customer and unauthenticated cannot read or write an unlisted path", async () => {
      await seed("someFuturePath/file.bin");
      for (const storage of [customerCtx("cust-1").storage(), anon().storage()]) {
        await assertFails(getBytes(ref(storage, "someFuturePath/file.bin")));
      }
    });
  });
});
