import { describe, expect, it } from 'vitest';

import { captureAnchor, locateAnchor } from './bookmark-anchor';

describe('captureAnchor', () => {
  const text = 'The quick brown fox jumps over the lazy dog';

  it('captures the quote with surrounding context', () => {
    const start = text.indexOf('brown');
    const anchor = captureAnchor(text, start, start + 'brown'.length, 4);
    expect(anchor).toEqual({ quote: 'brown', prefix: 'ick ', suffix: ' fox' });
  });

  it('clamps context at the string boundaries', () => {
    const anchor = captureAnchor(text, 0, 3, 10);
    expect(anchor).toEqual({ quote: 'The', prefix: '', suffix: ' quick bro' });
  });

  it('rejects an empty or whitespace-only selection', () => {
    expect(captureAnchor(text, 3, 3)).toBeNull();
    expect(captureAnchor('a   b', 1, 4)).toBeNull();
  });

  it('rejects out-of-range offsets', () => {
    expect(captureAnchor(text, -1, 3)).toBeNull();
    expect(captureAnchor(text, 0, text.length + 1)).toBeNull();
  });
});

describe('locateAnchor', () => {
  it('finds a unique quote', () => {
    const text = 'alpha beta gamma';
    expect(
      locateAnchor(text, { quote: 'beta', prefix: 'alpha ', suffix: ' gamma' }),
    ).toEqual({
      start: 6,
      end: 10,
    });
  });

  it('disambiguates repeated quotes using context', () => {
    const text = 'pay the fee. then pay the fee again.';
    // Target the SECOND "pay the fee" via its trailing " again" context.
    const anchor = { quote: 'pay the fee', prefix: 'then ', suffix: ' again' };
    const loc = locateAnchor(text, anchor);
    expect(loc).toEqual({ start: 18, end: 29 });
    expect(text.slice(loc!.start, loc!.end)).toBe('pay the fee');
  });

  it('returns null when the quote is gone', () => {
    expect(
      locateAnchor('nothing here', { quote: 'absent', prefix: '', suffix: '' }),
    ).toBeNull();
  });

  it('falls back to the first match when context does not distinguish', () => {
    const text = 'ab ab ab';
    expect(locateAnchor(text, { quote: 'ab', prefix: '', suffix: '' })).toEqual({
      start: 0,
      end: 2,
    });
  });

  it('round-trips with captureAnchor', () => {
    const text = 'one two three two one';
    const start = text.indexOf('three') + 'three '.length; // second "two"
    const anchor = captureAnchor(text, start, start + 3);
    expect(anchor).not.toBeNull();
    const loc = locateAnchor(text, anchor!);
    expect(text.slice(loc!.start, loc!.end)).toBe('two');
    expect(loc!.start).toBe(start);
  });
});
