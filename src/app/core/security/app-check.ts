import { FirebaseApp } from '@angular/fire/app';
import { initializeAppCheck, ReCaptchaV3Provider, AppCheck } from '@angular/fire/app-check';
import { environment } from '../../../environments/environment';

/**
 * Initializes Firebase App Check (reCAPTCHA v3) for this app instance.
 * A pure no-op when `environment.appCheckSiteKey` is empty — same
 * unconfigured-is-safe pattern as Sentry (core/monitoring/sentry.ts).
 *
 * IMPORTANT SEQUENCING: this only makes the client capable of sending App
 * Check tokens. Whether Firestore/Storage/Cloud Functions actually
 * REQUIRE a valid token is a separate, per-service "Enforce" toggle in
 * the Firebase console (App Check page) — do not turn that on until
 * this is deployed and confirmed working, or every request from every
 * client without a valid token starts failing, including this app's own
 * production traffic if the site key is wrong or missing.
 *
 * Local dev / emulators: set `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`
 * before this runs (done here automatically outside production) to get a
 * debug token printed to the browser console on first load — register
 * that token in Firebase console → App Check → the debug token allowlist
 * so local/CI testing isn't blocked once enforcement is on. The Local
 * Emulator Suite itself does not enforce App Check by default, so this
 * mainly matters when running the real (non-emulator) dev Firebase
 * project locally.
 *
 * @param {FirebaseApp} app The initialized Firebase app instance to attach App Check to.
 * @return {AppCheck | null} The AppCheck instance, or null if no site key is configured.
 */
export function initAppCheck(app: FirebaseApp): AppCheck | null {
  if (!environment.appCheckSiteKey) return null;

  if (environment.envLabel !== 'production') {
    (self as unknown as Record<string, unknown>)['FIREBASE_APPCHECK_DEBUG_TOKEN'] = true;
  }

  return initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(environment.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
