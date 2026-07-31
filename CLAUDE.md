# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tropx is a B2B wholesale platform: an Angular 20 SPA (admin back-office + customer portal + public marketing pages) on Firebase (Firestore, Auth, Storage, Cloud Functions, Hosting). Single-tenant today but data is tenant-scoped (`tenantId: 1` via `CURRENT_TENANT` in `src/app/core/config/tenant.config.ts`) in anticipation of multi-tenant later — always write/query with `tenantId` included.

## Why This Codebase Is Shaped The Way It Is

This is multi-tenant, multi-warehouse infrastructure for a 1000+ store wholesale operation. Almost every non-obvious pattern here exists because of that scale — treat these as load-bearing, not stylistic:

- **Denormalized counters and stamped fields are deliberate, not lazy.** Customer balances, shop `healthBand`/`healthDays`, pipeline `stuck` flags, `hasShop`/`hasCustomer` — all stamped onto documents by background jobs so list/dashboard reads are a single indexed query with zero per-row cross-loads. At 1000+ stores, computing these per-row client-side is not an option. When adding a new list-surfaced metric, follow this: stamp it in a sweep, read the field. Do not add a client-side compute-per-row.
- **The source of truth vs the denormalized copy are different things.** Orders and payments are authoritative; the customer's `totalOwingCents`/`totalOrderedCents` are a cache that reconciliation recomputes and can correct or freeze. Never treat a denormalized counter as truth — recompute from source when correctness matters.
- **`searchName` normalized fields + server-side pagination are the target convention because client-side filtering does not scale.** This is proven on `visits` (composite index + tenantId/shopId/isDeleted/visitDate). Some existing lists (e.g. customers, orders) still sort/filter in memory — that's accumulated debt, not the intended pattern. Any *new* browsable entity list should follow the indexed/paginated pattern from day one, not "later when it's slow."
- **Idempotency is a requirement, not a nice-to-have,** because the same recompute logic is invoked by both real-time triggers and scheduled sweeps. Anything a sweep touches must be safe to run twice with no change on the second pass.

## Decisions We Made And Why (and what we rejected)

- **Shop as a first-class entity, separate from Customer** — chosen so prospects can accumulate visit history before they have an account, and so conversion needs zero data migration (the shop persists, gains a link). Rejected: tying visits to customers (would have blocked prospect tracking and made conversion a migration).
- **Visits keyed on `shopId`, never `customerId`** — same reason. This is the single decision that makes the whole prospect→customer lifecycle seamless. Do not "improve" it by adding a customerId to visits.
- **`pipelineHistory` as a bounded array on the shop doc, not a subcollection** — a prospect goes through a handful of stage changes total; an array reads in one shot and powers the timeline + avg-convert KPI. A subcollection would add cross-loads for no benefit. Rejected explicitly.
- **Stamp health/pipeline nightly (server-side) rather than compute live** — chosen for national scale and consistency. Manual "Refresh Now" callables exist for immediacy and ignore the enable-toggle; scheduled sweeps honor it.
- **Vendor-neutral payment fields over Stripe-specific ones** — chosen to avoid processor lock-in before any processor was integrated. Rejected Stripe-named fields.
- **Zoho Books stays the official ledger; the portal tracks operations** — chosen deliberately; the portal is NOT the accounting system today. Bills/expenses are operational tracking. Rejected: making the portal do double-entry accounting now. (The long-term goal is self-sufficiency, but official invoice numbering + HST returns are the hard last mile, treated as a separate future track.)
- **Route optimization client-side (nearest-neighbor + 2-opt); navigation handed to Google Maps** — chosen because optimization is unlimited and free in-app, while Google's consumer nav caps at ~9 waypoints. Hence the chunked-legs handoff. Rejected: paid Google optimization APIs. Infill proximity ships as "within cluster radius of a route's shops" (honest, simple) — the true "extra driving added" (re-optimize-with-insertion) was explicitly deferred as a geometry rabbit hole; do not silently upgrade the label to imply added-driving.
- **Leaflet + OpenStreetMap over Google Maps for display** — chosen for zero cost/no API key; Google is used only for the free nav handoff.

## Workflow We Follow

- Changes are delivered as **sequenced, independently-verifiable prompts** (A/B/C), each with exact file paths and before/after blocks, run in Cursor and reported back via diff. A single prompt never full-replaces a file it edited earlier in the same session — only surgical edits.
- **Dev is always deployed and verified before prod. Prod deploy is single-line only.** Feature work happens on branches; master merges are prod-ready only, because master auto-deploys to the live site.
- Commit messages are multi-line: a concise subject, then a structured body covering all changes in the session — neither terse nor bloated.
- Communication is terse and direct; intent is interpreted broadly; a mid-session correction is authoritative and overrides earlier instructions in the same session.

## Review Behaviour
- Prefer minimal, targeted edits. Never full-replace a file that was modified earlier in the same session — make surgical `str_replace`-style edits.
- Explain before refactoring; do not redesign working architecture unprompted.
- Do not change UI/styling unless asked. Preserve the established design language: one accent (navy `#0a2d4a`), generous spacing, heavy/chunky numerals for prices and quantities, pill-shaped status badges, restrained formatting (Apple.com / Voila.ca references).
- Preserve backward compatibility: new settings/model fields are optional with `??` fallbacks so pre-existing Firestore docs keep working.
- Match existing patterns (config-driven labels, signal-based state, `FirestoreService` wrappers, per-card editing signals) rather than introducing new ones. Inspect the actual file before assuming field/method names.
- Deliver code changes as sequenced, independently-verifiable prompts (labeled A/B/C) with exact paths and before/after blocks; dev is always deployed/verified before prod; prod deploy is single-line only.
- New model/settings fields are optional with `??` fallbacks so pre-existing documents keep working — backward compatibility is not negotiable at this scale.
- When a request would create a cross-cutting inconsistency (e.g. one code path writing negative stock while every other clamps), flag it and reconcile rather than implementing it locally.

## Definition of Done

A change is not complete until the docs it's mapped to in `.claude/DOC-MAP.md` are updated **in the same commit** — not a follow-up, not a "will document later." Docs have gone stale from exactly that deferral before. Concretely:

- Before calling a change finished, check `.claude/DOC-MAP.md` for every area you touched and update the doc cells it lists (CLAUDE.md, README.md, `docs/ARCHITECTURE.md`, `docs/SOFTWARE_ARCHITECTURE_DOCUMENT.md`, `.claude/agents/*`, `.claude/commands/*` — whichever the row names).
- If a row genuinely doesn't apply (pure refactor, no behavior/schema/invariant change), that's a valid outcome — but it's a judgment you made against the table, not an omission.
- Run `/docs` before treating a change as done when it touches anything in DOC-MAP.md — it checks doc coverage for you and flags contradictions it finds between docs.
- `/review` treats "docs not updated for a touched area" as a finding, not a nit.

## Testing Philosophy

- Money math and cents↔display conversions are the highest-value tests — assert exact integer cents, never approximate.
- Invariants over happy paths: stock clamps at zero while the adjustment records the full amount; `stock` is already ATP (no subtraction — see Domain terminology below); cancellation/return restoration; dual-side shop↔customer link integrity; conversion preserving visit history.
- Anything touching rules, triggers, or batches is tested against the emulators; idempotency is verified by running a sweep twice and asserting no change on the second pass.
- Rules are tested per role claim and for the public-create collections.

## UX Philosophy

- One accent (navy `#0a2d4a`), generous spacing, heavy/chunky numerals for prices and quantities, pill-shaped status badges, restrained formatting (Apple.com / Voila.ca as references). New surfaces match this rather than inventing their own visual language.
- Field-facing surfaces are built for real conditions: fast entry, sensible auto-fills (visit "Left" prefilled from last visit), non-blocking warnings over hard blocks where field reality may diverge from records, thumb-friendly layouts for in-vehicle use. Never block a legitimate field action over a data-count mismatch — warn, record honestly, move on.## Architecture

### App structure
- `src/app/core/` — singletons: services (`providedIn: 'root'`), route guards, Firestore-backed models, and `config/` (static lookup tables — roles, statuses, currency, tenant).
- `src/app/features/` — three route trees, each with its own shell/layout component:
  - `public/` — unauthenticated marketing pages (home, login, request-access, forgot-password).
  - `portal/` — customer-facing app, gated by `PortalAuthGuard`, nested under `portal-shell`.
  - `admin/` — staff back-office, gated by `authGuard` + `roleGuard` (`data: { roles: [...] }` per route), nested under `admin-shell`. One folder per domain (orders, products, customers, purchase-orders, shops, etc.), each typically with `*-form`, `*-detail`, and modal subfolders alongside the list component.
- `src/app/shared/` — reusable components, directives, pipes, and pure utils (`currency.utils.ts` works in integer **cents**, `date.utils.ts`, `geo.utils.ts`, etc.). No feature-specific logic lives here.
- All components are standalone (no NgModules); routes are defined in `src/app/app.routes.ts` with `loadComponent()` lazy imports throughout — follow this pattern for any new route rather than eager-importing.
- The app uses zoneless change detection (`provideZonelessChangeDetection()` in `app.config.ts`) — state is driven by Angular `signal()`/`computed()`/`effect()`, not manual `ChangeDetectorRef` calls. `toSignal`/`toObservable` bridge to RxJS (mainly for Firestore streams and guards).

### Data layer
- `FirestoreService` (`core/services/firestore.service.ts`) wraps `@angular/fire/firestore` with generic `getDocument<T>`, `getCollection<T>`, `addDocument`, `setDocument`, `updateDocument`, `softDelete`, `runBatch`. Prefer these over calling `@angular/fire/firestore` functions directly in components.
- **Soft delete only** — `softDelete()` sets `isDeleted`/`deletedAt`/`deletedBy` instead of removing documents, to preserve audit trails and avoid dangling references (orders → customers, etc.). Hard delete is intentionally unavailable.
- Money is always stored/passed as **integer cents** (`totalCents`, `balanceCents`, …), converted for display via `centsToDisplay()` / `displayToCents()` in `shared/utils/currency.utils.ts`. Never do currency math in floats.
- `AuthService` (`core/services/auth.service.ts`) holds Firebase Auth state and the mirrored Firestore `users/{uid}` profile as signals (`currentUser`, `currentProfile`, `role`, `isAdmin`, `isStaff`). Role-based permission checks go through `hasPermission()` against the `ROLE_PERMISSIONS` map in that file, not ad-hoc role string comparisons.
- Roles: `admin`, `manager`, `sales_rep`, `warehouse` (collectively "staff"), and `customer` (portal). Route-level access is enforced by `roleGuard` reading `route.data['roles']`; UI-level access by `AuthService.hasPermission()` / the `hasPermission` directive.

### Cloud Functions (`functions/src/index.ts`)
A single large file (Gen2, `firebase-functions/v2`). Key patterns:
- **Firestore-as-job-queue**: writing a document to certain collections (e.g. `passwordResetRequests`, notification/email request collections) is how the client triggers server-side work — an `onDocumentCreated` trigger picks it up and sends email via Resend, rather than calling an HTTPS endpoint directly.
- **Reconciliation**: `onOrderWriteReconcile` / `onPaymentWriteReconcile` (real-time) plus `nightlyReconcileSweep` / `weeklyReconcileSweep` (scheduled) recompute denormalized customer counters (`totalOwingCents`, `totalOrderedCents`, `totalPaidCents`) from source-of-truth orders/payments and auto-correct or freeze based on thresholds in `settings/reconciliation` — same recompute logic (`recomputeCustomerCounters`) is shared by both paths so it stays idempotent.
- Other scheduled/on-call jobs follow similar naming: `nightly*`/`weekly*` for scheduled sweeps, `on*` for Firestore triggers, plain camelCase `onCall` functions for client-invoked RPCs (e.g. `placeOrder`, `refreshShopHealthNow`).
- The active Firestore **database ID** (`tropx-dev` vs `tropx-prod`) is resolved at runtime from `GCLOUD_PROJECT`, not from environment config — see the top of `functions/src/index.ts`.
- Functions region is `northamerica-northeast2` (set explicitly in `app.config.ts` via `getFunctions(app, ...)` — must match wherever functions are deployed).

### Firestore security rules (`firestore.rules`)
- Custom-claim based: `role()` reads `request.auth.token.role` (a custom claim, not the Firestore profile doc) via helpers `isSignedIn()`, `isAdmin()`, `isStaff()`, `isCustomer()`. When adding a new collection, follow the existing `isStaff()`/`isAdmin()`/scoped-to-own-doc pattern rather than inventing new access logic.
- A few collections allow unauthenticated `create` (e.g. `accessRequests`) to support public-facing forms (request access, contact) — read/update/delete still requires the appropriate role.
- `customers/{doc}`: staff have full access; a customer may `update` their **own** record (scoped by `linkedCustomerId` claim) but only through a narrow field allowlist (`businessName`, `ownerFirstName`, `ownerLastName`, `phone`, `address`, `logoUrl` — self-service profile fields only). Money/status/link fields (`totalOwingCents`, `status`, `linkedShopId`, etc.) stay staff-only even on the customer's own doc; `create`/`delete` are staff-only. Follow this allowlist pattern (`request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`) for any future customer self-edit capability rather than opening full document write access.
- Storage rules (`storage.rules`) mirror this: deny-by-default per path, with public read + staff-write for storefront-facing assets (`settings/`, `products/`, `categories/`, `brands/`, `storefront/`, `content/`), staff-or-self write for a customer's own logo (`customers/{customerId}/`) and a staff member's own avatar (`userProfiles/{uid}/`), and staff-only for `expenses/receipts/`. Any change to `storage.rules` prompted by a permission-denied error must add a scoped rule for that specific path — never widen the fallback or use a bare `allow write: if request.auth != null`, which erases the staff/customer boundary for every path at once.
- `firestore.rules`'s own catch-all fallback (`match /{document=**}`) must stay `allow read, write: if false` — the same reasoning as the storage-rules bullet above, but it was actually violated here until Phase 3.5 (2026-07-30). Firestore evaluates every `match` block whose path applies to a request and grants access if *any* of them allows it (recursive wildcards match at every depth, not just "if nothing more specific matched"). A fallback written as `if isStaff()` doesn't just gate unlisted collections — it silently ORs staff access on top of every narrower rule in the file. That was live in production: any staff role (not just admin) could read/write `reconciliationLog`/`employeeInvitations` past their `isAdmin()` guard, and any staff member could hard-delete `orders`/`returns` past `allow delete: if false`. Caught by `functions/src/firestore-rules.spec.ts` (Phase 3.5's rules-unit-testing suite), fixed by narrowing the fallback to `if false` — safe because every real collection already has its own explicit rule (verified via full-codebase grep). Never reintroduce a permissive fallback here.
- Firestore/Storage rules are tested against the real rule files (not a re-implementation) via `@firebase/rules-unit-testing` in `functions/src/firestore-rules.spec.ts` and `functions/src/storage-rules.spec.ts` — per-role matrix, `linkedCustomerId` scoping, public-create collections, and a storage-path-escape regression test. Run via the same `npm run test:ci` emulator harness as every other functions/ spec.

## Conventions worth knowing
- Config-driven UI: dropdown/label/status metadata (`USER_ROLES`, `ORDER_STATUSES`, `ADJUSTMENT_TYPES`, etc.) lives centrally in `core/config/*.config.ts` — update those, don't hardcode labels/strings in components/templates.
- Prettier is configured in `package.json` (`printWidth: 100`, `singleQuote: true`, Angular parser for `*.html`).
- Component style budgets are set in `angular.json` (`anyComponentStyle` warning 40kb / error 50kb).

## Project Knowledge

### Business context
- The strategic goal is for this portal to eventually run the **entire operation on its own**. Zoho Books is currently the official accounting system (invoices, HST/GST returns, bank reconciliation, T2 prep) — the portal owns all *operations*. The last bridge before fully dropping Zoho is official tax-invoice numbering integrity + CRA HST return generation; treat that as a future track, not something to casually self-build.
- The account/geographic concentration is a known business risk; features that surface concentration or help diversify are strategically valuable.

### Domain terminology
- **Shop** = a physical location you visit. **Customer** = a shop that has a portal account and orders. Every customer is a shop; not every shop is a customer (prospects are shops without accounts). This distinction is foundational — see module relationships below.
- **Sell-in vs sell-through**: opening orders are sell-in; true demand is sell-through (refill orders only). Visit `Left/Found/Added` captures sell-through directly (`sold = left − found`).
- **Infill prospect**: a prospect shop geographically inside an existing customer cluster, so adding it costs near-zero extra driving.
- **ATP** (available-to-promise) **is** `product.stock` as stored — no subtraction needed. Stock is decremented at order confirmation (not at delivery), so the stored value already excludes everything committed to open orders. `committed` (sum of quantities across `confirmed` + `preparing` + `out_for_delivery` orders, via `StockAvailabilityService.committedFor()`) is used the other direction — `available + committed` reconstructs the gross physical count still sitting in the warehouse. Never subtract `committed` from `stock` again; that would double-count the deduction already applied at confirmation.

### Module relationships (field ops)
- **Shop ↔ Customer** are linked symmetrically: `shop.linkedCustomerId` ↔ `customer.linkedShopId`, with `hasShop`/`hasCustomer` boolean flags and normalized `searchName` fields for indexed queries. `ShopLinkService` performs **dual-side batch writes** — never update one side of the link without the other. A reconciliation Cloud Function heals link drift (nightly incremental + weekly full + on-demand callable).
- **Visits are logged against `shopId`, never `customerId`.** This is deliberate: it lets prospects have visit history, and means conversion (prospect → customer) requires no data migration — the shop persists and gains a `linkedCustomerId`. All visit history is automatically intact through conversion.
- **Address and `serviceAreaId` sync across the shop↔customer link**: editing on either side writes both (batch), but only when linked. Same pattern for the `preferCoordinatesForNav` flag.
- **Pipeline** stages (prospects): `to_visit → first_contact → manager_meeting → sample_left → decision → opened`, plus terminal `not_interested` / converted. Stage changes stamp `pipelineEnteredStageAt` and append to a bounded `pipelineHistory[]` array on the shop doc (not a subcollection). "Stuck" flags are stamped nightly like health bands.
- **Shop health** is denormalized: `healthBand`/`healthDays`/`healthKind` are stamped onto each shop (nightly sweep + inline in the link reconciler) so lists/dashboards read a field with zero per-row cross-loads — this is the national-scale pattern; do not compute health per-row client-side.

### Naming / config conventions
- Sequenced document numbers use prefixes from `settings/*Sequence` docs: orders `TRX`, payments `PAY`, returns `RET`, bills `BILL`. Sequences increment server-side.
- Nightly/scheduled job config lives in `settings/reconciliation` (health thresholds under `.shopHealth`, pipeline under `.pipeline`). Follow this location for future scheduled-job config rather than new top-level settings docs.
- Vendor-neutral payment fields (`externalPaymentId`, `externalPaymentProvider`, `externalEventId`, `externalPaymentCustomerId`) exist for a future payment processor — do not rename them Stripe-specific.

## Development Rules

### Always
- Add `tenantId` to every write and every query, even though single-tenant today.
- Use `date.utils.ts` helpers (`dateInputToLocalDate`, `todayInputValue`, etc.) for date-only picker values. `new Date("YYYY-MM-DD")` parses as **UTC midnight** and shifts a day back in Eastern time. Firestore `Timestamp.toDate()` reads are safe and need no conversion.
- Coerce `[ngModel]` on `<input type="number">` via a `toNum()` helper before writing to numeric signals — ngModel returns strings.
- When injecting SVG via `innerHTML`, use `DomSanitizer.bypassSecurityTrustHtml` (Angular strips SVG otherwise).
- Give each independently-editable settings card its own `editing*` signal + own save/cancel; use `updateDocument` (partial merge) per card so cards don't overwrite each other's fields on the same settings doc.
- New browsable entity lists should paginate with indexed server-side queries and normalized `searchName` fields — this is the target convention (proven on `visits`), not yet applied to every existing list (customers/orders still sort client-side in memory today). Don't add a *new* client-side-filtered list at national scale; closing the gap on existing ones is tracked separately, not a license to add more.

### Never
- Never write true negative `product.stock`. Clamp with `Math.max(0, stock − qty)` everywhere (orders, edits, samples), but still record the **full** amount in `stockAdjustments` so the audit trail is honest even when the counter clamps. Visits/samples must not become the one path that produces negative stock (it would corrupt ATP and low-stock alerts).
- Never exclude no-coordinate shops silently from routing math — filter them out of optimization but surface them as "skipped — no location" (unfiltered, they corrupt distance calculations).
- Never import Leaflet (or any `window`/`document`-touching lib) at module top level — it breaks prerender/SSR builds with a mysterious white screen. Guard with `afterNextRender` + dynamic `import()`; also load Leaflet CSS and fix the default marker-icon path or markers render broken.

### Cloud Functions
- Shared recompute logic must stay **idempotent** — real-time triggers and scheduled sweeps call the same function (`recomputeCustomerCounters`), so it must be safe to run repeatedly on the same data.
- Firestore-as-job-queue: to trigger server work, write a request doc; an `onDocumentCreated` trigger processes it and stamps `processed`/`status` back. Guard against reprocessing (`if (data.processed) return`).
- `placeOrder` (onCall) is the correct path for portal order placement — it stamps `customer.lastOrderAt` and increments denormalized counters so health/counters stay current. It runs as a server-side Firestore transaction (re-reads product prices/stock, re-checks for oversell, then writes order + stock + adjustments atomically) precisely so a customer's client never has to be trusted with those writes directly; `firestore.rules` backs this up with a staff-only rule on `products`/`stockAdjustments` writes, full stop — there is no customer carve-out, since `placeOrder` (and `cancelOrder`/`submitReturn`, which restore stock on the same principle) write via the Admin SDK and bypass rules entirely.
- Region is `northamerica-northeast2` for triggers/callables; **Cloud Scheduler does not support northeast2** — scheduled functions run in `northamerica-northeast1`.
- Rate limiting on the public-create job-queue collections (`contactInquiries`, `accessRequests`) gates the trigger's outbound email, not the Firestore write — Firestore rules can't see IP/velocity, so `firestore.rules` stays `allow create: if true` for these and the limiting logic lives in `isRateLimited(scope, identifier)` in `index.ts`, keyed by a hashed email in `rateLimitCounters/{hash}`, config-driven via `settings/rateLimits` (`??` fallback to hardcoded defaults, same pattern as `isNotificationEnabled`). Follow this pattern — trigger-level gate, not a rules-level one — for any future public-create collection that needs rate limiting **unless** the limiter needs to protect the identifier's owner from third-party abuse (see next bullet) — in that case the identifier itself isn't a safe rate-limit key.
- `passwordResetRequests` is the one exception to the bullet above, and it's load-bearing: `firestore.rules` denies public `create` on it entirely. Rate-limiting a password-reset queue by the submitted email is a denial-of-service against the account owner — an attacker who doesn't own the victim's inbox can still burn the victim's limit and lock them out of their own reset attempts. The fix is `requestPasswordReset` (onCall), the collection's only writer, which rate-limits by a hash of `request.rawRequest.ip` (real requester signal, unavailable to a Firestore trigger) before writing the request doc via the Admin SDK. `isRateLimited` also fails closed by design now (a transient Firestore failure returns "over limit" via an explicit try/catch, not by accident of an uncaught exception) and stamps every counter doc with a 48h `expiresAt`, backed by a Firestore TTL policy on `rateLimitCounters` — bounding storage growth from an attacker cycling through many identifiers, an accepted residual risk documented in `docs/ARCHITECTURE.md` §6.5 (App Check's score-based rejection is the front-line mitigant, not a hard ceiling).

## Business Logic (frequently forgotten)

- **Stock deduction timing**: stock is deducted in the portal at order confirmation, not at delivery. Cancellation/returns restore stock via `stockAdjustments`. Samples reduce stock ($0, `type: 'sample'`).
- **Order status** progresses `confirmed → preparing → out_for_delivery → delivered`, with `cancelled` reachable from any non-terminal state. `preparing` is admin-only vocabulary — the portal always masks it back to "Confirmed" for the customer (order list, order detail, dashboard); never surface the internal `preparing` label on a customer-facing screen.
- **Order editing** is allowed while `confirmed`, `preparing`, or `out_for_delivery`; locked at `delivered`/`cancelled`. Quantities may only be **reduced** (stock already committed); reducing returns the diff to stock. Editing recomputes subtotal/tax/total/balance and adjusts the customer's denormalized `totalOrderedCents`/`totalOwingCents` in the same batch.
- **Tax**: single 13% HST, added at checkout on the pre-discount-adjusted subtotal (`tax = (subtotal − discount) × rate`). Prices shown pre-tax; HST added at the total.
- **Out-of-stock behavior** is global (`settings/ordering.outOfStockBehavior`: hide / show_disabled / allow_backorder) with a per-product `outOfStockBehaviorOverride` that wins. Resolve via a single `getEffectiveOutOfStockBehavior()` helper everywhere — never read the global directly in stock-display logic.
- **Restock** from a visit only applies to shops that are customers (`linkedCustomerId` set) — it pre-fills the order form via the reorder-draft localStorage pattern and stamps `restockOrderId` back on the visit; visit and order stay otherwise independent (prefill only, not linked).
- **Bills/Expenses (Phase 6) are operational tracking only** — Zoho Books remains the official ledger. Bills tie to POs; fuel is an Expense with `category: 'fuel'`, optionally linked to a visit/route.
- **Reconciliation** recomputes denormalized customer counters from source-of-truth orders/payments and auto-corrects or freezes based on `settings/reconciliation` thresholds — do not treat the denormalized counters as authoritative; orders/payments are.

## Safety Rules
- Money is integer cents end-to-end; never float math (already noted — reinforced: this includes discount %, tax, and fuel/expense amounts).
- Soft delete only, everywhere (already noted — extends to shops, visits, bills, expenses).
- Prefer `FirestoreService` wrappers over direct `@angular/fire/firestore` calls in components.
- Multi-document invariants (order + customer counters + stock adjustments; shop↔customer link; sample + stock + adjustment) must use `runBatch` so they succeed or fail atomically.
- Force-refresh the ID token (`getIdToken(user, true)`) after custom-claim (`linkedCustomerId`, role) changes, and add null guards in Firestore rules for backward compatibility.

## Testing
- Money math (tax, discount, balance, reconciliation recompute) and the cents/display conversions are the highest-value units to test — assert exact integer cents.
- Test stock invariants: clamp-at-zero while audit records the full amount; `stock` is already ATP (see Domain terminology); cancellation/return restoration.
- Test the shop↔customer dual-side link (both directions) and that conversion preserves visit history.
- Use the Firebase emulators (`auth:9099, firestore:8080, storage:9199`) for anything touching rules, triggers, or batch/transaction behavior; assert idempotency by running a reconcile sweep twice and expecting no change on the second pass.
- Test rules with each role claim (`admin`/`manager`/`sales_rep`/`warehouse`/`customer`) and the unauthenticated public-create collections.

## Repository Memory (lessons learned)
- `angular.json` production config **must** include `fileReplacements` swapping `environment.ts` → `environment.prod.ts`, or a "production" build silently bundles dev Firebase config.
- Cloud Functions resolve the database ID from `GCLOUD_PROJECT` at runtime — do not hardcode `tropx-dev`/`tropx-prod` in function code.
- First-ever 2nd-gen function deploy to a new GCP project needs one-time IAM grants: `roles/cloudbuild.builds.builder` on the Cloud Build SA, and Artifact Registry Editor/Writer on the compute SA. Eventarc permission-propagation delays on first deploy are expected — retry after a few minutes.
- Failed function deploys can leave functions stuck as HTTPS placeholders; changing trigger type then requires delete-and-recreate.
- StoreTrack (a separate localStorage-only HTML app) was discarded after it lost all data at 30 days — its features were folded into the portal. Never store operational data in localStorage; the reorder-draft handoff is the only sanctioned localStorage use, and it's transient.
- The portal is an Angular SPA: crawlers see an empty shell unless static content exists. `index.html` has a static SEO fallback inside `<app-root>` (Angular replaces it on boot) plus static `robots.txt`/`sitemap.xml`/favicons/`og-image` in `public/`. Keep the fallback's messaging roughly in sync with the real home page.

## Recurring Mistakes We Actually Hit (guard against these)

- Production build silently shipping dev Firebase config because `fileReplacements` was missing.
- Cloud Functions with hardcoded database IDs instead of resolving from `GCLOUD_PROJECT`.
- Scheduled functions failing because Cloud Scheduler doesn't support `northamerica-northeast2` (must be `northeast1`).
- Date-only picker values shifting a day back (UTC-midnight parse) — the reason `date.utils.ts` exists.
- ngModel numeric inputs writing strings into numeric signals — the reason `toNum()` exists.
- A shared `editing` signal putting every settings card into edit mode at once — the reason each card has its own signal + partial `updateDocument`.
- Naming an amount field ambiguously about cents vs dollars — always suffix cents fields `...Cents` and convert to dollars only at the display/input boundary.
- Leaflet imported at module top level white-screening prerender.
- No-coordinate shops corrupting route distance math when not filtered out.
- `firestore.rules`'s catch-all fallback written as `allow ... : if isStaff()` instead of `if false` — Firestore ORs every matching `match` block together (a recursive wildcard matches every path, not just "nothing more specific matched"), so this silently overrode `reconciliationLog`/`employeeInvitations`'s admin-only guard and let any staff role hard-delete `orders`/`returns` past `allow delete: if false`. Fixed 2026-07-30 (Phase 3.5); caught only because a rules-unit-testing suite was finally written — nothing had ever exercised those specific denials before.

## Commands

Frontend (run from repo root):
```bash
npm start                 # ng serve — dev server at localhost:4200
npm run build              # ng build (production config by default)
npm run watch               # ng build --watch --configuration development
npm test                    # ng test — Karma/Jasmine unit tests
ng test --include='**/order.model.spec.ts'   # run a single spec file
ng generate component features/admin/foo     # scaffold a standalone component
```

Cloud Functions (run from `functions/`):
```bash
npm run build        # tsc
npm run build:watch  # tsc --watch
npm run lint          # eslint --ext .js,.ts .
npm run serve         # build + firebase emulators:start --only functions
npm run shell         # build + firebase functions:shell
npm run deploy        # firebase deploy --only functions
npm run logs          # firebase functions:log
```

Firebase project / emulators (run from repo root):
```bash
firebase emulators:start                 # auth:9099, firestore:8080, storage:9199, ui enabled
firebase deploy --only firestore:rules   # deploy security rules
firebase use dev   # or: firebase use prod   (see .firebaserc: dev=tropx-wholesale-dev, prod=tropx-wholesale-prod)
```
Firestore config differs by environment: `firebase.json` (dev, uses database `tropx-dev`) vs `firebase.prod.json` (prod, uses database `tropx-prod` — **not** `(default)`). Functions deploy always runs `lint` then `build` as a predeploy step (see `firebase.json`).
