import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.user$.pipe(
    // take(1) ensures guard completes so router navigation can proceed
    take(1),
    map(user => user ? true : router.createUrlTree(['/login']))
  );
};
