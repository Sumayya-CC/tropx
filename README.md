# Tropx Wholesale Portal

Custom B2B wholesale platform for **Tropx Enterprises Inc.** — a wholesale distributor supplying convenience stores and gas stations across Canada. The platform is the single source of truth for storefront ordering, customer management, purchasing, inventory, field sales, and business operations.

**Live:** https://tropxwholesale.ca

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

* **Callable Cloud Functions:** `northamerica-northeast2`
* **Cloud Scheduler:** `northamerica-northeast1`

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
* **Scalability:** indexed queries, pagination, denormalized fields, and boolean lookup flags. No client-side full collection filtering.
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
* **Expenses & Bills** — operational expense tracking *(planned)*

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

## Planned Integrations

* **Zoho Books** — tax invoicing, HST compliance, and accounting integration
* Browser push notifications

---

## Repository Layout

```text
/src                  Angular application
/functions            Firebase Cloud Functions v2
firestore.rules       Firestore security rules
firestore.indexes.json Composite indexes
firebase.json         Firebase configuration
netlify.toml          Netlify configuration
```

---

© Tropx Enterprises Inc.
