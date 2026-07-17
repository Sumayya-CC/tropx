# `.claude/` — Claude Code workflows for Tropx

This directory holds reusable slash-commands and specialized subagents for working on the Tropx wholesale platform. `CLAUDE.md` (repo root) is the always-loaded baseline; the files here are invoked on demand so the base context stays lean while deep workflows are one command away.

The platform is **multi-tenant, multi-warehouse infrastructure for a 1000+ store wholesale operation.** Nearly every non-obvious pattern (denormalized stamped fields, server-side sweeps, indexed pagination, idempotent recompute, integer-cents money, soft deletes, dual-side links) exists because of that scale. The commands and agents here enforce those patterns so the codebase stays consistent as it grows.

## Slash-commands (`commands/`)

Invoke with `/name`.

| Command | Use it to |
|---|---|
| `/review` | Review a diff as a senior engineer — minimal-change, pattern-preserving, invariant-enforcing. |
| `/test` | Design or review invariant-driven tests (money, stock, counters, links, idempotency). |
| `/security` | Audit rules, claims, function auth, and data-integrity gates. |
| `/firestore` | Review or design data access — stamping, denormalization, batches, scale. |
| `/release` | Run or review a release against the dev-before-prod / fileReplacements / IAM checklist. |
| `/audit` | Sweep the repo (or a module) for drift from the durable invariants. |

## Subagents (`agents/`)

Delegate deeper work to a specialist that carries the relevant conventions.

| Agent | Owns |
|---|---|
| `senior-reviewer` | Correctness, scale-safety, consistency with established patterns. |
| `test-engineer` | Invariant-driven tests, emulator/auth/rule testing, regression discipline. |
| `firestore-expert` | Data model, denormalization, stamping sweeps, batches, scale/consistency diagnosis. |
| `angular-expert` | Angular 20 conventions, browser-guarding, the recurring frontend pitfalls, UI language. |

## The invariants these enforce (quick reference)

- **Money:** integer cents end-to-end, never float; cents fields suffixed `...Cents`.
- **Deletes:** soft delete only; never hard-delete business data.
- **Stock:** clamp at `Math.max(0, ...)` on every path, but record the *full* amount in `stockAdjustments`; never write true negative stock.
- **Invariants:** multi-doc changes use `runBatch` (order+counters+stock, dual-side shop↔customer link, sample+stock+adjustment).
- **Scale:** stamp list/dashboard metrics via sweeps and read the field; paginate with indexed queries + `searchName`; every write/query carries `tenantId`.
- **Links:** `shop.linkedCustomerId` ↔ `customer.linkedShopId` are dual-side; visits are keyed on `shopId`, never `customerId`.
- **Idempotency:** recompute/stamp logic is safe to run twice (no change on the second pass).
- **Frontend:** `date.utils.ts` for date-only values; `toNum()` for numeric ngModel; per-card `editing` signals; browser-guard Leaflet; go through `FirestoreService`.
- **Deploy:** dev before prod; prod is single-line; `angular.json` production `fileReplacements` must be present; scheduled functions in `northamerica-northeast1`; DB id from `GCLOUD_PROJECT`.

## Conventions for maintaining this directory

- Keep these files to **durable** knowledge — patterns true for months, not in-flight work or temporary facts.
- When a new recurring bug or invariant is discovered, add it to the relevant command/agent *and* the quick-reference above.
- Preserve the terse, specific style. No generic software-engineering advice, no explaining Angular or Firebase — only what's specific to this codebase.
