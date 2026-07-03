// Browser opt-out signals (docs/specs/product-analytics.md §3.5): when Do Not
// Track or Global Privacy Control is set, every tracker becomes a no-op.

export interface NavigatorPrivacySignals {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

// optedOut reads the ambient navigator by default; tests pass a fake. SSR-safe:
// no navigator means no signal to honour (and nothing is tracked server-side
// anyway).
export function optedOut(
  nav: NavigatorPrivacySignals | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as NavigatorPrivacySignals),
): boolean {
  if (!nav) {
    return false;
  }
  return nav.doNotTrack === '1' || !!nav.globalPrivacyControl;
}
