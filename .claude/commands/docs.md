# /docs

Enforce the "Definition of Done" doc-coverage rule (CLAUDE.md). Given the current diff (default) or a named area (e.g. `/docs functions/src/index.ts`), report what must be documented, whether it already is, and reconcile anything now false.

## 1. Determine touched areas

- No argument: use the staged diff (or, if nothing staged, the working-tree diff against the merge-base with `master`).
- Named area: treat that path/glob as the touched area directly.

## 2. Consult `.claude/DOC-MAP.md`

For every touched file, match it against the table's path column. Multiple rows can match one file (e.g. a `functions/src/index.ts` change to a reconciliation function matches both the blanket `functions/src/**` row and the more specific reconciliation-logic row) — collect the union of doc cells.

If a touched path matches no row, say so explicitly rather than guessing a section — that's a DOC-MAP.md gap to flag, not something to paper over.

## 3. Check whether those docs actually changed

For each doc cell DOC-MAP.md names, check whether that file appears in the diff. Report per row:

- **Covered** — the doc file changed.
- **Missing** — the doc file did not change. This is the finding to surface; don't downgrade it because the code change "looks small."
- **N/A** — you determined (and state why) the row doesn't apply to this specific change, per the "Not in scope" carve-out in DOC-MAP.md.

## 4. Reconcile stale statements

Independent of what DOC-MAP.md maps, re-read the specific sections named (not the whole document) in CLAUDE.md, README.md, `docs/ARCHITECTURE.md`, `docs/SOFTWARE_ARCHITECTURE_DOCUMENT.md`, and any touched `.claude/agents/*.md` / `.claude/commands/*.md`, and check each claim in them against the current code:

- A stated behavior that the diff just changed (e.g. a doc says a function is unbatched and the diff just batched it).
- A stated invariant the diff now violates or extends.
- A named file, function, region, or collection that was renamed/removed/moved by the diff.

## 5. Flag contradictions BETWEEN docs, not just staleness within one

This is the check the other tools don't do. After step 4, compare the same fact across documents — CLAUDE.md, README.md, ARCHITECTURE.md, and SAD frequently describe the same thing (a region, a lifecycle, a decision) independently. Look specifically for:

- Two docs stating different values for the same fact (e.g. a region, a threshold, a status list, a role set).
- One doc claiming a capability exists (e.g. "Sentry is wired up," "rules are tested per role") that another doc's "Known Gaps" / "Not done in this pass" section says is absent.
- An ADR in SAD §13 that no longer matches the decision described in CLAUDE.md "Decisions We Made And Why" (or vice versa).
- A section in ARCHITECTURE.md and its counterpart in SAD (e.g. §6 Cloud Functions vs SAD §8.8) describing the same subsystem differently.

Report contradictions as `<doc A> §X says "..." but <doc B> §Y says "..."` — always quote both sides.

## Output

```
Touched areas: <list>
DOC-MAP rows matched: <list, or "none — DOC-MAP.md gap">

Coverage:
- [Covered/Missing/N/A] <doc> §<section> — <one-line why, if Missing or N/A>
  ...

Stale statements found:
- <doc> §<section>: "<quoted claim>" — no longer true because <reason>
  ...

Contradictions between docs:
- <doc A> §X: "<quote>"  vs  <doc B> §Y: "<quote>"
  ...
```

If nothing is stale and everything required is covered, say so in one line — don't pad with "looks good" filler.
