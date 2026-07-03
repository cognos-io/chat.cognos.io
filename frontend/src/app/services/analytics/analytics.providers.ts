import {
  EnvironmentProviders,
  Provider,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

import { filter } from 'rxjs';

import { ANALYTICS_CONFIG, Analytics } from './analytics';
import { ConsoleAnalytics } from './console-analytics';
import { PlausibleAnalytics } from './plausible-analytics';
import { routePattern } from './route-pattern';

// provideAnalytics wires the Analytics token (Plausible in production,
// console.debug everywhere else) and the single router subscription that sends
// sanitised route-pattern pageviews. Goes in app.config.ts alongside
// providePocketbase(). Kept out of analytics.ts so token/type consumers (and
// src/test-providers.ts, which loads before the Angular test harness) never
// pull in @angular/router.
export function provideAnalytics(): (Provider | EnvironmentProviders)[] {
  return [
    {
      provide: Analytics,
      useFactory: () =>
        inject(ANALYTICS_CONFIG).enabled
          ? inject(PlausibleAnalytics)
          : inject(ConsoleAnalytics),
    },
    provideEnvironmentInitializer(() => {
      const router = inject(Router);
      const analytics = inject(Analytics);
      // App-lifetime subscription; never unsubscribed by design.
      router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() =>
          analytics.page(routePattern(router.routerState.snapshot.root)),
        );
    }),
  ];
}
