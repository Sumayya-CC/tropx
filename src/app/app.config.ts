import { ApplicationConfig, ErrorHandler, provideZonelessChangeDetection,
  provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, initializeFirestore } from '@angular/fire/firestore';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideAppCheck } from '@angular/fire/app-check';
import { environment } from '../environments/environment';
import { initSentry } from './core/monitoring/sentry';
import { AppErrorHandler } from './core/monitoring/app-error-handler';
import { initAppCheck } from './core/security/app-check';

const app = initializeApp(environment.firebase);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, environment.databaseName ?? '(default)');
const functions = getFunctions(app, 'northamerica-northeast2');
const storage = getStorage(app);

// No-op outside production or when no DSN is configured — see
// core/monitoring/sentry.ts.
initSentry();

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideFirebaseApp(() => app),
    provideAuth(() => auth),
    provideFirestore(() => db),
    provideFunctions(() => functions),
    provideStorage(() => storage),
    // Registered only when a site key is configured — see
    // core/security/app-check.ts. Not registering the provider at all
    // (rather than registering it with a null AppCheck instance) is the
    // safe no-op: unregistered means Firestore/Storage/Functions simply
    // never attach a token, exactly like today. Enforcement (whether
    // those services actually REQUIRE a valid token) is a separate
    // Firebase console setting either way, not decided by this line.
    ...(environment.appCheckSiteKey
      ? [provideAppCheck(() => initAppCheck(app)!)]
      : []),
    { provide: ErrorHandler, useClass: AppErrorHandler },
  ],
};