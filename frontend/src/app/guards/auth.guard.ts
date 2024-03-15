import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  if (authService.user()) {
    return true;
  }

  const router = inject(Router);

  // TODO(ewan): Add the 'next' query parameter to the login URL
  // to redirect user back to where they were going
  return router.parseUrl(`auth/login`);
};
