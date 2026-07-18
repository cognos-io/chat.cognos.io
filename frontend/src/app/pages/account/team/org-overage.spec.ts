import { describe, expect, it } from 'vitest';

import { OverageDisplay, overageDisplay } from './org-overage';

describe('overageDisplay', () => {
  const cases: {
    name: string;
    floor: number;
    usage: number;
    projected: number;
    expected: OverageDisplay;
  }[] = [
    {
      name: 'no usage yet',
      floor: 4500,
      usage: 0,
      projected: 0,
      expected: {
        state: 'under',
        overageRappen: 0,
        remainingRappen: 4500,
        progressPercent: 0,
      },
    },
    {
      name: 'usage under the floor',
      floor: 4500,
      usage: 3000,
      projected: 0,
      expected: {
        state: 'under',
        overageRappen: 0,
        remainingRappen: 1500,
        progressPercent: 67,
      },
    },
    {
      name: 'usage exactly at the floor',
      floor: 4500,
      usage: 4500,
      projected: 0,
      expected: {
        state: 'at',
        overageRappen: 0,
        remainingRappen: 0,
        progressPercent: 100,
      },
    },
    {
      name: 'usage over the floor',
      floor: 4500,
      usage: 6200,
      projected: 1700,
      expected: {
        state: 'over',
        overageRappen: 1700,
        remainingRappen: 0,
        progressPercent: 100,
      },
    },
    {
      // The server amount wins even if it disagrees with a naive usage−floor
      // (e.g. rounding at settlement) — display must follow the invoice.
      name: 'server projection is authoritative',
      floor: 4500,
      usage: 4499,
      projected: 100,
      expected: {
        state: 'over',
        overageRappen: 100,
        remainingRappen: 1,
        progressPercent: 100,
      },
    },
    {
      name: 'zero floor with usage never divides by zero',
      floor: 0,
      usage: 100,
      projected: 100,
      expected: {
        state: 'over',
        overageRappen: 100,
        remainingRappen: 0,
        progressPercent: 100,
      },
    },
    {
      name: 'zero floor and zero usage is a quiet under state',
      floor: 0,
      usage: 0,
      projected: 0,
      expected: {
        state: 'under',
        overageRappen: 0,
        remainingRappen: 0,
        progressPercent: 0,
      },
    },
    {
      // Invalid (negative) wire values fail safe rather than rendering a
      // negative bill preview.
      name: 'negative wire values clamp to zero',
      floor: -100,
      usage: -50,
      projected: -20,
      expected: {
        state: 'under',
        overageRappen: 0,
        remainingRappen: 0,
        progressPercent: 0,
      },
    },
  ];

  it.each(cases)('$name', ({ floor, usage, projected, expected }) => {
    expect(
      overageDisplay({
        floor_rappen: floor,
        pooled_usage_rappen: usage,
        projected_overage_rappen: projected,
      }),
    ).toEqual(expected);
  });
});
