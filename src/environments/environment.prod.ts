export const environment = {
  production: true,
  // See environment.ts for why this is separate from `production` — this
  // is the one place `envLabel` should read 'production'.
  envLabel: 'production' as 'development' | 'production',
  useEmulator: false,
  // See core/monitoring/sentry.ts for what this enables. A DSN is a
  // public client identifier, safe to commit like the Firebase config
  // below.
  sentryDsn: 'https://14f3de173144a5b40cb268dfec52043a@o4511809476034560.ingest.us.sentry.io/4511809535213568',
  // Set the real reCAPTCHA v3 site key here once App Check is set up in
  // the Firebase console for the prod project — see
  // core/security/app-check.ts. Empty keeps it off (a no-op). Do not
  // enable per-service "Enforce" in the console until this value is
  // deployed and confirmed working end to end.
  appCheckSiteKey: '',
  firebase: {
    projectId: 'tropx-wholesale-prod',
    appId: '1:735499758886:web:ff7e3dbbdf5668a0b265e7',
    storageBucket: 'tropx-wholesale-prod.firebasestorage.app',
    apiKey: 'AIzaSyD78ERYinKWMK61WRQ4OPoTRezuRLNPiWM',
    authDomain: 'tropx-wholesale-prod.firebaseapp.com',
    messagingSenderId: '735499758886'
  },
  databaseName: 'tropx-prod',
  emulator: {
    host: 'localhost',
    ports: {
      auth: 9099,
      firestore: 8080,
      functions: 5001,
    },
  },
};