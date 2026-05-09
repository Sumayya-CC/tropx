import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { filter, take, map, timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { AppUser } from '../models/user.model';

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const requiredRoles: string[] = route.data?.['roles'] ?? [];

  return auth.userProfile$.pipe(
    // Wait for a real profile — skip the initial null
    // that fires before Firestore loads on refresh
    filter((profile): profile is AppUser => 
      profile !== null && !!profile.role),
    take(1),
    timeout(8000),
    map((profile: AppUser) => {
      if (profile.status === 'suspended') 
        return router.createUrlTree(['/login']);
      if (requiredRoles.length === 0) return true;
      if (requiredRoles.includes(profile.role)) return true;
      return router.createUrlTree(['/unauthorized']);
    }),
    catchError(() => {
      // Timeout or error — redirect to login
      return of(router.createUrlTree(['/login']));
    })
  );
};

