import { describe, expect, it } from 'vitest';

import {
  containsRedactionToken,
  extractTokens,
  hydrateRedactedText,
} from './redaction-hydration';
import { RedactionEntry } from './redaction-types';

const entries: RedactionEntry[] = [
  {
    version: '1',
    token: '[[PII_EMAIL_A8F2KD]]',
    type: 'email',
    original: 'jane@example.com',
    normalized: 'jane@example.com',
    detector: 'email:v1',
  },
  {
    version: '1',
    token: '[[PII_IBAN_Q7K9M2]]',
    type: 'iban',
    original: 'GB82 WEST 1234 5698 7654 32',
    normalized: 'GB82WEST12345698765432',
    detector: 'iban:v1',
  },
];

describe('containsRedactionToken', () => {
  it('detects presence and absence of tokens', () => {
    expect(containsRedactionToken('see [[PII_EMAIL_A8F2KD]]')).toBe(true);
    expect(containsRedactionToken('no tokens here')).toBe(false);
  });
});

describe('extractTokens', () => {
  it('returns tokens in order of appearance', () => {
    expect(extractTokens('a [[PII_IBAN_Q7K9M2]] b [[PII_EMAIL_A8F2KD]]')).toEqual([
      '[[PII_IBAN_Q7K9M2]]',
      '[[PII_EMAIL_A8F2KD]]',
    ]);
  });
});

describe('hydrateRedactedText', () => {
  it('replaces known tokens with their originals', () => {
    const out = hydrateRedactedText('mail [[PII_EMAIL_A8F2KD]] now', entries);
    expect(out).toBe('mail jane@example.com now');
  });

  it('leaves unknown tokens untouched', () => {
    const out = hydrateRedactedText(
      '[[PII_PHONE_ZZ0000]] and [[PII_EMAIL_A8F2KD]]',
      entries,
    );
    expect(out).toBe('[[PII_PHONE_ZZ0000]] and jane@example.com');
  });

  it('handles repeated tokens', () => {
    const out = hydrateRedactedText(
      '[[PII_EMAIL_A8F2KD]] x [[PII_EMAIL_A8F2KD]]',
      entries,
    );
    expect(out).toBe('jane@example.com x jane@example.com');
  });

  it('does not mutate the input string or entries', () => {
    const input = 'mail [[PII_EMAIL_A8F2KD]]';
    const snapshot = JSON.parse(JSON.stringify(entries));
    hydrateRedactedText(input, entries);
    expect(input).toBe('mail [[PII_EMAIL_A8F2KD]]');
    expect(entries).toEqual(snapshot);
  });

  it('returns the text unchanged when there are no entries', () => {
    expect(hydrateRedactedText('mail [[PII_EMAIL_A8F2KD]]', [])).toBe(
      'mail [[PII_EMAIL_A8F2KD]]',
    );
  });
});
