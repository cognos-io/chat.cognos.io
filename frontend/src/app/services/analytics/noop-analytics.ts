import { Injectable } from '@angular/core';

import { Analytics } from './analytics';

// NoopAnalytics swallows everything. Provided globally in unit tests (see
// src/test-providers.ts) so instrumented services never need a real tracker.
@Injectable({ providedIn: 'root' })
export class NoopAnalytics implements Analytics {
  track(): void {
    // intentionally empty
  }

  page(): void {
    // intentionally empty
  }
}
