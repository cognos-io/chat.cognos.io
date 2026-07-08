import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_RETENTION_OPTIONS,
  CONVERSATION_RETENTION_OPTIONS,
  conversationRetentionLabelKey,
  effectiveRetentionDays,
  normalizeAccountRetention,
  normalizeConversationRetention,
  parseRetentionSegmentValue,
  retentionSegmentValue,
} from './retention';

describe('retention wire-value mapping', () => {
  // Pin the semantic ↔ wire contract the backend defined: inherit/never/7/30
  // map to 0/-1/7/30. A drift here would silently PATCH the wrong retention.
  it('maps conversation options to the backend wire integers', () => {
    const byLabel = Object.fromEntries(
      CONVERSATION_RETENTION_OPTIONS.map((option) => [option.labelKey, option.days]),
    );
    expect(byLabel).toEqual({ inherit: 0, never: -1, sevenDays: 7, thirtyDays: 30 });
  });

  it('offers never/7/30 (0/7/30) for the account default', () => {
    const byLabel = Object.fromEntries(
      ACCOUNT_RETENTION_OPTIONS.map((option) => [option.labelKey, option.days]),
    );
    expect(byLabel).toEqual({ never: 0, sevenDays: 7, thirtyDays: 30 });
  });

  it('round-trips a segment value through string and back', () => {
    for (const days of [-1, 0, 7, 30]) {
      expect(parseRetentionSegmentValue(retentionSegmentValue(days))).toBe(days);
    }
  });

  it('parses a non-integer segment value back to 0 (inherit/never)', () => {
    expect(parseRetentionSegmentValue('nonsense')).toBe(0);
    expect(parseRetentionSegmentValue('7.5')).toBe(0);
  });
});

describe('retention normalisation', () => {
  it('keeps known account values and clamps the rest to 0 (never)', () => {
    expect(normalizeAccountRetention(7)).toBe(7);
    expect(normalizeAccountRetention(30)).toBe(30);
    expect(normalizeAccountRetention(0)).toBe(0);
    // -1 is not a valid account value (only per-conversation) → never.
    expect(normalizeAccountRetention(-1)).toBe(0);
    expect(normalizeAccountRetention(90)).toBe(0);
    expect(normalizeAccountRetention(undefined)).toBe(0);
    expect(normalizeAccountRetention(null)).toBe(0);
  });

  it('keeps known conversation values and clamps the rest to 0 (inherit)', () => {
    expect(normalizeConversationRetention(-1)).toBe(-1);
    expect(normalizeConversationRetention(7)).toBe(7);
    expect(normalizeConversationRetention(30)).toBe(30);
    expect(normalizeConversationRetention(0)).toBe(0);
    expect(normalizeConversationRetention(90)).toBe(0);
    expect(normalizeConversationRetention(undefined)).toBe(0);
  });

  it('resolves the label key for a conversation value', () => {
    expect(conversationRetentionLabelKey(0)).toBe('inherit');
    expect(conversationRetentionLabelKey(-1)).toBe('never');
    expect(conversationRetentionLabelKey(7)).toBe('sevenDays');
    expect(conversationRetentionLabelKey(30)).toBe('thirtyDays');
    expect(conversationRetentionLabelKey(90)).toBe('inherit');
  });
});

describe('effectiveRetentionDays', () => {
  it('applies an explicit per-conversation window (7/30) over the account default', () => {
    expect(effectiveRetentionDays(7, 0)).toBe(7);
    expect(effectiveRetentionDays(30, 7)).toBe(30);
    expect(effectiveRetentionDays(7, 30)).toBe(7);
  });

  it('treats -1 as an explicit never (off) whatever the account default', () => {
    expect(effectiveRetentionDays(-1, 0)).toBe(0);
    expect(effectiveRetentionDays(-1, 7)).toBe(0);
    expect(effectiveRetentionDays(-1, 30)).toBe(0);
  });

  it('inherits the account default when the conversation is 0', () => {
    expect(effectiveRetentionDays(0, 0)).toBe(0);
    expect(effectiveRetentionDays(0, 7)).toBe(7);
    expect(effectiveRetentionDays(0, 30)).toBe(30);
  });

  it('normalises unexpected values before resolving', () => {
    // Unknown conversation value → inherit; unknown account value → never.
    expect(effectiveRetentionDays(90, 7)).toBe(7);
    expect(effectiveRetentionDays(0, 90)).toBe(0);
    expect(effectiveRetentionDays(undefined, undefined)).toBe(0);
    expect(effectiveRetentionDays(null, 30)).toBe(30);
  });
});
