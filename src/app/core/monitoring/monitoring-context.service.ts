import { Injectable, effect, inject } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { AuthService } from '../services/auth.service';
import { isSentryActive } from './sentry';

/**
 * Keeps Sentry's user context in sync with the signed-in role — role
 * always, uid only for staff. A `customer` role gets a role-only context
 * with no id and no email/name; customer PII is never attached here.
 */
@Injectable({ providedIn: 'root' })
export class MonitoringContextService {
  private readonly auth = inject(AuthService);

  constructor() {
    effect(() => {
      if (!isSentryActive()) return;

      const profile = this.auth.currentProfile();
      if (!profile) {
        Sentry.setUser(null);
        return;
      }

      Sentry.setUser(
        this.auth.isStaff()
          ? { id: profile.uid, role: profile.role }
          : { role: profile.role }
      );
    });
  }
}
