# /test

Design or review tests for the current change. Testing here is invariant-driven, not happy-path-driven. This is 1000+ store multi-tenant infrastructure — correctness of money, stock, and denormalized counters is what matters.

## What must always be tested

- **Money math** — tax (`(subtotal − discount) × rate`), discount (fixed and %), balance (`total − amountPaid`), reconciliation recompute. Assert **exact integer cents**, never approximate. Test the cents↔dollars boundary conversions explicitly.
- **Stock invariants** — clamp at zero while the adjustment records the full amount; `product.stock` **is** ATP as stored (decremented at order confirmation, not delivery — never subtract `committed`, which sums `confirmed` + `preparing` + `out_for_delivery` orders and is only used to reconstruct gross on-hand count); cancellation and return restoration; sample deduction.
- **Order editing** — reduce-only quantities, total recompute, customer counter adjustment in the same batch, lock at delivered/cancelled.
- **Link integrity** — shop↔customer dual-side writes; conversion preserves visit history (visits keyed on shopId survive the link).
- **Idempotency** — run any reconcile/stamp sweep **twice**; assert no change on the second pass.

## Edge cases to cover

- Sample qty exceeding current stock (records full amount, counter clamps to 0, warning not block).
- No-coordinate shops excluded from route math and surfaced as skipped.
- Discount exceeding subtotal (clamp, don't go negative).
- Pre-existing documents missing newly-added optional fields (must still read via `??` fallbacks).
- Order with zero remaining items after edits.

## Emulator usage

Anything touching Firestore rules, triggers, or batch/transaction behavior is tested against the emulators (`auth:9099`, `firestore:8080`, `storage:9199`). Do not mock away the rule layer for security-relevant tests.

## Authentication / rules testing

- Test each role claim (`admin`, `manager`, `sales_rep`, `warehouse`, `customer`) against the collections it should and shouldn't reach.
- Test the public-create collections (access requests, contact inquiries, password reset requests) unauthenticated.
- Test `linkedCustomerId`-scoped customer reads: a customer token reaches only its own data; verify the null-guard path for tokens minted before claims existed.

## Regression discipline

When a bug is fixed, add the test that would have caught it (the recurring ones: UTC date shift, ngModel string-into-number, negative stock, per-card editing signal bleed, dev config in prod build). These are the failures that recur — lock them down.

## Output

Produce the test cases (or review the existing ones) with clear names that state the invariant. Prefer a few sharp invariant tests over many shallow happy-path ones.
