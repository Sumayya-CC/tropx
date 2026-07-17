# /release

Run or review a release. This project's deploy discipline exists because specific things have bitten us before — treat the checklist as mandatory, not advisory.

## Golden rules

- **Dev is always deployed and verified before prod.**
- **Prod deploy is single-line only.**
- Feature work lives on branches. **Master is prod-ready only** — master auto-deploys to the live site via Netlify.

## Pre-merge checks

- Production build uses `--configuration production`, and `angular.json` production config includes the `fileReplacements` swapping `environment.ts` → `environment.prod.ts`. Without it, a "production" build silently ships **dev Firebase config**. Confirm the built bundle references the prod project.
- New model/settings fields are optional with `??` fallbacks — pre-existing documents must keep working after deploy.
- Firestore rules and indexes for any new collection are in the change and deployed to the target project.
- Any new scheduled function is in `northamerica-northeast1` (not northeast2).
- Functions resolve the database ID from `GCLOUD_PROJECT` — no hardcoded `tropx-dev`/`tropx-prod`.

## Cloud Functions deploy notes

- First-ever 2nd-gen deploy to a fresh GCP project needs one-time IAM: `roles/cloudbuild.builds.builder` on the Cloud Build SA, and Artifact Registry Editor/Writer on the compute SA. Eventarc permission propagation on first deploy is expected — retry after a few minutes rather than assuming failure.
- A failed deploy can leave functions stuck as HTTPS placeholders; changing a trigger type then requires delete-and-recreate.
- Secrets (Resend key, from-email, and any processor keys) are set on the **target** project's Secret Manager, not shared from dev.

## Commit / PR hygiene

- Commit message is multi-line: concise subject, then a structured body covering all changes in the session.
- Changes were delivered and verified as sequenced, independently-verifiable steps; no single step full-replaced a file it edited earlier in the same session.

## Post-deploy smoke (prod)

- Public home renders (SPA fallback content present for crawlers).
- Login + a customer portal read scoped by `linkedCustomerId`.
- Place a test order end-to-end (stock deducts, counters update, confirmation email sends).
- One nightly-sweep-stamped field (health or pipeline) reads correctly on a list.

## Output

For a run: produce the exact ordered commands (dev first, verify, then single-line prod) and the smoke checklist. For a review: confirm each golden rule and pre-merge check is satisfied; flag any miss before merge.
