import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "../logger";
import {db, sentryDsn} from "../core";

// ── Popular Products ─────────────────────────────────
// Counts distinct customers who ordered each product
// within a configurable window of delivered orders.
// Writes ranked results into settings/storefront so
// all storefront config stays in one document.
//
// Formula:
//   percent = distinct customers who ordered product
//           ÷ distinct customers with at least one
//             delivered order in window
//           × 100

async function computePopularProducts(): Promise<void> {
  const sfDoc = await db
    .doc("settings/storefront")
    .get();
  const sf = sfDoc.exists ? sfDoc.data() : {};
  const cfg = sf?.["popularProductsSettings"] ?? {
    windowDays: 90,
    topN: 10,
    minPercent: 0,
  };

  const windowDays: number = cfg.windowDays ?? 90;
  const topN: number = cfg.topN ?? 10;
  const minPercent: number = cfg.minPercent ?? 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const ordersSnap = await db
    .collection("orders")
    .where("tenantId", "==", 1)
    .where("status", "==", "delivered")
    .where("deliveredAt", ">=", cutoff)
    .get();

  const productCustomers =
    new Map<string, Set<string>>();
  const activeCustomers = new Set<string>();

  for (const doc of ordersSnap.docs) {
    const order = doc.data();
    const customerId: string = order["customerId"];
    if (!customerId) continue;

    activeCustomers.add(customerId);

    const items: any[] = order["items"] || [];
    for (const item of items) {
      const pid: string = item["productId"];
      if (!pid) continue;
      if (!productCustomers.has(pid)) {
        productCustomers.set(pid, new Set());
      }
      productCustomers.get(pid)!.add(customerId);
    }
  }

  const totalCustomers = activeCustomers.size;
  const stamp =
    admin.firestore.FieldValue.serverTimestamp();

  if (totalCustomers === 0) {
    await db.doc("settings/storefront").update({
      popularProductEntries: [],
      popularProductsComputedAt: stamp,
      popularProductsTotalCustomers: 0,
      popularProductsWindowDays: windowDays,
    });
    logger.info(
      "computePopularProducts: no delivered " +
      `orders in last ${windowDays} days`
    );
    return;
  }

  const entries: {
    productId: string;
    customerCount: number;
    totalCustomers: number;
    percent: number;
  }[] = [];

  for (
    const [productId, customers]
    of productCustomers
  ) {
    const customerCount = customers.size;
    const percent = Math.round(
      (customerCount / totalCustomers) * 100
    );
    if (percent >= minPercent) {
      entries.push({
        productId,
        customerCount,
        totalCustomers,
        percent,
      });
    }
  }

  entries.sort((a, b) => b.percent - a.percent);
  const top = entries.slice(0, topN);

  await db.doc("settings/storefront").update({
    popularProductEntries: top,
    popularProductsComputedAt: stamp,
    popularProductsTotalCustomers: totalCustomers,
    popularProductsWindowDays: windowDays,
  });

  logger.info(
    "computePopularProducts: " +
    `${top.length} products ranked, ` +
    `${totalCustomers} active customers, ` +
    `${windowDays}d window`
  );
}

// Scheduled: nightly at 2am Toronto time.
export const computePopularProductsScheduled =
  onSchedule(
    {
      schedule: "0 2 * * *",
      timeZone: "America/Toronto",
      region: "northamerica-northeast1",
      timeoutSeconds: 120,
      secrets: [sentryDsn],
    },
    async () => {
      await computePopularProducts();
    }
  );

// HTTP callable: admin triggers manual recompute
// from settings page without waiting for nightly.
export const computePopularProductsNow = onCall(
  {
    region: "northamerica-northeast1",
    secrets: [sentryDsn],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Must be authenticated"
      );
    }
    await computePopularProducts();
    return {success: true};
  }
);
