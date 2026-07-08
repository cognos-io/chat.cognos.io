/**
 * Bookmark anchoring uses a text-quote-with-context selector (the W3C Web
 * Annotation approach) rather than numeric offsets into the markdown source.
 *
 * Why not offsets: the stored content is markdown, but bookmarks are made over
 * the RENDERED plain text, and that text is reshaped by redaction pills and
 * citation chips that hydrate/dehydrate over time. Numeric offsets drift the
 * moment any of that changes. A quote plus a little surrounding context locates
 * the same span again by SEARCHING the current rendered text, and degrades
 * gracefully (no match → no highlight) instead of highlighting the wrong span.
 *
 * All offsets here are UTF-16 string indices (what DOM Ranges use); we never
 * persist a numeric offset, only the quote/prefix/suffix strings, so there is
 * no code-point/UTF-16 conversion to get wrong.
 */

export interface BookmarkAnchor {
  /** The exact highlighted text. */
  quote: string;
  /** Up to `ANCHOR_CONTEXT_CHARS` of text immediately before the quote. */
  prefix: string;
  /** Up to `ANCHOR_CONTEXT_CHARS` of text immediately after the quote. */
  suffix: string;
}

export const ANCHOR_CONTEXT_CHARS = 32;

/** Build an anchor from the selection's [start,end) offsets within `text`. */
export function captureAnchor(
  text: string,
  start: number,
  end: number,
  context = ANCHOR_CONTEXT_CHARS,
): BookmarkAnchor | null {
  if (start < 0 || end > text.length || start >= end) {
    return null;
  }
  const quote = text.slice(start, end);
  if (quote.trim() === '') {
    return null;
  }
  return {
    quote,
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, end + context),
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
    n++;
  }
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) {
    n++;
  }
  return n;
}

/**
 * Find the [start,end) span of `anchor.quote` in `text`, using prefix/suffix
 * context to disambiguate when the quote occurs more than once. Returns null
 * when the quote no longer appears (message edited, redaction changed, etc.).
 */
export function locateAnchor(
  text: string,
  anchor: BookmarkAnchor,
): { start: number; end: number } | null {
  const { quote, prefix, suffix } = anchor;
  if (!quote) {
    return null;
  }

  const positions: number[] = [];
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    positions.push(i);
  }
  if (positions.length === 0) {
    return null;
  }
  if (positions.length === 1) {
    return { start: positions[0], end: positions[0] + quote.length };
  }

  // Disambiguate by how much of the stored context matches around each match.
  let best = positions[0];
  let bestScore = -1;
  for (const p of positions) {
    const before = text.slice(Math.max(0, p - prefix.length), p);
    const after = text.slice(p + quote.length, p + quote.length + suffix.length);
    const score =
      commonSuffixLength(prefix, before) + commonPrefixLength(suffix, after);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return { start: best, end: best + quote.length };
}
