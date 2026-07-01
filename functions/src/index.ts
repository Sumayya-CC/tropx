import * as admin from "firebase-admin";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import {Resend} from "resend";
import {onSchedule} from "firebase-functions/v2/scheduler";

admin.initializeApp();

// Database name resolves based on which
// Firebase project this is deployed to.
// GCLOUD_PROJECT is automatically set by
// Cloud Functions at runtime — no manual
// config needed per environment.
const PROJECT_ID = process.env.GCLOUD_PROJECT || "";
const DATABASE_ID = PROJECT_ID === "tropx-wholesale-prod" ?
  "tropx-prod" : "tropx-dev";

const db = admin.firestore();
db.settings({databaseId: DATABASE_ID});

console.log(
  "Cloud Functions initialized — project: " +
  `${PROJECT_ID}, database: ${DATABASE_ID}`
);

async function getAdminEmail(): Promise<string> {
  try {
    const doc = await db
      .collection("settings")
      .doc("business")
      .get();
    return doc.data()?.email || "admin@tropxwholesale.ca";
  } catch {
    return "admin@tropxwholesale.ca";
  }
}

async function isNotificationEnabled(
  key: string
): Promise<boolean> {
  try {
    const doc = await db
      .collection("settings")
      .doc("notifications")
      .get();
    if (!doc.exists) return true; // default on
    const data = doc.data();
    if (!data) return true;
    return data[key] !== false; // default true
  } catch {
    return true;
  }
}

const resendApiKey = defineSecret("RESEND_API_KEY");
const fromEmail = defineSecret("FROM_EMAIL");

// ─── Welcome Email ─────────────────────────────────────────────────────────
export const onAccessRequestApproved = onDocumentCreated(
  {
    document: "accessRequestApprovals/{approvalId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const {email, ownerFirstName, ownerLastName, businessName} = data;

    if (!email) {
      console.error("No email found on approval");
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const firstName = ownerFirstName ?? "";
    const lastName = ownerLastName ?? null;
    const fullDisplayName = [firstName, lastName]
      .filter(Boolean)
      .join(" ");

    let resetLink = "";
    try {
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        userRecord = await admin.auth().createUser({
          email,
          displayName: fullDisplayName,
          emailVerified: false,
        });
      }

      await db.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        firstName,
        lastName,
        email,
        role: "customer",
        tenantId: data.tenantId ?? 1,
        linkedCustomerId: data.customerId ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isDeleted: false,
      }, {merge: true});

      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );

      await event.data?.ref.update({
        linkedUserId: userRecord.uid,
        processed: true,
        processedAt: new Date(),
      });
    } catch (err) {
      console.error("Error creating user or reset link:", err);
      await event.data?.ref.update({error: true});
      return;
    }

    const html = welcomeEmailHtml(
      firstName || "there",
      businessName ?? "Valued Partner",
      resetLink
    );

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: email,
        subject: "Welcome to Tropx Wholesale — Set Up Your Account",
        html,
      });
      console.log(`Welcome email sent to ${email}`);
    } catch (err) {
      console.error("Error sending welcome email:", err);
    }
  }
);

export const onCustomerDeleted = onDocumentUpdated(
  {
    document: "customers/{customerId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // Only trigger when isDeleted changes to true
    if (before.isDeleted === after.isDeleted) return;
    if (!after.isDeleted) return;

    const email = after.email;
    if (!email) return;

    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(userRecord.uid, {disabled: true});
      console.log(`Disabled Auth user for deleted customer: ${email}`);

      // Also mark user doc as deleted
      await db.collection("users").doc(userRecord.uid).update({
        isDeleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("Error disabling auth user:", err);
    }
  }
);

// ─── Password Reset Email ───────────────────────────────────────────────────
export const sendPasswordResetEmail = onDocumentCreated(
  {
    document: "passwordResetRequests/{requestId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.processed) return;

    const {email} = data;
    if (!email) return;

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let resetLink = "";
    try {
      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );
    } catch (err) {
      console.error("Error generating reset link:", err);
      await event.data?.ref.update({processed: true, error: true});
      return;
    }

    const html = passwordResetEmailHtml(resetLink);

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: email,
        subject: "Reset Your Tropx Wholesale Password",
        html,
      });
      await event.data?.ref.update({
        processed: true,
        sentAt: new Date(),
      });
      console.log(`Password reset email sent to ${email}`);
    } catch (err) {
      console.error("Error sending password reset email:", err);
    }
  }
);

// ─── Admin-Triggered Password Reset ─────────────────────────────────────────
export const onAdminPasswordReset = onDocumentCreated(
  {
    document: "adminPasswordResets/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.processed) return;

    const {email} = data;
    if (!email) {
      await event.data?.ref.update({processed: true, error: "No email"});
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let resetLink = "";
    try {
      // Ensure Auth user exists — create if not
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        // User doesn't exist in Auth yet — create them
        userRecord = await admin.auth().createUser({
          email,
          emailVerified: false,
        });
        console.log(`Created Auth user for ${email}`);
      }

      // Ensure userProfiles doc exists
      const userProfileRef = db.collection("users").doc(userRecord.uid);
      const userProfileSnap = await userProfileRef.get();
      if (!userProfileSnap.exists) {
        // Try to get customer info to populate the profile
        let firstName = "";
        let lastName = null;
        const customerId = data.customerId || null;

        if (customerId) {
          try {
            const customerSnap = await db.collection("customers").doc(customerId).get();
            if (customerSnap.exists) {
              const customer = customerSnap.data()!;
              firstName = customer.ownerFirstName || "";
              lastName = customer.ownerLastName || null;

              // Also patch externalCustomerId back on customer if missing
              const customerData = customerSnap.data()!;
              if (!customerData.linkedUserId) {
                await db.collection("customers").doc(customerId).update({
                  linkedUserId: userRecord.uid,
                });
              }
            }
          } catch (err) {
            console.error("Could not fetch customer for profile:", err);
          }
        }

        await userProfileRef.set({
          uid: userRecord.uid,
          firstName,
          lastName,
          email,
          role: "customer",
          tenantId: data.tenantId ?? 1,
          linkedCustomerId: customerId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isDeleted: false,
        });
        console.log(`Created userProfiles doc for ${email}`);
      }

      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );
    } catch (err: any) {
      console.error("Error generating reset link:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed to generate link",
      });
      return;
    }

    const html = passwordResetEmailHtml(resetLink);

    try {
      await resend.emails.send({
        from: `Tropx Wholesale <${from}>`,
        to: email,
        subject: "Reset Your Tropx Wholesale Password",
        html,
      });
      await event.data?.ref.update({
        processed: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Admin-triggered password reset sent to ${email}`);
    } catch (err: any) {
      console.error("Error sending admin password reset:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed to send email",
      });
    }
  }
);

// ─── Contact Form Notification ──────────────────────────────────────────────
export const onContactInquiry = onDocumentCreated(
  {
    document: "contactInquiries/{inquiryId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {name, email, phone, businessName, message} = data;

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
      console.log("Contact inquiry notification sent");
    } catch (err) {
      console.error("Error sending contact notification:", err);
    }
  }
);

// ─── Employee Management ────────────────────────────────────────────────────

export const onEmployeeInvitation = onDocumentCreated(
  {
    document: "employeeInvitations/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.status !== "pending") return;

    const {email, firstName, lastName, phone, role,
      temporaryPassword, tenantId} = data;

    // Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email,
        password: temporaryPassword,
        displayName: `${firstName} ${lastName}`.trim(),
        emailVerified: false,
      });
    } catch (err: any) {
      console.error("Error creating auth user:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
      return;
    }

    // Create Firestore user doc
    await db.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      firstName,
      lastName: lastName || null,
      phone: phone || null,
      role,
      status: "active",
      tenantId: tenantId ?? 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: data.createdBy || null,
      isDeleted: false,
    });

    // Update invitation doc
    await event.data?.ref.update({
      status: "processed",
      linkedUid: userRecord.uid,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      temporaryPassword: admin.firestore.FieldValue.delete(),
    });

    // Send invitation email
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();
    const roleLabels: Record<string, string> = {
      admin: "Administrator",
      manager: "Manager",
      sales_rep: "Sales Representative",
      warehouse: "Warehouse Staff",
      customer: "Customer",
    };
    const roleLabel = roleLabels[role] || role;

    await resend.emails.send({
      from: `Tropx Wholesale <${from}>`,
      to: email,
      subject: "Your Tropx Wholesale Staff Account",
      html: employeeInvitationEmailHtml(
        firstName, roleLabel, email, temporaryPassword
      ),
    });

    console.log(`Employee invitation processed for ${email}`);
  }
);

export const onAuthAction = onDocumentCreated(
  {
    document: "authActions/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const {action, uid} = data;

    try {
      if (action === "disable") {
        await admin.auth().updateUser(uid, {disabled: true});
        console.log(`Disabled auth user: ${uid}`);
      } else if (action === "enable") {
        await admin.auth().updateUser(uid, {disabled: false});
        console.log(`Enabled auth user: ${uid}`);
      }
      await event.data?.ref.update({processed: true});
    } catch (err) {
      console.error("Error processing auth action:", err);
    }
  }
);

// ─── Invoice Requests ─────────────────────────────────────────────────────────

export const onInvoiceRequest = onDocumentCreated(
  {
    document: "invoiceRequests/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
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

      console.log(
        `Invoice ${orderNumber} sent to ${customerEmail}`
      );
    } catch (err: any) {
      console.error("Error sending invoice email:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
    }
  }
);

export const onOrderNotification = onDocumentCreated(
  {
    document: "orders/{orderId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

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
      console.log(
        `Order notification sent for ${orderNumber}`
      );
    } catch (err) {
      console.error("Error sending order notification:", err);
    }
  }
);

export const onAccessRequestNotification = onDocumentCreated(
  {
    document: "accessRequests/{requestId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const enabled = await isNotificationEnabled(
      "accessRequestAlert"
    );
    if (!enabled) return;

    const adminEmail = await getAdminEmail();
    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    const {
      businessName,
      ownerFirstName,
      ownerLastName,
      email,
      phone,
      businessType,
      address,
    } = data;

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
      console.log(
        `Access request notification sent for ${businessName}`
      );
    } catch (err) {
      console.error(
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
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

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
      console.log(
        `Return notification sent for ${returnNumber}`
      );
    } catch (err) {
      console.error(
        "Error sending return notification:", err
      );
    }
  }
);

export const onLowStockAlert = onDocumentCreated(
  {
    document: "stockAdjustments/{adjustmentId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
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
      console.error("Error computing committed stock:", err);
      // Fall back to raw stock if query fails
    }

    const atp = Math.max(0, newStock - committedQty);

    console.log(
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
        console.log(
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
      console.log(
        `Low stock alert sent for ${productName}: 
         ${newStock} remaining`
      );
    } catch (err) {
      console.error(
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
    secrets: [resendApiKey, fromEmail],
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
      console.log(
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
      console.log(
        `Order status email sent: ${orderNumber} ` +
        `→ ${newStatus} → ${customerEmail}`
      );
    } catch (err) {
      console.error(
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
    secrets: [resendApiKey, fromEmail],
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

    const notifKey = newStatus === "approved" ?
      "customerReturnApproved" :
      "customerReturnRejected";

    const enabled = await isNotificationEnabled(notifKey);
    if (!enabled) return;

    // Get customer email from linked order
    const customerEmail = after.customerEmail;
    if (!customerEmail) {
      console.log(
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
      console.log(
        `Return status email sent: ${returnNumber} ` +
        `→ ${newStatus} → ${customerEmail}`
      );
    } catch (err) {
      console.error(
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
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const enabled = await isNotificationEnabled(
      "customerPaymentReceipt"
    );
    if (!enabled) return;

    const customerEmail = data.customerEmail;
    if (!customerEmail) {
      console.log(
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
      console.log("Could not fetch order for receipt");
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
      console.log(
        `Payment receipt sent: ${paymentNumber} ` +
        `→ ${customerEmail}`
      );
    } catch (err) {
      console.error(
        "Error sending payment receipt:", err
      );
    }
  }
);

// ─── Email Templates ────────────────────────────────────────────────────────

function welcomeEmailHtml(
  ownerName: string,
  businessName: string,
  resetLink: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Tropx Wholesale</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 2rem 2.5rem;
      text-align: center;
    }
    .header h1 {
      color: #ffffff; font-size: 1.5rem;
      margin: 0; font-weight: 700;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }
    .body { padding: 2.5rem; }
    .greeting {
      font-size: 1.1rem; color: #1c1c1c;
      margin-bottom: 1rem;
    }
    .message {
      color: #444; line-height: 1.7;
      margin-bottom: 1.5rem; font-size: 0.95rem;
    }
    .highlight-box {
      background: #f0f7ff;
      border-left: 4px solid #16588e;
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem; margin-bottom: 2rem;
    }
    .highlight-box p {
      margin: 0; color: #0a2d4a;
      font-size: 0.9rem; line-height: 1.6;
    }
    .btn {
      display: block; width: fit-content;
      margin: 0 auto 2rem; background: #0a2d4a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 0.875rem 2.5rem; border-radius: 8px;
      font-weight: 600; font-size: 1rem;
      text-align: center;
    }
    .feature-item {
      display: flex; align-items: flex-start;
      gap: 0.75rem; margin-bottom: 0.5rem;
    }
    .feature-icon {
      color: #1a7c4a; font-weight: 700;
      font-size: 1rem;
    }
    .feature-text {
      color: #444; font-size: 0.875rem;
      line-height: 1.5;
    }
    .divider {
      border: none; border-top: 1px solid #eee;
      margin: 1.5rem 0;
    }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2.5rem; text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.8rem;
      margin: 0.25rem 0; line-height: 1.6;
    }
    .footer a { color: #16588e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Your Wholesale Partner</p>
    </div>
    <div class="body">
      <p class="greeting">Welcome, ${ownerName}! 🎉</p>
      <p class="message">
        Congratulations — <strong>${businessName}</strong> has been
        approved as a Tropx Wholesale partner. We're excited to
        work with you and help keep your shelves stocked with
        quality products at competitive prices.
      </p>
      <div class="highlight-box">
        <p>
          <strong>Your account is ready.</strong> Click the button
          below to set your password and access your wholesale
          portal. This link expires in 24 hours.
        </p>
      </div>
      <a href="${resetLink}" class="btn">
        Set Up Your Account →
      </a>
      <div style="margin-bottom: 2rem;">
        <p style="color:#0a2d4a;font-size:0.95rem;font-weight:600;">
          What you can do in your portal:
        </p>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            Browse our full product catalog with wholesale pricing
          </span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            Place and track orders anytime, 24/7
          </span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            View your order history and payment records
          </span>
        </div>
      </div>
      <hr class="divider">
      <p class="message" style="font-size:0.875rem;color:#666;">
        If you have any questions, don't hesitate to reach out.
        We're here to help.
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca
      </a></p>
      <p style="margin-top:1rem;font-size:0.75rem;">
        You received this email because your wholesale access
        request was approved.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function passwordResetEmailHtml(resetLink: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 2rem 2.5rem;
      text-align: center;
    }
    .header h1 {
      color: #ffffff; font-size: 1.5rem;
      margin: 0; font-weight: 700;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }
    .body { padding: 2.5rem; }
    .message {
      color: #444; line-height: 1.7;
      margin-bottom: 1.5rem; font-size: 0.95rem;
    }
    .highlight-box {
      background: #fff8f0;
      border-left: 4px solid #c9952a;
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem; margin-bottom: 2rem;
    }
    .highlight-box p {
      margin: 0; color: #6b4c00;
      font-size: 0.9rem; line-height: 1.6;
    }
    .btn {
      display: block; width: fit-content;
      margin: 0 auto 2rem; background: #0a2d4a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 0.875rem 2.5rem; border-radius: 8px;
      font-weight: 600; font-size: 1rem;
      text-align: center;
    }
    .divider {
      border: none; border-top: 1px solid #eee;
      margin: 1.5rem 0;
    }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2.5rem; text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.8rem;
      margin: 0.25rem 0; line-height: 1.6;
    }
    .footer a { color: #16588e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Your Wholesale Partner</p>
    </div>
    <div class="body">
      <p class="message" style="font-size:1.05rem;
        font-weight:600;color:#0a2d4a;">
        Password Reset Request
      </p>
      <p class="message">
        We received a request to reset the password for your
        Tropx Wholesale account. Click the button below to
        choose a new password.
      </p>
      <div class="highlight-box">
        <p>
          ⏱ This link expires in <strong>1 hour</strong>.
          If you didn't request a password reset, you can
          safely ignore this email.
        </p>
      </div>
      <a href="${resetLink}" class="btn">
        Reset My Password →
      </a>
      <hr class="divider">
      <p class="message" style="font-size:0.875rem;color:#666;">
        If the button doesn't work, copy and paste this link:<br>
        <a href="${resetLink}"
          style="color:#16588e;word-break:break-all;">
          ${resetLink}
        </a>
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca
      </a></p>
      <p style="margin-top:1rem;font-size:0.75rem;">
        If you did not request a password reset, please
        ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function contactInquiryEmailHtml(
  name: string,
  email: string,
  phone: string,
  businessName: string,
  message: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 1.5rem 2rem;
    }
    .header h1 {
      color: #ffffff; font-size: 1.1rem; margin: 0;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.8rem;
    }
    .body { padding: 2rem; }
    .field {
      margin-bottom: 1.25rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #f0f0f0;
    }
    .field:last-child { border-bottom: none; }
    .label {
      font-size: 0.75rem; font-weight: 600;
      color: #8a94a6; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.35rem;
    }
    .value {
      font-size: 0.95rem; color: #1c1c1c;
      line-height: 1.6;
    }
    .footer {
      background: #f8f9fa; padding: 1rem 2rem;
      text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.78rem; margin: 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>New Contact Inquiry</h1>
      <p>Tropx Wholesale — tropxwholesale.ca</p>
    </div>
    <div class="body">
      <div class="field">
        <div class="label">Name</div>
        <div class="value">${name ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Business Name</div>
        <div class="value">${businessName ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value">${email ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${phone ?? "Not provided"}</div>
      </div>
      <div class="field">
        <div class="label">Message</div>
        <div class="value">${message ?? "—"}</div>
      </div>
    </div>
    <div class="footer">
      <p>Sent from tropxwholesale.ca contact form</p>
    </div>
  </div>
</body>
</html>`;
}

function employeeInvitationEmailHtml(
  firstName: string,
  roleLabel: string,
  email: string,
  tempPassword: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Your Staff Account</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont,
      'Segoe UI', sans-serif; background:#f5f5f5; 
      margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px; overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a; padding:2rem 2.5rem;
      text-align:center; }
    .header h1 { color:#fff; font-size:1.5rem; margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.875rem; }
    .body { padding:2.5rem; }
    .message { color:#444; line-height:1.7;
      margin-bottom:1.5rem; font-size:0.95rem; }
    .credentials-box { background:#f0f7ff;
      border-left:4px solid #16588e;
      border-radius:0 8px 8px 0;
      padding:1.25rem 1.5rem; margin-bottom:2rem; }
    .credentials-box p { margin:0.25rem 0; 
      font-size:0.9rem; color:#0a2d4a; }
    .credentials-box strong { font-family:monospace;
      font-size:1rem; }
    .btn { display:block; width:fit-content;
      margin:0 auto 2rem; background:#0a2d4a;
      color:#fff !important; text-decoration:none;
      padding:0.875rem 2.5rem; border-radius:8px;
      font-weight:600; font-size:1rem; text-align:center; }
    .footer { background:#f8f9fa; padding:1.5rem 2.5rem;
      text-align:center; }
    .footer p { color:#8a94a6; font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Staff Portal Access</p>
    </div>
    <div class="body">
      <p class="message">
        Hi ${firstName}, a staff account has been created 
        for you on the Tropx Wholesale platform. 
        Your role is <strong>${roleLabel}</strong>.
      </p>
      <div class="credentials-box">
        <p>Email: <strong>${email}</strong></p>
        <p>Temporary Password: 
          <strong>${tempPassword}</strong></p>
      </div>
      <a href="https://tropxwholesale.ca/login" class="btn">
        Sign In →
      </a>
      <p class="message" style="font-size:0.875rem;
        color:#666;">
        Please change your password after signing in.
        If you have questions, contact your administrator.
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca</a></p>
    </div>
  </div>
</body>
</html>`;
}

function orderNotificationEmailHtml(
  orderNumber: string,
  customerName: string,
  customerPhone: string,
  total: string,
  itemsHtml: string,
  deliveryType: string,
  serviceAreaName: string,
  source: string
): string {
  const deliveryLabel = deliveryType === "pickup" ?
    "📦 Pickup" : "🚚 Delivery";
  const sourceLabel = source === "customer_portal" ?
    "Customer Portal" : "Admin";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.85rem; }
    .body { padding:1.75rem 2rem; }
    .order-num { font-family:monospace;
      font-size:1.5rem; font-weight:800;
      color:#0a2d4a; margin:0 0 1rem; }
    .meta-grid { display:grid;
      grid-template-columns:1fr 1fr;
      gap:1rem; margin-bottom:1.5rem; }
    .meta-item .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:#8a94a6;
      margin-bottom:0.25rem; }
    .meta-item .value { font-size:0.9rem;
      color:#1c1c1c; font-weight:500; }
    table { width:100%; border-collapse:collapse;
      margin-bottom:1rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px; font-size:0.75rem;
      font-weight:700; text-transform:uppercase;
      color:white; text-align:left; }
    .total-row { background:#f8f9fa;
      border-top:2px solid #0a2d4a; }
    .total-row td { padding:12px;
      font-weight:700; font-size:1rem;
      color:#0a2d4a; }
    .action-btn { display:inline-block;
      margin-top:1.5rem; background:#0a2d4a;
      color:#fff !important; text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🛒 New Order Received</h1>
      <p>Tropx Wholesale Admin Alert</p>
    </div>
    <div class="body">
      <div class="order-num">${orderNumber}</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Customer</div>
          <div class="value">${customerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">Phone</div>
          <div class="value">
            ${customerPhone || "—"}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Delivery</div>
          <div class="value">${deliveryLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Service Area</div>
          <div class="value">
            ${serviceAreaName || "—"}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Source</div>
          <div class="value">${sourceLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Order Total</div>
          <div class="value" 
            style="font-size:1.1rem;font-weight:700;
              color:#0a2d4a;">
            ${total}
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tr class="total-row">
          <td colspan="2">Order Total</td>
          <td style="text-align:right;">${total}</td>
        </tr>
      </table>
      <a href="https://tropxwholesale.ca/admin/orders"
        class="action-btn">
        View Order →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

function accessRequestNotificationEmailHtml(
  businessName: string,
  ownerName: string,
  email: string,
  phone: string,
  businessType: string,
  address: any
): string {
  const addressStr = address ?
    [address.city, address.province, address.country]
      .filter(Boolean).join(", ") :
    "—";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.85rem; }
    .body { padding:1.75rem 2rem; }
    .business-name { font-size:1.375rem;
      font-weight:800; color:#0a2d4a;
      margin:0 0 1.25rem; }
    .field { margin-bottom:1rem;
      padding-bottom:1rem;
      border-bottom:1px solid #f0f0f0; }
    .field:last-of-type { border-bottom:none; }
    .label { font-size:0.7rem; font-weight:700;
      text-transform:uppercase; letter-spacing:0.05em;
      color:#8a94a6; margin-bottom:0.25rem; }
    .value { font-size:0.925rem; color:#1c1c1c; }
    .action-btn { display:inline-block;
      margin-top:1.5rem; background:#1a7c4a;
      color:#fff !important; text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🏪 New Access Request</h1>
      <p>Tropx Wholesale — Review Required</p>
    </div>
    <div class="body">
      <div class="business-name">${businessName}</div>
      <div class="field">
        <div class="label">Owner Name</div>
        <div class="value">${ownerName || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value">${email || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${phone || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Business Type</div>
        <div class="value">${businessType || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Location</div>
        <div class="value">${addressStr}</div>
      </div>
      <a href="https://tropxwholesale.ca/admin/access-requests"
        class="action-btn">
        Review Request →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

function returnNotificationEmailHtml(
  returnNumber: string,
  orderNumber: string,
  customerName: string,
  typeLabel: string,
  amount: string,
  reasonLabel: string,
  reason: string,
  itemsHtml: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#c9952a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#fff9ee; margin:0.25rem 0 0;
      font-size:0.85rem; opacity:0.85; }
    .body { padding:1.75rem 2rem; }
    .return-num { font-family:monospace;
      font-size:1.375rem; font-weight:800;
      color:#0a2d4a; margin:0 0 0.25rem; }
    .order-ref { font-size:0.875rem; color:#8a94a6;
      margin:0 0 1.25rem; }
    .meta-grid { display:grid;
      grid-template-columns:1fr 1fr;
      gap:1rem; margin-bottom:1.5rem; }
    .meta-item .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:#8a94a6;
      margin-bottom:0.25rem; }
    .meta-item .value { font-size:0.9rem;
      color:#1c1c1c; font-weight:500; }
    .reason-box { background:#fff8f0;
      border-left:4px solid #c9952a;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      color:#8a94a6; margin-bottom:0.375rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    table { width:100%; border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px; font-size:0.75rem;
      font-weight:700; text-transform:uppercase;
      color:white; text-align:left; }
    .action-btn { display:inline-block;
      background:#c9952a; color:#fff !important;
      text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>↩️ Return Submitted</h1>
      <p>Tropx Wholesale — Action Required</p>
    </div>
    <div class="body">
      <div class="return-num">${returnNumber}</div>
      <div class="order-ref">
        Order: ${orderNumber}
      </div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Customer</div>
          <div class="value">${customerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">Return Type</div>
          <div class="value">${typeLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Return Value</div>
          <div class="value"
            style="font-size:1.1rem;font-weight:700;
              color:#e7222e;">
            ${amount}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Reason</div>
          <div class="value">${reasonLabel}</div>
        </div>
      </div>
      <div class="reason-box">
        <div class="label">Customer Description</div>
        <div class="value">${reason || "—"}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Value
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <a href="https://tropxwholesale.ca/admin/returns"
        class="action-btn">
        Review Return →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

function lowStockAlertEmailHtml(
  productName: string,
  productSku: string,
  atp: number,
  threshold: number,
  isOutOfStock: boolean,
  linkedOrderNumber: string | null,
  committedQty = 0
): string {
  const headerColor = isOutOfStock ?
    "#e7222e" : "#c9952a";
  const statusText = isOutOfStock ?
    "Out of Stock" : "Low Stock";
  const emoji = isOutOfStock ? "🔴" : "🟡";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${headerColor};
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#fff; margin:0.25rem 0 0;
      font-size:0.85rem; opacity:0.85; }
    .body { padding:1.75rem 2rem; }
    .product-name { font-size:1.375rem;
      font-weight:800; color:#0a2d4a;
      margin:0 0 0.25rem; }
    .product-sku { font-family:monospace;
      font-size:0.875rem; color:#8a94a6;
      margin:0 0 1.5rem; }
    .stock-display { text-align:center;
      padding:1.5rem; background:#f8f9fa;
      border-radius:10px; margin-bottom:1.5rem; }
    .stock-number { font-size:3rem; font-weight:800;
      color:${headerColor}; line-height:1; }
    .stock-label { font-size:0.875rem; color:#8a94a6;
      margin-top:0.25rem; }
    .threshold-note { font-size:0.875rem;
      color:#8a94a6; margin-top:0.5rem; }
    .context-box { background:#f0f7ff;
      border-left:4px solid #16588e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .context-box p { margin:0; font-size:0.875rem;
      color:#0a2d4a; }
    .action-btn { display:inline-block;
      background:#0a2d4a; color:#fff !important;
      text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${emoji} ${statusText} Alert</h1>
      <p>Tropx Wholesale Inventory Warning</p>
    </div>
    <div class="body">
      <div class="product-name">${productName}</div>
      <div class="product-sku">SKU: ${productSku}</div>
      <div class="stock-display">
        <div class="stock-number">
          ${atp}
        </div>
        <div class="stock-label">
          units available to promise
        </div>
        <div class="threshold-note">
          Low stock threshold: ${threshold} units
          ${committedQty > 0 ?
    `· ${committedQty} committed to open orders` :
    ""}
        </div>
      </div>
      ${linkedOrderNumber ? `
        <div class="context-box">
          <p>
            This alert was triggered by order
            <strong>${linkedOrderNumber}</strong>.
          </p>
        </div>
      ` : ""}
      <p style="color:#444;font-size:0.9rem;
        margin-bottom:1.5rem;line-height:1.6;">
        ${isOutOfStock ?
    "This product is now <strong>out of stock</strong>. " +
          "Please reorder as soon as possible." :
    "This product is running low. Consider restocking soon."
}
      </p>
      <a href="https://tropxwholesale.ca/admin/products"
        class="action-btn">
        View Products →
      </a>
    </div>
  </div>
</body>
</html>`;
}

function orderStatusEmailHtml(
  status: string,
  orderNumber: string,
  customerName: string,
  total: string,
  balance: string,
  balanceCents: number,
  itemsHtml: string,
  deliveryType: string,
  deliveryDateStr: string,
  cancellationReason: string
): string {
  const configs: Record<string, {
    headerBg: string;
    emoji: string;
    title: string;
    subtitle: string;
    message: string;
    btnColor: string;
    btnText: string;
  }> = {
    confirmed: {
      headerBg: "#1a7c4a",
      emoji: "✅",
      title: "Order Confirmed",
      subtitle: "Your order has been received",
      message: "Great news! Your order has been " +
        "confirmed and is being prepared. " +
        "We will notify you when it is on its way.",
      btnColor: "#1a7c4a",
      btnText: "View Order →",
    },
    out_for_delivery: {
      headerBg: "#16588e",
      emoji: "🚚",
      title: "Out for Delivery",
      subtitle: "Your order is on its way",
      message: "Your order is on its way to you. " +
        "Please ensure someone is available " +
        "to receive the delivery.",
      btnColor: "#16588e",
      btnText: "View Order →",
    },
    delivered: {
      headerBg: "#0a2d4a",
      emoji: "📦",
      title: "Order Delivered",
      subtitle: "Your order has arrived",
      message: "Your order has been marked as " +
        "delivered. Thank you for your business! " +
        "If you have any issues with your order, " +
        "please contact us.",
      btnColor: "#0a2d4a",
      btnText: "View Invoice →",
    },
    cancelled: {
      headerBg: "#e7222e",
      emoji: "❌",
      title: "Order Cancelled",
      subtitle: "Your order has been cancelled",
      message: "Your order has been cancelled. " +
        "If you have any questions or would like " +
        "to place a new order, please contact us.",
      btnColor: "#e7222e",
      btnText: "Contact Us →",
    },
  };

  const cfg = configs[status] || configs["confirmed"];

  const deliverySection = deliveryDateStr ?
    `<div class="info-box">
      <div class="info-label">
        ${status === "out_for_delivery" ?
    "Expected Delivery" : "Delivery Date"}
      </div>
      <div class="info-value">${deliveryDateStr}</div>
    </div>` : "";

  const cancellationSection = (
    status === "cancelled" && cancellationReason
  ) ?
    `<div class="reason-box">
      <div class="label">Reason</div>
      <div class="value">${cancellationReason}</div>
    </div>` : "";

  const balanceSection = (
    status === "delivered" && balanceCents > 0
  ) ?
    `<div class="balance-box">
      <p>
        <strong>Outstanding Balance: ${balance}</strong>
        <br>
        <span style="font-size:0.875rem;color:#666;">
          Please arrange payment at your earliest
          convenience.
        </span>
      </p>
    </div>` : "";

  const btnHref = status === "cancelled" ?
    "https://tropxwholesale.ca/contact" :
    "https://tropxwholesale.ca/portal/orders";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${cfg.headerBg};
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#fff;margin:0.25rem 0 0;
      font-size:0.875rem;opacity:0.85; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .order-num { font-family:monospace;
      font-size:1.25rem;font-weight:800;
      color:#0a2d4a;margin-bottom:1.5rem; }
    .info-box { background:#f8f9fa;
      border-radius:8px;padding:1rem 1.25rem;
      margin-bottom:1rem; }
    .info-label { font-size:0.7rem;font-weight:700;
      text-transform:uppercase;letter-spacing:0.05em;
      color:#8a94a6;margin-bottom:0.25rem; }
    .info-value { font-size:0.95rem;
      color:#1c1c1c;font-weight:600; }
    .reason-box { background:#fff0f0;
      border-left:4px solid #e7222e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    .balance-box { background:#fff8f0;
      border-left:4px solid #c9952a;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .balance-box p { margin:0;color:#1c1c1c;
      font-size:0.9rem;line-height:1.6; }
    table { width:100%;border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px;font-size:0.75rem;
      font-weight:700;text-transform:uppercase;
      color:white;text-align:left; }
    tbody td { border-bottom:1px solid #f0f0f0; }
    .total-row { background:#f8f9fa; }
    .total-row td { padding:12px;font-weight:700;
      font-size:1rem;color:#0a2d4a; }
    .btn { display:inline-block;
      background:${cfg.btnColor};
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">${cfg.emoji}</span>
      <h1>${cfg.title}</h1>
      <p>${cfg.subtitle}</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">${cfg.message}</p>
      <div class="order-num">
        Order: ${orderNumber}
      </div>
      ${deliverySection}
      ${cancellationSection}
      ${balanceSection}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tr class="total-row">
          <td colspan="2"
            style="padding:12px;">
            Order Total
          </td>
          <td style="padding:12px;
            text-align:right;">
            ${total}
          </td>
        </tr>
      </table>
      <a href="${btnHref}" class="btn">
        ${cfg.btnText}
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function returnStatusEmailHtml(
  status: string,
  returnNumber: string,
  orderNumber: string,
  customerName: string,
  typeLabel: string,
  amount: string,
  itemsHtml: string,
  rejectionReason: string,
  stockRestored: boolean
): string {
  const isApproved = status === "approved";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${isApproved ?
    "#1a7c4a" : "#e7222e"};
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#fff;margin:0.25rem 0 0;
      font-size:0.875rem;opacity:0.85; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .ref-row { display:flex;gap:1.5rem;
      margin-bottom:1.5rem;flex-wrap:wrap; }
    .ref-item .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      letter-spacing:0.05em;color:#8a94a6;
      margin-bottom:0.25rem; }
    .ref-item .value { font-size:0.95rem;
      color:#1c1c1c;font-weight:600;
      font-family:monospace; }
    .amount-box { background:${isApproved ?
    "rgba(26,124,74,0.06)" :
    "rgba(231,34,46,0.06)"};
      border-left:4px solid ${isApproved ?
    "#1a7c4a" : "#e7222e"};
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .amount-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .amount-box .value { font-size:1.25rem;
      font-weight:800;
      color:${isApproved ? "#1a7c4a" : "#e7222e"}; }
    .reason-box { background:#fff0f0;
      border-left:4px solid #e7222e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    table { width:100%;border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px;font-size:0.75rem;
      font-weight:700;text-transform:uppercase;
      color:white;text-align:left; }
    tbody td { border-bottom:1px solid #f0f0f0; }
    .btn { display:inline-block;
      background:${isApproved ?
    "#1a7c4a" : "#0a2d4a"};
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">
        ${isApproved ? "✅" : "❌"}
      </span>
      <h1>
        Return ${isApproved ? "Approved" : "Not Approved"}
      </h1>
      <p>
        ${isApproved ?
    "Your return has been processed" :
    "We could not approve your return"}
      </p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">
        ${isApproved ?
    "Your return request has been approved. " +
          `A <strong>${typeLabel}</strong> of ` +
          `<strong>${amount}</strong> has been ` +
          "processed for your account." :
    "Unfortunately we were unable to approve " +
          "your return request at this time. " +
          "Please contact us if you have questions."
}
      </p>
      <div class="ref-row">
        <div class="ref-item">
          <div class="label">Return</div>
          <div class="value">${returnNumber}</div>
        </div>
        <div class="ref-item">
          <div class="label">Order</div>
          <div class="value">${orderNumber}</div>
        </div>
      </div>
      ${isApproved ? `
        <div class="amount-box">
          <div class="label">
            ${typeLabel} Amount
          </div>
          <div class="value">${amount}</div>
        </div>
        ${stockRestored ? `
          <p style="font-size:0.875rem;
            color:#666;margin-bottom:1.5rem;">
            ℹ️ The returned items have been added
            back to inventory.
          </p>
        ` : ""}
      ` : `
        ${rejectionReason ? `
          <div class="reason-box">
            <div class="label">Reason</div>
            <div class="value">
              ${rejectionReason}
            </div>
          </div>
        ` : ""}
      `}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Value
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <a href="https://tropxwholesale.ca/portal/orders"
        class="btn">
        View My Orders →
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function paymentReceiptEmailHtml(
  paymentNumber: string,
  orderNumber: string,
  customerName: string,
  amount: string,
  methodLabel: string,
  referenceNumber: string,
  receivedDate: string,
  balance: string,
  orderTotal: string,
  remainingBalanceCents: number
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#f0c040;margin:0.25rem 0 0;
      font-size:0.875rem; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .amount-display { text-align:center;
      padding:1.5rem;background:#f0f7f3;
      border-radius:10px;margin-bottom:1.5rem;
      border:1px solid rgba(26,124,74,0.2); }
    .amount-num { font-size:2.5rem;font-weight:800;
      color:#1a7c4a;line-height:1; }
    .amount-label { font-size:0.875rem;
      color:#8a94a6;margin-top:0.25rem; }
    .details-table { width:100%;
      border-collapse:collapse;
      margin-bottom:1.5rem; }
    .details-table tr { border-bottom:
      1px solid #f0f0f0; }
    .details-table tr:last-child {
      border-bottom:none; }
    .details-table td { padding:0.75rem 0;
      font-size:0.9rem; }
    .details-table td:first-child {
      color:#8a94a6;font-weight:500; }
    .details-table td:last-child {
      color:#1c1c1c;font-weight:600;
      text-align:right; }
    .balance-box { padding:1rem 1.25rem;
      border-radius:8px;margin-bottom:1.5rem;
      background:${remainingBalanceCents > 0 ?
    "rgba(231,34,46,0.06)" :
    "rgba(26,124,74,0.06)"};
      border:1px solid ${remainingBalanceCents > 0 ?
    "rgba(231,34,46,0.2)" :
    "rgba(26,124,74,0.2)"}; }
    .balance-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .balance-box .value { font-size:1.125rem;
      font-weight:800;
      color:${remainingBalanceCents > 0 ?
    "#e7222e" : "#1a7c4a"}; }
    .balance-box .sub { font-size:0.8rem;
      color:#8a94a6;margin-top:0.25rem; }
    .btn { display:inline-block;background:#0a2d4a;
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">💳</span>
      <h1>Payment Received</h1>
      <p>Tropx Wholesale — Payment Confirmation</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">
        We have received your payment. Here is your
        receipt for your records.
      </p>
      <div class="amount-display">
        <div class="amount-num">${amount}</div>
        <div class="amount-label">
          Payment received
        </div>
      </div>
      <table class="details-table">
        <tr>
          <td>Payment #</td>
          <td style="font-family:monospace;">
            ${paymentNumber}
          </td>
        </tr>
        <tr>
          <td>Order #</td>
          <td style="font-family:monospace;">
            ${orderNumber}
          </td>
        </tr>
        <tr>
          <td>Payment Method</td>
          <td>${methodLabel}</td>
        </tr>
        ${referenceNumber ? `
          <tr>
            <td>Reference #</td>
            <td style="font-family:monospace;">
              ${referenceNumber}
            </td>
          </tr>
        ` : ""}
        <tr>
          <td>Date</td>
          <td>${receivedDate}</td>
        </tr>
        <tr>
          <td>Order Total</td>
          <td>${orderTotal}</td>
        </tr>
      </table>
      <div class="balance-box">
        <div class="label">
          ${remainingBalanceCents > 0 ?
    "Remaining Balance" :
    "Account Status"}
        </div>
        <div class="value">
          ${remainingBalanceCents > 0 ?
    balance : "Paid in Full ✓"}
        </div>
        ${remainingBalanceCents > 0 ? `
          <div class="sub">
            Balance remaining on this order
          </div>
        ` : `
          <div class="sub">
            This order is fully paid — thank you!
          </div>
        `}
      </div>
      <a href="https://tropxwholesale.ca/portal/orders"
        class="btn">
        View My Orders →
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
      <p style="margin-top:0.75rem;font-size:0.75rem;">
        This is an automated payment confirmation.
        Please keep this email for your records.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export const checkAbandonedCarts =
  onSchedule({
    schedule: "every 60 minutes",
    region: "northamerica-northeast1",
    timeoutSeconds: 300,
    secrets: [resendApiKey, fromEmail],
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
        .collection("userProfiles")
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

        console.log(
          "Abandoned cart email sent: " +
        `${threshold.key} → ${email}`
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
      secrets: [resendApiKey, fromEmail],
    },
    async (event) => {
      const order = event.data?.data();
      if (!order) return;

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

      console.log(
        "Portal order confirmation sent: " +
        `${order.orderNumber} → ${customerEmail}`
      );
    }
  );

// ─── Purchase Order Requests ────────────────────────────────────────────────

export const onPoRequest = onDocumentCreated(
  {
    document: "poRequests/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
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

      console.log(`PO ${poNumber} sent to ${supplierEmail}`);
    } catch (err: any) {
      console.error("Error sending PO email:", err);
      await event.data?.ref.update({
        status: "error",
        error: err.message,
      });
    }
  }
);
