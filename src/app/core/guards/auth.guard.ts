import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  // Use a Promise that waits for Firebase Auth to 
  // finish initializing before making any decision.
  // auth.authStateReady() resolves when Firebase has
  // completed restoring the session from local cache.
  return new Observable(observer => {
    auth.authStateReady().then(() => {
      if (auth.currentUser) {
        observer.next(true);
      } else {
        observer.next(router.createUrlTree(['/login']));
      }
      observer.complete();
    });
  });
};
