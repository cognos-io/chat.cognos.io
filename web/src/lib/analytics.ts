// Privacy-respecting event tracking for the marketing site.
// See docs/specs/product-analytics.md — props are enums/booleans only,
// no identifiers, no content, and browser opt-out signals are honoured.

export type EventProps = Record<string, string | number | boolean>;

export type WebAnalyticsEvent = 'cta_click' | 'locale_switched';

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: EventProps }) => void;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

/** True when the browser asks us not to track (Do Not Track / GPC). */
export function optedOut(): boolean {
  return navigator.doNotTrack === '1' || Boolean(navigator.globalPrivacyControl);
}

/** Fire a named product event. Dev builds only log to the console. */
export function track(event: WebAnalyticsEvent, props?: EventProps): void {
  if (optedOut()) return;
  if (import.meta.env.DEV) {
    console.debug(`[analytics] ${event}`, props ?? {});
    return;
  }
  window.plausible?.(event, { props });
}
