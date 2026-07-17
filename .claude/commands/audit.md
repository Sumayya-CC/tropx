# /audit

Sweep the repository (or a named module) for drift from the project's durable invariants. This is a consistency audit, not a feature review — the goal is to catch places where the codebase contradicts its own rules as it grew.

## What to hunt for

**Money**
- Any float math on money, tax, discount, or amounts.
- Amount fields not suffixed `...Cents`, or dollar/cents conversion happening anywhere except the display/input boundary.

**Deletes**
- Any hard delete of business data. Everything is soft delete (`isDeleted`/`isDeletedAt`/`deletedBy`).

**Stock**
- Any path that can write true negative `product.stock` (must clamp at zero).
- Any stock change that clamps but fails to record the full amount in `stockAdjustments`.
- Any customer-reachable write to `products`/`stockAdjustments` outside the sanctioned function path.

**Denormalization / scale**
- List or dashboard code computing a metric per-row instead of reading a stamped field.
- Browsable entity lists filtering client-side instead of indexed server-side queries with `searchName`.
- Any query or write missing `tenantId`.

**Invariants / batches**
- Multi-doc invariants written as separate calls instead of `runBatch`.
- One-sided shop↔customer link writes, or address/serviceAreaId/preferCoordinatesForNav updated on one side only when linked.
- Visits keyed on anything other than `shopId`.

**Idempotency**
- Recompute/stamp logic that isn't safe to run twice.
- Queue-request handlers missing the `if (data.processed) return` guard.

**Angular / build**
- `new Date("YYYY-MM-DD")` on date-only values instead of `date.utils.ts` helpers.
- ngModel numeric inputs writing strings into numeric signals without `toNum()`.
- Settings cards sharing one `editing` signal instead of one per card.
- Browser-only libs (Leaflet) imported at module top level instead of guarded.
- Raw `@angular/fire/firestore` calls in components bypassing `FirestoreService`.

**Config**
- Hardcoded database IDs instead of `GCLOUD_PROJECT` resolution.
- Scheduled functions in `northamerica-northeast2`.
- New scheduled-job config outside `settings/reconciliation`.

## Output

Group findings by invariant. For each, list the offending files/lines and whether it's an active defect or latent risk. End with the top 3 worth fixing first. Do not propose redesigns — this audit reports drift, it doesn't re-architect.
