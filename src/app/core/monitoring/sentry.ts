import * as Sentry from '@sentry/angular';
import { environment } from '../../../environments/environment';

let sentryActive = false;

/**
 * Initializes browser error tracking. A pure no-op when no DSN is
 * configured (environment.ts/environment.prod.ts) — gated on the DSN
 * alone, not environment identity, so dev and prod both report once a
 * DSN is set for each; `environment: environment.envLabel` on the init
 * call is what separates them in Sentry, not whether this runs at all.
 *
 * Deliberately conservative: no performance tracing (tracesSampleRate: 0),
 * no `httpClientIntegration` (that's what would capture request/response
 * bodies — order/customer data — so it's left out entirely rather than
 * configured around), and sendDefaultPii stays false so Sentry never
 * auto-attaches IP address or cookies.
 */
export function initSentry(): void {
  if (!environment.sentryDsn) return;
  Sentry.init({
    dsn: environment.sentryDsn,
    environment: environment.envLabel,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  sentryActive = true;
}

export function isSentryActive(): boolean {
  return sentryActive;
}

// Belt-and-suspenders scrub, on top of never deliberately reporting PII or
// *Cents amounts in the first place (see how setUser() is called in
// monitoring-context.service.ts, and app-error-handler.ts's filtering).
const SENSITIVE_KEY = /(cents|email|phone|address|businessname|ownerfirstname|ownerlastname|customername|logourl)/i;

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // The request/XHR surface is the most likely place a customer/order/
  // payment payload would end up — drop it wholesale rather than trying
  // to pick out individual fields.
  delete event.request;

  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (SENSITIVE_KEY.test(key)) delete event.extra[key];
    }
  }

  if (event.user) {
    // Only role and (for staff) uid are ever intentionally set — but
    // enforce the shape here too in case that ever drifts.
    const id = event.user['id'];
    const role = event.user['role'] as string | undefined;
    event.user = {
      id: typeof id === 'string' || typeof id === 'number' ? id : undefined,
      role,
    };
  }

  return event;
}

function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
    delete breadcrumb.data;
  }
  return breadcrumb;
}
