import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { AppUser } from '../models/user.model';

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const requiredRoles: string[] = route.data?.['roles'] ?? [];

  return auth.userProfile$.pipe(
    take(1),
    map((profile: AppUser | null) => {
      if (!profile || profile.status === 'suspended') return router.createUrlTree(['/login']);
      // Redirect to unauthorized keeps user logged in while blocking restricted areas
      if (requiredRoles.includes(profile.role)) return true;
      return router.createUrlTree(['/unauthorized']);
    })
  );
};

