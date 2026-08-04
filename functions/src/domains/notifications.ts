import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {Resend} from "resend";
import * as logger from "../logger";
import {db, DATABASE_ID, sentryDsn, resendApiKey, fromEmail, getAdminEmail, isNotificationEnabled} from "../core";
import {isRateLimited} from "../rate-limit";
import {
  contactInquiryEmailHtml,
  orderNotificationEmailHtml,
  accessRequestNotificationEmailHtml,
  returnNotificationEmailHtml,
  backInStockEmailHtml,
  lowStockAlertEmailHtml,
  orderStatusEmailHtml,
  returnStatusEmailHtml,
  paymentReceiptEmailHtml,
} from "../email-templates";


// ─── Contact Form Notification ──────────────────────────────────────────────
export const onContactInquiry = onDocumentCreated(
  {
    document: "contactInquiries/{inquiryId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    // Guards against a redelivered trigger event re-sending the admin
    // notification — see the "idempotency" comment block above
    // onOrderNotification for the shared reasoning across these
    // business-doc-triggered notification functions. rateLimited is a
    // separate terminal marker (see isRateLimited above) — either one
    // means this doc is already handled, don't reprocess.
    if (!data || data.notificationSentAt || data.rateLimited) return;

    const {name, email, phone, businessName, message} = data;

    if (email && (await isRateLimited("contactInquiries", email))) {
      await event.data?.ref.update({rateLimited: true});
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const html = contactInquiryEmailHtml(
      name, email, phone, businessName, message
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: "admin@tropxwholesale.ca",
        replyTo: email,
        subject: `New Contact Inquiry from ${businessName ?? name}`,
        html,
      });
      await event.data?.ref.update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      logger.info("Contact inquiry notification sent");
    } catch (err) {
      await logger.error("Error sending contact notification:", err);
    }
  }
);

// ─── Invoice Requests ─────────────────────────────────────────────────────────

export const onInvoiceRequest = onDocumentCreated(
  {
    document: "invoiceRequests/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "pending") return;

    const {
      customerEmail,
      orderNumber,
      invoiceHtml,
    } = data;

    if (!customerEmail || !invoiceHtml) {
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
        to: customerEmail,
        subject: `Order Confirmation ${orderNumber} — Tropx Wholesale`,
        html: invoiceHtml,
      });

      await event.data?.ref.update({
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(
        `Invoice ${orderNumber} sent to ${customerEmail}`
      );
    } catch (err: any) {
      await logger.error("Error sending invoice email:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
    }
  }
);

// The next several triggers fire a customer- or admin-facing email off a
// primary business document (orders/returns/payments), not a job-queue
// request doc — so there's no natural "processed" field to check. Each
// stamps its own narrow *SentAt marker on the same doc and checks it
// before sending, guarding specifically against Cloud Functions'
// at-least-once redelivery re-sending the same email. The marker write
// happens only after a successful send, so a genuinely failed send is
// still eligible to be retried (mirrors onProductRestocked's per-
// recipient "notified" pattern above). Writing back to the same doc can
// re-trigger sibling *WriteReconcile functions on that collection — safe,
// since those are already idempotent by design (see recomputeCustomerCounters).
export const onOrderNotification = onDocumentCreated(
  {
    document: "orders/{orderId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.adminNotifiedAt) return;

    // Check toggle
    const enabled = await isNotificationEnabled(
      "newOrderAlert"
    );
    if (!enabled) return;

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      orderNumber,
      customerName,
      customerPhone,
      totalCents,
      items,
      deliveryType,
      serviceAreaName,
      source,
    } = data;

    // Format items list
    const itemsHtml = (items || []).map((item: any) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
          <span style="color:#8a94a6;font-size:0.8rem;
            display:block;font-family:monospace;">
            ${item.productSku}
          </span>
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;
          font-weight:600;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const totalFormatted =
      `$${((totalCents || 0) / 100).toFixed(2)}`;

    const html = orderNotificationEmailHtml(
      orderNumber,
      customerName,
      customerPhone,
      totalFormatted,
      itemsHtml,
      deliveryType,
      serviceAreaName,
      source
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        subject: `🛒 New Order ${orderNumber} — ${customerName}`,
        html,
      });
      await event.data?.ref.update({adminNotifiedAt: FieldValue.serverTimestamp()});
      logger.info(
        `Order notification sent for ${orderNumber}`
      );
    } catch (err) {
      await logger.error("Error sending order notification:", err);
    }
  }
);

export const onAccessRequestNotification = onDocumentCreated(
  {
    document: "accessRequests/{requestId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.notificationSentAt || data.rateLimited) return;

    const enabled = await isNotificationEnabled(
      "accessRequestAlert"
    );
    if (!enabled) return;

    const {
      businessName,
      ownerFirstName,
      ownerLastName,
      email,
      phone,
      businessType,
      address,
    } = data;

    if (email && (await isRateLimited("accessRequests", email))) {
      await event.data?.ref.update({rateLimited: true});
      return;
    }

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const ownerFullName = [ownerFirstName, ownerLastName]
      .filter(Boolean)
      .join(" ");

    const html = accessRequestNotificationEmailHtml(
      businessName,
      ownerFullName,
      email,
      phone,
      businessType,
      address
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        replyTo: email,
        subject: `🏪 New Access Request — ${businessName}`,
        html,
      });
      await event.data?.ref.update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      logger.info("Access request notification sent");
    } catch (err) {
      await logger.error(
        "Error sending access request notification:", err
      );
    }
  }
);

export const onReturnNotification = onDocumentCreated(
  {
    document: "returns/{returnId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.notificationSentAt) return;

    const enabled = await isNotificationEnabled(
      "returnSubmittedAlert"
    );
    if (!enabled) return;

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      returnNumber,
      orderNumber,
      customerName,
      type,
      amountCents,
      reasonCode,
      reason,
      items,
    } = data;

    const typeLabel = type === "credit_note" ?
      "Credit Note" : "Refund";

    const reasonLabels: Record<string, string> = {
      damaged: "Damaged / Defective",
      wrong_item: "Wrong Item",
      customer_changed_mind: "Customer Changed Mind",
      expired: "Expired / Past Best Before",
      quality_issue: "Quality Issue",
      other: "Other",
    };

    const itemsHtml = (items || []).map((item: any) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const amountFormatted =
      `$${((amountCents || 0) / 100).toFixed(2)}`;

    const html = returnNotificationEmailHtml(
      returnNumber,
      orderNumber,
      customerName,
      typeLabel,
      amountFormatted,
      reasonLabels[reasonCode] || reasonCode,
      reason,
      itemsHtml
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        subject: `↩️ Return ${returnNumber} — ${customerName}`,
        html,
      });
      await event.data?.ref.update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      logger.info(
        `Return notification sent for ${returnNumber}`
      );
    } catch (err) {
      await logger.error(
        "Error sending return notification:", err
      );
    }
  }
);

// ─── Back-in-Stock Notifications ────────────────────────────────────────────
// Fires when a product's stock crosses from out-of-stock (<=0) to in-stock (>0)
// — e.g. via a stock adjustment or PO receive. Emails every customer with a
// pending stockNotificationRequest for that product, then marks them notified.
export const onProductRestocked = onDocumentUpdated(
  {
    document: "products/{productId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const prevStock = before.stock || 0;
    const newStock = after.stock || 0;

    // Only when crossing from out-of-stock into in-stock.
    if (!(prevStock <= 0 && newStock > 0)) return;
    if (after.isDeleted || after.active === false) return;

    const productId = event.params.productId;
    const productName = after.name || "A product";

    // Pending requests for this product.
    const reqSnap = await db
      .collection("stockNotificationRequests")
      .where("productId", "==", productId)
      .where("status", "==", "pending")
      .get();

    if (reqSnap.empty) {
      logger.info(`Restock: ${productName} back in stock, no pending requests`);
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let sent = 0;
    for (const doc of reqSnap.docs) {
      const req = doc.data();
      const email = req.customerEmail;
      if (!email) {
        await doc.ref.update({
          status: "notified",
          notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: "no-email",
        });
        continue;
      }
      try {
        await resend.emails.send({
          from: `Tropx Wholesale <${from}>`,
          to: email,
          subject: `Back in stock: ${productName}`,
          html: backInStockEmailHtml(
            req.customerName || "there",
            productName,
            after.sku || req.productSku || "",
          ),
        });
        await doc.ref.update({
          status: "notified",
          notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        sent++;
      } catch (err) {
        await logger.error("Restock email failed", err);
        // Leave as pending so a future restock/backfill can retry.
      }
    }
    logger.info(`Restock: ${productName} — notified ${sent}/${reqSnap.size} customers`);
  }
);

export const onLowStockAlert = onDocumentCreated(
  {
    document: "stockAdjustments/{adjustmentId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const enabled = await isNotificationEnabled(
      "lowStockAlert"
    );
    if (!enabled) return;

    const {productId, productName, productSku, newStock} =
      data;

    if (!productId) return;

    // Get product to check threshold
    const productDoc = await db
      .collection("products")
      .doc(productId)
      .get();

    if (!productDoc.exists) return;

    const product = productDoc.data()!;
    const threshold = product.lowStockThreshold || 5;

    // Compute committed stock: sum quantities from
    // orders with status confirmed or out_for_delivery
    // for this product
    let committedQty = 0;
    try {
      const committedSnap = await db
        .collection("orders")
        .where("status", "in", ["confirmed", "out_for_delivery"])
        .where("isDeleted", "==", false)
        .get();

      for (const orderDoc of committedSnap.docs) {
        const orderData = orderDoc.data();
        const items: any[] = orderData.items || [];
        for (const item of items) {
          if (item.productId === productId) {
            committedQty += item.quantity || 0;
          }
        }
      }
    } catch (err) {
      await logger.error("Error computing committed stock:", err);
      // Fall back to raw stock if query fails
    }

    const atp = Math.max(0, newStock - committedQty);

    logger.info(
      `Low stock check for ${productName}: ` +
      `stock=${newStock}, committed=${committedQty}, atp=${atp}, ` +
      `threshold=${threshold}`
    );

    // Only alert if ATP is at or below threshold
    if (atp > threshold) return;

    // Check last alert time — max once per 24h per product
    const lastAlert = product.lastLowStockAlertAt;
    if (lastAlert) {
      const lastAlertDate = lastAlert.toDate ?
        lastAlert.toDate() :
        new Date(lastAlert);
      const hoursSince = (Date.now() -
        lastAlertDate.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        logger.info(
          `Low stock alert for ${productName} 
           suppressed — sent ${hoursSince.toFixed(1)}h ago`
        );
        return;
      }
    }

    // Update lastLowStockAlertAt to suppress future alerts
    await db.collection("products").doc(productId).update({
      lastLowStockAlertAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const isOutOfStock = atp <= 0;

    const html = lowStockAlertEmailHtml(
      productName,
      productSku,
      atp,
      threshold,
      isOutOfStock,
      data.linkedOrderNumber || null,
      committedQty
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: adminEmail,
        subject: isOutOfStock ?
          `🔴 Out of Stock: ${productName}` :
          `🟡 Low Stock: ${productName} (${atp} available)`,
        html,
      });
      logger.info(
        `Low stock alert sent for ${productName}: 
         ${newStock} remaining`
      );
    } catch (err) {
      await logger.error(
        "Error sending low stock alert:", err
      );
    }
  }
);

export const onOrderStatusChanged = onDocumentUpdated(
  {
    document: "orders/{orderId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const prevStatus = before.status;
    const newStatus = after.status;

    // Only fire when status actually changes
    if (prevStatus === newStatus) return;

    // Only handle these status transitions
    const handledStatuses = [
      "confirmed",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ];
    if (!handledStatuses.includes(newStatus)) return;

    // A redelivered trigger event replays the identical before/after
    // pair, so prevStatus !== newStatus alone doesn't protect against a
    // duplicate send — each of these statuses is only reached once per
    // order in practice, so comparing against the last status this
    // function actually emailed for is enough.
    if (after.lastStatusNotificationSentFor === newStatus) return;

    // Map status to notification key
    const notifKeyMap: Record<string, string> = {
      confirmed: "customerOrderConfirmed",
      out_for_delivery: "customerOutForDelivery",
      delivered: "customerOrderDelivered",
      cancelled: "customerOrderCancelled",
    };

    const notifKey = notifKeyMap[newStatus];
    const enabled = await isNotificationEnabled(notifKey);
    if (!enabled) return;

    // Get customer email — from order doc directly
    const customerEmail = after.customerEmail;
    if (!customerEmail) {
      logger.info(
        `No customer email on order ${after.orderNumber}, ` +
        "skipping notification"
      );
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      orderNumber,
      customerName,
      totalCents,
      balanceCents,
      items,
      deliveryType,
      expectedDeliveryDate,
      cancellationReason,
    } = after;

    const itemsHtml = (items || []).map((item: {
      productName: string;
      productSku: string;
      quantity: number;
      lineTotalCents: number;
    }) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
          <span style="color:#8a94a6;font-size:0.8rem;
            display:block;font-family:monospace;">
            ${item.productSku}
          </span>
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;
          font-weight:600;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const totalFormatted =
      `$${((totalCents || 0) / 100).toFixed(2)}`;
    const balanceFormatted =
      `$${((balanceCents || 0) / 100).toFixed(2)}`;

    let deliveryDateStr = "";
    if (expectedDeliveryDate) {
      try {
        const d = expectedDeliveryDate.toDate ?
          expectedDeliveryDate.toDate() :
          new Date(expectedDeliveryDate);
        deliveryDateStr = d.toLocaleDateString("en-CA", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      } catch {
        deliveryDateStr = "";
      }
    }

    const html = orderStatusEmailHtml(
      newStatus,
      orderNumber,
      customerName,
      totalFormatted,
      balanceFormatted,
      balanceCents || 0,
      itemsHtml,
      deliveryType,
      deliveryDateStr,
      cancellationReason || ""
    );

    const subjectMap: Record<string, string> = {
      confirmed:
        `✅ Order Confirmed — ${orderNumber}`,
      out_for_delivery:
        `🚚 Your Order Is On Its Way — ${orderNumber}`,
      delivered:
        `📦 Order Delivered — ${orderNumber}`,
      cancelled:
        `❌ Order Cancelled — ${orderNumber}`,
    };

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject: subjectMap[newStatus],
        html,
      });
      await event.data?.after.ref.update({
        lastStatusNotificationSentFor: newStatus,
      });
      logger.info(
        `Order status email sent: ${orderNumber} → ${newStatus}`
      );
    } catch (err) {
      await logger.error(
        "Error sending order status email:", err
      );
    }
  }
);

export const onReturnStatusChanged = onDocumentUpdated(
  {
    document: "returns/{returnId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const prevStatus = before.status;
    const newStatus = after.status;

    if (prevStatus === newStatus) return;

    if (newStatus !== "approved" &&
        newStatus !== "rejected") return;

    // Same reasoning as onOrderStatusChanged above — guards a redelivered
    // trigger event from re-sending, since each of these statuses is only
    // reached once per return in practice.
    if (after.lastStatusNotificationSentFor === newStatus) return;

    const notifKey = newStatus === "approved" ?
      "customerReturnApproved" :
      "customerReturnRejected";

    const enabled = await isNotificationEnabled(notifKey);
    if (!enabled) return;

    // Get customer email from linked order
    const customerEmail = after.customerEmail;
    if (!customerEmail) {
      logger.info(
        "No customer email on return " +
        `${after.returnNumber}, skipping`
      );
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      returnNumber,
      orderNumber,
      customerName,
      type,
      amountCents,
      rejectionReason,
      items,
      stockRestored,
    } = after;

    const typeLabel = type === "credit_note" ?
      "Credit Note" : "Refund";

    const amountFormatted =
      `$${((amountCents || 0) / 100).toFixed(2)}`;

    const itemsHtml = (items || []).map((item: {
      productName: string;
      quantity: number;
      lineTotalCents: number;
    }) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;">
          ${item.productName}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:center;">
          ${item.quantity}
        </td>
        <td style="padding:8px 12px;border-bottom:
          1px solid #f0f0f0;text-align:right;">
          $${((item.lineTotalCents || 0) / 100)
    .toFixed(2)}
        </td>
      </tr>`
    ).join("");

    const html = returnStatusEmailHtml(
      newStatus,
      returnNumber,
      orderNumber,
      customerName,
      typeLabel,
      amountFormatted,
      itemsHtml,
      rejectionReason || "",
      stockRestored || false
    );

    const subject = newStatus === "approved" ?
      `✅ Return Approved — ${returnNumber}` :
      `❌ Return Not Approved — ${returnNumber}`;

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject,
        html,
      });
      await event.data?.after.ref.update({
        lastStatusNotificationSentFor: newStatus,
      });
      logger.info(
        `Return status email sent: ${returnNumber} → ${newStatus}`
      );
    } catch (err) {
      await logger.error(
        "Error sending return status email:", err
      );
    }
  }
);

export const onPaymentReceipt = onDocumentCreated(
  {
    document: "payments/{paymentId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.receiptSentAt) return;

    const enabled = await isNotificationEnabled(
      "customerPaymentReceipt"
    );
    if (!enabled) return;

    const customerEmail = data.customerEmail;
    if (!customerEmail) {
      logger.info(
        "No customer email on payment " +
        `${data.paymentNumber}, skipping`
      );
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      paymentNumber,
      orderNumber,
      orderId,
      customerName,
      amountCents,
      method,
      referenceNumber,
      receivedDate,
    } = data;

    // Get remaining balance from order
    let remainingBalanceCents = 0;
    let orderTotalCents = 0;
    try {
      const orderDoc = await db
        .collection("orders")
        .doc(orderId)
        .get();
      if (orderDoc.exists) {
        remainingBalanceCents =
          orderDoc.data()?.balanceCents || 0;
        orderTotalCents =
          orderDoc.data()?.totalCents || 0;
      }
    } catch {
      logger.info("Could not fetch order for receipt");
    }

    const methodLabels: Record<string, string> = {
      cash: "Cash",
      e_transfer: "E-Transfer",
      cheque: "Cheque",
      other: "Other",
    };

    const amountFormatted =
      `$${((amountCents || 0) / 100).toFixed(2)}`;
    const balanceFormatted =
      `$${(remainingBalanceCents / 100).toFixed(2)}`;
    const totalFormatted =
      `$${(orderTotalCents / 100).toFixed(2)}`;
    const methodLabel =
      methodLabels[method] || method;

    const html = paymentReceiptEmailHtml(
      paymentNumber,
      orderNumber,
      customerName,
      amountFormatted,
      methodLabel,
      referenceNumber || "",
      receivedDate || "",
      balanceFormatted,
      totalFormatted,
      remainingBalanceCents
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: customerEmail,
        subject:
          `💳 Payment Received — ${orderNumber}`,
        html,
      });
      await event.data?.ref.update({
        receiptSentAt: FieldValue.serverTimestamp(),
      });
      logger.info(
        `Payment receipt sent: ${paymentNumber} ` +
        `→ ${customerEmail}`
      );
    } catch (err) {
      await logger.error(
        "Error sending payment receipt:", err
      );
    }
  }
);


export const checkAbandonedCarts =
  onSchedule({
    schedule: "every 60 minutes",
    region: "northamerica-northeast1",
    timeoutSeconds: 300,
    secrets: [resendApiKey, fromEmail, sentryDsn],
  }, async () => {
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    const HOUR = 60 * 60 * 1000;
    const thresholds = [
      {
        key: "abandonedCart24h",
        field: "abandonedEmailSent24h",
        ms: 24 * HOUR,
        subject: (name: string) =>
          `You left something behind, ${name}`,
        headline: "Your cart is waiting",
        subtext: "You left some items in your " +
        "cart. Complete your order whenever " +
        "you're ready.",
      },
      {
        key: "abandonedCart72h",
        field: "abandonedEmailSent72h",
        ms: 72 * HOUR,
        subject: (name: string) =>
          `Still thinking it over, ${name}?`,
        headline: "Still thinking it over?",
        subtext: "Your cart is still saved. " +
        "Place your order when ready and " +
        "we'll get it to you fast.",
      },
      {
        key: "abandonedCart7d",
        field: "abandonedEmailSent7d",
        ms: 7 * 24 * HOUR,
        subject: (name: string) =>
          `Your cart is still saved, ${name}`,
        headline: "Your cart is still here",
        subtext: "It's been a week since you " +
        "added items to your cart. " +
        "Complete your order today.",
      },
    ];

    // Load notification settings
    const settingsDoc = await db
      .doc("settings/notifications")
      .get();
    const notifSettings =
    settingsDoc.data() || {};

    // Load all carts with items
    const cartsSnap = await db
      .collection("portalCarts")
      .get();

    const resend = new Resend(resendApiKey.value());

    for (const cartDoc of cartsSnap.docs) {
      const cart = cartDoc.data();
      const items = cart.items || [];

      // Skip empty carts
      if (!items.length) continue;

      // Get last updated time
      const updatedAt = cart.updatedAt?.toMillis ?
        cart.updatedAt.toMillis() :
        cart.updatedAt;
      if (!updatedAt) continue;

      const ageMs = nowMs - updatedAt;

      // Get customer info
      const customerId = cartDoc.id;
      const customerSnap = await db
        .doc(`customers/${customerId}`)
        .get();
      if (!customerSnap.exists) continue;

      const customer = customerSnap.data();
      if (!customer) continue;
      const email = customer.email;
      const firstName = customer.ownerFirstName || "there";

      if (!email) continue;

      // Get linked user for portal access
      const userSnap = await db
        .collection("users")
        .where("linkedCustomerId", "==", customerId)
        .limit(1)
        .get();
      if (userSnap.empty) continue;

      for (const threshold of thresholds) {
      // Check if setting enabled
        if (!notifSettings[threshold.key]) continue;

        // Check if already sent
        if (cart[threshold.field]) continue;

        // Check if cart is old enough
        if (ageMs < threshold.ms) continue;

        // Check if newer threshold was already
        // handled (don't send 24h after 72h sent)
        // by checking the age falls in the right
        // window (within 2x the threshold)
        if (ageMs > threshold.ms * 3) continue;

        // Build items HTML
        const itemsHtml = items.map((item: any) =>
          `<tr>
          <td style="padding:10px 16px;
            border-bottom:1px solid #f0f0f0;
            font-size:14px;color:#1c1c1c;">
            ${item.productName}
          </td>
          <td style="padding:10px 16px;
            border-bottom:1px solid #f0f0f0;
            text-align:center;font-size:14px;
            color:#1c1c1c;">
            ×${item.quantity}
          </td>
          <td style="padding:10px 16px;
            border-bottom:1px solid #f0f0f0;
            text-align:right;font-size:14px;
            font-weight:600;color:#0a2d4a;">
            $${((item.priceCents *
              item.quantity) / 100)
    .toFixed(2)}
          </td>
        </tr>`
        ).join("");

        const subtotalCents = items.reduce(
          (sum: number, i: any) =>
            sum + (i.priceCents * i.quantity), 0
        );

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,
    initial-scale=1.0">
</head>
<body style="margin:0;padding:0;
  background:#f4f5f7;
  font-family:-apple-system,BlinkMacSystemFont,
  'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;
    padding:32px 16px;">

    <!-- Header -->
    <div style="background:#0a2d4a;
      border-radius:12px 12px 0 0;
      padding:28px 32px;text-align:center;">
      <div style="font-size:1.5rem;
        font-weight:800;color:white;
        letter-spacing:-0.02em;">
        Tropx Wholesale
      </div>
    </div>

    <!-- Body -->
    <div style="background:white;
      padding:32px;
      border:1px solid #e8eaed;
      border-top:none;">

      <h2 style="font-size:1.25rem;
        font-weight:700;color:#0a2d4a;
        margin:0 0 8px;">
        ${threshold.headline}
      </h2>
      <p style="font-size:0.9375rem;
        color:#6b7280;margin:0 0 24px;
        line-height:1.6;">
        Hi ${firstName}, ${threshold.subtext}
      </p>

      <!-- Cart items -->
      <table style="width:100%;
        border-collapse:collapse;
        border:1px solid #f0f0f0;
        border-radius:8px;overflow:hidden;
        margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;
              text-align:left;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:#6b7280;
              border-bottom:
                1px solid #f0f0f0;">
              Product
            </th>
            <th style="padding:10px 16px;
              text-align:center;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:#6b7280;
              border-bottom:
                1px solid #f0f0f0;">
              Qty
            </th>
            <th style="padding:10px 16px;
              text-align:right;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:#6b7280;
              border-bottom:
                1px solid #f0f0f0;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          <tr style="background:#f8fafc;">
            <td colspan="2"
              style="padding:12px 16px;
              font-weight:700;
              font-size:0.9375rem;
              color:#0a2d4a;">
              Subtotal
            </td>
            <td style="padding:12px 16px;
              text-align:right;
              font-weight:800;
              font-size:1rem;
              color:#0a2d4a;">
              $${(subtotalCents / 100)
    .toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>

      <!-- CTA -->
      <div style="text-align:center;
        margin-bottom:24px;">
        <a href="https://tropxwholesale.ca/portal/cart"
          style="display:inline-block;
          background:#0a2d4a;color:white;
          text-decoration:none;
          padding:14px 32px;
          border-radius:10px;
          font-weight:700;
          font-size:1rem;">
          Complete Your Order →
        </a>
      </div>

      <p style="font-size:0.8125rem;
        color:#9ca3af;text-align:center;
        margin:0;line-height:1.6;">
        Questions? Reply to this email or
        contact us at info@tropxwholesale.ca
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;
      text-align:center;">
      <p style="font-size:0.75rem;
        color:#9ca3af;margin:0;">
        © Tropx Enterprises Inc. ·
        Kitchener, Ontario, Canada
      </p>
    </div>

  </div>
</body>
</html>`;

        // Send email via Resend
        await resend.emails.send({
          from: `Tropx Wholesale <${fromEmail.value()}>`,
          to: email,
          subject: threshold.subject(firstName),
          html: emailHtml,
        });

        // Mark as sent on cart doc
        await db
          .doc(`portalCarts/${customerId}`)
          .update({
            [threshold.field]: true,
            [`${threshold.field}SentAt`]:
            admin.firestore.FieldValue
              .serverTimestamp(),
          });

        logger.info(
          `Abandoned cart email sent: ${threshold.key}`, {customerId}
        );

        // Only send one threshold per run
        // per customer to avoid flooding
        break;
      }
    }
  });

export const onPortalOrderConfirmation =
  onDocumentCreated(
    {
      document: "orders/{orderId}",
      database: DATABASE_ID,
      region: "northamerica-northeast2",
      secrets: [resendApiKey, fromEmail, sentryDsn],
    },
    async (event) => {
      const order = event.data?.data();
      if (!order || order.portalConfirmationSentAt) return;

      // Only fire for portal orders
      if (order.source !== "customer_portal") {
        return;
      }

      // Check notification setting
      const isEnabled = await isNotificationEnabled(
        "customerOrderConfirmed"
      );
      if (!isEnabled) return;

      const customerEmail = order.customerEmail;
      if (!customerEmail) return;

      const firstName = order.customerName
        ?.split(" ")[0] || "there";

      // Build invoice HTML inline in email
      // (same structure as generateInvoiceHtml
      // in order-detail.component.ts)

      const formatCurrency = (cents: number) =>
        "$" + (cents / 100).toFixed(2);

      const formatDate = (ts: any) => {
        if (!ts) return "—";
        const d = ts.toDate ?
          ts.toDate() : new Date(ts);
        return d.toLocaleDateString("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      };

      // Load business settings
      const settingsDoc = await admin
        .firestore()
        .doc("settings/business")
        .get();
      const business = settingsDoc.data() || {};

      const invoiceSettingsDoc = await admin
        .firestore()
        .doc("settings/invoice")
        .get();
      const invoiceSettings =
        invoiceSettingsDoc.data() || {};

      const companyName =
        business.tradingName || "Tropx Wholesale";
      const etransferEmail =
        invoiceSettings.etransferEmail ||
        "tropxenterprises@gmail.com";
      const paymentTermsDays =
        invoiceSettings.paymentTermsDays || 30;
      const hstNumber =
        business.hstNumber || "793273830 RT 0001";
      const logoUrl = business.logoUrl || "";

      const dueDate = (() => {
        if (!order.confirmedAt) return "—";
        const d = order.confirmedAt.toDate ?
          order.confirmedAt.toDate() :
          new Date(order.confirmedAt);
        const due = new Date(d);
        due.setDate(
          due.getDate() + paymentTermsDays
        );
        return due.toLocaleDateString("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      })();

      const itemRows = (order.items || [])
        .map((item: any) => `
          <tr>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              font-size:14px;">
              <div style="font-weight:600;
                color:#1c1c1c;">
                ${item.productName}
              </div>
              <div style="font-size:12px;
                color:#8a94a6;
                font-family:monospace;">
                ${item.productSku}
              </div>
            </td>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              text-align:center;font-size:14px;">
              ${item.quantity}
            </td>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              text-align:right;font-size:14px;">
              ${formatCurrency(item.unitPriceCents)}
            </td>
            <td style="padding:10px 12px;
              border-bottom:1px solid #f0f0f0;
              text-align:right;font-size:14px;
              font-weight:600;color:#0a2d4a;">
              ${formatCurrency(item.lineTotalCents)}
            </td>
          </tr>
        `).join("");

      const portalOrderUrl =
        "https://tropxwholesale.ca/portal/orders/" +
        event.params.orderId;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,
    initial-scale=1.0">
  <title>Order Confirmation</title>
</head>
<body style="margin:0;padding:0;
  background:#f4f5f7;
  font-family:-apple-system,
  BlinkMacSystemFont,'Segoe UI',
  Arial,sans-serif;">
  <div style="max-width:680px;
    margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="background:#0a2d4a;
      border-radius:12px 12px 0 0;
      padding:28px 32px;">
      <div style="display:flex;
        justify-content:space-between;
        align-items:center;">
        <div>
          ${logoUrl ?
    `<img src="${logoUrl}"
              alt="${companyName}"
              style="height:40px;
              object-fit:contain;">` :
    `<div style="font-size:1.5rem;
              font-weight:800;color:white;">
              ${companyName}
            </div>`
}
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.75rem;
            color:rgba(255,255,255,0.6);
            text-transform:uppercase;
            letter-spacing:0.08em;">
            Order Confirmation
          </div>
          <div style="font-size:1.25rem;
            font-weight:800;color:white;
            font-family:monospace;">
            ${order.orderNumber}
          </div>
        </div>
      </div>
    </div>

    <!-- Confirmation banner -->
    <div style="background:#1a7c4a;
      padding:16px 32px;
      display:flex;align-items:center;
      gap:12px;">
      <div style="width:28px;height:28px;
        border-radius:50%;
        background:rgba(255,255,255,0.2);
        display:flex;align-items:center;
        justify-content:center;
        flex-shrink:0;">
        <span style="color:white;
          font-size:16px;">✓</span>
      </div>
      <div>
        <div style="font-weight:700;
          color:white;font-size:0.9375rem;">
          Order Confirmed!
        </div>
        <div style="font-size:0.8125rem;
          color:rgba(255,255,255,0.8);">
          Hi ${firstName}, your order has been
          received and is being processed.
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="background:white;
      padding:32px;
      border:1px solid #e8eaed;
      border-top:none;">

      <!-- Order meta -->
      <div style="display:grid;
        grid-template-columns:1fr 1fr;
        gap:24px;margin-bottom:28px;">
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            Order Date
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${formatDate(order.confirmedAt)}
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            Payment Due
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${dueDate}
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            Delivery Method
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${order.deliveryType === "pickup" ?
    "📦 Pickup" : "🚚 Delivery"}
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:4px;">
            HST Number
          </div>
          <div style="font-size:0.9rem;
            font-weight:600;color:#1c1c1c;">
            ${hstNumber}
          </div>
        </div>
      </div>

      <!-- Items table -->
      <table style="width:100%;
        border-collapse:collapse;
        margin-bottom:0;">
        <thead>
          <tr style="background:#0a2d4a;">
            <th style="padding:10px 12px;
              text-align:left;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Product
            </th>
            <th style="padding:10px 12px;
              text-align:center;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Qty
            </th>
            <th style="padding:10px 12px;
              text-align:right;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Unit Price
            </th>
            <th style="padding:10px 12px;
              text-align:right;font-size:12px;
              font-weight:700;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:white;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Totals -->
      <div style="border:1px solid #f0f0f0;
        border-top:none;
        margin-bottom:24px;">
        <div style="display:flex;
          justify-content:space-between;
          padding:8px 12px;font-size:14px;
          color:#444;
          border-bottom:1px solid #f0f0f0;">
          <span>Subtotal</span>
          <span>
            ${formatCurrency(order.subtotalCents)}
          </span>
        </div>
        ${order.discountCents > 0 ? `
          <div style="display:flex;
            justify-content:space-between;
            padding:8px 12px;font-size:14px;
            color:#e7222e;
            border-bottom:1px solid #f0f0f0;">
            <span>Discount</span>
            <span>
              -${formatCurrency(
    order.discountCents
  )}
            </span>
          </div>
        ` : ""}
        <div style="display:flex;
          justify-content:space-between;
          padding:8px 12px;font-size:14px;
          color:#444;
          border-bottom:1px solid #f0f0f0;">
          <span>HST (${order.taxRatePercent}%)</span>
          <span>
            ${formatCurrency(order.taxCents)}
          </span>
        </div>
        <div style="display:flex;
          justify-content:space-between;
          padding:14px 12px;
          background:#0a2d4a;
          font-size:1rem;font-weight:700;
          color:white;">
          <span>Total</span>
          <span>
            ${formatCurrency(order.totalCents)}
          </span>
        </div>
      </div>

      <!-- Payment instructions -->
      <div style="background:#f0f7ff;
        border-left:4px solid #16588e;
        border-radius:0 8px 8px 0;
        padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:0.75rem;
          font-weight:700;
          text-transform:uppercase;
          letter-spacing:0.08em;
          color:#16588e;margin-bottom:8px;">
          Payment Instructions
        </div>
        <div style="font-size:0.875rem;
          color:#0a2d4a;margin-bottom:4px;">
          💳 E-Transfer to:
          <strong>${etransferEmail}</strong>
        </div>
        <div style="font-size:0.875rem;
          color:#0a2d4a;margin-bottom:8px;">
          💵 Cash on delivery accepted
        </div>
        <div style="font-size:0.75rem;
          color:#6b7280;">
          Please reference order number
          <strong>${order.orderNumber}</strong>
          in your payment.
          Payment due within
          ${paymentTermsDays} days.
        </div>
      </div>

      ${order.customerNotes ? `
        <div style="background:#f8fafc;
          border-radius:8px;padding:16px;
          margin-bottom:24px;">
          <div style="font-size:0.7rem;
            font-weight:700;
            text-transform:uppercase;
            letter-spacing:0.1em;
            color:#8a94a6;margin-bottom:8px;">
            Your Notes
          </div>
          <div style="font-size:0.875rem;
            color:#444;">
            ${order.customerNotes}
          </div>
        </div>
      ` : ""}

      <!-- View order CTA -->
      <div style="text-align:center;">
        <a href="${portalOrderUrl}"
          style="display:inline-block;
          background:#0a2d4a;color:white;
          text-decoration:none;
          padding:14px 32px;
          border-radius:10px;
          font-weight:700;font-size:1rem;">
          View Order Details →
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;
      text-align:center;
      border:1px solid #e8eaed;
      border-top:none;
      background:#f8fafc;
      border-radius:0 0 12px 12px;">
      <p style="font-size:0.75rem;
        color:#9ca3af;margin:0 0 4px;">
        © Tropx Enterprises Inc. ·
        Kitchener, Ontario, Canada
      </p>
      <p style="font-size:0.75rem;
        color:#9ca3af;margin:0;">
        <a href="https://tropxwholesale.ca"
          style="color:#16588e;
          text-decoration:none;">
          tropxwholesale.ca
        </a>
      </p>
    </div>

  </div>
</body>
</html>`;

      const resend = new Resend(resendApiKey.value());

      await resend.emails.send({
        from: `${companyName} <${fromEmail.value()}>`,
        to: customerEmail,
        subject:
          `Order Confirmed — ${order.orderNumber}`,
        html: emailHtml,
      });

      await event.data?.ref.update({
        portalConfirmationSentAt: FieldValue.serverTimestamp(),
      });

      logger.info(
        "Portal order confirmation sent: " +
        `${order.orderNumber} → ${customerEmail}`
      );
    }
  );
