import { describe, expect, it } from 'vitest';

import { AppAnalyticsEvent, EventProps } from './analytics';
import { EVENT_PROPS, guardProps } from './prop-guard';

describe('guardProps', () => {
  const violations: {
    name: string;
    event: AppAnalyticsEvent;
    props: EventProps;
    surviving: string[];
  }[] = [
    {
      name: 'drops a prop key outside the event catalogue',
      event: 'message_sent',
      props: { model: 'gpt-5-mini', title: 'My secret conversation' },
      surviving: ['model'],
    },
    {
      name: 'drops a string value longer than 32 characters',
      event: 'signup_completed',
      props: { source: 'a'.repeat(33) },
      surviving: [],
    },
    {
      name: 'drops an @-containing (email-shaped) value',
      event: 'signup_completed',
      props: { source: 'user@example.com' },
      surviving: [],
    },
    {
      name: 'drops every prop on a no-prop event',
      event: 'conversation_created',
      props: { extra: 'nope' },
      surviving: [],
    },
  ];

  it.each(violations)('production: $name', ({ event, props, surviving }) => {
    const result = guardProps(event, props, false);
    expect(Object.keys(result ?? {})).toEqual(surviving);
  });

  it.each(violations)('dev mode: $name becomes a thrown error', ({ event, props }) => {
    expect(() => guardProps(event, props, true)).toThrow(/\[analytics\]/);
  });

  const valid: { name: string; event: AppAnalyticsEvent; props: EventProps }[] = [
    {
      name: 'enum + boolean message props pass',
      event: 'message_sent',
      props: { model: 'gpt-5-mini', attachments: true, reasoning: 'high' },
    },
    {
      name: 'boolean mfa prop passes',
      event: 'login_completed',
      props: { mfa: false },
    },
    {
      name: 'checkout enums pass',
      event: 'checkout_started',
      props: { plan: 'payg', entry: 'trial_lock' },
    },
    {
      name: 'a 32-character string is still allowed',
      event: 'model_selected',
      props: { model: 'm'.repeat(32) },
    },
  ];

  it.each(valid)('$name (dev and production)', ({ event, props }) => {
    expect(guardProps(event, props, true)).toEqual(props);
    expect(guardProps(event, props, false)).toEqual(props);
  });

  it('returns undefined when no props are given', () => {
    expect(guardProps('mfa_enrolled', undefined, true)).toBeUndefined();
  });

  it('has a registry entry for every catalogue event', () => {
    // Compile-time exhaustiveness lives in the Record type; this guards the
    // values against accidental free-form-friendly entries.
    for (const allowed of Object.values(EVENT_PROPS)) {
      expect(Array.isArray(allowed)).toBe(true);
    }
  });
});
