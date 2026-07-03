import { InjectionToken } from '@angular/core';

import { environment } from '../../../environments/environment';

// Privacy-respecting product analytics (docs/specs/product-analytics.md).
// Hard rules (spec §3): no identifiers, no content, props are closed enums and
// booleans only, sanitised route patterns instead of raw URLs, and analytics
// must never throw into app code or be awaited on a hot path.

// Props are structurally constrained; the prop guard (prop-guard.ts) enforces
// the per-event catalogue on top.
export type EventProps = Record<string, string | number | boolean>;

// The app-side event catalogue (spec §7.2). Adding an event means updating the
// spec table and the EVENT_PROPS registry in prop-guard.ts in the same PR.
export type AppAnalyticsEvent =
  // Acquisition & onboarding
  | 'signup_completed'
  | 'onboarding_step_completed'
  | 'login_completed'
  | 'mfa_enrolled'
  | 'vault_unlock_prompted'
  // Core usage
  | 'conversation_created'
  | 'message_sent'
  | 'message_failed'
  | 'model_selected'
  | 'attachment_added'
  | 'share_created'
  | 'conversation_duplicated'
  // Monetisation
  | 'trial_exhausted'
  | 'checkout_started'
  | 'checkout_completed'
  | 'plan_changed'
  | 'billing_portal_opened';

// Abstract class doubles as the DI token (same pattern as PADDLE_CONFIG's
// service). Swapping vendors later means one new class implementing this.
export abstract class Analytics {
  abstract track(event: AppAnalyticsEvent, props?: EventProps): void;
  abstract page(routePattern: string): void;
}

// AnalyticsConfig is behind an injection token (rather than read from
// `environment` directly) so tests can override it — the Angular unit-test
// harness can't mock relative imports.
export interface AnalyticsConfig {
  enabled: boolean;
  domain: string;
  apiHost: string;
}

export const ANALYTICS_CONFIG = new InjectionToken<AnalyticsConfig>(
  'ANALYTICS_CONFIG',
  {
    providedIn: 'root',
    factory: () => ({
      enabled: environment.analytics.enabled,
      domain: environment.analytics.plausibleDomain,
      apiHost: environment.analytics.plausibleApiHost,
    }),
  },
);

// The network side effect behind a token (mirrors PADDLE_INITIALIZE) so tests
// can inject a failing/spying fetch without touching globals.
export type AnalyticsFetch = typeof fetch;

export const ANALYTICS_FETCH = new InjectionToken<AnalyticsFetch>('ANALYTICS_FETCH', {
  providedIn: 'root',
  factory: () => fetch.bind(globalThis),
});

// The marketing site appends `?ref=<location>` to sign-up CTAs (spec §5.3/§6.5).
// Anything outside this closed enum maps to 'other'; absent maps to 'direct',
// so the `source` prop can never carry a free-form string.
export const SIGNUP_SOURCES = [
  'navbar',
  'hero',
  'how_it_works',
  'pricing_individuals',
  'pricing_business',
  'cta_individuals',
  'cta_business',
  'contact',
  'footer',
  'redaction',
  'about',
] as const;

export function signupSource(ref: string | null): string {
  if (!ref) {
    return 'direct';
  }
  return (SIGNUP_SOURCES as readonly string[]).includes(ref) ? ref : 'other';
}

// modelProp normalises a catalogue model id for the `model` prop. Ids are our
// catalogue data (not user content) and are the one non-enum string the spec
// allows, but some provider-synced ids contain '@' (e.g. "o4-mini@eastus2"),
// which the prop guard rejects as email-shaped. Replace it and clamp to the
// guard's length cap so a legitimate id is never dropped.
export function modelProp(modelId: string): string {
  return modelId.replace(/@/g, ':').slice(0, 32);
}
