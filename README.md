# Tropx Wholesale Portal

Custom B2B wholesale platform for **Tropx Enterprises Inc.** — a wholesale distributor supplying convenience stores and gas stations across Canada. The platform is the single source of truth for storefront ordering, customer management, purchasing, inventory, field sales, and business operations.

**Live:** https://tropxwholesale.ca

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — internal engineering reference: invariants, data model, Cloud Functions, security rules, decision log. Start here to change the code safely.
- [`docs/SOFTWARE_ARCHITECTURE_DOCUMENT.md`](docs/SOFTWARE_ARCHITECTURE_DOCUMENT.md) — external-facing Software Architecture Document (C4 views, ADRs, quality attributes) for due diligence, hiring review, or portfolio use.
- `CLAUDE.md` — working context and conventions for AI-assisted development in this repo.

---

## Tech Stack

| Layer    | Technology                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| Frontend | Angular 20 (standalone components, signals, `inject()`, `@if`/`@for`)          |
| Backend  | Firebase — Firestore, Authentication, Storage, Cloud Functions v2 (TypeScript) |
| Maps     | Leaflet + OpenStreetMap, Google Maps navigation handoff                        |
| Hosting  | Netlify (frontend, auto-deploy on `master`)                                    |
| Email    | Resend                                                                         |
| PDF      | `html2pdf.js`                                                                  |
| IDE      | Cursor                                                                         |

---

## Environments

|      | Project                | Firestore DB |
| ---- | ---------------------- | ------------ |
| Dev  | `tropx-wholesale-dev`  | `tropx-dev`  |
| Prod | `tropx-wholesale-prod` | `tropx-prod` |

**All features are validated in the development environment before production deployment.**

### Regions

* **Firestore triggers & callable (`onCall`) functions:** `northamerica-northeast2`
* **Scheduled (`onSchedule`) functions:** `northamerica-northeast1` — Cloud Scheduler does not support `northeast2`

---

## CI

`.github/workflows/ci.yml` runs on every pull request into `master` and every push to a feature branch: install, lint, typecheck, production build, and headless unit tests — for both the Angular app and Cloud Functions, as two independent jobs.

* **Verification only — this pipeline does not deploy anything.** Deploys remain manual, following the dev-before-prod / single-line-prod discipline above; nothing in CI changes that.
* Frontend lint (`ng lint`, via Angular ESLint) is currently **non-blocking** — the repo had no lint tooling until it was added alongside this pipeline, so there's a pre-existing backlog of findings across the codebase. It runs and reports on every PR; it becomes a hard gate once that backlog is triaged.
* Functions lint (existing ESLint setup, already used in the Firebase predeploy hook) is blocking, as are typecheck, build, and tests on both sides.
* `.github/workflows/deploy-preview.yml` is a **disabled scaffold** for future PR preview deploys — see the comments at the top of that file for how to enable it later. It does not run today.

---

## Observability

Error tracking (Sentry) and structured logging are wired in but **off by default** — both the Angular app and Cloud Functions no-op until a Sentry DSN is configured, and nothing is hardcoded.

* **Cloud Functions**: `functions/src/logger.ts` replaces ad-hoc `console.log`/`console.error` with structured logging (via `firebase-functions/logger`) plus optional Sentry reporting on `.error()`. Enable it by creating a `SENTRY_DSN` secret the same way `RESEND_API_KEY`/`FROM_EMAIL` already exist:
  ```bash
  firebase functions:secrets:set SENTRY_DSN --project tropx-wholesale-dev
  firebase functions:secrets:set SENTRY_DSN --project tropx-wholesale-prod
  ```
  Every function already declares `secrets: [sentryDsn]` (or has it appended to its existing secrets array) — no per-function wiring needed once the secret exists. Leaving it unset keeps Sentry off; nothing else changes.
* **Frontend**: `src/app/core/monitoring/sentry.ts` initializes `@sentry/angular` only when `environment.production` is true **and** `environment.sentryDsn` is non-empty. To enable: create a Sentry project (dashboard action, not something this repo can do for you), then set `sentryDsn` in `src/environments/environment.prod.ts` — a DSN is a public client identifier, safe to commit like the Firebase config already in that file.
* Both sides scrub known-sensitive field names (`*Cents`, email, phone, address, business/owner/customer name) before anything reaches Sentry, and neither captures request/response bodies. See the comments in `logger.ts` and `sentry.ts` for the exact rules.
* User context on the frontend is role + uid for staff, role-only (no id) for customers — never customer PII.

---

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
ng serve

# Build
ng build

# Cloud Functions
cd functions
npm install
npm run build
```

---

## Workflow

1. Branch from `master`.
2. Validate changes in the **development** Firebase project.
3. Merge into `master`.
4. Netlify automatically deploys the frontend.
5. Deploy backend targets explicitly.

### Production Deploy

```bash
firebase deploy --only [target] --project tropx-wholesale-prod
```

Examples:

```bash
firebase deploy --only functions --project tropx-wholesale-prod
firebase deploy --only firestore:rules --project tropx-wholesale-prod
firebase deploy --only firestore:indexes --project tropx-wholesale-prod
```

---

## Architecture & Conventions

* **Currency:** cents-based everywhere (`Cents` type). Never store or compute in dollars.
* **Multi-tenancy:** tenant-aware architecture (currently single tenant with `tenantId = 1`).
* **Soft delete:** `isDeleted`, `isDeletedAt`, `deletedBy`. Domain records are never hard deleted.
* **Role-based access:** Firebase Authentication custom claims with granular permission mapping.
* **Authentication:** `auth.getActionBy()` for audit records and `getIdToken(user, true)` after claim changes.
* **Firestore access:** centralized through `FirestoreService`.
* **Scalability:** indexed queries, pagination, denormalized fields, and boolean lookup flags are the target convention for browsable entity lists (proven today on `visits`); closing the gap on lists that still sort/filter client-side (e.g. customers, orders) is tracked, ongoing work.
* **Security:** Firestore rules scoped by authenticated ownership where applicable.
* **Storefront configuration:** managed through Firestore settings documents.
* **Background automation:** Cloud Scheduler and Cloud Functions power reconciliation, operational maintenance, and scheduled workflows.
* **Search normalization:** `normalizeSearchName` must remain identical between frontend and Cloud Functions.
* **SCSS:** reuse existing styles instead of introducing new CSS classes.
* **Persistent application data:** stored in Firestore rather than browser storage.

---

## Features

### Public Website & CMS

* Dynamic marketing website
* Request-access workflow
* Editable homepage content, banners, contact information, and defaults
* Admin-managed CMS with no code changes required

### Storefront & Customer Portal

* Product catalog and shopping cart
* Customer dashboard
* Online ordering
* Order history
* Invoice downloads
* Payment history
* Returns and customer credit management

### Administration

* Customer, employee, product, inventory, order, payment, return, and settings management
* Approval-based access requests
* Product and inventory management
* Purchase order generation (PDF + email)
* Storefront and business configuration
* Business dashboards, analytics, notifications, and CSV exports

### Field Operations Suite

* **Shops** — CRM with GPS capture, Shop↔Customer linking, service areas, and automatic reconciliation
* **Visits** — visit lifecycle, sample inventory, timelines, edit/delete, and restock workflow
* **Shop Health** — server-computed health scoring with configurable thresholds
* **Prospect Pipeline** — Kanban pipeline, stage history, KPIs, next actions, and conversion workflow
* **Route Planning** — optimized delivery and visit routes, interactive maps, nearby-shop intelligence, saved routes, and Google Maps navigation handoff
* **Field Operations Dashboard** — unified operational dashboard combining Shop Health, Pipeline insights, and backorders
* **Expenses & Bills** — operational expense and supplier-bill tracking, tied to purchase orders; a money-out dashboard (fuel trend, upcoming bills, revenue concentration) sits alongside it. Operational tracking only — Zoho Books remains the accounting system of record.

---

## Core Capabilities

* Storefront catalog · shopping cart · customer portal
* Order lifecycle · payments · returns · customer credit
* Inventory ledger · stock adjustments · receiving
* Purchasing · purchase orders · GRN
* Field CRM · shops · visits · restocking · route planning
* Role-based access · Firebase Authentication · multi-tenant architecture
* Scheduled automation · self-healing reconciliation

---

## Platform Highlights

* Multi-tenant architecture with role-based access control (5 roles)
* Automated inventory updates across orders, returns, samples, and stock adjustments
* Purchase order generation with PDF and email workflows
* Spend and payment tracking
* Customer and staff onboarding workflows
* Transactional email notifications
* Scheduled operational jobs and self-healing reconciliation
* Admin-configurable public content, banners, storefront configuration, and application defaults without code changes

---

## Roadmap

* **Official tax-invoice numbering + CRA HST-return generation** — the remaining bridge before the portal can fully replace Zoho Books, treated as a deliberate, separate future track rather than something to build incidentally. Zoho Books remains the official accounting ledger today; the portal owns operations (orders, payments, expenses, bills) and does not do double-entry accounting.
* **Payment processor integration** — the data model (vendor-neutral fields on `Payment`/`Customer`) already anticipates this; wiring an actual processor is the remaining step.
* Browser push notifications

---

## Repository Layout

```text
/src                  Angular application
/functions            Firebase Cloud Functions v2
firestore.rules       Firestore security rules
storage.rules         Cloud Storage security rules
firestore.indexes.json Composite indexes
firebase.json         Firebase configuration (dev)
firebase.prod.json    Firebase configuration (prod)
src/_redirects        Netlify SPA routing (rewrites all paths to index.html)
```

---

© Tropx Enterprises Inc.
