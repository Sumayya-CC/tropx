import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "../logger";
import {db, sentryDsn} from "../core";

// ═══ Shop↔Customer Link Reconciliation ═══════════════════════════════════
// Keeps the bidirectional Shop/Customer link and its denormalized flags
// honest. Heals unambiguous drift automatically; logs ambiguous conflicts
// for manual review. The link WRITES (client-side ShopLinkService + the
// approval batch) remain the source of truth — this is the safety net for
// partial failures, manual console edits, and legacy records.

// normalizeSearchName — MUST match src/app/shared/utils/text.utils.ts exactly.
function normalizeSearchNameFn(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface HealthThresholds {
  customerWatchDays: number;
  customerAtRiskDays: number;
  prospectCoolingDays: number;
  prospectColdDays: number;
}

async function getHealthThresholds(): Promise<HealthThresholds> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const sh = (doc.data() || {}).shopHealth || {};
    return {
      customerWatchDays: sh.customerWatchDays ?? 30,
      customerAtRiskDays: sh.customerAtRiskDays ?? 60,
      prospectCoolingDays: sh.prospectCoolingDays ?? 14,
      prospectColdDays: sh.prospectColdDays ?? 45,
    };
  } catch {
    return {customerWatchDays: 30, customerAtRiskDays: 60, prospectCoolingDays: 14, prospectColdDays: 45};
  }
}

async function isShopHealthEnabled(): Promise<boolean> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const sh = (doc.data() || {}).shopHealth || {};
    return sh.enabled !== false;
  } catch {
    return true;
  }
}

function daysSinceMs(value: any): number | null {
  if (!value) return null;
  const then = value?.toMillis ? value.toMillis() :
    (value instanceof Date ? value.getTime() : new Date(value).getTime());
  if (isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

type HealthBand = "healthy"|"watch"|"at_risk"|"warm"|"cooling"|"cold"|"unknown";

function computeCustomerBand(days: number | null, t: HealthThresholds, atRiskOverride?: number): HealthBand {
  if (days == null) return "unknown";
  const atRisk = atRiskOverride ?? t.customerAtRiskDays;
  if (days >= atRisk) return "at_risk";
  if (days >= t.customerWatchDays) return "watch";
  return "healthy";
}
function computeProspectBand(days: number | null, t: HealthThresholds): HealthBand {
  if (days == null) return "unknown";
  if (days >= t.prospectColdDays) return "cold";
  if (days >= t.prospectCoolingDays) return "cooling";
  return "warm";
}

interface LinkReconSummary {
  scanned: number;
  healed: number;
  flagged: number;
  backfilled: number;
}

interface LinkReconConfig {
  enabled: boolean;
}

async function getLinkReconConfig(): Promise<LinkReconConfig> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const d = doc.data() || {};
    const s = d.shopLink || {};
    return {enabled: s.enabled !== false}; // default ON
  } catch {
    return {enabled: true};
  }
}

// Reconcile ONE customer + its linked shop. Returns which buckets it touched.
// Auto-heals: flag↔link agreement, dangling pointer, missing back-pointer,
// stale searchName, shop status coherence. Flags (no write): three-way
// mismatch (cust→shopA but shopA→custB), and shop claimed by another customer.
async function reconcileOneCustomer(
  customerId: string, healthT: HealthThresholds
): Promise<{healed: boolean; flagged: boolean; backfilled: boolean}> {
  const custRef = db.collection("customers").doc(customerId);
  const custSnap = await custRef.get();
  if (!custSnap.exists) return {healed: false, flagged: false, backfilled: false};
  const cust = custSnap.data() || {};
  if (cust.isDeleted) return {healed: false, flagged: false, backfilled: false};

  const custUpdate: Record<string, any> = {};
  let flagged = false;
  let backfilled = false;
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  // searchName backfill/refresh (first-run migration + drift).
  const wantSearch = normalizeSearchNameFn(cust.businessName);
  if ((cust.searchName || "") !== wantSearch) {
    custUpdate.searchName = wantSearch;
    if (cust.searchName === undefined) backfilled = true;
  }

  const linkedShopId: string | null = cust.linkedShopId ?? null;

  if (!linkedShopId) {
    // No shop link → hasShop must be false.
    if (cust.hasShop !== false) {
      custUpdate.hasShop = false;
      if (cust.hasShop === undefined) backfilled = true;
    }
  } else {
    const shopRef = db.collection("shops").doc(linkedShopId);
    const shopSnap = await shopRef.get();

    if (!shopSnap.exists || shopSnap.data()?.isDeleted) {
      // Dangling pointer → clear it, hasShop false. (Unambiguous heal.)
      custUpdate.linkedShopId = admin.firestore.FieldValue.delete();
      custUpdate.hasShop = false;
    } else {
      const shop = shopSnap.data() || {};
      const backRef: string | null = shop.linkedCustomerId ?? null;

      if (backRef === customerId) {
        // Healthy link. Ensure flags + shop coherence.
        if (cust.hasShop !== true) {
          custUpdate.hasShop = true;
          if (cust.hasShop === undefined) backfilled = true;
        }
        const shopUpdate: Record<string, any> = {};
        if (shop.hasCustomer !== true) {
          shopUpdate.hasCustomer = true;
          if (shop.hasCustomer === undefined) backfilled = true;
        }
        if (shop.status !== "customer") shopUpdate.status = "customer";
        const shopWantSearch = normalizeSearchNameFn(shop.name);
        if ((shop.searchName || "") !== shopWantSearch) {
          shopUpdate.searchName = shopWantSearch;
          if (shop.searchName === undefined) backfilled = true;
        }
        const custDays = daysSinceMs(cust.lastOrderAt);
        const band = computeCustomerBand(custDays, healthT, shop.inactiveDaysOverride);
        const prevBand = shop.healthBand;
        const staleMs = daysSinceMs(shop.healthComputedAt);
        if (band !== prevBand || (staleMs != null && staleMs >= 1) || shop.healthComputedAt == null) {
          shopUpdate.healthBand = band;
          shopUpdate.healthDays = custDays;
          shopUpdate.healthKind = "customer";
          shopUpdate.healthComputedAt = stamp;
        }
        if (Object.keys(shopUpdate).length > 0) {
          await shopRef.update(shopUpdate);
        }
      } else if (backRef == null) {
        // One-way link (cust→shop, shop has no back-pointer). Heal: set back-pointer.
        await shopRef.update({
          linkedCustomerId: customerId,
          hasCustomer: true,
          status: "customer",
        });
        if (cust.hasShop !== true) custUpdate.hasShop = true;
      } else {
        // Three-way mismatch: cust→shop, but shop→someone else. AMBIGUOUS.
        flagged = true;
        await db.collection("reconciliationLog").add({
          kind: "shop_link",
          status: "needs_review",
          reason: "three_way_mismatch",
          customerId,
          shopId: linkedShopId,
          shopLinkedCustomerId: backRef,
          tenantId: 1,
          detectedAt: stamp,
          resolvedAt: null,
          resolvedBy: null,
        });
        // Do NOT touch either side.
      }
    }
  }

  const healed = Object.keys(custUpdate).length > 0;
  if (healed) {
    custUpdate.linkReconciledAt = stamp;
    await custRef.update(custUpdate);
  } else {
    // Still stamp watermark so we don't reprocess a clean doc every incremental run.
    await custRef.update({linkReconciledAt: stamp});
  }

  return {healed, flagged, backfilled};
}

// Reconcile shops that have NO customer link (the customer loop above only
// visits shops reachable from a customer). Catches orphan flags on prospect
// shops + backfills their searchName/hasCustomer.
async function reconcileOrphanShops(
  shopIds: string[], healthT: HealthThresholds
): Promise<{healed: number; backfilled: number}> {
  let healed = 0;
  let backfilled = 0;
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  for (const id of shopIds) {
    const ref = db.collection("shops").doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const shop = snap.data() || {};
    if (shop.isDeleted) continue;
    if (shop.linkedCustomerId) continue; // handled via customer loop

    const update: Record<string, any> = {};
    if (shop.hasCustomer !== false) {
      update.hasCustomer = false;
      if (shop.hasCustomer === undefined) backfilled++;
    }
    const wantSearch = normalizeSearchNameFn(shop.name);
    if ((shop.searchName || "") !== wantSearch) {
      update.searchName = wantSearch;
      if (shop.searchName === undefined) backfilled++;
    }
    const days = daysSinceMs(shop.lastVisitDate);
    const band = computeProspectBand(days, healthT);
    const prevBand = shop.healthBand;
    const staleMs = daysSinceMs(shop.healthComputedAt);
    if (band !== prevBand || (staleMs != null && staleMs >= 1) || shop.healthComputedAt == null) {
      update.healthBand = band;
      update.healthDays = days;
      update.healthKind = "prospect";
      update.healthComputedAt = stamp;
    }
    if (Object.keys(update).length > 0) {
      await ref.update(update);
      healed++;
    }
  }
  return {healed, backfilled};
}

// Core sweep. mode 'full' scans everything; 'incremental' only customers
// whose doc changed since their last link-reconcile watermark. Exported
// for the same reason recomputeCustomerCounters is: shared by the
// nightly/weekly sweeps and the on-demand callable, so it needs to be
// directly testable for idempotency.
export async function reconcileShopLinks(
  mode: "full" | "incremental"
): Promise<LinkReconSummary> {
  const summary: LinkReconSummary = {scanned: 0, healed: 0, flagged: 0, backfilled: 0};
  const healthT = await getHealthThresholds();

  // ── customers ──
  const customerIds: string[] = [];
  const pageSize = 500;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (let page = 0; page < 20; page++) {
    let q = db.collection("customers")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .orderBy("businessName")
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (mode === "incremental") {
        const d = doc.data();
        const changed = d.updatedAt?.toMillis?.() ??
          d.createdAt?.toMillis?.() ?? 0;
        const reconciled = d.linkReconciledAt?.toMillis?.() ?? 0;
        // First-run (no watermark) always qualifies → doubles as backfill.
        if (reconciled !== 0 && changed <= reconciled) continue;
      }
      customerIds.push(doc.id);
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }

  for (const id of customerIds) {
    try {
      const r = await reconcileOneCustomer(id, healthT);
      summary.scanned++;
      if (r.healed) summary.healed++;
      if (r.flagged) summary.flagged++;
      if (r.backfilled) summary.backfilled++;
    } catch (err) {
      await logger.error(`Link reconcile failed for customer ${id}:`, err);
    }
  }

  // ── orphan shops (full sweep only — cheap enough, and where legacy prospect
  //    shops get their flags backfilled) ──
  if (mode === "full") {
    const shopIds: string[] = [];
    last = null;
    for (let page = 0; page < 20; page++) {
      let q = db.collection("shops")
        .where("tenantId", "==", 1)
        .where("isDeleted", "==", false)
        .orderBy("name")
        .limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) shopIds.push(doc.id);
      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < pageSize) break;
    }
    const orphan = await reconcileOrphanShops(shopIds, healthT);
    summary.healed += orphan.healed;
    summary.backfilled += orphan.backfilled;
    summary.scanned += shopIds.length;
  }

  logger.info(
    `Link reconcile (${mode}): scanned ${summary.scanned}, ` +
    `healed ${summary.healed}, flagged ${summary.flagged}, ` +
    `backfilled ${summary.backfilled}`
  );
  return summary;
}

// Nightly incremental — only recently-changed customers.
export const nightlyLinkReconcile = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const cfg = await getLinkReconConfig();
    if (!cfg.enabled) {
      logger.info("Link reconcile disabled — skipping nightly");
      return;
    }
    await reconcileShopLinks("incremental");
  }
);

// Exported for the same reason as reconcileShopLinks above — shared by
// the nightly sweep and the on-demand callable, testable directly.
export async function stampAllShopHealth(): Promise<{scanned: number; updated: number}> {
  const t = await getHealthThresholds();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  const pageSize = 500;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0; let updated = 0;

  for (let page = 0; page < 40; page++) {
    let q = db.collection("shops")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .orderBy("name")
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const shop = doc.data();
      scanned++;
      let band: HealthBand; let days: number | null; let kind: "customer"|"prospect";
      if (shop.linkedCustomerId) {
        let lastOrderAt: any = null;
        try {
          const c = await db.collection("customers").doc(shop.linkedCustomerId).get();
          lastOrderAt = c.exists ? c.data()?.lastOrderAt : null;
        } catch {/* null */}
        days = daysSinceMs(lastOrderAt);
        band = computeCustomerBand(days, t, shop.inactiveDaysOverride);
        kind = "customer";
      } else {
        days = daysSinceMs(shop.lastVisitDate);
        band = computeProspectBand(days, t);
        kind = "prospect";
      }
      // Manual refresh writes even if band unchanged, so healthDays reflects the true current day count on demand.
      await doc.ref.update({healthBand: band, healthDays: days, healthKind: kind, healthComputedAt: stamp});
      updated++;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  logger.info(`Shop health stamp: scanned ${scanned}, updated ${updated}`);
  return {scanned, updated};
}

export const nightlyShopHealthStamp = onSchedule(
  {
    schedule: "every day 03:45",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const enabled = await isShopHealthEnabled();
    if (!enabled) {
      logger.info("Shop health computation disabled — skipping nightly");
      return;
    }
    await stampAllShopHealth();
  }
);

export const refreshShopHealthNow = onCall(
  {region: "northamerica-northeast2", cors: true, secrets: [sentryDsn]},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be authenticated");
    if (request.auth.token["role"] !== "admin") throw new HttpsError("permission-denied", "Admin only");
    return await stampAllShopHealth();
  }
);

interface StuckThresholds {
  to_visit: number; first_contact: number; manager_meeting: number; sample_left: number;
  decision: number; opened: number;
}

async function getPipelineConfig(): Promise<{enabled: boolean; thresholds: StuckThresholds}> {
  try {
    const doc = await db.collection("settings").doc("reconciliation").get();
    const p = (doc.data() || {}).pipeline || {};
    const st = p.stuckThresholds || {};
    return {
      enabled: p.enabled !== false, // default ON
      thresholds: {
        to_visit: st.to_visit ?? 10,
        first_contact: st.first_contact ?? 7,
        manager_meeting: st.manager_meeting ?? 10,
        sample_left: st.sample_left ?? 14,
        decision: st.decision ?? 7,
        opened: st.opened ?? 3,
      },
    };
  } catch {
    return {
      enabled: true,
      thresholds: {to_visit: 10, first_contact: 7, manager_meeting: 10, sample_left: 14, decision: 7, opened: 3},
    };
  }
}

// Exported for the same reason as reconcileShopLinks/stampAllShopHealth
// above — shared by the nightly sweep and the on-demand callable,
// testable directly.
export async function stampAllPipelineStuck(): Promise<{scanned: number; updated: number; backfilled: number}> {
  const {thresholds} = await getPipelineConfig();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  const pageSize = 500;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0; let updated = 0; let backfilled = 0;

  for (let page = 0; page < 40; page++) {
    let q = db.collection("shops")
      .where("tenantId", "==", 1)
      .where("isDeleted", "==", false)
      .where("status", "==", "prospect")
      .orderBy("name")
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const shop = doc.data();
      scanned++;
      const stage = shop.pipelineStage || "first_contact";

      let enteredAt = shop.pipelineEnteredStageAt;
      const update: Record<string, any> = {};
      if (!enteredAt) {
        enteredAt = shop.createdAt || stamp;
        update.pipelineEnteredStageAt = enteredAt;
        if (!shop.pipelineHistory || shop.pipelineHistory.length === 0) {
          update.pipelineHistory = [{stage, enteredAt: enteredAt, by: null}];
        }
        backfilled++;
      }

      const days = daysSinceMs(enteredAt);
      const threshold = (thresholds as any)[stage] ?? 14;
      const stuck = days != null && days > threshold;

      if (shop.pipelineStuck !== stuck || shop.daysInStage !== days || update.pipelineEnteredStageAt) {
        update.pipelineStuck = stuck;
        update.daysInStage = days;
        update.pipelineStuckComputedAt = stamp;
      }

      if (Object.keys(update).length > 0) {
        await doc.ref.update(update);
        updated++;
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) break;
  }
  logger.info(`Pipeline stuck stamp: scanned ${scanned}, updated ${updated}, backfilled ${backfilled}`);
  return {scanned, updated, backfilled};
}

export const nightlyPipelineStuckStamp = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const {enabled} = await getPipelineConfig();
    if (!enabled) {
      logger.info("Pipeline stamping disabled — skipping"); return;
    }
    await stampAllPipelineStuck();
  }
);

export const refreshPipelineStuckNow = onCall(
  {region: "northamerica-northeast2", cors: true, secrets: [sentryDsn]},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be authenticated");
    if (request.auth.token["role"] !== "admin") throw new HttpsError("permission-denied", "Admin only");
    return await stampAllPipelineStuck();
  }
);

// Weekly full — backstop that catches dormant/legacy drift the incremental misses.
export const weeklyLinkReconcile = onSchedule(
  {
    schedule: "every sunday 04:30",
    timeZone: "America/Toronto",
    region: "northamerica-northeast1",
    timeoutSeconds: 540,
    secrets: [sentryDsn],
  },
  async () => {
    const cfg = await getLinkReconConfig();
    if (!cfg.enabled) {
      logger.info("Link reconcile disabled — skipping weekly");
      return;
    }
    await reconcileShopLinks("full");
  }
);

// On-demand "Reconcile Now" — always a FULL sweep. Region matches app.config
// (northamerica-northeast2) so the callable resolves.
export const reconcileShopLinksNow = onCall(
  {
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }
    if (request.auth.token["role"] !== "admin") {
      throw new HttpsError("permission-denied", "Admin only");
    }
    // Manual runs ignore the enabled flag — pressing the button IS intent.
    const summary = await reconcileShopLinks("full");
    return summary;
  }
);
