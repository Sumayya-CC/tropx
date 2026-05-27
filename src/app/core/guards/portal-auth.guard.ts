import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
import { filter, map, switchMap, take, timeout, catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { AppUser } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class PortalAuthGuard {
  private authService = inject(AuthService);
  private fireAuth = inject(Auth);
  private router = inject(Router);

  canActivate(): Observable<boolean> {
    // 1. Wait for Firebase Auth session restoration
    return from(this.fireAuth.authStateReady()).pipe(
      switchMap(() => {
        // 2. Check if user is logged in
        if (!this.fireAuth.currentUser) {
          this.router.navigate(['/login']);
          return of(false);
        }

        // 3. Wait for Firestore profile to load
        return this.authService.userProfile$.pipe(
          filter((profile): profile is AppUser => 
            profile !== null && !!profile.role
          ),
          take(1),
          timeout(8000),
          map(profile => {
            if (profile.status === 'suspended') {
              this.router.navigate(['/login']);
              return false;
            }
            if (profile.role !== 'customer') {
              this.router.navigate(['/admin/dashboard']);
              return false;
            }
            return true;
          }),
          catchError(() => {
            this.router.navigate(['/login']);
            return of(false);
          })
        );
      })
    );
  }
}
