import { Injectable, inject } from '@angular/core';

import {
  ANALYTICS_CONFIG,
  ANALYTICS_FETCH,
  Analytics,
  AppAnalyticsEvent,
  EventProps,
} from './analytics';
import { optedOut } from './opt-out';
import { guardProps } from './prop-guard';

// PlausibleAnalytics talks straight to Plausible's Events API with a plain
// POST — no vendor JavaScript ever executes in the app context, because the
// app handles key material (docs/specs/product-analytics.md §3.4/§6.2).
// Analytics is fire-and-forget: never awaited, never throws into app code,
// failures swallowed without logging payloads.
@Injectable({ providedIn: 'root' })
export class PlausibleAnalytics implements Analytics {
  private readonly _config = inject(ANALYTICS_CONFIG);
  private readonly _fetch = inject(ANALYTICS_FETCH);

  // The sanitised route pattern reported as the current URL on every event.
  // Set by the router pageview subscription; never a raw router URL.
  private _currentRoutePattern = '/';

  track(event: AppAnalyticsEvent, props?: EventProps): void {
    // The guard runs outside the send path on purpose: in dev mode a
    // catalogue violation throws (test failure), in production it drops the
    // offending prop and the event still sends.
    this._send(event, guardProps(event, props));
  }

  page(routePattern: string): void {
    this._currentRoutePattern = routePattern;
    this._send('pageview');
  }

  private _send(name: string, props?: EventProps): void {
    if (optedOut()) {
      return;
    }
    try {
      void this._fetch(`${this._config.apiHost}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Events fired during navigation/logout aren't dropped.
        keepalive: true,
        body: JSON.stringify({
          domain: this._config.domain,
          name,
          url: `https://${this._config.domain}${this._currentRoutePattern}`,
          ...(props && Object.keys(props).length > 0 ? { props } : {}),
        }),
      }).catch(() => {
        // Analytics must never break the app; failures are not even logged.
      });
    } catch {
      // e.g. fetch unavailable — same rule: swallow silently.
    }
  }
}
