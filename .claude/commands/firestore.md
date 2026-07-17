# /firestore

Review or design Firestore data access for the current change. This codebase's data model is shaped by 1000+ store, multi-tenant, multi-warehouse scale — the patterns below are load-bearing, not stylistic.

## The stamping pattern (denormalization)

- List- and dashboard-surfaced metrics are **stamped onto documents by background jobs**, then read as a plain field. Examples: shop `healthBand`/`healthDays`/`healthKind`, pipeline `stuck`/`daysInStage`, `hasShop`/`hasCustomer`, customer counters.
- A new metric that appears in a list follows this pattern: stamp in a sweep, read the field. **Never compute a metric per-row client-side across a paginated list** — it does not scale.
- Sweeps run nightly (incremental + weekly full); an on-demand callable exists for immediacy. Scheduled sweeps honor the enable toggle; manual refresh ignores it.

## Source of truth vs cache

- Orders and payments are authoritative. Customer `totalOwingCents`/`totalOrderedCents` are a denormalized cache that reconciliation recomputes and may correct or freeze per `settings/reconciliation` thresholds.
- Never treat a denormalized counter as truth when correctness matters — recompute from source.

## Idempotency

- The same recompute logic runs from both real-time triggers and scheduled sweeps. It must be safe to run repeatedly — running a sweep twice produces no change on the second pass. Verify this for any new stamping/recompute code.

## Query scale

- Browsable entity lists paginate with **indexed server-side queries** and a normalized `searchName` field. No client-side filtering of large collections. Any new browsable entity gets `searchName` + pagination from the start.
- Every query and write carries `tenantId`.

## Batches and invariants

- Multi-document invariants use `runBatch`: order + customer counters + stock adjustment; shop↔customer link (dual-side); sample + stock + adjustment; address / serviceAreaId / preferCoordinatesForNav sync across a link.
- A one-sided link write or a counter update split from its source change is a defect.

## Link symmetry

- `shop.linkedCustomerId` ↔ `customer.linkedShopId`, with `hasShop`/`hasCustomer` flags. `ShopLinkService` owns the dual-side batch. Visits are keyed on `shopId`, never `customerId` — this is what makes conversion migration-free. Do not add `customerId` to visits.

## Config location

- Scheduled-job config lives under `settings/reconciliation` (`.shopHealth`, `.pipeline`). Sequence config lives in `settings/*Sequence`. Put new scheduled-job config there rather than in new top-level docs.

## Regional / deploy notes

- Triggers/callables: `northamerica-northeast2`. Scheduled functions: `northamerica-northeast1` (Cloud Scheduler doesn't support northeast2).
- Functions resolve the database ID from `GCLOUD_PROJECT` at runtime — never hardcode `tropx-dev`/`tropx-prod`.

## Output

For a review: confirm the change respects stamping, idempotency, tenant scoping, batch invariants, and link symmetry; name any violation with its file. For a design: propose the field/stamp/sweep shape and where config lives.
