import { describe, expect, it } from 'vitest';

import { chfFromRappen } from './currency';

describe('chfFromRappen', () => {
  const cases: { name: string; rappen: number; expected: string }[] = [
    { name: 'zero', rappen: 0, expected: 'CHF 0.00' },
    { name: 'sub-franc amount keeps two decimals', rappen: 5, expected: 'CHF 0.05' },
    { name: 'exact francs', rappen: 1500, expected: 'CHF 15.00' },
    { name: 'francs and rappen', rappen: 12345, expected: 'CHF 123.45' },
    // Pin: fractional rappen (should not occur on the wire — the backend
    // ceils charges to whole rappen) round to the nearest rappen for display
    // rather than crashing or showing long decimals.
    {
      name: 'fractional rappen rounds for display',
      rappen: 10.4,
      expected: 'CHF 0.10',
    },
    // Pin: negative amounts format with a leading minus. No org billing
    // surface shows credits today, but the formatter must not mangle them.
    { name: 'negative amount', rappen: -250, expected: 'CHF -2.50' },
  ];

  it.each(cases)('$name', ({ rappen, expected }) => {
    expect(chfFromRappen(rappen)).toBe(expected);
  });
});
