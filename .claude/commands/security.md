# /security

Audit the current change for security and data-integrity risk. Scope is Firestore rules, Cloud Function auth, custom claims, and the invariants that protect data at 1000+ store scale.

## Rules review

- Every collection access is scoped by `tenantId` and by role. Confirm new collections (bills, expenses, visits, shops, etc.) have rules — staff-only for internal field/finance data, no customer access.
- Customer data reads are scoped by the `linkedCustomerId` custom claim on the token. New customer-facing reads must enforce this. Keep null guards for tokens minted before the claim existed.
- Public-create collections (access requests, contact inquiries, password reset requests) allow unauthenticated create but nothing else — verify create-only, no read/update/delete leakage.

## Claims and tokens

- After any custom-claim change (`linkedCustomerId`, role), the client must force-refresh the token (`getIdToken(user, true)`). Flag flows that change claims without refresh.
- Never trust client-supplied identity fields; derive customer/tenant scoping from the token claim, not from request data.

## Cloud Function auth

- `placeOrder` (onCall) is the sanctioned path for portal order placement — it runs as a server-side transaction (re-reads price/stock, re-checks for oversell, then writes order+stock+adjustments atomically) and stamps `lastOrderAt`/counters. `firestore.rules` backs this up by requiring staff or a non-null `linkedCustomerId` claim on `products`/`stockAdjustments` writes — flag any new code that widens customer write access to inventory beyond that.
- Firestore-as-queue request docs must guard against reprocessing (`if (data.processed) return`) and validate the caller.

## Data-integrity gates (security-adjacent)

- Soft delete only — a hard delete of business data is a defect and a loss of audit trail.
- Money in integer cents; no float.
- Stock clamps at zero but the adjustment records the full amount — the audit trail must stay honest.
- Multi-doc invariants use `runBatch` — a partial write that leaves counters or links inconsistent is a security/integrity risk at scale.

## Child safety / content

Not applicable to this codebase's domain, but if any user-generated or public-facing content surface is added, confirm it can't be used to target or endanger minors before shipping.

## Output

Lead with a risk verdict. List each finding with the exact rule/function/file and the specific exposure. Distinguish "exploitable now" from "hardening." Do not hand-wave — name the path.
