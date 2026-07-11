import { isDevMode } from '@angular/core';

import { AppAnalyticsEvent, EventProps } from './analytics';

// EVENT_PROPS is the catalogue-as-code registry of allowed prop keys per event
// (docs/specs/product-analytics.md §7.2). A prop key outside this list is a
// spec violation: it throws in dev mode (so it becomes a test failure, §6.4)
// and is silently dropped in production (so it can never become a data leak).
export const EVENT_PROPS: Record<AppAnalyticsEvent, readonly string[]> = {
  signup_completed: ['source'],
  onboarding_step_completed: ['step'],
  login_completed: ['mfa'],
  mfa_enrolled: [],
  vault_unlock_prompted: ['trigger'],
  adoption_milestone: ['milestone'],
  import_previewed: ['source'],
  import_completed: ['source'],
  conversation_created: [],
  message_sent: ['model', 'attachments', 'reasoning'],
  message_failed: ['reason'],
  model_selected: ['model'],
  attachment_added: [],
  share_created: [],
  conversation_duplicated: [],
  trial_exhausted: [],
  checkout_started: ['plan', 'entry'],
  checkout_completed: ['plan'],
  plan_changed: ['from', 'to'],
  billing_portal_opened: [],
};

// Defence in depth against free-form strings: anything longer than an enum
// value plausibly is, or containing '@' (email-shaped), is rejected. Values
// themselves are never included in the violation message — no payload logging.
const MAX_STRING_PROP_LENGTH = 32;

// guardProps returns the props with every violating entry removed. `dev`
// defaults to Angular's dev mode and is parameterised only so unit tests can
// exercise both the throwing (dev) and dropping (production) behaviours.
export function guardProps(
  event: AppAnalyticsEvent,
  props?: EventProps,
  dev: boolean = isDevMode(),
): EventProps | undefined {
  if (!props) {
    return undefined;
  }

  const allowed = EVENT_PROPS[event] ?? [];
  const safe: EventProps = {};

  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key)) {
      violation(dev, `prop "${key}" is not in the catalogue for "${event}"`);
      continue;
    }
    if (
      typeof value === 'string' &&
      (value.length > MAX_STRING_PROP_LENGTH || value.includes('@'))
    ) {
      violation(dev, `prop "${key}" on "${event}" looks like a free-form string`);
      continue;
    }
    safe[key] = value;
  }

  return safe;
}

function violation(dev: boolean, message: string): void {
  if (dev) {
    throw new Error(`[analytics] ${message} (docs/specs/product-analytics.md §3.2)`);
  }
}
