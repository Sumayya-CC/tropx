import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onDocumentCreated, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {Resend} from "resend";
import * as logger from "../logger";
import {db, DATABASE_ID, sentryDsn, resendApiKey, fromEmail} from "../core";
import {isRateLimited} from "../rate-limit";
import {welcomeEmailHtml, passwordResetEmailHtml, employeeInvitationEmailHtml} from "../email-templates";

// ─── Welcome Email ─────────────────────────────────────────────────────────
export const onAccessRequestApproved = onDocumentCreated(
  {
    document: "accessRequestApprovals/{approvalId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    // Matches the guard on sendPasswordResetEmail/onAdminPasswordReset —
    // this doc is a job-queue request, and a redelivered trigger event
    // would otherwise create a duplicate Auth user attempt and re-send
    // the welcome email.
    if (!data || data.processed) return;

    const {email, ownerFirstName, ownerLastName, businessName} = data;

    if (!email) {
      await logger.error("No email found on approval");
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

      // Stamp the role as a custom claim so Firestore
      // security rules can check request.auth.token.role
      // without an extra DB read.
      await admin.auth().setCustomUserClaims(
        userRecord.uid, {
          role: "customer",
          tenantId: 1,
          linkedCustomerId: data.customerId ?? null,
        }
      );

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
      await logger.error("Error creating user or reset link:", err);
      await event.data?.ref.update({processed: true, error: true});
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
      logger.info("Welcome email sent");
    } catch (err) {
      await logger.error("Error sending welcome email:", err);
    }
  }
);

export const onCustomerDeleted = onDocumentUpdated(
  {
    document: "customers/{customerId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
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
      logger.info("Disabled Auth user for deleted customer", {uid: userRecord.uid});

      // Also mark user doc as deleted
      await db.collection("users").doc(userRecord.uid).update({
        isDeleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      await logger.error("Error disabling auth user:", err);
    }
  }
);

// ─── Password Reset Request (public entry point) ───────────────────────────
// The only sanctioned writer of passwordResetRequests — firestore.rules
// denies public `create` on this collection (see the rate-limiting comment
// block near isRateLimited for why). An onCall function, not a direct
// client write, specifically so this has access to `request.rawRequest.ip`:
// a signal the attacker doesn't control, unlike the submitted email. Always
// resolves {success: true} regardless of whether the request was rate-
// limited or the email belongs to a real account — both are exactly the
// kind of thing that must not be observable from the response, or the
// endpoint becomes an email-enumeration or rate-limit oracle.
export const requestPasswordReset = onCall(
  {
    region: "northamerica-northeast2",
  },
  async (request) => {
    const email = (request.data?.email || "").trim().toLowerCase();
    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required");
    }

    const ip = request.rawRequest.ip || "unknown";
    if (await isRateLimited("passwordResetRequests", ip)) {
      return {success: true};
    }

    await db.collection("passwordResetRequests").add({
      email,
      processed: false,
      createdAt: FieldValue.serverTimestamp(),
      tenantId: 1,
    });

    return {success: true};
  }
);

// ─── Password Reset Email ───────────────────────────────────────────────────
export const sendPasswordResetEmail = onDocumentCreated(
  {
    document: "passwordResetRequests/{requestId}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.processed) return;

    const {email} = data;
    if (!email) return;

    // No isRateLimited call here: the only writer of this collection is
    // requestPasswordReset (above), which already rate-limits by IP before
    // ever creating this doc. A second, email-keyed check here would
    // reintroduce the exact victim-lockout vulnerability that moved this
    // collection off the trigger-gate pattern in the first place.

    const resend = new Resend(resendApiKey.value());
    const from = fromEmail.value();

    let resetLink = "";
    try {
      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );
    } catch (err) {
      await logger.error("Error generating reset link:", err);
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
      logger.info("Password reset email sent");
    } catch (err) {
      await logger.error("Error sending password reset email:", err);
    }
  }
);

// ─── Admin-Triggered Password Reset ─────────────────────────────────────────
export const onAdminPasswordReset = onDocumentCreated(
  {
    document: "adminPasswordResets/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
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
        logger.info("Created Auth user", {uid: userRecord.uid});
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
              const customer = customerSnap.data() || {};
              firstName = customer.ownerFirstName || "";
              lastName = customer.ownerLastName || null;

              // Also patch externalCustomerId back on customer if missing
              const customerData = customerSnap.data() || {};
              if (!customerData.linkedUserId) {
                await db.collection("customers").doc(customerId).update({
                  linkedUserId: userRecord.uid,
                });
              }
            }
          } catch (err) {
            await logger.error("Could not fetch customer for profile:", err);
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
        logger.info("Created userProfiles doc", {customerId});
      }

      // Stamp role claim — determines Firestore rule access.
      // Always customer for admin-triggered resets since this
      // path is used exclusively for customer account setup.
      await admin.auth().setCustomUserClaims(
        userRecord.uid, {
          role: "customer",
          tenantId: 1,
          linkedCustomerId: data.customerId ?? null,
        }
      );

      resetLink = await admin.auth().generatePasswordResetLink(
        email,
        {url: "https://tropxwholesale.ca/login"}
      );
    } catch (err: any) {
      await logger.error("Error generating reset link:", err);
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
      logger.info("Admin-triggered password reset sent");
    } catch (err: any) {
      await logger.error("Error sending admin password reset:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed to send email",
      });
    }
  }
);

export const onEmployeeInvitation = onDocumentCreated(
  {
    document: "employeeInvitations/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [resendApiKey, fromEmail, sentryDsn],
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
      await logger.error("Error creating auth user:", err);
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

    // Stamp role as custom claim. Employee roles:
    // admin | manager | sales_rep | warehouse.
    // These map directly to Firestore rule checks.
    await admin.auth().setCustomUserClaims(
      userRecord.uid,
      {role: role, tenantId: tenantId ?? 1}
    );
    logger.info(
      `Set custom claim role=${role}`, {uid: userRecord.uid}
    );

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

    logger.info("Employee invitation processed");
  }
);

export const onAuthAction = onDocumentCreated(
  {
    document: "authActions/{id}",
    database: DATABASE_ID,
    region: "northamerica-northeast2",
    secrets: [sentryDsn],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const {action, email} = data;
    let {uid} = data;

    try {
      // Resolve uid from email if uid not provided. Email is the
      // reliable identifier since linkedUserId is not always
      // populated on customer docs.
      if (!uid && email) {
        try {
          const userRecord = await admin.auth().getUserByEmail(email);
          uid = userRecord.uid;
        } catch {
          // No Auth account exists for this email — nothing to
          // disable. The customer status flip alone blocks them.
          logger.info("No Auth user for this email, skipping");
          await event.data?.ref.update({
            processed: true,
            note: "no-auth-account",
          });
          return;
        }
      }

      if (!uid) {
        await event.data?.ref.update({
          processed: true,
          error: "No uid or email provided",
        });
        return;
      }

      if (action === "disable") {
        await admin.auth().updateUser(uid, {disabled: true});
        logger.info("Disabled auth user", {uid});
      } else if (action === "enable") {
        await admin.auth().updateUser(uid, {disabled: false});
        logger.info("Enabled auth user", {uid});

        // Re-stamp the claim on re-enable in case it was
        // cleared. Look up role from the users collection.
        try {
          const userDocs = await db
            .collection("users")
            .where("uid", "==", uid)
            .limit(1)
            .get();
          if (!userDocs.empty) {
            const userData = userDocs.docs[0].data();
            const role = userData.role || "customer";
            const tenantId = userData.tenantId ?? 1;
            const linkedCustomerId =
              userData.linkedCustomerId ?? null;
            await admin.auth().setCustomUserClaims(
              uid, {role, tenantId, linkedCustomerId}
            );
            logger.info(
              `Restored claim role=${role} for ${uid}`
            );
          }
        } catch (claimErr) {
          await logger.error(
            "Could not restore claim on enable:", claimErr
          );
        }
      }
      await event.data?.ref.update({processed: true, resolvedUid: uid});
    } catch (err: any) {
      await logger.error("Error processing auth action:", err);
      await event.data?.ref.update({
        processed: true,
        error: err.message || "Failed",
      });
    }
  }
);
