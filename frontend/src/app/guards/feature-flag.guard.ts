import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { environment } from '@environments/environment';

export type FeatureFlag = keyof typeof environment.featureFlags;

// featureFlagGuard gates a route behind a build-time feature flag. The flag name
// is read from the route's `data.featureFlag`; when the flag is off (or missing)
// the guard redirects to the Account home so flagged-off sections aren't
// reachable by direct URL.
export const featureFlagGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const flag = route.data['featureFlag'] as FeatureFlag | undefined;

  if (flag && environment.featureFlags[flag]) {
    return true;
  }

  return router.parseUrl('/account');
};
