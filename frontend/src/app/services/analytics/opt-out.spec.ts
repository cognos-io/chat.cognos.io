import { describe, expect, it } from 'vitest';

import { NavigatorPrivacySignals, optedOut } from './opt-out';

describe('optedOut', () => {
  const cases: {
    name: string;
    nav: NavigatorPrivacySignals | undefined;
    expected: boolean;
  }[] = [
    { name: 'DNT enabled', nav: { doNotTrack: '1' }, expected: true },
    { name: 'GPC enabled', nav: { globalPrivacyControl: true }, expected: true },
    {
      name: 'both signals enabled',
      nav: { doNotTrack: '1', globalPrivacyControl: true },
      expected: true,
    },
    { name: 'DNT explicitly disabled', nav: { doNotTrack: '0' }, expected: false },
    { name: 'DNT unspecified', nav: { doNotTrack: null }, expected: false },
    {
      name: 'GPC explicitly false',
      nav: { globalPrivacyControl: false },
      expected: false,
    },
    { name: 'no signals at all', nav: {}, expected: false },
    { name: 'no navigator (SSR)', nav: undefined, expected: false },
  ];

  it.each(cases)('$name → $expected', ({ nav, expected }) => {
    expect(optedOut(nav)).toBe(expected);
  });
});
