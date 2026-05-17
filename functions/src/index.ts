import * as admin from "firebase-admin";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import {Resend} from "resend";

admin.initializeApp();
const db = admin.firestore();
db.settings({databaseId: "tropx-dev"});

const resendApiKey = defineSecret("RESEND_API_KEY");
const fromEmail = defineSecret("FROM_EMAIL");

// ─── Welcome Email ─────────────────────────────────────────────────────────
export const onAccessRequestApproved = onDocumentCreated(
  {
    document: "accessRequestApprovals/{approvalId}",
    database: "tropx-dev",
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const {email, ownerName, businessName} = data;

    if (!email) {
      console.error("No email found on approval");
      return;
    }

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let resetLink = "";
    try {
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        userRecord = await admin.auth().createUser({
          email,
          displayName: ownerName ?? "",
          emailVerified: false,
        });
      }

      const ownerNameStr = ownerName ?? "";
      const nameParts = ownerNameStr.trim().split(" ");
      const firstName = nameParts[0] || ownerNameStr;
      const lastName = nameParts.slice(1).join(" ") || null;

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
      ownerName ?? "there",
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
    database: "tropx-dev",
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
    database: "tropx-dev",
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

// ─── Contact Form Notification ──────────────────────────────────────────────
export const onContactInquiry = onDocumentCreated(
  {
    document: "contactInquiries/{inquiryId}",
    database: "tropx-dev",
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
    database: "tropx-dev",
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
    database: "tropx-dev",
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
    database: "tropx-dev",
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
        subject: `Invoice ${orderNumber} — Tropx Wholesale`,
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
