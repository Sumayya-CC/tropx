# /review

Review the current change (staged diff, or the files named by the user) as a senior engineer who knows this codebase. This is multi-tenant, multi-warehouse infrastructure for a 1000+ store wholesale operation — review with that scale in mind.

## How to review

1. **Understand the change before judging it.** Read the actual files it touches, not just the diff hunk. If the change references a field, method, or service, confirm it exists rather than assuming.
2. **Prefer minimal, targeted edits.** Flag anything that full-replaces a file, rewrites working logic, or expands scope beyond what was asked.
3. **Do not endorse redesigns of working architecture** unless the user explicitly asked for one. If a refactor is tempting, explain the case first — don't silently bless it.
4. **UI/styling changes require an explicit request.** If a diff changes styling, spacing, colors, or markup structure without the user asking, flag it.

## What to check every time

- **Money:** integer cents end-to-end. Any float math on money, tax, discount %, or amounts is a defect. Cents fields must be `...Cents`; dollar conversion happens only at the display/input boundary.
- **Deletes:** soft delete only (`isDeleted`, `isDeletedAt`, `deletedBy`). A hard delete of business data is a defect.
- **Stock:** clamps at `Math.max(0, stock − qty)` on every path (orders, edits, samples). The *full* amount must still be recorded in `stockAdjustments` even when the counter clamps. Flag any path that could write true negative stock — it corrupts ATP and low-stock alerts.
- **Multi-doc invariants:** order + customer counters + stock adjustments; shop↔customer link; sample + stock + adjustment — all must be a single `runBatch`. Flag any invariant split across separate writes.
- **Tenant scoping:** every write and query carries `tenantId`. Flag any that don't.
- **Backward compat:** new model/settings fields are optional with `??` fallbacks so pre-existing documents keep working. Flag required new fields on existing collections.
- **Denormalization discipline:** new list/dashboard metrics are stamped by a sweep and read as a field — not computed per-row client-side. Flag per-row cross-loads in lists.
- **Link symmetry:** shop↔customer (and address / serviceAreaId / preferCoordinatesForNav sync) must update both sides in one batch. Flag one-sided link writes.
- **FirestoreService:** components go through the service wrappers, not raw `@angular/fire/firestore`.

## Cross-cutting consistency

If the change introduces a behavior that contradicts how the rest of the app works (e.g. one path writing negative stock while every other clamps, or a new settings card sharing an `editing` signal), **flag it and propose reconciliation** rather than approving the local version.

## Doc-drift check (every review)

Check the diff's touched files against `.claude/DOC-MAP.md`. For every matching row, confirm the doc(s) it names were updated in the same diff. If a mapped doc wasn't touched, that's a **finding** — file it as `docs`/`risk`, not a nit, worded as "docs not updated for touched area X" naming the exact DOC-MAP.md row and the doc/section it points to. It only drops out if the change genuinely falls under DOC-MAP.md's "Not in scope" carve-out (pure refactor, no behavior/schema/invariant change) — state that explicitly rather than silently skipping the check.

## Output

- Lead with a one-line verdict: approve / approve-with-nits / needs-changes.
- Group findings by severity (defect / risk / docs / nit).
- For each defect, name the exact file and line and the invariant it breaks.
- Keep nits short. Don't pad with generic praise.
