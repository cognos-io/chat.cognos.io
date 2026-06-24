import { describe, expect, it } from 'vitest';

import { relativeDate } from './relative-date';

describe('relativeDate', () => {
  // A fixed "now" so the buckets are deterministic regardless of the clock.
  const now = new Date(2026, 5, 24, 10, 0, 0); // 2026-06-24 (month is 0-based)

  const cases: Array<{
    name: string;
    value: string | Date | null | undefined;
    expected: ReturnType<typeof relativeDate>;
  }> = [
    {
      name: 'same calendar day → today',
      value: new Date(2026, 5, 24, 1, 0, 0),
      expected: { key: 'common.relativeDate.today' },
    },
    {
      name: 'later today still counts as today',
      value: new Date(2026, 5, 24, 23, 30, 0),
      expected: { key: 'common.relativeDate.today' },
    },
    {
      name: 'previous calendar day → yesterday',
      value: new Date(2026, 5, 23, 23, 0, 0),
      expected: { key: 'common.relativeDate.yesterday' },
    },
    {
      name: '3 days ago → N days ago',
      value: new Date(2026, 5, 21, 9, 0, 0),
      expected: { key: 'common.relativeDate.daysAgo', params: { count: 3 } },
    },
    {
      name: '6 days ago → still N days ago',
      value: new Date(2026, 5, 18, 9, 0, 0),
      expected: { key: 'common.relativeDate.daysAgo', params: { count: 6 } },
    },
    {
      name: '7 days ago → last week',
      value: new Date(2026, 5, 17, 9, 0, 0),
      expected: { key: 'common.relativeDate.lastWeek' },
    },
    {
      name: '13 days ago → last week',
      value: new Date(2026, 5, 11, 9, 0, 0),
      expected: { key: 'common.relativeDate.lastWeek' },
    },
    {
      name: '14 days ago → absolute date',
      value: new Date(2026, 5, 10, 9, 0, 0),
      expected: { absolute: '2026/06/10' },
    },
    {
      name: 'far past → zero-padded absolute date',
      value: new Date(2020, 0, 2, 9, 0, 0),
      expected: { absolute: '2020/01/02' },
    },
    {
      name: 'future date is clamped to today',
      value: new Date(2026, 5, 30, 9, 0, 0),
      expected: { key: 'common.relativeDate.today' },
    },
    { name: 'missing value → null', value: undefined, expected: null },
    { name: 'unparseable value → null', value: 'not-a-date', expected: null },
  ];

  for (const { name, value, expected } of cases) {
    it(name, () => {
      expect(relativeDate(value, now)).toEqual(expected);
    });
  }
});
