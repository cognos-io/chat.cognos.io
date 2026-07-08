// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  anchorFromRange,
  offsetsToRange,
  plainText,
  rangeForAnchor,
  rangeToOffsets,
} from './bookmark-dom';

function root(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('plainText', () => {
  it('flattens rendered markup to text', () => {
    expect(plainText(root('<p>Hello <strong>bold</strong> world</p>'))).toBe(
      'Hello bold world',
    );
  });
});

describe('offsetsToRange', () => {
  it('spans a range across element boundaries', () => {
    const el = root('<p>Hello <strong>bold</strong> world</p>');
    // "bold world" starts at offset 6.
    const range = offsetsToRange(el, 6, 16);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('bold world');
  });

  it('locates a span within a single text node', () => {
    const el = root('<p>abcdef</p>');
    expect(offsetsToRange(el, 2, 4)!.toString()).toBe('cd');
  });

  it('returns null for invalid or out-of-range offsets', () => {
    const el = root('<p>abc</p>');
    expect(offsetsToRange(el, -1, 2)).toBeNull();
    expect(offsetsToRange(el, 2, 1)).toBeNull();
    expect(offsetsToRange(el, 0, 99)).toBeNull();
  });
});

describe('rangeToOffsets', () => {
  it('is the inverse of offsetsToRange', () => {
    const el = root('<p>Hello <em>there</em> friend</p>');
    const range = offsetsToRange(el, 6, 11)!; // "there"
    expect(range.toString()).toBe('there');
    expect(rangeToOffsets(el, range)).toEqual({ start: 6, end: 11 });
  });
});

describe('anchorFromRange / rangeForAnchor round-trip', () => {
  it('re-locates a highlighted span across boundaries', () => {
    const el = root('<p>keep the <strong>secret</strong> phrase safe</p>');
    const selection = offsetsToRange(el, 9, 22)!; // "secret phrase"
    expect(selection.toString()).toBe('secret phrase');

    const anchor = anchorFromRange(el, selection);
    expect(anchor?.quote).toBe('secret phrase');

    const relocated = rangeForAnchor(el, anchor!);
    expect(relocated).not.toBeNull();
    expect(relocated!.toString()).toBe('secret phrase');
  });

  it('returns null when the anchor text is no longer present', () => {
    const el = root('<p>different content now</p>');
    expect(
      rangeForAnchor(el, { quote: 'secret phrase', prefix: '', suffix: '' }),
    ).toBeNull();
  });
});
