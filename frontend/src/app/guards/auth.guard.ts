import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { map } from 'rxjs';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    map((user) => {
      if (user) {
        return true;
      }
      // TODO(ewan): Add the 'next' query parameter to the login URL
      // to redirect user back to where they were going
      return router.parseUrl(`auth/login`);
    }),
  );
};
