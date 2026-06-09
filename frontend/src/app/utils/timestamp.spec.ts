import { describe, expect, it } from 'vitest';

import { isTimestampInMilliseconds, parseBackendDate } from './timestamp';

describe('isTimestampInMilliseconds', () => {
  it('treats 13-digit timestamps as milliseconds', () => {
    expect(isTimestampInMilliseconds(1717971364000)).toBe(true);
  });

  it('treats 10-digit timestamps as seconds', () => {
    expect(isTimestampInMilliseconds(1717971364)).toBe(false);
  });
});

describe('parseBackendDate', () => {
  it('parses PocketBase space-separated timestamps', () => {
    // PocketBase serialises timestamps with a space instead of the ISO "T",
    // which Safari/Firefox reject. The parser must normalise it.
    const date = parseBackendDate('2026-06-09 22:36:04.123Z');

    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.toISOString()).toBe('2026-06-09T22:36:04.123Z');
  });

  it('parses already-ISO timestamps unchanged', () => {
    const date = parseBackendDate('2026-06-09T22:36:04.123Z');

    expect(date.toISOString()).toBe('2026-06-09T22:36:04.123Z');
  });

  it('returns an invalid date for empty or missing values', () => {
    expect(Number.isNaN(parseBackendDate('').getTime())).toBe(true);
    expect(Number.isNaN(parseBackendDate(undefined).getTime())).toBe(true);
    expect(Number.isNaN(parseBackendDate(null).getTime())).toBe(true);
  });
});
