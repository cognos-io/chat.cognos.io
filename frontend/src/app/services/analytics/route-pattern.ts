import type { ActivatedRouteSnapshot } from '@angular/router';

// routePattern reconstructs the route *config* pattern for the activated route
// (docs/specs/product-analytics.md §6.3): `/c/abc123` reports as
// `/c/:conversationId`, `/p/<share-token>` as `/p/:token`. The raw router URL
// is never returned — any wildcard or unmatched segment falls back to
// '/unknown' so a resolved id/token can never leak into a pageview.
export function routePattern(root: ActivatedRouteSnapshot): string {
  const segments: string[] = [];
  let node: ActivatedRouteSnapshot | null = root;

  while (node) {
    const config = node.routeConfig;
    const path = config?.path;

    if (path === '**') {
      return '/unknown';
    }
    // A snapshot holding URL segments without a config path to describe them
    // has nothing safe to report.
    if (!config && node.url.length > 0) {
      return '/unknown';
    }
    if (path) {
      segments.push(path);
    }

    node = node.firstChild;
  }

  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}
