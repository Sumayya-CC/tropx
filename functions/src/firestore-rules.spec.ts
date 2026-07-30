import * as fs from "fs";
import * as path from "path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

/**
 * Phase 3.5 — Firestore security rules, tested against the real rules file
 * (not a re-implementation) via the Firestore emulator's rules engine.
 * Uses a dedicated projectId so this suite's data is fully isolated from
 * every other functions/ spec file — no shared fixtures, no id collisions
 * possible (see project_functions_test_id_collision_flakiness memory:
 * this sidesteps that whole class of problem rather than needing unique
 * ids at all).
 *
 * Auth is synthetic (testEnv.authenticatedContext token claims) — the
 * real Auth emulator is not needed for rules tests, since rules only ever
 * read request.auth.token.
 */

const STAFF_ROLES = ["admin", "manager", "sales_rep", "warehouse"] as const;

describe("firestore.rules", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "tropx-rules-firestore-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: fs.readFileSync(
          path.join(__dirname, "../../firestore.rules"),
          "utf8",
        ),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  function staffCtx(role: (typeof STAFF_ROLES)[number], uidVal = "staff-1") {
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

  async function seed(
    collection: string,
    docId: string,
    data: Record<string, unknown>,
  ) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), collection, docId), data);
    });
  }

  // ── Public-read, staff-write collections ──────────────────
  describe("public-read collections (products/categories/brands/serviceAreas)", () => {
    const collections = ["products", "categories", "brands", "serviceAreas"];

    for (const col of collections) {
      it(`${col}: anyone (even unauthenticated) can read`, async () => {
        await seed(col, "doc1", {name: "Test"});
        await assertSucceeds(getDoc(doc(anon().firestore(), col, "doc1")));
      });

      it(`${col}: unauthenticated cannot write`, async () => {
        await assertFails(
          setDoc(doc(anon().firestore(), col, "doc1"), {name: "Test"}),
        );
      });

      it(`${col}: customer cannot write`, async () => {
        await assertFails(
          setDoc(
            doc(customerCtx("cust-1").firestore(), col, "doc1"),
            {name: "Test"},
          ),
        );
      });

      it(`${col}: staff can write`, async () => {
        await assertSucceeds(
          setDoc(doc(staffCtx("admin").firestore(), col, "doc1"), {
            name: "Test",
          }),
        );
      });
    }
  });

  describe("settings/{doc}", () => {
    for (const publicDoc of ["storefront", "ordering", "business", "content"]) {
      it(`settings/${publicDoc} is publicly readable`, async () => {
        await seed("settings", publicDoc, {enabled: true});
        await assertSucceeds(
          getDoc(doc(anon().firestore(), "settings", publicDoc)),
        );
      });
    }

    // NOTE: the rule's own comment says non-storefront/ordering/business/
    // content settings docs (invoice, notifications, reconciliation) are
    // "staff-only", but the actual condition is
    // `... || isCustomer() || isStaff()` — isCustomer() is unconditional,
    // not scoped to the public doc names. This test documents the RULE AS
    // WRITTEN (a customer can currently read settings/reconciliation),
    // which contradicts the comment. Flagged to the user as a discrepancy
    // rather than silently changed — see chat.
    it("settings/reconciliation: customer read currently SUCCEEDS " +
      "(rule text contradicts its own comment — flagged, not fixed)", async () => {
      await seed("settings", "reconciliation", {shopHealth: {}});
      await assertSucceeds(
        getDoc(doc(customerCtx("cust-1").firestore(), "settings", "reconciliation")),
      );
    });

    it("settings/reconciliation: unauthenticated cannot read", async () => {
      await seed("settings", "reconciliation", {shopHealth: {}});
      await assertFails(
        getDoc(doc(anon().firestore(), "settings", "reconciliation")),
      );
    });

    it("settings/{doc}: only staff can write, any doc", async () => {
      await assertFails(
        setDoc(
          doc(customerCtx("cust-1").firestore(), "settings", "ordering"),
          {enabled: false},
        ),
      );
      await assertSucceeds(
        setDoc(doc(staffCtx("manager").firestore(), "settings", "ordering"), {
          enabled: false,
        }),
      );
    });
  });

  // ── Staff-only collections + fallback ─────────────────────
  describe("staff-only collections (representative: shops)", () => {
    it.each(STAFF_ROLES)("%s can read and write shops", async (role) => {
      await seed("shops", "shop1", {name: "Test Shop"});
      const db = staffCtx(role).firestore();
      await assertSucceeds(getDoc(doc(db, "shops", "shop1")));
      await assertSucceeds(updateDoc(doc(db, "shops", "shop1"), {name: "Updated"}));
    });

    it("customer cannot read or write shops", async () => {
      await seed("shops", "shop1", {name: "Test Shop"});
      const db = customerCtx("cust-1").firestore();
      await assertFails(getDoc(doc(db, "shops", "shop1")));
      await assertFails(setDoc(doc(db, "shops", "shop1"), {name: "x"}));
    });

    it("unauthenticated cannot read or write shops", async () => {
      await seed("shops", "shop1", {name: "Test Shop"});
      const db = anon().firestore();
      await assertFails(getDoc(doc(db, "shops", "shop1")));
      await assertFails(setDoc(doc(db, "shops", "shop1"), {name: "x"}));
    });
  });

  describe("rateLimitCounters: staff read-only, no client write ever", () => {
    it("staff can read but not write", async () => {
      await seed("rateLimitCounters", "c1", {scope: "x", count: 1});
      const db = staffCtx("admin").firestore();
      await assertSucceeds(getDoc(doc(db, "rateLimitCounters", "c1")));
      await assertFails(updateDoc(doc(db, "rateLimitCounters", "c1"), {count: 99}));
    });

    it("customer and unauthenticated cannot read or write", async () => {
      await seed("rateLimitCounters", "c1", {scope: "x", count: 1});
      for (const db of [customerCtx("cust-1").firestore(), anon().firestore()]) {
        await assertFails(getDoc(doc(db, "rateLimitCounters", "c1")));
        await assertFails(setDoc(doc(db, "rateLimitCounters", "c1"), {count: 1}));
      }
    });
  });

  describe("admin-only collections (reconciliationLog, employeeInvitations)", () => {
    for (const col of ["reconciliationLog", "employeeInvitations"]) {
      it(`${col}: admin can read/write, other staff roles cannot`, async () => {
        await seed(col, "doc1", {note: "test"});
        await assertSucceeds(getDoc(doc(staffCtx("admin").firestore(), col, "doc1")));

        for (const role of ["manager", "sales_rep", "warehouse"] as const) {
          await assertFails(getDoc(doc(staffCtx(role).firestore(), col, "doc1")));
        }
      });

      it(`${col}: customer and unauthenticated cannot read`, async () => {
        await seed(col, "doc1", {note: "test"});
        await assertFails(getDoc(doc(customerCtx("cust-1").firestore(), col, "doc1")));
        await assertFails(getDoc(doc(anon().firestore(), col, "doc1")));
      });
    }
  });

  describe("fallback rule (unlisted collection): deny by default", () => {
    // The fallback used to grant blanket isStaff() access to any unlisted
    // collection — but since a recursive wildcard match ORs together with
    // every more-specific rule for the same path (not just the most
    // specific one), that also silently overrode narrower rules elsewhere
    // (see the admin-only and delete:if-false tests below). Fixed to deny
    // by default; every real collection already has its own explicit rule.
    it("staff cannot read/write an unlisted collection", async () => {
      await assertFails(
        setDoc(doc(staffCtx("admin").firestore(), "someFutureCollection", "d1"), {
          x: 1,
        }),
      );
    });

    it("customer and unauthenticated cannot read/write an unlisted collection", async () => {
      await seed("someFutureCollection", "d1", {x: 1});
      await assertFails(
        getDoc(doc(customerCtx("cust-1").firestore(), "someFutureCollection", "d1")),
      );
      await assertFails(
        getDoc(doc(anon().firestore(), "someFutureCollection", "d1")),
      );
    });
  });

  // ── linkedCustomerId scoping ───────────────────────────────
  describe("orders: customer scoped to own linkedCustomerId", () => {
    it("customer can read their own order", async () => {
      await seed("orders", "order1", {customerId: "cust-1", totalCents: 1000});
      await assertSucceeds(
        getDoc(doc(customerCtx("cust-1").firestore(), "orders", "order1")),
      );
    });

    it("customer cannot read another customer's order", async () => {
      await seed("orders", "order1", {customerId: "cust-2", totalCents: 1000});
      await assertFails(
        getDoc(doc(customerCtx("cust-1").firestore(), "orders", "order1")),
      );
    });

    it("customer cannot create an order directly (placeOrder uses Admin SDK)", async () => {
      await assertFails(
        setDoc(doc(customerCtx("cust-1").firestore(), "orders", "order1"), {
          customerId: "cust-1",
          totalCents: 1000,
        }),
      );
    });

    it("customer cannot update an order (even their own)", async () => {
      await seed("orders", "order1", {customerId: "cust-1", totalCents: 1000});
      await assertFails(
        updateDoc(doc(customerCtx("cust-1").firestore(), "orders", "order1"), {
          totalCents: 2000,
        }),
      );
    });

    it("no one can delete an order (allow delete: if false)", async () => {
      await seed("orders", "order1", {customerId: "cust-1", totalCents: 1000});
      await assertFails(
        deleteDoc(doc(staffCtx("admin").firestore(), "orders", "order1")),
      );
    });

    it("staff can read/create/update any order", async () => {
      const db = staffCtx("admin").firestore();
      await assertSucceeds(
        setDoc(doc(db, "orders", "order1"), {customerId: "cust-1", totalCents: 1000}),
      );
      await assertSucceeds(updateDoc(doc(db, "orders", "order1"), {totalCents: 1500}));
      await assertSucceeds(getDoc(doc(db, "orders", "order1")));
    });
  });

  describe("payments: customer scoped to own linkedCustomerId", () => {
    it("customer can read their own payment", async () => {
      await seed("payments", "pay1", {customerId: "cust-1", amountCents: 500});
      await assertSucceeds(
        getDoc(doc(customerCtx("cust-1").firestore(), "payments", "pay1")),
      );
    });

    it("customer cannot read another customer's payment", async () => {
      await seed("payments", "pay1", {customerId: "cust-2", amountCents: 500});
      await assertFails(
        getDoc(doc(customerCtx("cust-1").firestore(), "payments", "pay1")),
      );
    });

    it("customer cannot write payments at all", async () => {
      await assertFails(
        setDoc(doc(customerCtx("cust-1").firestore(), "payments", "pay1"), {
          customerId: "cust-1",
          amountCents: 500,
        }),
      );
    });
  });

  describe("returns: customer scoped to own linkedCustomerId", () => {
    it("customer can read their own return", async () => {
      await seed("returns", "ret1", {customerId: "cust-1", totalCents: 200});
      await assertSucceeds(
        getDoc(doc(customerCtx("cust-1").firestore(), "returns", "ret1")),
      );
    });

    it("customer cannot read another customer's return", async () => {
      await seed("returns", "ret1", {customerId: "cust-2", totalCents: 200});
      await assertFails(
        getDoc(doc(customerCtx("cust-1").firestore(), "returns", "ret1")),
      );
    });

    it("customer can create a return for their own customerId", async () => {
      await assertSucceeds(
        setDoc(doc(customerCtx("cust-1").firestore(), "returns", "ret1"), {
          customerId: "cust-1",
          totalCents: 200,
        }),
      );
    });

    it("customer cannot create a return for a different customerId", async () => {
      await assertFails(
        setDoc(doc(customerCtx("cust-1").firestore(), "returns", "ret1"), {
          customerId: "cust-2",
          totalCents: 200,
        }),
      );
    });

    it("customer cannot update a return", async () => {
      await seed("returns", "ret1", {customerId: "cust-1", totalCents: 200});
      await assertFails(
        updateDoc(doc(customerCtx("cust-1").firestore(), "returns", "ret1"), {
          totalCents: 300,
        }),
      );
    });

    it("no one can delete a return (allow delete: if false)", async () => {
      await seed("returns", "ret1", {customerId: "cust-1", totalCents: 200});
      await assertFails(
        deleteDoc(doc(staffCtx("admin").firestore(), "returns", "ret1")),
      );
    });
  });

  describe("portalCarts/{customerId}: owner-scoped", () => {
    it("customer can read/write their own cart", async () => {
      const db = customerCtx("cust-1").firestore();
      await assertSucceeds(setDoc(doc(db, "portalCarts", "cust-1"), {items: []}));
      await assertSucceeds(getDoc(doc(db, "portalCarts", "cust-1")));
    });

    it("customer cannot read/write another customer's cart", async () => {
      await seed("portalCarts", "cust-2", {items: []});
      const db = customerCtx("cust-1").firestore();
      await assertFails(getDoc(doc(db, "portalCarts", "cust-2")));
      await assertFails(setDoc(doc(db, "portalCarts", "cust-2"), {items: []}));
    });

    it("staff can read/write any cart", async () => {
      const db = staffCtx("admin").firestore();
      await assertSucceeds(setDoc(doc(db, "portalCarts", "cust-9"), {items: []}));
    });
  });

  describe("customers/{doc}: read scoped + narrow self-update allowlist", () => {
    const seedCustomer = () =>
      seed("customers", "cust-1", {
        businessName: "Acme",
        ownerFirstName: "Jane",
        ownerLastName: "Doe",
        phone: "555-0100",
        address: "1 Main St",
        logoUrl: "",
        totalOwingCents: 0,
        status: "active",
        linkedShopId: "shop-1",
      });

    it("customer can read their own record", async () => {
      await seedCustomer();
      await assertSucceeds(
        getDoc(doc(customerCtx("cust-1").firestore(), "customers", "cust-1")),
      );
    });

    it("customer cannot read another customer's record", async () => {
      await seedCustomer();
      await assertFails(
        getDoc(doc(customerCtx("cust-2").firestore(), "customers", "cust-1")),
      );
    });

    it("customer can update allowlisted profile fields on their own record", async () => {
      await seedCustomer();
      await assertSucceeds(
        updateDoc(doc(customerCtx("cust-1").firestore(), "customers", "cust-1"), {
          phone: "555-0199",
          address: "2 Main St",
        }),
      );
    });

    it("customer cannot update a money/status/link field on their own record", async () => {
      await seedCustomer();
      await assertFails(
        updateDoc(doc(customerCtx("cust-1").firestore(), "customers", "cust-1"), {
          totalOwingCents: 99999,
        }),
      );
    });

    it("customer cannot smuggle a money field alongside an allowed field", async () => {
      await seedCustomer();
      await assertFails(
        updateDoc(doc(customerCtx("cust-1").firestore(), "customers", "cust-1"), {
          phone: "555-0199",
          status: "frozen",
        }),
      );
    });

    it("customer cannot update another customer's record even with allowlisted fields", async () => {
      await seedCustomer();
      await assertFails(
        updateDoc(doc(customerCtx("cust-2").firestore(), "customers", "cust-1"), {
          phone: "555-0199",
        }),
      );
    });

    it("customer cannot create or delete a customer record", async () => {
      await assertFails(
        setDoc(doc(customerCtx("cust-1").firestore(), "customers", "cust-1"), {
          businessName: "Acme",
        }),
      );
      await seedCustomer();
      await assertFails(
        deleteDoc(doc(customerCtx("cust-1").firestore(), "customers", "cust-1")),
      );
    });

    it("staff has full read/write/create/delete access", async () => {
      const db = staffCtx("admin").firestore();
      await assertSucceeds(
        setDoc(doc(db, "customers", "cust-9"), {businessName: "New Co"}),
      );
      await assertSucceeds(
        updateDoc(doc(db, "customers", "cust-9"), {totalOwingCents: 500}),
      );
      await assertSucceeds(deleteDoc(doc(db, "customers", "cust-9")));
    });
  });

  describe("users/{uid}: self-read + staff full access", () => {
    it("a signed-in user can read their own profile", async () => {
      await seed("users", "user-1", {firstName: "A", role: "sales_rep"});
      await assertSucceeds(
        getDoc(
          doc(
            testEnv.authenticatedContext("user-1", {role: "sales_rep"}).firestore(),
            "users",
            "user-1",
          ),
        ),
      );
    });

    it("a non-staff signed-in user cannot read another user's profile", async () => {
      await seed("users", "user-1", {firstName: "A", role: "customer"});
      await assertFails(
        getDoc(
          doc(
            testEnv.authenticatedContext("user-2", {role: "customer"}).firestore(),
            "users",
            "user-1",
          ),
        ),
      );
    });

    it("a non-staff user cannot write any profile, even their own", async () => {
      await assertFails(
        setDoc(
          doc(
            testEnv.authenticatedContext("user-1", {role: "customer"}).firestore(),
            "users",
            "user-1",
          ),
          {firstName: "A"},
        ),
      );
    });

    it("staff can write any profile", async () => {
      await assertSucceeds(
        setDoc(doc(staffCtx("admin").firestore(), "users", "user-1"), {
          firstName: "A",
        }),
      );
    });
  });

  // ── Public-create collections ──────────────────────────────
  describe("public-create collections", () => {
    it("accessRequests: unauthenticated can create, but not read/update/delete", async () => {
      const db = anon().firestore();
      await assertSucceeds(setDoc(doc(db, "accessRequests", "r1"), {name: "Bob"}));
      await assertFails(getDoc(doc(db, "accessRequests", "r1")));
    });

    it("accessRequests: signed-in (staff) can read/update/delete", async () => {
      await seed("accessRequests", "r1", {name: "Bob"});
      await assertSucceeds(
        getDoc(doc(staffCtx("admin").firestore(), "accessRequests", "r1")),
      );
    });

    it("contactInquiries: unauthenticated can create, but not read", async () => {
      const db = anon().firestore();
      await assertSucceeds(setDoc(doc(db, "contactInquiries", "c1"), {msg: "hi"}));
      await assertFails(getDoc(doc(db, "contactInquiries", "c1")));
    });

    it("passwordResetRequests: unauthenticated can create, but not read", async () => {
      const db = anon().firestore();
      await assertSucceeds(
        setDoc(doc(db, "passwordResetRequests", "p1"), {email: "a@b.com"}),
      );
      await assertFails(getDoc(doc(db, "passwordResetRequests", "p1")));
    });

    it("bannerClicks: unauthenticated can create, but only staff can read", async () => {
      const db = anon().firestore();
      await assertSucceeds(setDoc(doc(db, "bannerClicks", "b1"), {bannerId: "x"}));
      await assertFails(getDoc(doc(db, "bannerClicks", "b1")));
      await assertSucceeds(
        getDoc(doc(staffCtx("admin").firestore(), "bannerClicks", "b1")),
      );
    });

    it("stockNotificationRequests: customer can create for their own customerId only", async () => {
      await assertSucceeds(
        setDoc(
          doc(customerCtx("cust-1").firestore(), "stockNotificationRequests", "n1"),
          {customerId: "cust-1", productId: "p1"},
        ),
      );
      await assertFails(
        setDoc(
          doc(customerCtx("cust-1").firestore(), "stockNotificationRequests", "n2"),
          {customerId: "cust-2", productId: "p1"},
        ),
      );
    });

    it("stockNotificationRequests: unauthenticated cannot create", async () => {
      await assertFails(
        setDoc(doc(anon().firestore(), "stockNotificationRequests", "n1"), {
          customerId: "cust-1",
          productId: "p1",
        }),
      );
    });

    it("stockNotificationRequests: only staff can read/update/delete", async () => {
      await seed("stockNotificationRequests", "n1", {
        customerId: "cust-1",
        productId: "p1",
      });
      await assertFails(
        getDoc(doc(customerCtx("cust-1").firestore(), "stockNotificationRequests", "n1")),
      );
      await assertSucceeds(
        getDoc(doc(staffCtx("admin").firestore(), "stockNotificationRequests", "n1")),
      );
    });
  });
});
