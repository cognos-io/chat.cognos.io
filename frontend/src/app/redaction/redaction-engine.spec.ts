import { describe, expect, it } from 'vitest';

import {
  TOKEN_RE,
  applyRedactions,
  buildCustomCandidates,
  buildToken,
  defaultTokenGenerator,
  detectSensitiveText,
  randomTokenSuffix,
  resolveOverlaps,
} from './redaction-engine';
import {
  Detector,
  RedactionEntry,
  RedactionType,
  TokenGenerator,
} from './redaction-types';

/** Deterministic token generator for assertions. */
function sequentialTokens(): TokenGenerator {
  let n = 0;
  return (type: RedactionType) => buildToken(type, `T${n++}`);
}

const IBAN = 'GB82 WEST 1234 5698 7654 32';

describe('token generation', () => {
  it('builds tokens in the [[PII_<TYPE>_<RANDOM>]] format', () => {
    expect(defaultTokenGenerator('iban')).toMatch(/^\[\[PII_IBAN_[A-Z0-9]{6}\]\]$/);
    expect(defaultTokenGenerator('email')).toMatch(/^\[\[PII_EMAIL_[A-Z0-9]{6}\]\]$/);
  });

  it('produces non-derived, random suffixes', () => {
    const a = randomTokenSuffix();
    const b = randomTokenSuffix();
    expect(a).not.toBe(b); // overwhelmingly likely with CSPRNG
    expect(a).toMatch(/^[A-Z0-9]{6}$/);
  });
});

describe('detectSensitiveText', () => {
  it('detects multiple types and returns non-overlapping ranges sorted by start', () => {
    const text = `IBAN ${IBAN} email a@b.io`;
    const candidates = detectSensitiveText(text);
    expect(candidates.map((c) => c.type).sort()).toEqual(['email', 'iban']);
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i].start).toBeGreaterThanOrEqual(candidates[i - 1].end);
    }
  });

  it('resolves overlaps by highest confidence then longest range', () => {
    const text = 'ABCDEFGHIJ';
    const low: Detector = {
      id: 'low:v1',
      type: 'org',
      detect: () => [
        {
          type: 'org',
          detector: 'low:v1',
          start: 0,
          end: 8,
          value: 'ABCDEFGH',
          normalized: 'abcdefgh',
          confidence: 'low',
        },
      ],
    };
    const high: Detector = {
      id: 'high:v1',
      type: 'person',
      detect: () => [
        {
          type: 'person',
          detector: 'high:v1',
          start: 2,
          end: 6,
          value: 'CDEF',
          normalized: 'cdef',
          confidence: 'high',
        },
      ],
    };
    const result = detectSensitiveText(text, [low, high]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('high');
  });

  it('leaves unsupported text unchanged (no candidates)', () => {
    expect(detectSensitiveText('Lunch at noon costs 12 dollars.')).toEqual([]);
  });

  it('detects 10k characters within the performance budget', () => {
    const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(220);
    const text = `${filler} pay ${IBAN} or email a@b.io`.slice(0, 10_000);
    const start = performance.now();
    detectSensitiveText(text);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('applyRedactions', () => {
  it('replaces detected values with tokens and never leaks the original', () => {
    const text = `Pay ${IBAN} and mail a@b.io`;
    const candidates = detectSensitiveText(text);
    const result = applyRedactions(text, candidates, [], sequentialTokens());

    expect(result.redactedText).not.toContain('GB82');
    expect(result.redactedText).not.toContain('a@b.io');
    expect(result.redactedText.match(TOKEN_RE)).toHaveLength(2);
    expect(result.newEntries).toHaveLength(2);
    // tokens never embed the original value
    for (const entry of result.newEntries) {
      expect(entry.token).not.toContain(entry.normalized);
    }
  });

  it('leaves text with no candidates unchanged', () => {
    const text = 'nothing sensitive here';
    const result = applyRedactions(
      text,
      detectSensitiveText(text),
      [],
      sequentialTokens(),
    );
    expect(result.redactedText).toBe(text);
    expect(result.newEntries).toEqual([]);
  });

  it('reuses an existing entry token instead of minting a new one', () => {
    const text = 'mail a@b.io';
    const existing: RedactionEntry[] = [
      {
        version: '1',
        token: '[[PII_EMAIL_EXIST0]]',
        type: 'email',
        original: 'a@b.io',
        normalized: 'a@b.io',
        detector: 'email:v1',
      },
    ];
    const result = applyRedactions(
      text,
      detectSensitiveText(text),
      existing,
      sequentialTokens(),
    );
    expect(result.redactedText).toContain('[[PII_EMAIL_EXIST0]]');
    expect(result.newEntries).toHaveLength(0);
  });

  it('gives repeated identical values one shared token', () => {
    const text = 'a@b.io and again a@b.io';
    const result = applyRedactions(
      text,
      detectSensitiveText(text),
      [],
      sequentialTokens(),
    );
    expect(result.newEntries).toHaveLength(1);
    expect(result.tokens).toHaveLength(2);
    expect(result.tokens[0]).toBe(result.tokens[1]);
  });

  it('stamps source metadata on new entries', () => {
    const text = 'mail a@b.io';
    const result = applyRedactions(
      text,
      detectSensitiveText(text),
      [],
      sequentialTokens(),
      {
        kind: 'message',
        id: 'msg_1',
      },
    );
    expect(result.newEntries[0].source).toEqual({ kind: 'message', id: 'msg_1' });
  });
});

describe('buildCustomCandidates', () => {
  it('finds every occurrence of each selected substring', () => {
    const candidates = buildCustomCandidates('pay Acme Ltd and Acme Ltd again', [
      'Acme Ltd',
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.type === 'custom')).toBe(true);
    expect(candidates[0]).toMatchObject({ start: 4, end: 12, value: 'Acme Ltd' });
    expect(candidates[1].start).toBe(17);
  });

  it('ignores blank and duplicate selections', () => {
    expect(buildCustomCandidates('hello', ['  '])).toEqual([]);
    expect(buildCustomCandidates('a a a', ['a', 'a'])).toHaveLength(3); // deduped input, 3 hits
  });
});

describe('resolveOverlaps', () => {
  it('keeps the higher-confidence candidate when ranges overlap', () => {
    const low = {
      type: 'org' as const,
      detector: 'x',
      start: 0,
      end: 8,
      value: 'ABCDEFGH',
      normalized: 'abcdefgh',
      confidence: 'low' as const,
    };
    const high = {
      type: 'custom' as const,
      detector: 'custom:v1',
      start: 2,
      end: 6,
      value: 'CDEF',
      normalized: 'CDEF',
      confidence: 'high' as const,
    };
    const resolved = resolveOverlaps([low, high]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].confidence).toBe('high');
  });
});
