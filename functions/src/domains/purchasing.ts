import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {Resend} from "resend";
import * as logger from "../logger";
import {db, DATABASE_ID, sentryDsn, resendApiKey, fromEmail, STAFF_ROLES} from "../core";
import {buildStaffActionBy} from "../staff-transactions-shared";

// ─── Purchase Order Requests ────────────────────────────────────────────────

export const onPoRequest = onDocumentCreated(
  {
    document: "poRequests/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "pending") return;

    const {supplierEmail, poNumber, poHtml} = data;

    if (!supplierEmail || !poHtml) {
      await event.data?.ref.update({
        status: "error",
        error: "Missing email or HTML",
      });
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: supplierEmail,
        subject: `Purchase Order ${poNumber} — Tropx Wholesale`,
        html: poHtml,
      });

      await event.data?.ref.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`PO ${poNumber} sent to supplier`);
    } catch (err: any) {
      await logger.error("Error sending PO email:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
    }
  }
);

// ── receivePurchaseOrder ────────────────────────────────────────────────
// Staff-only admin action (po-receive.component.ts saveReceive()). Used to
// be a client writeBatch that took a getDoc() read of each product before
// committing, plus a *separate* runTransaction (getNextReceiveNumber) run
// before the batch even started — so a receive-number could be consumed
// even if the batch that followed it failed, and two concurrent receipts
// against the same product could race on stock, same defect class as
// approveReturn. Moved to a single runTransaction: the receive-number
// sequence, PO status, and every product's stock now commit atomically
// together. Money/stock logic is otherwise unchanged from the original
// component method.
interface ReceivePoRow {
  productId: string;
  receiveNow: number;
}

export const receivePurchaseOrder = onCall(
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
    const purchaseOrderId = (data.purchaseOrderId || "").toString();
    const rawRows: ReceivePoRow[] = Array.isArray(data.rows) ? data.rows : [];
    const notes = (data.notes || "").toString().slice(0, 2000);
    const receivedDate = (data.receivedDate || "").toString();
    const warehouseId = (data.warehouseId || "").toString();

    if (!purchaseOrderId) throw new HttpsError("invalid-argument", "purchaseOrderId is required");

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before writes) ──
      const poRef = db.collection("purchaseOrders").doc(purchaseOrderId);
      const poSnap = await tx.get(poRef);
      if (!poSnap.exists) throw new HttpsError("not-found", "Purchase order not found");
      const po = poSnap.data()!;
      if (po["isDeleted"]) throw new HttpsError("not-found", "Purchase order not found");
      if (po["status"] !== "sent" && po["status"] !== "partially_received") {
        throw new HttpsError(
          "failed-precondition",
          "Only sent or partially received purchase orders can be received"
        );
      }

      const actionBy = await buildStaffActionBy(tx, auth.uid);

      const inventorySnap = await tx.get(db.collection("settings").doc("inventory"));
      const inventory = inventorySnap.data() || {};
      const multiWarehouseEnabled = inventory["multiWarehouseEnabled"] === true;

      let finalWarehouseId: string;
      let finalWarehouseName: string;
      let warehouseSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (multiWarehouseEnabled) {
        if (!warehouseId) throw new HttpsError("invalid-argument", "Select a warehouse");
        warehouseSnap = await tx.get(db.collection("warehouses").doc(warehouseId));
        finalWarehouseId = warehouseId;
        finalWarehouseName = warehouseSnap.exists ?
          (warehouseSnap.data()!["name"] || po["warehouseName"]) :
          po["warehouseName"];
      } else {
        finalWarehouseId = inventory["defaultWarehouseId"] || po["warehouseId"];
        finalWarehouseName = inventory["defaultWarehouseName"] || po["warehouseName"];
      }

      const seqRef = db.collection("settings").doc("receiveSequence");
      const seqSnap = await tx.get(seqRef);
      const seqData = seqSnap.exists ?
        seqSnap.data()! :
        {prefix: "GRN", nextNumber: 1, padding: 5};
      const nextNum = seqData["nextNumber"] || 1;
      const prefix = seqData["prefix"] || "GRN";
      const padding = seqData["padding"] || 5;
      const receiveNumber = `${prefix}-${String(nextNum).padStart(padding, "0")}`;

      // Server-authoritative: quantityOrdered/quantityReceived/unitCostCents
      // come from the stored PO line, never from the client — a receipt
      // can't be padded past what's actually remaining on the order, and
      // the cost recorded can't be tampered with (the client UI never lets
      // it be edited either — see po-receive.component.ts).
      const poItems: Array<Record<string, any>> = po["items"] || [];
      const poItemsByProduct = new Map(poItems.map((it) => [it["productId"], it]));

      const validRows: Array<{
        productId: string; productName: string; productSku: string;
        qty: number; unitCostCents: number;
      }> = [];
      for (const raw of rawRows) {
        const pid = (raw.productId || "").toString();
        const poItem = poItemsByProduct.get(pid);
        if (!poItem) {
          throw new HttpsError("invalid-argument", "One of the items wasn't part of this purchase order");
        }
        const qty = Math.floor(Number(raw.receiveNow) || 0);
        if (qty <= 0) continue;
        const remaining = (poItem["quantityOrdered"] || 0) - (poItem["quantityReceived"] || 0);
        if (qty > remaining) {
          throw new HttpsError(
            "invalid-argument",
            `Cannot receive more than the ${remaining} remaining for ${poItem["productName"]}`
          );
        }
        validRows.push({
          productId: pid,
          productName: poItem["productName"],
          productSku: poItem["productSku"],
          qty,
          unitCostCents: poItem["unitCostCents"] || 0,
        });
      }
      if (validRows.length === 0) {
        throw new HttpsError("invalid-argument", "Must receive at least one item");
      }

      const productRefs = validRows.map((r) => db.collection("products").doc(r.productId));
      const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

      // ── writes (all reads done) ──
      const now = FieldValue.serverTimestamp();
      const receiveItems: Array<Record<string, unknown>> = [];
      const poItemsUpdate = poItems.map((it) => ({...it}));

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const snap = productSnaps[i];
        const currentStock = snap.exists ? (snap.data()!["stock"] || 0) : 0;
        const newStock = currentStock + row.qty;

        if (snap.exists) {
          tx.update(productRefs[i], {stock: newStock, costCents: row.unitCostCents});
        }

        const adjRef = db.collection("stockAdjustments").doc();
        tx.set(adjRef, {
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          type: "received",
          quantity: row.qty,
          previousStock: currentStock,
          newStock,
          reason: `PO ${po["poNumber"]} received (${receiveNumber})`,
          adjustedBy: actionBy,
          createdAt: now,
          tenantId: 1,
          isDeleted: false,
          linkedPoId: purchaseOrderId,
          linkedPoNumber: po["poNumber"],
          warehouseId: finalWarehouseId,
        });

        receiveItems.push({
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          quantityReceived: row.qty,
          previousStock: currentStock,
          newStock,
        });

        const idx = poItemsUpdate.findIndex((it) => it["productId"] === row.productId);
        if (idx >= 0) {
          poItemsUpdate[idx]["quantityReceived"] = (poItemsUpdate[idx]["quantityReceived"] || 0) + row.qty;
        }
      }

      const recRef = db.collection("purchaseReceives").doc();
      tx.set(recRef, {
        receiveNumber,
        purchaseOrderId,
        poNumber: po["poNumber"],
        supplierId: po["supplierId"],
        supplierName: po["supplierName"],
        warehouseId: finalWarehouseId,
        warehouseName: finalWarehouseName,
        items: receiveItems,
        receivedDate: receivedDate ? new Date(`${receivedDate}T12:00:00Z`) : now,
        notes,
        createdAt: now,
        createdBy: actionBy,
        tenantId: 1,
        isDeleted: false,
      });

      tx.set(seqRef, {...seqData, nextNumber: nextNum + 1});

      const allReceived = poItemsUpdate.every(
        (it) => (it["quantityReceived"] || 0) >= (it["quantityOrdered"] || 0)
      );
      const poUpdate: Record<string, unknown> = {
        items: poItemsUpdate,
        status: allReceived ? "received" : "partially_received",
      };
      if (allReceived) poUpdate["receivedAt"] = now;
      tx.update(poRef, poUpdate);

      return {receiveNumber, purchaseOrderId};
    });

    return result;
  }
);
