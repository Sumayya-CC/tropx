# DOC-MAP — change → doc mapping

Mechanical lookup table: find the row(s) matching what you touched, update every doc cell listed, in the **same commit**. See CLAUDE.md → "Definition of Done". Used by `/docs` and `/review`.

Section references are exact headings that exist today in `docs/ARCHITECTURE.md` and `docs/SOFTWARE_ARCHITECTURE_DOCUMENT.md` (SAD) — if a heading below no longer exists, that's doc drift itself; fix the reference, don't invent a new section silently.

| Area touched | Docs to update |
|---|---|
| `functions/src/**` (triggers, callables, scheduled jobs in `index.ts`) | ARCHITECTURE.md §6 Cloud Functions (6.1 Reconciliation & stamping / 6.2 Transactional writes / 6.3 Email-notifications / 6.4 Guard pattern) · SAD §8.8 Cloud Function Interaction Map · SAD §8.9 Scheduled Jobs · SAD §16.1 Cloud Functions by region · CLAUDE.md "Cloud Functions" (`functions/src/index.ts`) + Development Rules → Cloud Functions |
| `firestore.rules` | ARCHITECTURE.md §7 Security Model · SAD §9 Security Architecture (9.1 Trust model / 9.2 Authorization mechanics / 9.3 historical bug) · CLAUDE.md "Firestore security rules" |
| `storage.rules` | ARCHITECTURE.md §7 Security Model · SAD §9.4 Storage rules · CLAUDE.md "Firestore security rules" (storage mirrors it — same section) |
| `src/app/core/models/**` | ARCHITECTURE.md §3 Data Model (pick sub-section: 3.1 Core commerce / 3.2 Field operations / 3.3 Purchasing & money-out / 3.5 Job-queue collections) · SAD §7 Data Architecture (7.1 ER Commerce & Field Ops / 7.2 ER Purchasing & Money-Out) · SAD §16.3 Firestore top-level collections |
| `src/app/core/models/storefront-settings.model.ts`, `core/services/settings.service.ts`, `settings/*` doc schema (business, invoice, notifications, storefront, reconciliation, ordering, sequences) | ARCHITECTURE.md §3.4 Settings (config-as-data) · CLAUDE.md "Naming / config conventions" |
| `angular.json`, `firebase.json`, `firebase.prod.json`, `.firebaserc`, `src/environments/**` | README.md §Environments · ARCHITECTURE.md §8 Operational Concerns · SAD §6.3 Environment separation · CLAUDE.md "Repository Memory (lessons learned)" if the change fixes/changes a footgun already documented there |
| `core/services/firestore.service.ts`, `core/services/auth.service.ts` | ARCHITECTURE.md §2 Architecture (2.2 Frontend structure) · CLAUDE.md "Data layer" |
| Shop↔Customer link logic (`ShopLinkService`, `shop.model.ts`/`customer.model.ts` link fields) | ARCHITECTURE.md §2.4 Data flow — shop↔customer link · §5.7 Visits keyed on shopId · SAD §8.3 Shop Lifecycle · SAD §13 ADR-001, ADR-002 |
| Reconciliation logic (`recomputeCustomerCounters`, `onOrderWriteReconcile`, `onPaymentWriteReconcile`, nightly/weekly sweeps) | ARCHITECTURE.md §6.1 Reconciliation & stamping · §5.8 Idempotent recompute · SAD §8.8 Cloud Function Interaction Map · SAD §7.3 Source of truth vs. cache |
| Shop health / pipeline stamping sweeps | ARCHITECTURE.md §2.5 Data flow — nightly stamping sweeps · §5.4 Denormalized/stamped fields · SAD §8.9 Scheduled Jobs · SAD §13 ADR-004 |
| Route optimization / navigation handoff (`geo.utils.ts`, route planner) | SAD §13 ADR-007, ADR-014 · ARCHITECTURE.md §4 Field-Operations Lifecycle |
| `placeOrder` / order confirm / cancel / return flow | ARCHITECTURE.md §2.3 Data flow — placing a portal order · §6.2 Transactional writes · SAD §8.2 Order Lifecycle · SAD §13 ADR-010 |
| Purchase orders / bills / expenses (Phase 6) | ARCHITECTURE.md §3.3 Purchasing & money-out · SAD §7.2 ER Purchasing & Money-Out · SAD §8.5 Purchase Order Lifecycle · SAD §13 ADR-006 |
| New Firestore composite indexes / a list moved to server-side pagination | ARCHITECTURE.md §3.6 Indexing reality vs. stated convention · SAD §7.4 Indexing reality vs. stated ambition |
| `.github/workflows/**` | README.md §CI |
| New invariant, convention, or recurring-mistake fix (anything you'd want future-you to not relearn) | CLAUDE.md (Development Rules → Always/Never, Business Logic, Safety Rules, Recurring Mistakes) · ARCHITECTURE.md §5 Invariants and Why They Exist · relevant `.claude/agents/*.md` + `.claude/commands/*.md` if it changes what those enforce |
| New architectural decision, or reversal of an existing one | CLAUDE.md "Decisions We Made And Why" · SAD §13 Architecture Decision Records (add/amend the ADR) |
| New/changed role or permission (`AuthService.ROLE_PERMISSIONS`, `roleGuard`) | CLAUDE.md App structure (roles list) · SAD §16.2 Role → permission surface · ARCHITECTURE.md §7 Security Model |
| New public-facing feature (admin/portal/public route) | README.md §Features (pick sub-section: Public Website & CMS / Storefront & Customer Portal / Administration / Field Operations Suite) |
| Test coverage added/removed for an invariant (money, stock, links, idempotency) | README.md §CI "Coverage so far" paragraph · CLAUDE.md "Testing" |
| Deploy/release steps, IAM grants, first-deploy gotchas | README.md §Workflow / §Production Deploy · CLAUDE.md "Repository Memory (lessons learned)" |

## Not in scope for this table

Pure refactors with no behavior, schema, invariant, or workflow change (renames, dead-code removal, formatting) touch no doc — don't force an edit. `/docs` and `/review` should treat "no doc change" as correct in that case, not as neglect.
