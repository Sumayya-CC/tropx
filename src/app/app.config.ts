import { ApplicationConfig, provideZonelessChangeDetection,
  provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, initializeFirestore } from '@angular/fire/firestore';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { environment } from '../environments/environment';

const app = initializeApp(environment.firebase);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, environment.databaseName ?? '(default)');
const functions = getFunctions(app, 'northamerica-northeast2');
const storage = getStorage(app);

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
  ],
};