import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { applyRedactions, buildToken } from './redaction-engine';
import {
  containsRedactionToken,
  extractTokens,
  hydrateRedactedText,
  splitRedactionSegments,
} from './redaction-hydration';
import { RedactionCandidate, RedactionEntry } from './redaction-types';

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

describe('splitRedactionSegments', () => {
  it('splits text into plain runs and known-token segments in order', () => {
    const segments = splitRedactionSegments('to [[PII_EMAIL_A8F2KD]] now', entries);
    expect(segments).toEqual([
      { text: 'to ' },
      { text: '[[PII_EMAIL_A8F2KD]]', entry: entries[0] },
      { text: ' now' },
    ]);
  });

  it('marks unknown tokens as plain text (no entry)', () => {
    const segments = splitRedactionSegments('x [[PII_PHONE_ZZ0000]] y', entries);
    expect(segments).toEqual([
      { text: 'x ' },
      { text: '[[PII_PHONE_ZZ0000]]', entry: undefined },
      { text: ' y' },
    ]);
  });

  it('handles a token at the very start and end', () => {
    const segments = splitRedactionSegments(
      '[[PII_EMAIL_A8F2KD]][[PII_IBAN_Q7K9M2]]',
      entries,
    );
    expect(segments).toEqual([
      { text: '[[PII_EMAIL_A8F2KD]]', entry: entries[0] },
      { text: '[[PII_IBAN_Q7K9M2]]', entry: entries[1] },
    ]);
  });

  it('returns a single plain segment for token-free text', () => {
    expect(splitRedactionSegments('Quarterly Report', entries)).toEqual([
      { text: 'Quarterly Report' },
    ]);
  });

  it('returns no segments for empty text', () => {
    expect(splitRedactionSegments('', entries)).toEqual([]);
  });

  it('is stateless across calls (shared global regex not leaked)', () => {
    const text = 'a [[PII_EMAIL_A8F2KD]] b';
    expect(splitRedactionSegments(text, entries)).toEqual(
      splitRedactionSegments(text, entries),
    );
  });
});

describe('redaction apply/hydrate properties', () => {
  // Property: applying a custom redaction then hydrating with the new entries
  // restores the original string; unknown tokens stay visible as placeholders.
  it('round-trips custom redactions under hydration', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9 ._-]{1,40}$/),
        fc.stringMatching(/^[A-Za-z0-9]{4,12}$/),
        (prefix, secret) => {
          const text = `${prefix} ${secret} end`;
          const start = text.indexOf(secret);
          const candidates: RedactionCandidate[] = [
            {
              type: 'custom',
              detector: 'custom:v1',
              start,
              end: start + secret.length,
              value: secret,
              normalized: secret,
              confidence: 'high',
            },
          ];
          let suffixCounter = 0;
          const result = applyRedactions(text, candidates, [], () =>
            buildToken('custom', `T${(suffixCounter++).toString().padStart(5, '0')}`),
          );
          expect(result.redactedText).not.toContain(secret);
          expect(containsRedactionToken(result.redactedText)).toBe(true);
          expect(hydrateRedactedText(result.redactedText, result.newEntries)).toBe(
            text,
          );
          // Without entries, tokens remain visible (no silent data invention).
          expect(hydrateRedactedText(result.redactedText, [])).toBe(
            result.redactedText,
          );
          expect(extractTokens(result.redactedText).length).toBe(1);
        },
      ),
    );
  });
});

describe('applyRedactions + hydrateRedactedText properties', () => {
  // Property: redacting a known email substring and hydrating with the new
  // entries restores the original text; tokens remain value-independent.
  it('round-trips a redacted email span back to the original text', () => {
    fc.assert(
      fc.property(
        fc
          .stringMatching(/[A-Za-z0-9._%+-]{1,12}@[A-Za-z0-9.-]{1,12}\.[A-Za-z]{2,6}/)
          .filter((value) => !value.includes('[[') && !value.includes(']]')),
        fc.stringMatching(/[A-Za-z0-9 ]{0,20}/),
        fc.stringMatching(/[A-Za-z0-9 ]{0,20}/),
        (email, prefix, suffix) => {
          const text = `${prefix}${email}${suffix}`;
          const start = prefix.length;
          const candidate: RedactionCandidate = {
            type: 'email',
            detector: 'email:v1',
            start,
            end: start + email.length,
            value: email,
            normalized: email.toLowerCase(),
            confidence: 'high',
          };
          let suffixCounter = 0;
          const { redactedText, newEntries } = applyRedactions(
            text,
            [candidate],
            [],
            () =>
              buildToken('email', `T${(suffixCounter++).toString().padStart(5, '0')}`),
          );
          expect(redactedText).not.toContain(email);
          expect(containsRedactionToken(redactedText)).toBe(true);
          expect(hydrateRedactedText(redactedText, newEntries)).toBe(text);
          expect(extractTokens(redactedText).length).toBe(1);
        },
      ),
    );
  });
});
