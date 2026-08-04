import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db, sentryDsn, STAFF_ROLES} from "../core";
import {buildStaffActionBy} from "../staff-transactions-shared";

// ── saveVisit ─────────────────────────────────────────────────────────
// Staff-only field-ops action (visit.service.ts saveVisit()). Used to be
// a client writeBatch with a getDoc-then-batch race per sample item, same
// defect class as the other 5H sites — lower urgency than the order/
// return/PO sites (single-user-initiated, not concurrent-admin-prone),
// but the same fix. shopName is now re-derived from a fresh read rather
// than trusted from the client, since it only ever fed an audit-trail
// reason string — cheap to make correct while already reading the shop
// doc to validate shopId exists.
interface VisitItemInput {
  productId?: string;
  productName: string;
  left?: number;
  found?: number;
  added?: number;
  isSample?: boolean;
  sampleQty?: number;
}

export const saveVisit = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const shopId = (data.shopId || "").toString();
    const rawItems: VisitItemInput[] = Array.isArray(data.items) ? data.items : [];
    const outcome = data.outcome ?? null;
    const managerAvailable = data.managerAvailable ?? null;
    const notes = data.notes ?? null;
    const markedConversion = data.markedConversion ?? false;
    const visitDateMs = typeof data.visitDateMs === "number" ? data.visitDateMs : Date.now();

    if (!shopId) throw new HttpsError("invalid-argument", "shopId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const shopRef = db.collection("shops").doc(shopId);
      const shopSnap = await tx.get(shopRef);
      if (!shopSnap.exists) throw new HttpsError("not-found", "Shop not found");
      const shop = shopSnap.data()!;
      const shopName = shop["name"] || "";

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      // Compute soldSinceLastVisit per item (left - found, floored at 0),
      // stripping undefined keys — matches the original client mapping.
      const items = rawItems.map((it) => {
        const sold = (it.left != null && it.found != null) ?
          Math.max(0, it.left - it.found) :
          undefined;
        const item: Record<string, unknown> = {...it, soldSinceLastVisit: sold};
        for (const key of Object.keys(item)) {
          if (item[key] === undefined) delete item[key];
        }
        return item;
      });

      const sampleItems = items.filter((it) =>
        it["isSample"] && it["productId"] && (it["sampleQty"] as number) > 0);
      const productRefs = sampleItems.map((it) => db.collection("products").doc(it["productId"] as string));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const visitDate = new Date(visitDateMs);
      const visitRef = db.collection("visits").doc();

      tx.set(visitRef, {
        shopId,
        visitDate,
        items,
        outcome,
        managerAvailable,
        notes,
        markedConversion,
        visitedBy: actionBy,
        tenantId: 1,
        createdAt: now,
        isDeleted: false,
      });

      tx.update(shopRef, {lastVisitDate: visitDate});

      for (let i = 0; i < sampleItems.length; i++) {
        const it = sampleItems[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;

        const sampleQty = it["sampleQty"] as number;
        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = Math.max(0, currentStock - sampleQty);

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: it["productId"],
          productName: it["productName"],
          productSku: p["sku"] || "",
          type: "sample",
          quantity: -sampleQty,
          previousStock: currentStock,
          newStock,
          reason: `Sample given at ${shopName}`,
          notes: sampleQty > currentStock ?
            `Sampled ${sampleQty}, stock was ${currentStock}` :
            null,
          linkedShopId: shopId,
          linkedVisitId: visitRef.id,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
        });
      }

      return {visitId: visitRef.id};
    });

    return result;
  }
);

// ── deleteVisit ───────────────────────────────────────────────────────
// Staff-only field-ops action (visit.service.ts deleteVisit()). Same
// getDoc-then-batch race per sample item as saveVisit, same fix. Also
// closes the same race for the delete path itself: the original code had
// no guard against a repeated/double delete call, so a double-click could
// double-reverse stock (soft-delete update — like every soft delete in
// this app, see FirestoreService.softDelete — would just silently
// re-stamp isDeletedAt/deletedBy, but the reversal loop underneath it had
// no such protection). Re-reading the visit fresh inside the transaction
// makes the already-deleted check free — a repeat call is now a no-op
// instead of a second reversal, matching this codebase's stated
// idempotency requirement for anything that could plausibly be invoked
// twice on the same data.
export const deleteVisit = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const visitId = (data.visitId || "").toString();
    const reverseStock = data.reverseStock === true;
    if (!visitId) throw new HttpsError("invalid-argument", "visitId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const visitRef = db.collection("visits").doc(visitId);
      const visitSnap = await tx.get(visitRef);
      if (!visitSnap.exists) throw new HttpsError("not-found", "Visit not found");
      const visit = visitSnap.data()!;

      if (visit["isDeleted"]) {
        // Already deleted — idempotent no-op, not a second reversal.
        return {shopId: visit["shopId"], alreadyDeleted: true};
      }

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const items: Array<Record<string, any>> = visit["items"] || [];
      const sampleItems = reverseStock ?
        items.filter((it) => it["isSample"] && it["productId"] && (it["sampleQty"] || 0) > 0) :
        [];
      const productRefs = sampleItems.map((it) => db.collection("products").doc(it["productId"]));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      tx.update(visitRef, {
        isDeleted: true,
        isDeletedAt: now,
        deletedBy: actionBy,
      });

      for (let i = 0; i < sampleItems.length; i++) {
        const it = sampleItems[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;

        const sampleQty = it["sampleQty"] as number;
        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + sampleQty;

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: it["productId"],
          productName: it["productName"],
          productSku: p["sku"] || "",
          type: "sample_reversal",
          quantity: sampleQty,
          previousStock: currentStock,
          newStock,
          reason: "Reversed sample from deleted visit",
          notes: null,
          linkedShopId: visit["shopId"],
          linkedVisitId: visitId,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
        });
      }

      return {shopId: visit["shopId"], alreadyDeleted: false};
    });

    return result;
  }
);

// ── saveStockAdjustment ──────────────────────────────────────────────────
// Staff-only admin action (stock-adjustment-modal.component.ts
// saveSingle()). This site had NO read at all before — previousStock came
// straight off a live-listener signal (this.product(), fed by a
// getDocument() subscription), which can be arbitrarily stale relative to
// the actual write with no fresh-read step whatsoever — a WIDER race
// window than the getDoc-then-batch sites elsewhere in 5H, not a
// narrower one (see the 2026-07-28 re-audit). This migration adds the
// read that never existed, rather than converting an existing one.
//
// Direction is re-derived server-side from `type` via the same
// ADJUSTMENT_TYPE_DIRECTION mapping the client uses (stock-adjustment.
// model.ts) — for fixed-direction types the client's direction is
// ignored entirely, only trusted for 'correction' (the one type marked
// 'either'). This blocks a tampered request from flipping the sign on a
// type that has no legitimate "which way" ambiguity.
//
// Unlike order/sample paths, this type of manual correction has never
// clamped-and-recorded-full on an oversell — the original client blocked
// the save entirely if the result would go negative (isValid()'s
// noNegativeStock check). That's preserved as a hard reject here, not
// loosened into a clamp.
const ADJUSTMENT_TYPE_DIRECTION: Record<string, "in" | "out" | "either"> = {
  received: "in",
  sold: "out",
  damaged: "out",
  returned: "in",
  correction: "either",
  transfer: "out",
  sample: "out",
  sample_reversal: "in",
  opening_balance: "in",
};

export const saveStockAdjustment = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const productId = (data.productId || "").toString();
    const type = (data.type || "").toString();
    const quantity = Math.floor(Number(data.quantity) || 0);
    const clientDirection = data.direction === "out" ? "out" : "in";
    const reason = (data.reason || "").toString().trim();
    const notes = (data.notes || "").toString().trim();

    if (!productId) throw new HttpsError("invalid-argument", "productId is required");
    if (!ADJUSTMENT_TYPE_DIRECTION[type]) throw new HttpsError("invalid-argument", "Invalid adjustment type");
    if (quantity <= 0) throw new HttpsError("invalid-argument", "Quantity must be at least 1");
    if (!reason) throw new HttpsError("invalid-argument", "Please provide a reason");

    const mappedDirection = ADJUSTMENT_TYPE_DIRECTION[type];
    const direction = mappedDirection === "either" ? clientDirection : mappedDirection;

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const productRef = db.collection("products").doc(productId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists) throw new HttpsError("not-found", "Product not found");
      const product = productSnap.data()!;
      if (product["isDeleted"]) throw new HttpsError("not-found", "Product not found");

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const currentStock = product["stock"] || 0;
      const signedQty = direction === "in" ? quantity : -quantity;
      const newStock = currentStock + signedQty;
      if (newStock < 0) {
        throw new HttpsError("failed-precondition", "Cannot reduce stock below 0");
      }

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const adjRef = db.collection("stockAdjustments").doc();

      tx.set(adjRef, {
        productId,
        productName: product["name"] || "",
        productSku: product["sku"] || "",
        type,
        quantity: signedQty,
        previousStock: currentStock,
        newStock,
        reason,
        notes,
        adjustedBy: actionBy,
        createdAt: now,
        tenantId: 1,
        isDeleted: false,
      });

      tx.update(productRef, {stock: newStock, updatedAt: now});

      return {adjustmentId: adjRef.id, newStock};
    });

    return result;
  }
);

// ── saveStockAdjustments (multi-product) ─────────────────────────────────
// Staff-only admin action (stock-adjustment-modal.component.ts
// saveMulti()) — the multi-product variant of saveStockAdjustment, same
// migration reasoning: no read at all before (previousStock came off
// each item's captured allProducts() snapshot from add-time). One
// transaction spans every product in the batch — all-or-nothing, matching
// the original single writeBatch's atomicity. If ANY item would go
// negative, the WHOLE adjustment is rejected (not just that item),
// consistent with this being one save action, not N independent ones.
interface MultiStockAdjustmentItemInput {
  productId: string;
  quantity: number;
  direction: "in" | "out";
}

export const saveStockAdjustments = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const role = (auth.token["role"] as string) || "none";
    if (!STAFF_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "Staff only");
    }

    const data = request.data || {};
    const rawItems: MultiStockAdjustmentItemInput[] = Array.isArray(data.items) ? data.items : [];
    const type = (data.type || "").toString();
    const reason = (data.reason || "").toString().trim();
    const notes = (data.notes || "").toString().trim();

    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Add at least one product");
    if (!ADJUSTMENT_TYPE_DIRECTION[type]) throw new HttpsError("invalid-argument", "Invalid adjustment type");
    if (!reason) throw new HttpsError("invalid-argument", "Please provide a reason");
    for (const it of rawItems) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.productId || qty <= 0) {
        throw new HttpsError("invalid-argument", "Every item needs a quantity of at least 1");
      }
    }

    const mappedDirection = ADJUSTMENT_TYPE_DIRECTION[type];

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const productRefs = rawItems.map((it) => db.collection("products").doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      // Resolve every item before writing anything — an all-or-nothing
      // save, so any missing product or would-go-negative result rejects
      // the whole adjustment rather than partially applying it.
      const resolved = rawItems.map((it, i) => {
        const snap = productSnaps[i];
        if (!snap.exists) {
          throw new HttpsError("not-found", "One of the selected products no longer exists");
        }
        const product = snap.data()!;
        const direction = mappedDirection === "either" ?
          (it.direction === "out" ? "out" : "in") :
          mappedDirection;
        const qty = Math.floor(Number(it.quantity) || 0);
        const currentStock = product["stock"] || 0;
        const signedQty = direction === "in" ? qty : -qty;
        const newStock = currentStock + signedQty;
        if (newStock < 0) {
          throw new HttpsError(
            "failed-precondition",
            `${product["name"] || "A product"}: cannot reduce below 0`
          );
        }
        return {
          productId: it.productId,
          productName: product["name"] || "",
          productSku: product["sku"] || "",
          signedQty,
          currentStock,
          newStock,
        };
      });

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      for (const r of resolved) {
        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: r.productId,
          productName: r.productName,
          productSku: r.productSku,
          type,
          quantity: r.signedQty,
          previousStock: r.currentStock,
          newStock: r.newStock,
          reason,
          notes,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
        });

        tx.update(db.collection("products").doc(r.productId), {stock: r.newStock, updatedAt: now});
      }

      return {count: resolved.length};
    });

    return result;
  }
);
