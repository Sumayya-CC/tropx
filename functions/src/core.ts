import * as admin from "firebase-admin";
import {defineSecret} from "firebase-functions/params";
import * as logger from "./logger";

// Structured logging + error reporting. See logger.ts: never pass PII or
// *Cents amounts to logger.error/logger.info — a doc id or order/invoice
// number is enough for traceability.
export const sentryDsn = defineSecret("SENTRY_DSN");
export const resendApiKey = defineSecret("RESEND_API_KEY");
export const fromEmail = defineSecret("FROM_EMAIL");

admin.initializeApp();

// Database name resolves based on which
// Firebase project this is deployed to.
// GCLOUD_PROJECT is automatically set by
// Cloud Functions at runtime — no manual
// config needed per environment.
export const PROJECT_ID = process.env.GCLOUD_PROJECT || "";
export const DATABASE_ID = PROJECT_ID === "tropx-wholesale-prod" ?
  "tropx-prod" : "tropx-dev";

export const db = admin.firestore();
db.settings({databaseId: DATABASE_ID});

logger.info(
  "Cloud Functions initialized — project: " +
  `${PROJECT_ID}, database: ${DATABASE_ID}`
);

// Roles collectively referred to as "staff" throughout this codebase —
// gates every staff-only onCall (as opposed to customer-portal or public
// callables). See CLAUDE.md's Roles section.
export const STAFF_ROLES = ["admin", "manager", "sales_rep", "warehouse"];

export async function getAdminEmail(): Promise<string> {
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

export async function isNotificationEnabled(
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
