import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { map } from 'rxjs';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    map((user) => {
      if (user) {
        return true;
      }
      // Preserve the full attempted URL (path + query, e.g. an
      // /invite?token=… deep link) so the login page can return the user
      // there after signing in. '/' is the post-login default anyway, so it
      // needs no `next`.
      const next = state.url && state.url !== '/' ? state.url : null;
      return router.createUrlTree(
        ['/auth/login'],
        next ? { queryParams: { next } } : undefined,
      );
    }),
  );
};
