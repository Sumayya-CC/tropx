// index.ts is now a pure re-export aggregator (Prompt 5, file split
// complete through phase 5.9) — every Cloud Function has moved to its own
// domains/*.ts file. isRateLimited is the one non-Cloud-Function export
// kept here (spec files import it via `from "./index"`; see below).
import {isRateLimited} from "./rate-limit";

// Phase 5 (file split) 5.1: `core.ts`/`rate-limit.ts`/`email-templates.ts`
// hold shared infra with zero exported Cloud Functions — index.ts imports
// what it still needs from them rather than `export *`-ing them, so their
// internals (db, secrets, STAFF_ROLES) don't leak into index's own
// namespace. `isRateLimited` is the one exception: it was already
// `export`ed from index.ts before the split (spec files import it via
// `from "./index"`), so it gets an explicit named re-export below to keep
// those imports resolving unchanged.
export {isRateLimited};

// Phase 5.2: reconciliation domain (customer counter recompute, real-time
// triggers, nightly/weekly sweeps) — moved to domains/reconciliation.ts.
// A plain `export *` is safe here: unlike core/rate-limit/email-templates,
// this file exports only Cloud Functions plus `recomputeCustomerCounters`
// (already publicly exported pre-split for recompute-idempotency.spec.ts).
export * from "./domains/reconciliation";

// Phase 5.3: shop health / pipeline-stuck / shop↔customer link
// reconciliation — moved to domains/shop-health.ts. Kept as one file, not
// three, because reconcileOneCustomer/reconcileOrphanShops and
// stampAllShopHealth both independently compute healthBand using the same
// banding helpers (computeCustomerBand/computeProspectBand/
// getHealthThresholds/daysSinceMs) — splitting further would duplicate
// those across files.
export * from "./domains/shop-health";

// Phase 5.4: auth lifecycle (welcome/password-reset/employee-invitation/
// auth-action triggers, plus requestPasswordReset) — moved to
// domains/auth-lifecycle.ts. Not contiguous with onContactInquiry, which
// stayed in index.ts (belongs to the notifications domain, phase 5.5).
export * from "./domains/auth-lifecycle";

// Phase 5.5: business-event notification triggers (order/return/access-
// request alerts, low-stock, back-in-stock, abandoned cart, portal order
// confirmation, payment receipt) — moved to domains/notifications.ts.
export * from "./domains/notifications";

// Phase 5.6: purchasing (onPoRequest, receivePurchaseOrder) and popular
// products (computePopularProducts + its scheduled/on-demand pair) — moved
// to domains/purchasing.ts and domains/popular-products.ts respectively.
// testSentryReporting (formerly here) was dropped, not migrated — its own
// code comment already called for its deletion once Sentry was verified,
// ahead of this exact split.
export * from "./domains/purchasing";
export * from "./domains/popular-products";

// Phase 5.8: orders/returns transactional group (placeOrder, cancelOrder,
// submitReturn, approveReturn, createAdminOrder, updateAdminOrder,
// cancelAdminOrder, saveOrderQuantityEdits) — moved to domains/orders.ts,
// after each was individually migrated onto staff-transactions-shared.ts's
// helpers (see commit history for phase 5.8.1-5.8.8, one function at a
// time, placeOrder last).
export * from "./domains/orders";

// Phase 5.9: field-ops transactional group (saveVisit, deleteVisit,
// saveStockAdjustment, saveStockAdjustments) — moved to
// domains/field-ops-transactions.ts, after adopting buildStaffActionBy
// (diffed against the already-extracted version first, per the plan's
// explicit pre-adoption check — confirmed byte-identical).
export * from "./domains/field-ops-transactions";

