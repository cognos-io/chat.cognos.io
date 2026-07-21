// Pure, browser-only helpers for web-search citations. See
// docs/business_processes/web-search.md. No Angular/DOM-framework dependencies
// beyond the standard DOM used
// by the marker-injection helper, so the offset maths, URL sanitisation and
// domain-label derivation stay fast and unit-testable.

/**
 * Citation is one web source returned by the provider's native search. Mirrors
 * the SSE `web_search` frame and the persisted (encrypted) `MessageData`
 * `citations[]` entry — one shape for live and reload.
 */
export interface Citation {
  url: string;
  // Optional: Vertex Gemini proxy sources arrive title-less; when present the
  // title is frequently the displayable domain itself.
  title?: string;
  // Optional: currently always empty from the Gemini family.
  snippet?: string;
}

/**
 * CitationAnchor ties a span of the answer's raw markdown to a citation. `start`
 * and `end` are offsets in Unicode CODE POINTS (the gateway already normalised
 * provider byte offsets → code points); `citation` is a stable index into the
 * accumulated `citations[]`.
 */
export interface CitationAnchor {
  citation: number;
  start: number;
  end: number;
}

// The vertexaisearch grounding-redirect host is never a useful label — the real
// displayable domain travels in the annotation title (spec, risks).
const PROXY_HOSTS = ['vertexaisearch.cloud.google.com'];

// A conservative "looks like a bare domain" test: labels of alphanumerics and
// hyphens separated by dots, at least one dot, no spaces or scheme.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * sanitizeCitationUrl returns the URL only when it parses and uses an http(s)
 * scheme, otherwise null. Guards every rendered link against `javascript:`,
 * `data:` and other non-navigational schemes (spec rendering safety).
 */
export function sanitizeCitationUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return null;
}

function looksLikeDomain(value: string): boolean {
  return DOMAIN_RE.test(value.trim());
}

function hostnameOf(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

/**
 * citationDomainLabel derives the human label for a source. It prefers the
 * citation title when the title looks like a bare domain (Vertex Gemini returns
 * the domain AS the title, with a proxy-redirect URL), otherwise the hostname of
 * the URL. The grounding-redirect proxy host is never shown — the title wins in
 * that case even when it is not domain-shaped.
 */
export function citationDomainLabel(citation: Citation): string {
  const title = (citation.title ?? '').trim();
  if (title && looksLikeDomain(title)) {
    return title.replace(/^www\./i, '');
  }
  const host = hostnameOf(sanitizeCitationUrl(citation.url));
  if (host && !PROXY_HOSTS.includes(host)) {
    return host;
  }
  // The host is a grounding-redirect proxy (or the URL is unusable): never show
  // the proxy host as the label. Fall back to the title if any, else empty — the
  // UI substitutes a localised generic label ("Web source").
  return title;
}

/**
 * citationAvatarLetter returns the uppercase first alphanumeric character of the
 * displayable domain, for the letter avatar. Falls back to '?'.
 */
export function citationAvatarLetter(citation: Citation): string {
  const label = citationDomainLabel(citation);
  const match = label.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : '?';
}

// citationMarkerToken is the literal placeholder inserted into the raw markdown
// at an anchor position before rendering; a post-render pass swaps it for an
// interactive chip. `index` is the 0-based citation index; the chip renders the
// 1-based number. Mirrors the redaction-pill token strategy so markdown treats
// it as plain text.
export function citationMarkerToken(index: number): string {
  return `[[CITE_${index}]]`;
}

// Regex source matching a citation marker token and capturing its index. Kept in
// sync with citationMarkerToken.
export const CITATION_MARKER_SOURCE = '\\[\\[CITE_(\\d+)\\]\\]';

// codePointToUtf16Map builds a lookup where entry i is the UTF-16 string index at
// which the i-th Unicode code point begins. Length is codePointCount + 1, with
// the final entry equal to text.length (so an end offset up to the count is
// valid). Astral-plane characters (emoji) advance the UTF-16 index by 2.
function codePointToUtf16Map(text: string): number[] {
  const map: number[] = [];
  let index = 0;
  for (const ch of text) {
    map.push(index);
    index += ch.length;
  }
  map.push(index);
  return map;
}

/**
 * insertCitationMarkers inserts a marker token into `content` at the END of each
 * valid, non-overlapping anchor span, converting the anchors' code-point offsets
 * to UTF-16 string indices first. Out-of-range anchors (bad citation index or
 * offsets past the content) and anchors overlapping an already-accepted one are
 * dropped — never guessed. Insertion runs right-to-left so earlier UTF-16
 * indices stay valid as tokens are spliced in.
 */
export function insertCitationMarkers(
  content: string,
  anchors: readonly CitationAnchor[] | undefined,
  citationCount: number,
): string {
  if (!anchors || anchors.length === 0 || citationCount <= 0) {
    return content;
  }

  const map = codePointToUtf16Map(content);
  const codePointCount = map.length - 1;

  const valid = anchors.filter(
    (anchor) =>
      Number.isInteger(anchor.citation) &&
      anchor.citation >= 0 &&
      anchor.citation < citationCount &&
      Number.isInteger(anchor.start) &&
      Number.isInteger(anchor.end) &&
      anchor.start >= 0 &&
      anchor.end >= anchor.start &&
      anchor.end <= codePointCount,
  );

  // Sort by span start (then end) so overlap detection is a single left-to-right
  // sweep. A span whose start falls before the last accepted span's end overlaps
  // and is dropped; adjacent spans (start === lastEnd) are kept.
  const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: CitationAnchor[] = [];
  let lastEnd = -1;
  for (const anchor of sorted) {
    if (anchor.start < lastEnd) {
      continue;
    }
    kept.push(anchor);
    lastEnd = anchor.end;
  }

  let result = content;
  for (let i = kept.length - 1; i >= 0; i--) {
    const anchor = kept[i];
    const at = map[anchor.end];
    result = `${result.slice(0, at)}${citationMarkerToken(anchor.citation)}${result.slice(at)}`;
  }
  return result;
}

/**
 * injectCitationMarkers walks every text node under `root`, replacing each
 * citation marker token with the node returned by `makeChip(citationIndex)`.
 * Surrounding text and markup are preserved. Mirrors injectRedactionPills so the
 * (fiddly) text-node surgery is testable without a markdown renderer.
 */
export function injectCitationMarkers(
  root: Node,
  makeChip: (citationIndex: number) => Node,
): void {
  const detect = new RegExp(CITATION_MARKER_SOURCE);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && detect.test(node.nodeValue)) {
      targets.push(node as Text);
    }
  }
  for (const textNode of targets) {
    replaceMarkersInTextNode(textNode, makeChip);
  }
}

function replaceMarkersInTextNode(
  textNode: Text,
  makeChip: (citationIndex: number) => Node,
): void {
  const text = textNode.nodeValue ?? '';
  const re = new RegExp(CITATION_MARKER_SOURCE, 'g');
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let replaced = false;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text))) {
    replaced = true;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    fragment.appendChild(makeChip(Number(match[1])));
    lastIndex = match.index + match[0].length;
  }

  if (!replaced) {
    return;
  }
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  textNode.parentNode?.replaceChild(fragment, textNode);
}
