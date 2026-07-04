import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CITATION_MARKER_SOURCE,
  Citation,
  CitationAnchor,
  citationAvatarLetter,
  citationDomainLabel,
  citationMarkerToken,
  injectCitationMarkers,
  insertCitationMarkers,
  sanitizeCitationUrl,
} from './citations';

// Arbitrary content that may include astral-plane code points (emoji) but never
// a literal '[' — so a generated string can never accidentally spell a
// citation-marker token and confuse the round-trip oracle.
const contentArb = fc
  .string({ unit: 'binary', maxLength: 40 })
  .filter((s) => !s.includes('['));

const stripMarkers = (text: string): string =>
  text.replace(new RegExp(CITATION_MARKER_SOURCE, 'g'), '');

const findMarkerIndices = (text: string): number[] =>
  [...text.matchAll(new RegExp(CITATION_MARKER_SOURCE, 'g'))].map((m) => Number(m[1]));

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

  // Named regression rows for anchor shapes the property test explores in bulk —
  // documenting the exact pinned behaviour for each degenerate anchor.
  describe('degenerate anchor shapes (pinned behaviour)', () => {
    it('drops an inverted anchor (end < start), never guessing', () => {
      expect(
        insertCitationMarkers('abcdef', [{ citation: 0, start: 5, end: 2 }], 1),
      ).toBe('abcdef');
    });

    it('drops an anchor with a negative start offset', () => {
      expect(
        insertCitationMarkers('abcdef', [{ citation: 0, start: -1, end: 3 }], 1),
      ).toBe('abcdef');
    });

    it('drops a non-integer offset', () => {
      expect(
        insertCitationMarkers('abcdef', [{ citation: 0, start: 0, end: 2.5 }], 1),
      ).toBe('abcdef');
    });

    it('collapses two identical duplicate anchors to a single marker', () => {
      const out = insertCitationMarkers(
        'hello world',
        [
          { citation: 0, start: 0, end: 5 },
          { citation: 0, start: 0, end: 5 },
        ],
        1,
      );
      expect(out).toBe(`hello${citationMarkerToken(0)} world`);
      expect(findMarkerIndices(out)).toEqual([0]);
    });

    it('inserts inside markdown emphasis markers when the anchor spans them (pinned)', () => {
      // The anchor indexes the RAW markdown, so a marker can land between the
      // closing "bold" text and the "**" delimiters. We pin this rather than
      // trying to be markdown-aware (spec §6: insert on the source, not the DOM).
      const out = insertCitationMarkers(
        '**bold**',
        [{ citation: 0, start: 2, end: 6 }],
        1,
      );
      expect(out).toBe(`**bold${citationMarkerToken(0)}**`);
    });

    it('emits the marker on otherwise-empty content when the anchor is at 0 (pinned)', () => {
      // Empty content + a zero-length anchor at offset 0 is in range, so the
      // marker is emitted (not dropped). Pinned so a future "drop empties" change
      // is a conscious decision, not an accident.
      expect(insertCitationMarkers('', [{ citation: 0, start: 0, end: 0 }], 1)).toBe(
        citationMarkerToken(0),
      );
    });
  });

  // ---- Property-based (fast-check) ----------------------------------------
  describe('properties', () => {
    it('converts code-point offsets to the UTF-16 slice an Array.from oracle gives', () => {
      fc.assert(
        fc.property(contentArb, fc.nat(), (content, rawEnd) => {
          const codePoints = Array.from(content);
          const end = rawEnd % (codePoints.length + 1); // in range: 0..cpCount
          const out = insertCitationMarkers(
            content,
            [{ citation: 0, start: 0, end }],
            1,
          );
          const oracle =
            codePoints.slice(0, end).join('') +
            citationMarkerToken(0) +
            codePoints.slice(end).join('');
          expect(out).toBe(oracle);
        }),
      );
    });

    it('never throws and drops any out-of-range single anchor', () => {
      fc.assert(
        fc.property(
          contentArb,
          fc.integer({ min: -50, max: 200 }),
          fc.integer({ min: -50, max: 200 }),
          (content, start, end) => {
            let out!: string;
            expect(() => {
              out = insertCitationMarkers(content, [{ citation: 0, start, end }], 1);
            }).not.toThrow();
            expect(typeof out).toBe('string');
            const cpCount = Array.from(content).length;
            const inRange = start >= 0 && end >= start && end <= cpCount;
            if (!inRange) {
              expect(out).toBe(content);
            }
          },
        ),
      );
    });

    it('round-trips: stripping inserted markers restores the exact original', () => {
      const spec = fc
        .tuple(contentArb, fc.array(fc.nat(), { maxLength: 8 }))
        .map(([content, raws]) => {
          const cpCount = Array.from(content).length;
          // Distinct, sorted end offsets → zero-length non-overlapping anchors.
          const ends = [...new Set(raws.map((r) => r % (cpCount + 1)))].sort(
            (a, b) => a - b,
          );
          const anchors: CitationAnchor[] = ends.map((end, i) => ({
            citation: i,
            start: end,
            end,
          }));
          return { content, anchors };
        });

      fc.assert(
        fc.property(spec, ({ content, anchors }) => {
          const out = insertCitationMarkers(
            content,
            anchors,
            Math.max(anchors.length, 1),
          );
          // (a) removing the markers restores the source exactly
          expect(stripMarkers(out)).toBe(content);
          const nums = findMarkerIndices(out);
          // (b) every distinct non-overlapping valid anchor produced one marker
          expect(nums.length).toBeLessThanOrEqual(anchors.length);
          expect(nums.length).toBe(anchors.length);
          // (c) markers appear in ascending anchor (offset) order
          expect(nums).toEqual([...nums].sort((a, b) => a - b));
        }),
      );
    });

    it('never throws on arbitrary anchor garbage and still restores the source', () => {
      const garbageAnchor = fc.record({
        citation: fc.oneof(fc.integer(), fc.double(), fc.constant(NaN)),
        start: fc.oneof(fc.integer(), fc.double()),
        end: fc.oneof(fc.integer(), fc.double()),
      });
      fc.assert(
        fc.property(
          contentArb,
          fc.array(garbageAnchor, { maxLength: 10 }),
          (content, anchors) => {
            let out!: string;
            expect(() => {
              out = insertCitationMarkers(
                content,
                anchors as unknown as CitationAnchor[],
                3,
              );
            }).not.toThrow();
            expect(typeof out).toBe('string');
            // Whatever survives, only marker tokens were ever inserted.
            expect(stripMarkers(out)).toBe(content);
          },
        ),
      );
    });

    it('sanitises arbitrary URL-ish strings to http(s) or null, idempotently', () => {
      const urlish = fc.oneof(
        fc.string(),
        fc.webUrl(),
        fc.constantFrom(
          'javascript:alert(1)',
          'data:text/html,<script>',
          'vbscript:msgbox(1)',
          '//evil.example.com/x',
          'HTTP://EXAMPLE.COM/A',
          'ftp://example.com',
          '  https://spaced.example.com  ',
        ),
      );
      fc.assert(
        fc.property(urlish, (raw) => {
          const result = sanitizeCitationUrl(raw);
          if (result !== null) {
            expect(result.startsWith('http://') || result.startsWith('https://')).toBe(
              true,
            );
          }
          // Idempotent: sanitising the output changes nothing.
          expect(sanitizeCitationUrl(result ?? undefined)).toBe(result);
        }),
      );
    });
  });
});

describe('injectCitationMarkers', () => {
  // A lightweight chip stand-in so the DOM surgery is asserted without the real
  // CitationMarker Angular component (mirrors the redaction-pill spec approach).
  const makeChip = (index: number): Node => {
    const span = document.createElement('span');
    span.setAttribute('data-cite', String(index));
    span.textContent = `«${index}»`;
    return span;
  };

  const root = (html: string): HTMLElement => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  };

  it('replaces a marker token with a chip, preserving surrounding text', () => {
    const el = root(`See ${citationMarkerToken(0)} here`);
    injectCitationMarkers(el, makeChip);

    const chip = el.querySelector('[data-cite]');
    expect(chip?.getAttribute('data-cite')).toBe('0');
    // "See ", chip, " here"
    expect(el.childNodes).toHaveLength(3);
    expect(el.textContent).toBe('See «0» here');
  });

  it('replaces multiple tokens in a single text node in order', () => {
    const el = root(`${citationMarkerToken(0)} and ${citationMarkerToken(2)}`);
    injectCitationMarkers(el, makeChip);

    const chips = Array.from(el.querySelectorAll('[data-cite]')).map((c) =>
      c.getAttribute('data-cite'),
    );
    expect(chips).toEqual(['0', '2']);
  });

  it('keeps a marker nested inside an element within that element', () => {
    const el = root(`<strong>bold${citationMarkerToken(1)}</strong> tail`);
    injectCitationMarkers(el, makeChip);

    const chip = el.querySelector('strong [data-cite]');
    expect(chip?.getAttribute('data-cite')).toBe('1');
  });

  it('leaves content untouched when there are no marker tokens', () => {
    const el = root('plain text, nothing to hydrate');
    const before = el.innerHTML;
    injectCitationMarkers(el, makeChip);
    expect(el.innerHTML).toBe(before);
    expect(el.querySelector('[data-cite]')).toBeNull();
  });

  it('does not disturb non-citation tokens (redaction pills coexist)', () => {
    // A redaction-style token must survive untouched — only CITE tokens hydrate,
    // proving the two post-render passes do not collide on each other's tokens.
    const el = root(`[[REDACT_iban_1]] cites ${citationMarkerToken(0)}`);
    injectCitationMarkers(el, makeChip);

    expect(el.querySelectorAll('[data-cite]')).toHaveLength(1);
    expect(el.textContent).toContain('[[REDACT_iban_1]]');
  });
});
