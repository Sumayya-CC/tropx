import * as fnLogger from "firebase-functions/logger";
import * as Sentry from "@sentry/node";

/**
 * Thin structured-logging + error-reporting wrapper.
 *
 * Drop-in replacement for console.log/console.error/console.warn:
 * firebase-functions/logger already emits structured JSON to Cloud Logging
 * (severity, function name via execution context, timestamp) so callers
 * only need to pass a short message plus safe, non-identifying metadata.
 *
 * NEVER pass: emails, names, addresses, phone numbers, full customer/order
 * objects, or any *Cents amount. Pass a document id or order/invoice number
 * (already a non-identifying business reference) instead when traceability
 * is needed.
 *
 * Sentry is initialized lazily, once per container instance, on the first
 * error() call — by then we're executing inside a specific function's
 * handler, so the SENTRY_DSN secret (declared per-function, like
 * RESEND_API_KEY/FROM_EMAIL) is guaranteed to be populated in process.env
 * if that function has it bound. No DSN configured means Sentry silently
 * stays off; nothing is hardcoded.
 */

let sentryInitAttempted = false;
let sentryReady = false;

// Same 'production'/'development' values as the frontend's
// environment.envLabel (not the raw GCLOUD_PROJECT id), so events from
// both sides filter together in Sentry under one environment value.
function resolveEnvLabel(): "production" | "development" {
  return process.env.GCLOUD_PROJECT === "tropx-wholesale-prod" ?
    "production" : "development";
}

function ensureSentryInit(): void {
  if (sentryInitAttempted) return;
  sentryInitAttempted = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: resolveEnvLabel(),
    tracesSampleRate: 0,
  });
  sentryReady = true;
}

function firstError(args: unknown[]): Error | undefined {
  return args.find((a): a is Error => a instanceof Error);
}

export const info = (...args: unknown[]): void => {
  fnLogger.info(...(args as [unknown, ...unknown[]]));
};

export const warn = (...args: unknown[]): void => {
  fnLogger.warn(...(args as [unknown, ...unknown[]]));
};

// Async and always awaited by callers (see call sites): Cloud Functions
// can freeze the container the instant the handler returns, killing any
// in-flight request — Sentry.captureException only queues the event, so
// without an awaited flush() here the event can silently never leave the
// process. 2s matches Sentry's own recommended serverless flush timeout.
export async function error(...args: unknown[]): Promise<void> {
  fnLogger.error(...(args as [unknown, ...unknown[]]));
  ensureSentryInit();
  if (!sentryReady) return;
  const err = firstError(args);
  if (err) {
    Sentry.captureException(err);
  } else {
    Sentry.captureMessage(
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      "error"
    );
  }
  await Sentry.flush(2000);
}
