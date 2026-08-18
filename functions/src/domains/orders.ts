import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db, sentryDsn, STAFF_ROLES} from "../core";
import {
  buildStaffActionBy,
  allocateOrderNumber,
  allocateReturnNumber,
  computeOrderTotals,
} from "../staff-transactions-shared";
import {
  normalizeCouponCode,
  validateAndComputeCoupons,
  redeemCoupons,
  releaseCoupons,
  releaseAllCoupons,
  AppliedCoupon,
} from "../coupon-shared";

// ═══ Order Placement (transactional) ═════════════════════════════════════
// Replaces client-side placeOrder. A Firestore transaction re-reads stock and
// the order sequence at commit time, so concurrent orders cannot oversell or
// collide on order numbers. Pulls real cost from products for correct margin.
// Stock floors at 0 for every item; backorder shortfall is captured explicitly.

interface PlaceOrderItem { productId: string; quantity: number; }

export const placeOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const linkedCustomerId = auth.token["linkedCustomerId"] as string | undefined;
    const role = (auth.token["role"] as string) || "none";
    const isCustomer = role === "customer";
    if (!isCustomer || !linkedCustomerId) {
      throw new HttpsError("permission-denied", "Only customers can place portal orders");
    }

    const data = request.data || {};
    const deliveryType: "delivery" | "pickup" = data.deliveryType === "pickup" ? "pickup" : "delivery";
    const notes: string = (data.notes || "").toString().slice(0, 2000);
    const rawItems: PlaceOrderItem[] = Array.isArray(data.items) ? data.items : [];
    const couponCodes: string[] = Array.isArray(data.couponCodes) ? data.couponCodes : [];

    if (rawItems.length === 0) {
      throw new HttpsError("invalid-argument", "Cart is empty");
    }
    // Collapse duplicate productIds, coerce qty to positive ints.
    const wanted = new Map<string, number>();
    for (const it of rawItems) {
      const pid = (it.productId || "").toString();
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!pid || qty <= 0) continue;
      wanted.set(pid, (wanted.get(pid) || 0) + qty);
    }
    if (wanted.size === 0) throw new HttpsError("invalid-argument", "No valid items");

    const result = await db.runTransaction(async (tx) => {
      // ── customer ──
      const custRef = db.collection("customers").doc(linkedCustomerId);
      const custSnap = await tx.get(custRef);
      if (!custSnap.exists) throw new HttpsError("not-found", "Customer not found");
      const cust = custSnap.data() || {};

      // ── ordering settings ──
      const orderingSnap = await tx.get(db.collection("settings").doc("ordering"));
      const ordering = orderingSnap.data() || {};
      const taxRatePercent = ordering["defaultTaxRatePercent"] ?? 13;
      const outOfStockBehavior = ordering["outOfStockBehavior"] || "show_disabled";

      // ── read all products FIRST (transaction rule: all reads before writes) ──
      const productRefs = [...wanted.keys()].map((pid) => db.collection("products").doc(pid));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      const lineItems: any[] = [];
      let subtotalCents = 0;
      let costTotalCents = 0;

      for (let i = 0; i < productSnaps.length; i++) {
        const snap = productSnaps[i];
        const pid = productRefs[i].id;
        const qty = wanted.get(pid)!;
        if (!snap.exists) {
          throw new HttpsError("failed-precondition", "A product is no longer available");
        }
        const p = snap.data() || {};
        if (p["isDeleted"] || p["active"] === false) {
          throw new HttpsError("failed-precondition", `${p["name"] || "An item"} is no longer available`);
        }

        const stock = p["stock"] || 0;
        const perProductBehavior = p["outOfStockBehaviorOverride"] ?? outOfStockBehavior;
        const allowBackorder = perProductBehavior === "allow_backorder";

        // Oversell guard — re-checked at commit time. Backorder items are exempt.
        if (!allowBackorder && qty > stock) {
          throw new HttpsError(
            "failed-precondition",
            `${p["name"] || "An item"} — only ${stock} left (you asked for ${qty})`,
            {productId: pid, available: stock, requested: qty, name: p["name"] || ""},
          );
        }

        const unitPriceCents = p["priceCents"] ?? 0;
        const unitCostCents = p["costCents"] ?? 0;
        const lineTotal = unitPriceCents * qty;
        subtotalCents += lineTotal;
        costTotalCents += unitCostCents * qty;

        // Stock floors at 0 for ALL items (keeps the app-wide stock>=0 invariant).
        // For backorder items exceeding stock, record the shortfall explicitly so
        // it's queryable and surfaced — never left implicit.
        const backorderedQty = allowBackorder ? Math.max(0, qty - stock) : 0;

        lineItems.push({
          productId: pid,
          productName: p["name"] || "Unnamed product",
          productSku: p["sku"] || "",
          quantity: qty,
          unitPriceCents,
          lineTotalCents: lineTotal,
          costCents: unitCostCents,
          lineCostCents: unitCostCents * qty,
          lineMarginCents: lineTotal - unitCostCents * qty,
          backorderedQty, // 0 when fully in stock
          _newStock: Math.max(0, stock - qty), // never negative
          _prevStock: stock,
        });
      }

      // ── order sequence (transactional) ──
      // Unified onto orderSequence.prefix (via allocateOrderNumber) rather
      // than the ordering.orderPrefix this used to read — a deliberate,
      // known change (Prompt 5 phase 5.8.8): the two diverged in prod
      // ("TRX" vs "TW"), and orderSequence.prefix was chosen as canonical
      // since createAdminOrder already used it. Confirm the real prod
      // orderSequence.prefix value is the intended one before this reaches
      // prod traffic.
      const seqRef = db.collection("settings").doc("orderSequence");
      const {number: orderNumber, nextSeq} = await allocateOrderNumber(tx);

      // ── coupons (read/validate — still the read phase) ──
      const {appliedCoupons, couponDiscountCents, redemptionPlan} =
        await validateAndComputeCoupons(tx, couponCodes, subtotalCents, linkedCustomerId);

      // ── totals ──
      const manualDiscountCents = 0; // portal self-checkout has no manual-discount concept
      const discountCents = manualDiscountCents + couponDiscountCents;
      const {taxCents, totalCents} = computeOrderTotals(subtotalCents, discountCents, taxRatePercent);
      const marginCents = subtotalCents - costTotalCents;

      const hasBackorder = lineItems.some((li) => li.backorderedQty > 0);
      const totalBackorderedUnits = lineItems.reduce((s, li) => s + li.backorderedQty, 0);

      // Modular import (not admin.firestore.FieldValue) — the old
      // namespace-style static access crashes inside the Functions
      // Emulator when combined with this file's named-database
      // db.settings() call; see the import comment at the top of this
      // file and place-order.spec.ts for the full diagnosis. Production
      // (real Cloud Functions runtime, not the local emulator) is
      // unaffected either way — this only matters for local testing.
      const now = FieldValue.serverTimestamp();
      const orderRef = db.collection("orders").doc();

      // Strip internal _newStock/_prevStock; backorderedQty stays on the stored line.
      const orderItems = lineItems.map(({_newStock, _prevStock, ...rest}) => rest);

      // ── WRITES (all reads are done) ──
      tx.set(orderRef, {
        orderNumber,
        customerId: linkedCustomerId,
        customerName: cust["businessName"] ||
          `${cust["ownerFirstName"] || ""} ${cust["ownerLastName"] || ""}`.trim(),
        customerEmail: cust["email"] || "",
        customerPhone: cust["phone"] || "",
        serviceAreaId: cust["serviceAreaId"] || null,
        serviceAreaName: cust["serviceAreaName"] || cust["serviceAreaCustom"] || "",
        status: "confirmed",
        source: "customer_portal",
        deliveryType,
        items: orderItems,
        subtotalCents,
        discountCents,
        manualDiscountCents,
        couponDiscountCents,
        appliedCoupons,
        taxRatePercent,
        taxCents,
        totalCents,
        costTotalCents,
        marginCents,
        hasBackorder,
        totalBackorderedUnits,
        amountPaidCents: 0,
        balanceCents: totalCents,
        paymentStatus: "unpaid",
        customerNotes: notes,
        tenantId: 1,
        isDeleted: false,
        confirmedAt: now,
        createdAt: now,
      });

      tx.update(custRef, {
        lastOrderAt: now,
        totalOrderedCents: (cust["totalOrderedCents"] || 0) + totalCents,
        totalOwingCents: (cust["totalOwingCents"] || 0) + totalCents,
      });

      tx.set(seqRef, {sequence: nextSeq}, {merge: true});

      redeemCoupons(tx, redemptionPlan, orderRef.id, now);

      for (const li of lineItems) {
        tx.update(db.collection("products").doc(li.productId), {stock: li._newStock});
        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: li.productId,
          productName: li.productName,
          productSku: li.productSku,
          type: "sold",
          quantity: -li.quantity,
          previousStock: li._prevStock,
          newStock: li._newStock,
          reason: `Order ${orderNumber} (portal)`,
          adjustedBy: {
            uid: auth.uid,
            firstName: cust["ownerFirstName"] || cust["businessName"] || "Portal customer",
            lastName: cust["ownerLastName"] || "",
          },
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderRef.id,
          linkedOrderNumber: orderNumber,
        });
      }

      return {orderId: orderRef.id, orderNumber, hasBackorder, totalBackorderedUnits};
    });

    return result;
  }
);

// ── cancelOrder / submitReturn ──────────────────────────────────────────
// Portal self-service cancellation and returns used to write directly from
// the client via a Firestore batch touching orders/customers/settings/
// products/stockAdjustments — all staff-only or narrowly-scoped collections
// under firestore.rules. That batch was permission-denied for every real
// customer (Firestore batches are all-or-nothing across every write), so
// these two features never actually worked end to end. Moved server-side,
// same reasoning as placeOrder: re-validate ownership/state against the
// stored order rather than trusting the client, and use the Admin SDK for
// the writes rules correctly keep staff-only.

export const cancelOrder = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const linkedCustomerId = auth.token["linkedCustomerId"] as string | undefined;
    const role = (auth.token["role"] as string) || "none";
    if (role !== "customer" || !linkedCustomerId) {
      throw new HttpsError("permission-denied", "Only customers can cancel their own orders");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const reason = (data.reason || "").toString().trim().slice(0, 2000);
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (!reason) throw new HttpsError("invalid-argument", "A cancellation reason is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;

      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (order["customerId"] !== linkedCustomerId) {
        throw new HttpsError("permission-denied", "This order does not belong to you");
      }
      // Portal can only cancel while still confirmed — matches the
      // client-side canCancel gate, re-checked here server-side rather
      // than trusted from the client.
      if (order["status"] !== "confirmed") {
        throw new HttpsError(
          "failed-precondition",
          "Only orders that haven't shipped yet can be cancelled"
        );
      }

      const custRef = db.collection("customers").doc(linkedCustomerId);
      const custSnap = await tx.get(custRef);
      const cust = custSnap.exists ? custSnap.data()! : {};

      const items: any[] = order["items"] || [];
      const productRefs = items.map((it) => db.collection("products").doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      const amountPaid = order["amountPaidCents"] || 0;

      // A credit/refund audit record is only needed when money already
      // changed hands — reserve a return number for it now (read before
      // write) so the whole thing stays one atomic transaction.
      const retSeqRef = db.collection("settings").doc("returnSequence");
      let returnNumber = "";
      let nextRetSeq = 0;
      if (amountPaid > 0) {
        const allocation = await allocateReturnNumber(tx);
        returnNumber = allocation.number;
        nextRetSeq = allocation.nextSeq;
      }

      // Terminal coupon release — order is now dead. Guarded by
      // couponsReleasedAt so this never double-decrements a usedCount
      // shared with other customers (see coupon-shared.ts's release docs).
      // Must run in the read phase (releaseAllCoupons does its own
      // get-then-write) — before any of cancelOrder's own writes below.
      const appliedCoupons = order["appliedCoupons"] || [];
      const shouldReleaseCoupons = appliedCoupons.length > 0 && !order["couponsReleasedAt"];
      if (shouldReleaseCoupons) {
        await releaseAllCoupons(tx, appliedCoupons, linkedCustomerId);
      }

      const now = FieldValue.serverTimestamp();
      const actionBy = {
        uid: auth.uid,
        firstName: cust["ownerFirstName"] || cust["businessName"] || "Portal customer",
        lastName: cust["ownerLastName"] || "",
      };

      // ── writes ──
      tx.update(orderRef, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actionBy,
        cancellationReason: reason,
        cancelledByPortal: true,
        balanceCents: 0,
        paymentStatus: "unpaid",
        ...(shouldReleaseCoupons ? {couponsReleasedAt: now} : {}),
      });

      const totalOrdered = (cust["totalOrderedCents"] || 0) - (order["totalCents"] || 0);
      const totalOwing = (cust["totalOwingCents"] || 0) - (order["balanceCents"] || 0);
      const custUpdates: Record<string, unknown> = {
        totalOrderedCents: Math.max(0, totalOrdered),
        totalOwingCents: Math.max(0, totalOwing),
      };
      if (amountPaid > 0) {
        custUpdates["totalPaidCents"] =
          Math.max(0, (cust["totalPaidCents"] || 0) - amountPaid);
        custUpdates["creditBalanceCents"] =
          (cust["creditBalanceCents"] || 0) + amountPaid;
      }
      tx.update(custRef, custUpdates);

      if (amountPaid > 0) {
        tx.set(retSeqRef, {sequence: nextRetSeq}, {merge: true});
        const creditRef = db.collection("returns").doc();
        tx.set(creditRef, {
          returnNumber,
          orderId,
          orderNumber: order["orderNumber"],
          customerId: linkedCustomerId,
          customerName: order["customerName"],
          customerEmail: order["customerEmail"] || "",
          customerPhone: order["customerPhone"] || "",
          type: "refund",
          status: "approved",
          source: "cancellation",
          reasonCode: "order_cancelled",
          reason: `Order cancelled by customer. Reason: ${reason}`,
          items: items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents,
          })),
          amountCents: amountPaid,
          stockRestored: true,
          stockAdjustmentIds: [],
          refundMethod: "store_credit",
          tenantId: 1,
          isDeleted: false,
          createdAt: now,
          createdBy: actionBy,
          processedAt: now,
          processedBy: actionBy,
        });
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;
        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + item.quantity;

        tx.update(productRefs[i], {stock: newStock});
        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          type: "returned",
          quantity: item.quantity,
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} cancelled by customer`,
          notes: `Reason: ${reason}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderRef.id,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

interface SubmitReturnItem {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
}

export const submitReturn = onCall(
  {
    region: "northamerica-northeast2",
    cors: true,
    secrets: [sentryDsn],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Must be signed in");

    const linkedCustomerId = auth.token["linkedCustomerId"] as string | undefined;
    const role = (auth.token["role"] as string) || "none";
    const isStaffCaller = STAFF_ROLES.includes(role);
    const isCustomerCaller = role === "customer" && !!linkedCustomerId;
    if (!isStaffCaller && !isCustomerCaller) {
      throw new HttpsError("permission-denied", "Only staff or the owning customer can submit a return");
    }

    const data = request.data || {};
    const orderId = (data.orderId || "").toString();
    const returnType = data.returnType === "refund" ? "refund" : "credit_note";
    const reasonCode = (data.reasonCode || "other").toString();
    const notes = (data.notes || "").toString().slice(0, 2000);
    // Staff-only: shown on the admin return detail regardless of status,
    // never customer-facing (see admin-returns.component.html).
    const internalNotes = isStaffCaller ? (data.internalNotes || "").toString().slice(0, 2000) : "";
    const rawItems: SubmitReturnItem[] = Array.isArray(data.items) ? data.items : [];

    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Select at least one item to return");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;

      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      // A portal customer may only return their own order; staff can
      // submit a return for any customer's order (admin-created-return
      // flow — formerly a separate client-side batch write, consolidated
      // onto this callable so return creation is server-owned end to end,
      // same trust boundary as placeOrder/cancelOrder/approveReturn).
      if (isCustomerCaller && order["customerId"] !== linkedCustomerId) {
        throw new HttpsError("permission-denied", "This order does not belong to you");
      }
      const customerId = order["customerId"] as string;
      // Matches the client-side canSubmitReturn gate — a return can only
      // be requested once the order has actually been delivered.
      if (order["status"] !== "delivered") {
        throw new HttpsError(
          "failed-precondition",
          "Returns can only be submitted for delivered orders"
        );
      }

      const orderItems: any[] = order["items"] || [];
      const orderItemsByProduct = new Map(orderItems.map((it) => [it.productId, it]));

      const orderSubtotalCents = order["subtotalCents"] || 0;
      const orderDiscountCents = order["discountCents"] || 0;
      const taxRatePercent = order["taxRatePercent"] || 0;
      // Guard the >100%-discount clamp case, same as computeOrderTotals
      // clamping taxableCents at 0.
      const effectiveDiscountCents = Math.min(orderDiscountCents, orderSubtotalCents);

      // Server-authoritative: quantity and price come from the stored
      // order line, never from the client — a return can't be padded
      // past what was actually ordered or priced differently.
      const returnItems: any[] = [];
      let returnGrossCents = 0;
      for (const raw of rawItems) {
        const pid = (raw.productId || "").toString();
        const orderLine = orderItemsByProduct.get(pid);
        if (!orderLine) {
          throw new HttpsError("invalid-argument", "One of the return items wasn't part of this order");
        }
        const qty = Math.floor(Number(raw.quantity) || 0);
        if (qty <= 0 || qty > orderLine.quantity) {
          throw new HttpsError(
            "invalid-argument",
            `Return quantity for ${orderLine.productName} must be between 1 and ${orderLine.quantity}`
          );
        }
        const lineTotalCents = orderLine.unitPriceCents * qty;
        returnGrossCents += lineTotalCents;
        returnItems.push({
          productId: pid,
          productName: orderLine.productName,
          productSku: orderLine.productSku,
          quantity: qty,
          unitPriceCents: orderLine.unitPriceCents,
          lineTotalCents,
        });
      }

      // Refund net-of-discount, plus-tax, using the order's frozen
      // snapshot — same discount-first-then-tax ordering as
      // computeOrderTotals, applied to the returned share of the order.
      // Customers are credited what they actually paid for the returned
      // units, not the gross line price.
      const discountShareCents = orderSubtotalCents > 0 ?
        Math.round((effectiveDiscountCents * returnGrossCents) / orderSubtotalCents) :
        0;
      const returnNetCents = Math.max(0, returnGrossCents - discountShareCents);
      const returnTaxCents = Math.round((returnNetCents * taxRatePercent) / 100);
      let amountCents = returnNetCents + returnTaxCents;

      // isFullReturn: does this return, once approved, account for every
      // unit on the order? The existing return model has no cumulative
      // returned-quantity tracking at all (pre-existing gap, unrelated to
      // coupons) — this is the minimal addition needed to know when a
      // coupon's redemption slot should free up. Counts pending+approved
      // prior returns (their eventual approval isn't guaranteed, so this
      // can go stale if a counted pending return is later rejected via the
      // admin's direct rejectReturn() write — accepted v1 limitation, same
      // looseness the rest of the return model already has).
      const priorReturnsSnap = await tx.get(
        db.collection("returns").where("orderId", "==", orderId).where("isDeleted", "==", false)
      );
      const returnedByProduct = new Map<string, number>();
      for (const doc of priorReturnsSnap.docs) {
        const r = doc.data();
        if (r["status"] === "rejected") continue;
        for (const it of (r["items"] || [])) {
          returnedByProduct.set(it.productId, (returnedByProduct.get(it.productId) || 0) + (it.quantity || 0));
        }
      }
      for (const ri of returnItems) {
        returnedByProduct.set(ri.productId, (returnedByProduct.get(ri.productId) || 0) + ri.quantity);
      }
      const isFullReturn = orderItems.every(
        (oi) => (returnedByProduct.get(oi.productId) || 0) >= (oi.quantity || 0)
      );

      // Proportional discount/tax shares won't sum back to totalCents
      // exactly across multiple partial returns (rounding drift) — on the
      // return that completes the order, true up to what's actually left
      // instead of trusting the formula, so the order zeroes out clean.
      // Prior *approved* returns have already been subtracted from
      // order.totalCents by approveReturn; only pending ones (not yet
      // applied) still need to be netted out here.
      if (isFullReturn) {
        let pendingPriorAmountCents = 0;
        for (const doc of priorReturnsSnap.docs) {
          const r = doc.data();
          if (r["status"] === "pending") pendingPriorAmountCents += r["amountCents"] || 0;
        }
        amountCents = Math.max(0, (order["totalCents"] || 0) - pendingPriorAmountCents);
      }

      const [allocation, custSnap, staffActionBy] = await Promise.all([
        allocateReturnNumber(tx),
        tx.get(db.collection("customers").doc(customerId)),
        isStaffCaller ? buildStaffActionBy(tx, auth.uid) : Promise.resolve(null),
      ]);
      const {number: returnNumber, nextSeq} = allocation;
      const cust = custSnap.exists ? custSnap.data()! : {};

      const now = FieldValue.serverTimestamp();
      const returnRef = db.collection("returns").doc();

      // ── writes ──
      tx.set(returnRef, {
        returnNumber,
        orderId,
        orderNumber: order["orderNumber"],
        customerId,
        customerName: order["customerName"],
        customerEmail: order["customerEmail"] || "",
        type: returnType,
        status: "pending",
        source: isStaffCaller ? "admin" : "customer_portal",
        reasonCode,
        reason: notes || reasonCode,
        ...(internalNotes ? {internalNotes} : {}),
        items: returnItems,
        amountCents,
        isFullReturn,
        stockRestored: false,
        tenantId: 1,
        isDeleted: false,
        createdAt: now,
        createdBy: staffActionBy || {
          uid: auth.uid,
          firstName: cust["ownerFirstName"] || cust["businessName"] || "Portal customer",
          lastName: cust["ownerLastName"] || "",
        },
      });
      tx.set(db.collection("settings").doc("returnSequence"), {sequence: nextSeq}, {merge: true});

      return {returnId: returnRef.id, returnNumber};
    });

    return result;
  }
);

// ── approveReturn ────────────────────────────────────────────────────────
// Staff-only admin action (admin-returns.component.ts). Used to be a
// client Firestore writeBatch that took a getDoc() read of the order/
// customer/product docs, then committed the batch — the read is never
// re-validated at commit time, so two concurrent approvals (two staff
// tabs, a retry) can race on the same product's stock. Same defect class
// as placeOrder pre-migration; moved to a runTransaction so every read is
// re-taken atomically with the write. Money/customer-counter logic is
// unchanged from the original component method — see git history on
// admin-returns.component.ts for the pre-migration version this mirrors.

export const approveReturn = onCall(
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
    const returnId = (data.returnId || "").toString();
    const restoreStock = data.restoreStock !== false; // defaults true, matches the component signal
    const refundMethod = (data.refundMethod || "").toString();
    const refundReferenceNumber = (data.refundReferenceNumber || "").toString().trim();

    if (!returnId) throw new HttpsError("invalid-argument", "returnId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const returnRef = db.collection("returns").doc(returnId);
      const returnSnap = await tx.get(returnRef);
      if (!returnSnap.exists) throw new HttpsError("not-found", "Return not found");
      const ret = returnSnap.data()!;
      if (ret["isDeleted"]) throw new HttpsError("not-found", "Return not found");

      if (ret["type"] === "refund" && !refundMethod) {
        throw new HttpsError("invalid-argument", "refundMethod is required for a refund");
      }

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const orderRef = db.collection("orders").doc(ret["orderId"]);
      const orderSnap = await tx.get(orderRef);

      const customerRef = db.collection("customers").doc(ret["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const items: Array<Record<string, any>> = ret["items"] || [];
      const productRefs = items.map((it) => db.collection("products").doc(it["productId"]));
      const productSnaps = restoreStock ?
        await Promise.all(productRefs.map((r) => tx.get(r))) :
        [];

      // Terminal coupon release, only for a full return (see isFullReturn's
      // doc comment in submitReturn for what "full" means and its
      // accepted staleness limitation) — same couponsReleasedAt guard as
      // cancelOrder/cancelAdminOrder. A partial return never touches
      // appliedCoupons/couponDiscountCents (see plan: the return model
      // doesn't recompute subtotal/discount/tax on partial returns either).
      const orderForCoupons = orderSnap.exists ? orderSnap.data()! : null;
      const appliedCoupons: AppliedCoupon[] = orderForCoupons?.["appliedCoupons"] || [];
      const shouldReleaseCoupons = ret["isFullReturn"] === true &&
        appliedCoupons.length > 0 && !orderForCoupons?.["couponsReleasedAt"];
      if (shouldReleaseCoupons) {
        await releaseAllCoupons(tx, appliedCoupons, ret["customerId"]);
      }

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const returnUpdates: Record<string, unknown> = {
        status: "approved",
        processedBy: actionBy,
        processedAt: now,
        stockRestored: restoreStock,
      };

      if (ret["type"] === "refund") {
        returnUpdates["refundMethod"] = refundMethod;
        returnUpdates["refundedAt"] = now;
        returnUpdates["refundedBy"] = actionBy;
        if (refundReferenceNumber) returnUpdates["refundReferenceNumber"] = refundReferenceNumber;
      }

      if (orderSnap.exists) {
        const order = orderSnap.data()!;
        const amountCents = ret["amountCents"] || 0;
        const newTotal = Math.max(0, (order["totalCents"] || 0) - amountCents);
        const newBalance = Math.max(0, (order["balanceCents"] || 0) - amountCents);
        const newAmountPaid = Math.min(newTotal, order["amountPaidCents"] || 0);
        const newPaymentStatus = newBalance <= 0 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";

        tx.update(orderRef, {
          totalCents: newTotal,
          balanceCents: newBalance,
          amountPaidCents: newAmountPaid,
          paymentStatus: newPaymentStatus,
          ...(shouldReleaseCoupons ? {couponsReleasedAt: now} : {}),
        });
      }

      if (customerSnap.exists) {
        const cust = customerSnap.data()!;
        const amountCents = ret["amountCents"] || 0;
        const custUpdates: Record<string, unknown> = {
          totalOrderedCents: Math.max(0, (cust["totalOrderedCents"] || 0) - amountCents),
        };
        if (ret["type"] === "credit_note") {
          custUpdates["totalOwingCents"] = Math.max(0, (cust["totalOwingCents"] || 0) - amountCents);
        } else if (ret["type"] === "refund") {
          custUpdates["totalPaidCents"] = Math.max(0, (cust["totalPaidCents"] || 0) - amountCents);
        }
        tx.update(customerRef, custUpdates);
      }

      if (restoreStock) {
        const stockAdjustmentIds: string[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const snap = productSnaps[i];
          if (!snap.exists) continue;
          const p = snap.data()!;
          const currentStock = p["stock"] || 0;
          const newStock = currentStock + (item["quantity"] || 0);

          tx.update(productRefs[i], {stock: newStock});

          const adjRef = db.collection("stockAdjustments").doc();
          stockAdjustmentIds.push(adjRef.id);
          tx.set(adjRef, {
            productId: item["productId"],
            productName: item["productName"],
            productSku: item["productSku"],
            type: "returned",
            quantity: item["quantity"],
            previousStock: currentStock,
            newStock,
            reason: `Return ${ret["returnNumber"]} approved`,
            notes: `Return reason: ${ret["reason"]}`,
            adjustedBy: actionBy,
            createdAt: now,
            tenantId: 1,
            isDeleted: false,
            linkedOrderId: ret["orderId"],
            linkedOrderNumber: ret["orderNumber"],
          });
        }
        returnUpdates["stockAdjustmentIds"] = stockAdjustmentIds;
      }

      tx.update(returnRef, returnUpdates);

      return {returnNumber: ret["returnNumber"]};
    });

    return result;
  }
);


// ── createAdminOrder ─────────────────────────────────────────────────────
// Staff-only admin action (order-form.component.ts saveOrder(), create
// mode). Used to be a client writeBatch that took a getDoc() read of each
// product before committing (same race as approveReturn/
// receivePurchaseOrder), preceded by its own order-number sequence read —
// and that sequence tracked a *different* field (`lastNumber`) than the
// one placeOrder uses (`sequence`) on the very same settings/orderSequence
// document, so a portal order and an admin-created order could land on
// the identical order number. Moved to a single runTransaction reusing
// placeOrder's `sequence` field: nextSeq is one past whichever of the two
// legacy counters is higher, so nothing already issued under either
// scheme can collide, and both paths share `sequence` from here on.
// Unlike placeOrder, staff may still set a custom unitPriceCents per line
// (negotiated pricing, a pre-existing capability) — that trust boundary
// is unchanged; this migration only fixes the stock/sequence race.
interface AdminOrderItemInput {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export const createAdminOrder = onCall(
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
    const customerId = (data.customerId || "").toString();
    const rawItems: AdminOrderItemInput[] = Array.isArray(data.items) ? data.items : [];
    const manualDiscountCents = Math.floor(Number(data.discountCents) || 0);
    const couponCodes: string[] = Array.isArray(data.couponCodes) ? data.couponCodes : [];
    const taxRatePercent = Number(data.taxRatePercent) || 0;
    const deliveryType: "delivery" | "pickup" = data.deliveryType === "pickup" ? "pickup" : "delivery";
    const customerNotes = (data.customerNotes || "").toString().slice(0, 2000) || null;
    const internalNotes = (data.internalNotes || "").toString().slice(0, 2000) || null;
    // Epoch ms computed client-side from the browser's local midnight
    // (dateInputToLocalDate) — recomputing "local midnight" here would
    // use the Functions runtime's timezone (UTC), not the browser's, and
    // silently shift the stored date by the offset between them.
    const expectedDeliveryDateMs = typeof data.expectedDeliveryDateMs === "number" ?
      data.expectedDeliveryDateMs :
      null;

    if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");
    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Add at least one item");
    for (const it of rawItems) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.productId || qty <= 0) {
        throw new HttpsError("invalid-argument", "All items must have a quantity greater than 0");
      }
    }

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const custRef = db.collection("customers").doc(customerId);
      const custSnap = await tx.get(custRef);
      if (!custSnap.exists) throw new HttpsError("not-found", "Customer not found");
      const cust = custSnap.data()!;

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      let serviceAreaName = "";
      if (cust["serviceAreaId"]) {
        const saSnap = await tx.get(db.collection("serviceAreas").doc(cust["serviceAreaId"]));
        if (saSnap.exists && !saSnap.data()!["isDeleted"]) {
          serviceAreaName = saSnap.data()!["name"] || "";
        }
      }

      const seqRef = db.collection("settings").doc("orderSequence");
      const {number: orderNumber, nextSeq} = await allocateOrderNumber(tx);

      // Products: read fresh inside the transaction (the race this
      // migration exists to fix) — but item name/sku/price/cost stay
      // client-supplied; staff pricing overrides are unchanged.
      const productRefs = rawItems.map((it) => db.collection("products").doc(it.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // Item/subtotal computation is pure JS (no Firestore calls) — done
      // here, still within the read phase, so coupon validation below (a
      // real read) can use the real subtotal before any write happens.
      const items = rawItems.map((it) => {
        const qty = Math.floor(Number(it.quantity) || 0);
        const unitPriceCents = Math.floor(Number(it.unitPriceCents) || 0);
        const unitCostCents = Math.floor(Number(it.unitCostCents) || 0);
        return {
          productId: it.productId,
          productName: it.productName,
          productSku: it.productSku,
          quantity: qty,
          unitPriceCents,
          unitCostCents,
          lineTotalCents: qty * unitPriceCents,
          lineCostCents: qty * unitCostCents,
          currencyCode: "CAD",
        };
      });
      const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);

      // ── coupons (read/validate — still the read phase) ──
      const {appliedCoupons, couponDiscountCents, redemptionPlan} =
        await validateAndComputeCoupons(tx, couponCodes, subtotalCents, customerId);
      const discountCents = manualDiscountCents + couponDiscountCents;

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const orderRef = db.collection("orders").doc();

      const {taxCents, totalCents} = computeOrderTotals(subtotalCents, discountCents, taxRatePercent);
      const totalCostCents = items.reduce((sum, i) => sum + i.lineCostCents, 0);

      tx.set(orderRef, {
        orderNumber,
        customerId,
        customerName: cust["businessName"] || "",
        customerPhone: cust["phone"] ?? null,
        customerEmail: cust["email"] || "",
        serviceAreaId: cust["serviceAreaId"] || null,
        serviceAreaName: serviceAreaName || null,
        items,
        subtotalCents,
        taxRatePercent,
        taxCents,
        discountCents,
        manualDiscountCents,
        couponDiscountCents,
        appliedCoupons,
        totalCents,
        currencyCode: "CAD",
        totalCostCents,
        marginCents: totalCents - totalCostCents,
        status: "confirmed",
        paymentStatus: "unpaid",
        amountPaidCents: 0,
        balanceCents: totalCents,
        source: "admin_created",
        deliveryType,
        customerNotes,
        internalNotes,
        expectedDeliveryDate: expectedDeliveryDateMs != null ? new Date(expectedDeliveryDateMs) : null,
        confirmedAt: now,
        confirmedBy: actionBy,
        tenantId: 1,
        createdAt: now,
        createdBy: actionBy,
        isDeleted: false,
      });

      tx.update(custRef, {
        totalOrderedCents: (cust["totalOrderedCents"] || 0) + totalCents,
        totalOwingCents: (cust["totalOwingCents"] || 0) + totalCents,
        lastOrderAt: now,
      });

      redeemCoupons(tx, redemptionPlan, orderRef.id, now);

      tx.set(seqRef, {sequence: nextSeq}, {merge: true});

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue; // matches original: skip stock entirely if the product doc is gone

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        // Clamp at 0, oversell allowed — staff already confirmed via the
        // client-side warning dialog; no server-side oversell block for
        // admin-created orders (unlike placeOrder's portal guard).
        const newStock = Math.max(0, currentStock - item.quantity);

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          type: "sold",
          quantity: -item.quantity,
          previousStock: currentStock,
          newStock,
          reason: `Order ${orderNumber}`,
          notes: null,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderRef.id,
          linkedOrderNumber: orderNumber,
        });
      }

      return {orderId: orderRef.id, orderNumber};
    });

    return result;
  }
);

// ── updateAdminOrder ─────────────────────────────────────────────────────
// Staff-only admin action (order-form.component.ts saveEditedOrder()).
// Used to be a client writeBatch keyed off originalOrder() — a live
// listener snapshot that could be stale by the time save ran — plus a
// getDoc()-then-batch race on the customer doc and every touched product,
// same defect class as the other 5H sites. Moved to a runTransaction that
// re-reads the order fresh: the diff baseline (originalItems, totalCents,
// amountPaidCents, status) all come from the transaction's own read, never
// from whatever the client had open. New item data (name/sku/qty/price/
// cost) stays client-supplied, same trust boundary as createAdminOrder.
interface AdminOrderItemInput2 {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export const updateAdminOrder = onCall(
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
    const orderId = (data.orderId || "").toString();
    const rawItems: AdminOrderItemInput2[] = Array.isArray(data.items) ? data.items : [];
    const manualDiscountCents = Math.floor(Number(data.discountCents) || 0);
    // Full desired set of coupon codes for the edited order (same
    // convention as items — the complete target list, not a delta).
    const couponCodes: string[] = Array.isArray(data.couponCodes) ? data.couponCodes : [];
    const taxRatePercent = Number(data.taxRatePercent) || 0;
    const deliveryType: "delivery" | "pickup" = data.deliveryType === "pickup" ? "pickup" : "delivery";
    const customerNotes = (data.customerNotes || "").toString().slice(0, 2000) || null;
    const internalNotes = (data.internalNotes || "").toString().slice(0, 2000) || null;
    const expectedDeliveryDateMs = typeof data.expectedDeliveryDateMs === "number" ?
      data.expectedDeliveryDateMs :
      null;

    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (rawItems.length === 0) throw new HttpsError("invalid-argument", "Add at least one item");
    for (const it of rawItems) {
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!it.productId || qty <= 0) {
        throw new HttpsError("invalid-argument", "All items must have a quantity greater than 0");
      }
    }

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;
      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      // Matches the client-side load-time gate in loadOrderForEdit — only
      // 'confirmed' orders are editable via this form (narrower than the
      // general edit-window documented for order status elsewhere; this
      // migration preserves the existing gate as-is, not broaden it).
      if (order["status"] !== "confirmed") {
        throw new HttpsError("failed-precondition", "Only confirmed orders can be edited");
      }

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const customerRef = db.collection("customers").doc(order["customerId"]);
      const customerSnap = await tx.get(customerRef);

      // ── coupon diff setup ──
      // Belt-and-suspenders: updateAdminOrder is already gated to
      // status === 'confirmed' above, and the terminal release paths
      // (cancelOrder/cancelAdminOrder/approveReturn) always move status
      // away from 'confirmed' — so this should be unreachable today. Still
      // block it explicitly: redeeming onto an order that's already been
      // terminally released would leak a live redemption that no future
      // cancel/return could ever release again (couponsReleasedAt already
      // set, so releaseAllCoupons would never be called a second time).
      const existingAppliedCoupons: AppliedCoupon[] = order["appliedCoupons"] || [];
      const requestedCodes = [...new Set(couponCodes.map(normalizeCouponCode).filter(Boolean))];
      const existingCodesSet = new Set(existingAppliedCoupons.map((c) => c.couponId));
      const codesToAdd = requestedCodes.filter((c) => !existingCodesSet.has(c));
      const requestedCodesSet = new Set(requestedCodes);
      const couponsToRemove = existingAppliedCoupons.filter((c) => !requestedCodesSet.has(c.couponId));
      const unchangedCoupons = existingAppliedCoupons.filter((c) => requestedCodesSet.has(c.couponId));

      if (codesToAdd.length > 0 && order["couponsReleasedAt"]) {
        throw new HttpsError(
          "failed-precondition",
          "This order's coupons have already been released and can't be re-applied"
        );
      }

      const newItems = rawItems.map((it) => {
        const qty = Math.floor(Number(it.quantity) || 0);
        const unitPriceCents = Math.floor(Number(it.unitPriceCents) || 0);
        const unitCostCents = Math.floor(Number(it.unitCostCents) || 0);
        return {
          productId: it.productId,
          productName: it.productName,
          productSku: it.productSku,
          quantity: qty,
          unitPriceCents,
          unitCostCents,
          lineTotalCents: qty * unitPriceCents,
          lineCostCents: qty * unitCostCents,
          currencyCode: "CAD",
        };
      });

      const originalItems: Array<Record<string, any>> = order["items"] || [];
      const originalMap = new Map(originalItems.map((it) => [it["productId"], it["quantity"] || 0]));
      const newMap = new Map(newItems.map((it) => [it.productId, it.quantity]));
      const allProductIds = new Set([...originalMap.keys(), ...newMap.keys()]);

      const productRefs = [...allProductIds].map((pid) => db.collection("products").doc(pid));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));
      const productSnapByPid = new Map([...allProductIds].map((pid, i) => [pid, productSnaps[i]]));

      const subtotalCents = newItems.reduce((sum, i) => sum + i.lineTotalCents, 0);

      // ── coupons (still the read phase) ──
      // Unchanged coupons' stackable flag: only needed if we're adding new
      // codes, to check the FULL resulting set's compatibility (not just
      // the newly-added codes in isolation).
      let existingAllStackable = true;
      if (codesToAdd.length > 0 && unchangedCoupons.length > 0) {
        const unchangedSnaps = await Promise.all(
          unchangedCoupons.map((c) => tx.get(db.collection("coupons").doc(c.couponId)))
        );
        existingAllStackable = unchangedSnaps.every((s) => s.exists && s.data()?.["stackable"] !== false);
      }

      const {appliedCoupons: newlyAddedCoupons, redemptionPlan} = await validateAndComputeCoupons(
        tx, codesToAdd, subtotalCents, order["customerId"],
        {count: unchangedCoupons.length, allStackable: existingAllStackable}
      );

      // Removed coupons release now (own get-then-write, still before any
      // of this function's own writes below) — never touches
      // couponsReleasedAt, see coupon-shared.ts's releaseCoupons doc.
      if (couponsToRemove.length > 0) {
        await releaseCoupons(tx, couponsToRemove, order["customerId"]);
      }

      // Percentage-type coupons still on the order must be recomputed
      // against the possibly-changed subtotal on every edit — the
      // appliedCoupons[] snapshot and the rolled-up couponDiscountCents
      // must never disagree. Fixed-cents coupons are edit-invariant.
      const recomputedUnchanged: AppliedCoupon[] = unchangedCoupons.map((c) =>
        c.type === "percentage" ?
          {...c, discountCents: Math.round(subtotalCents * (c.value / 100))} :
          c
      );
      const appliedCoupons: AppliedCoupon[] = [...recomputedUnchanged, ...newlyAddedCoupons];
      const couponDiscountCents = appliedCoupons.reduce((sum, c) => sum + c.discountCents, 0);
      const discountCents = manualDiscountCents + couponDiscountCents;

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      const {taxCents, totalCents} = computeOrderTotals(subtotalCents, discountCents, taxRatePercent);
      const totalCostCents = newItems.reduce((sum, i) => sum + i.lineCostCents, 0);
      const totalDiff = totalCents - (order["totalCents"] || 0);

      tx.update(orderRef, {
        items: newItems,
        subtotalCents,
        taxRatePercent,
        taxCents,
        discountCents,
        manualDiscountCents,
        couponDiscountCents,
        appliedCoupons,
        totalCents,
        totalCostCents,
        marginCents: totalCents - totalCostCents,
        balanceCents: Math.max(0, totalCents - (order["amountPaidCents"] || 0)),
        deliveryType,
        customerNotes,
        internalNotes,
        expectedDeliveryDate: expectedDeliveryDateMs != null ? new Date(expectedDeliveryDateMs) : null,
        updatedAt: now,
        updatedBy: actionBy,
      });

      redeemCoupons(tx, redemptionPlan, orderId, now);

      if (totalDiff !== 0 && customerSnap.exists) {
        const cd = customerSnap.data()!;
        tx.update(customerRef, {
          totalOrderedCents: Math.max(0, (cd["totalOrderedCents"] || 0) + totalDiff),
          totalOwingCents: Math.max(0, (cd["totalOwingCents"] || 0) + totalDiff),
        });
      }

      for (const productId of allProductIds) {
        const originalQty = originalMap.get(productId) || 0;
        const newQty = newMap.get(productId) || 0;
        const diff = newQty - originalQty;
        if (diff === 0) continue;

        const snap = productSnapByPid.get(productId)!;
        if (!snap.exists) continue;

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        // diff > 0: more ordered, deduct more. diff < 0: less ordered, restore some.
        const newStock = Math.max(0, currentStock - diff);
        tx.update(db.collection("products").doc(productId), {stock: newStock});

        const itemSnapshot = newItems.find((i) => i.productId === productId) ||
          originalItems.find((i) => i["productId"] === productId);

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId,
          productName: itemSnapshot?.["productName"] || productId,
          productSku: itemSnapshot?.["productSku"] || "",
          type: diff > 0 ? "sold" : "returned",
          quantity: -diff,
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} edited`,
          notes: `Quantity changed from ${originalQty} to ${newQty}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderId,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderId, orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

// ── cancelAdminOrder ─────────────────────────────────────────────────────
// Staff-only admin action (order-detail.component.ts confirmCancel()).
// Used to be a client writeBatch keyed off the order()/customer live-
// listener snapshots plus a getDoc-then-batch race on every touched
// product, same defect class as the other 5H sites. Moved to a
// runTransaction: order, customer, and every product read fresh. Named
// distinctly from the portal's own cancelOrder (self-service, confirmed-
// only, no reason-required UI) — this is the staff path, reachable from
// confirmed/preparing/out_for_delivery, matching the "Cancel Order"
// button's visibility in order-detail.component.html exactly.
export const cancelAdminOrder = onCall(
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
    const orderId = (data.orderId || "").toString();
    const reason = (data.reason || "").toString().trim();
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");
    if (!reason) throw new HttpsError("invalid-argument", "Please provide a reason for cancellation");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;
      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (!["confirmed", "preparing", "out_for_delivery"].includes(order["status"])) {
        throw new HttpsError("failed-precondition", "This order can no longer be cancelled");
      }

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const customerRef = db.collection("customers").doc(order["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const items: Array<Record<string, any>> = order["items"] || [];
      const productRefs = items.map((it) => db.collection("products").doc(it["productId"]));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // Terminal coupon release — same guard as the portal's cancelOrder.
      const appliedCoupons: AppliedCoupon[] = order["appliedCoupons"] || [];
      const shouldReleaseCoupons = appliedCoupons.length > 0 && !order["couponsReleasedAt"];
      if (shouldReleaseCoupons) {
        await releaseAllCoupons(tx, appliedCoupons, order["customerId"]);
      }

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      tx.update(orderRef, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actionBy,
        cancellationReason: reason,
        balanceCents: 0,
        ...(shouldReleaseCoupons ? {couponsReleasedAt: now} : {}),
      });

      if (customerSnap.exists) {
        const cd = customerSnap.data()!;
        const amountPaid = order["amountPaidCents"] || 0;
        const totalOrdered = (cd["totalOrderedCents"] || 0) - (order["totalCents"] || 0);
        const totalOwing = (cd["totalOwingCents"] || 0) - ((order["totalCents"] || 0) - amountPaid);

        const custUpdates: Record<string, unknown> = {
          totalOrderedCents: Math.max(0, totalOrdered),
          totalOwingCents: Math.max(0, totalOwing),
        };
        if (amountPaid > 0) {
          custUpdates["totalPaidCents"] = Math.max(0, (cd["totalPaidCents"] || 0) - amountPaid);
          custUpdates["creditBalanceCents"] = (cd["creditBalanceCents"] || 0) + amountPaid;
        }
        tx.update(customerRef, custUpdates);
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const snap = productSnaps[i];
        if (!snap.exists) continue;

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + (item["quantity"] || 0);

        tx.update(productRefs[i], {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: item["productId"],
          productName: item["productName"],
          productSku: item["productSku"],
          type: "returned",
          quantity: item["quantity"],
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} cancelled`,
          notes: `Cancellation reason: ${reason}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderId,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderNumber: order["orderNumber"]};
    });

    return result;
  }
);

// ── saveOrderQuantityEdits ───────────────────────────────────────────────
// Staff-only admin action (order-detail.component.ts saveOrderEdits()) —
// the inline quick-edit on the order detail page, distinct from
// updateAdminOrder (order-form's full edit form). This flow only ever
// REDUCES quantities on the order's existing lines (stock is already
// committed; a reduction returns the diff — see CLAUDE.md "Order
// editing"), never adds/removes lines or raises a quantity above what
// was ordered. It also has its own, broader status gate than
// updateAdminOrder (confirmed/preparing/out_for_delivery via
// canEditOrder(), not confirmed-only) — preserved as-is, not unified.
// Used to be a client writeBatch keyed off the order()/customer live-
// listener snapshots plus a getDoc-then-batch race on every touched
// product. Moved to a runTransaction re-reading everything fresh.
interface OrderQuantityEditInput {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export const saveOrderQuantityEdits = onCall(
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
    const orderId = (data.orderId || "").toString();
    const rawItems: OrderQuantityEditInput[] = Array.isArray(data.items) ? data.items : [];
    // order-detail.component.ts's quick-edit DOES have its own manual
    // discount editor (editDiscountCents/editDiscountType/
    // editDiscountPercent, fixed-$ or %) — client-supplied here, same
    // trust boundary as updateAdminOrder's manual discount. An earlier
    // version of this comment claimed this flow had no discount UI at
    // all; that was wrong — verified against order-detail.component.ts
    // directly. Coupons are layered on top server-side, see below.
    const manualDiscountCents = Math.floor(Number(data.discountCents) || 0);
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found");
      const order = orderSnap.data()!;
      if (order["isDeleted"]) throw new HttpsError("not-found", "Order not found");
      if (!["confirmed", "preparing", "out_for_delivery"].includes(order["status"])) {
        throw new HttpsError("failed-precondition", "This order can no longer be edited");
      }

      const originalItems: Array<Record<string, any>> = order["items"] || [];
      const originalByPid = new Map(originalItems.map((it) => [it["productId"], it]));

      // This flow can only adjust existing lines — no adding/removing —
      // so the incoming set of productIds must exactly match the order's.
      const incomingPids = new Set(rawItems.map((it) => it.productId));
      const originalPids = new Set(originalByPid.keys());
      const setsMatch = incomingPids.size === originalPids.size &&
        [...incomingPids].every((pid) => originalPids.has(pid));
      if (rawItems.length === 0 || !setsMatch) {
        throw new HttpsError("invalid-argument", "Items must match the order's existing lines");
      }

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const customerRef = db.collection("customers").doc(order["customerId"]);
      const customerSnap = await tx.get(customerRef);

      const productRefs = [...originalPids].map((pid) => db.collection("products").doc(pid));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));
      const productSnapByPid = new Map([...originalPids].map((pid, i) => [pid, productSnaps[i]]));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();

      // Reduce-only clamp, re-derived server-side rather than trusted from
      // the client — mirrors updateItemQuantity's client clamp exactly.
      const editedItems = rawItems.map((it) => {
        const original = originalByPid.get(it.productId)!;
        const originalQty = original["quantity"] || 0;
        const quantity = Math.max(1, Math.min(Math.floor(Number(it.quantity) || 0), originalQty));
        const unitPriceCents = Math.floor(Number(it.unitPriceCents) || 0);
        const unitCostCents = original["unitCostCents"] || 0;
        return {
          productId: it.productId,
          productName: original["productName"],
          productSku: original["productSku"],
          quantity,
          unitPriceCents,
          lineTotalCents: quantity * unitPriceCents,
          unitCostCents,
          lineCostCents: quantity * unitCostCents,
          currencyCode: "CAD",
        };
      });

      const subtotalCents = editedItems.reduce((sum, i) => sum + i.lineTotalCents, 0);
      const taxRatePercent = order["taxRatePercent"] || 0;

      // This flow only ever reduces quantities — no lines added/removed —
      // and has no coupon-editing UI of its own, but its manual discount
      // editor IS real (see manualDiscountCents above). Coupons are layered
      // on top, not editable here: any percentage-type coupon still
      // applied is recomputed against the new (smaller) subtotal so
      // appliedCoupons[] and the rolled-up couponDiscountCents never
      // disagree with what's actually charged; fixed-cents coupons are
      // edit-invariant. No coupons are added/removed/re-validated here.
      const existingAppliedCoupons: AppliedCoupon[] = order["appliedCoupons"] || [];
      const appliedCoupons: AppliedCoupon[] = existingAppliedCoupons.map((c) =>
        c.type === "percentage" ?
          {...c, discountCents: Math.round(subtotalCents * (c.value / 100))} :
          c
      );
      const couponDiscountCents = appliedCoupons.reduce((sum, c) => sum + c.discountCents, 0);
      const discountCents = manualDiscountCents + couponDiscountCents;

      const {taxCents, totalCents} = computeOrderTotals(subtotalCents, discountCents, taxRatePercent);
      const totalCostCents = editedItems.reduce((sum, i) => sum + i.lineCostCents, 0);
      const balanceCents = Math.max(0, totalCents - (order["amountPaidCents"] || 0));
      const totalDiff = totalCents - (order["totalCents"] || 0);

      tx.update(orderRef, {
        items: editedItems,
        subtotalCents,
        discountCents,
        manualDiscountCents,
        couponDiscountCents,
        appliedCoupons,
        taxCents,
        totalCents,
        balanceCents,
        totalCostCents,
        lastEditedAt: now,
        lastEditedBy: actionBy,
      });

      if (totalDiff !== 0 && customerSnap.exists) {
        const cd = customerSnap.data()!;
        tx.update(customerRef, {
          totalOrderedCents: Math.max(0, (cd["totalOrderedCents"] || 0) + totalDiff),
          totalOwingCents: Math.max(0, (cd["totalOwingCents"] || 0) + totalDiff),
        });
      }

      for (const editItem of editedItems) {
        const original = originalByPid.get(editItem.productId)!;
        const qtyDiff = (original["quantity"] || 0) - editItem.quantity;
        if (qtyDiff <= 0) continue; // only reductions restore stock

        const snap = productSnapByPid.get(editItem.productId)!;
        if (!snap.exists) continue;

        const p = snap.data()!;
        const currentStock = p["stock"] || 0;
        const newStock = currentStock + qtyDiff;
        tx.update(db.collection("products").doc(editItem.productId), {stock: newStock});

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: editItem.productId,
          productName: editItem.productName,
          productSku: editItem.productSku,
          type: "adjustment",
          quantity: qtyDiff,
          previousStock: currentStock,
          newStock,
          reason: `Order ${order["orderNumber"]} quantity reduced by ${qtyDiff}`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedOrderId: orderId,
          linkedOrderNumber: order["orderNumber"],
        });
      }

      return {orderId, orderNumber: order["orderNumber"]};
    });

    return result;
  }
);
