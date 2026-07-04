import { describe, expect, it } from 'vitest';

import {
  Citation,
  CitationAnchor,
  citationAvatarLetter,
  citationDomainLabel,
  citationMarkerToken,
  insertCitationMarkers,
  sanitizeCitationUrl,
} from './citations';

describe('sanitizeCitationUrl', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
  ])('accepts http(s) URL %s', (input, expected) => {
    expect(sanitizeCitationUrl(input)).toBe(expected);
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    ['ftp://example.com'],
    ['not a url'],
    [''],
    [undefined],
  ])('rejects non-http(s) or malformed URL %s', (input) => {
    expect(sanitizeCitationUrl(input as string | undefined)).toBeNull();
  });
});

describe('citationDomainLabel', () => {
  it('prefers a domain-shaped title over the URL host (Gemini proxy case)', () => {
    const citation: Citation = {
      url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
      title: 'reuters.com',
    };
    expect(citationDomainLabel(citation)).toBe('reuters.com');
  });

  it('never shows the grounding-redirect proxy host as the label', () => {
    const citation: Citation = {
      url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
      title: 'Breaking news from Reuters',
    };
    // Title is not domain-shaped and host is the proxy → fall back to the title
    // text, never the proxy host.
    expect(citationDomainLabel(citation)).toBe('Breaking news from Reuters');
  });

  it('returns empty for a title-less proxy source (never the proxy host)', () => {
    const citation: Citation = {
      url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
    };
    // No usable label — the UI substitutes a localised generic ("Web source").
    expect(citationDomainLabel(citation)).toBe('');
  });

  it('falls back to the URL hostname (www stripped) when the title is prose', () => {
    const citation: Citation = {
      url: 'https://www.example.com/article',
      title: 'A great article',
    };
    expect(citationDomainLabel(citation)).toBe('example.com');
  });

  it('uses the hostname when there is no title', () => {
    expect(citationDomainLabel({ url: 'https://news.bbc.co.uk/x' })).toBe(
      'news.bbc.co.uk',
    );
  });
});

describe('citationAvatarLetter', () => {
  it('returns the uppercase first alphanumeric of the domain', () => {
    expect(citationAvatarLetter({ url: 'https://reuters.com' })).toBe('R');
  });

  it('falls back to ? when no label can be derived', () => {
    expect(citationAvatarLetter({ url: 'javascript:void(0)' })).toBe('?');
  });
});

describe('insertCitationMarkers', () => {
  const cite = (n: number) => citationMarkerToken(n);

  it('inserts a marker at the end offset of a span', () => {
    // "The sky is blue" — anchor the word "blue" (code points 11..15).
    const out = insertCitationMarkers(
      'The sky is blue',
      [{ citation: 0, start: 11, end: 15 }],
      1,
    );
    expect(out).toBe(`The sky is blue${cite(0)}`);
  });

  it('inserts at the very start when end is 0', () => {
    const out = insertCitationMarkers('hello', [{ citation: 0, start: 0, end: 0 }], 1);
    expect(out).toBe(`${cite(0)}hello`);
  });

  it('keeps adjacent anchors and inserts both markers in order', () => {
    const anchors: CitationAnchor[] = [
      { citation: 0, start: 0, end: 5 },
      { citation: 1, start: 5, end: 11 },
    ];
    const out = insertCitationMarkers('hello world', anchors, 2);
    expect(out).toBe(`hello${cite(0)} world${cite(1)}`);
  });

  it('drops an overlapping anchor, never guessing', () => {
    const anchors: CitationAnchor[] = [
      { citation: 0, start: 0, end: 6 },
      { citation: 1, start: 3, end: 9 }, // overlaps the first
    ];
    const out = insertCitationMarkers('abcdefghij', anchors, 2);
    expect(out).toBe(`abcdef${cite(0)}ghij`);
  });

  it('drops out-of-range offsets and bad citation indices', () => {
    const anchors: CitationAnchor[] = [
      { citation: 0, start: 0, end: 999 }, // end past content
      { citation: 5, start: 0, end: 3 }, // citation index out of range
      { citation: -1, start: 0, end: 3 }, // negative citation
    ];
    expect(insertCitationMarkers('abcdef', anchors, 2)).toBe('abcdef');
  });

  it('converts code-point offsets to UTF-16 for accented text', () => {
    // "café" — é is a single code point but the word is 4 code points; anchor
    // it end=4 which is UTF-16 index 4 here (BMP), marker lands after "café".
    const out = insertCitationMarkers(
      'café ok',
      [{ citation: 0, start: 0, end: 4 }],
      1,
    );
    expect(out).toBe(`café${cite(0)} ok`);
  });

  it('converts code-point offsets past an astral-plane emoji', () => {
    // "🚀 go" — the rocket is 1 code point but 2 UTF-16 units. Anchoring the
    // word "go" (code points 2..4) must land the marker after "go", proving the
    // code-point → UTF-16 conversion (naive slicing at 4 would split the emoji).
    const content = '🚀 go';
    const out = insertCitationMarkers(content, [{ citation: 0, start: 2, end: 4 }], 1);
    expect(out).toBe(`🚀 go${cite(0)}`);
  });

  it('returns content unchanged when there are no anchors', () => {
    expect(insertCitationMarkers('unchanged', [], 3)).toBe('unchanged');
    expect(insertCitationMarkers('unchanged', undefined, 3)).toBe('unchanged');
  });

  it('returns content unchanged when there are no citations to reference', () => {
    expect(insertCitationMarkers('x', [{ citation: 0, start: 0, end: 1 }], 0)).toBe(
      'x',
    );
  });
});
