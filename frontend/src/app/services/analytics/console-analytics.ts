import { Injectable } from '@angular/core';

import { Analytics, AppAnalyticsEvent, EventProps } from './analytics';
import { optedOut } from './opt-out';
import { guardProps } from './prop-guard';

// ConsoleAnalytics is the development implementation: nothing leaves the
// machine. It still runs the prop guard (which throws in dev mode) so a
// catalogue violation is caught at development time, not shipped.
@Injectable({ providedIn: 'root' })
export class ConsoleAnalytics implements Analytics {
  track(event: AppAnalyticsEvent, props?: EventProps): void {
    if (optedOut()) {
      return;
    }
    console.debug(`[analytics] ${event}`, guardProps(event, props) ?? {});
  }

  page(routePattern: string): void {
    if (optedOut()) {
      return;
    }
    console.debug(`[analytics] pageview ${routePattern}`);
  }
}
