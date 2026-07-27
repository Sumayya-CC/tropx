export const environment = {
  production: false,
  // Environment identity — which Firebase project/data this build points
  // at. Distinct from `production` above, which is left as an Angular-
  // convention flag only; do not gate environment-identity behavior
  // (Sentry, App Check debug tokens, banners) on `production` — a
  // dev-deploy build stays `production: false` while still running
  // production-grade optimizations, so `production` no longer reliably
  // means "this is the live prod project." Use `envLabel` for that.
  envLabel: 'development' as 'development' | 'production',
  useEmulator: false,
  // Error tracking is off by default (see core/monitoring/sentry.ts —
  // it only initializes when this is non-empty; gated on the DSN alone,
  // not environment identity, so setting a dev DSN here turns on dev
  // error reporting too). A Sentry DSN is a public client identifier
  // (safe to ship in the bundle, like the Firebase config above) —
  // leave this empty until a Sentry project exists, then set the real
  // value in environment.prod.ts only.
  sentryDsn: '',
  // App Check is off by default (see core/security/app-check.ts — the
  // provider is only registered when this is non-empty). A reCAPTCHA v3
  // site key, like the Sentry DSN above, is a public client identifier
  // safe to ship in the bundle. Leave empty until App Check is set up in
  // the Firebase console for this project; set the real value only in
  // environment.prod.ts, and do not enable per-service enforcement in
  // the console until this is deployed and confirmed working.
  appCheckSiteKey: '',
  firebase: {
    projectId: "tropx-wholesale-dev",
    appId: "1:542964163707:web:7a62a125d3ea344329eede",
    storageBucket: "tropx-wholesale-dev.firebasestorage.app",
    apiKey: "AIzaSyDxMpydGo1LzShOH8hr7Tg8sKEpE5o4wac",
    authDomain: "tropx-wholesale-dev.firebaseapp.com",
    messagingSenderId: "542964163707"
  },
  databaseName: 'tropx-dev',
  emulator: {
    host: 'localhost',
    ports: {
      auth: 9099,
      firestore: 8080,
      functions: 5001,
    },
  },
};
