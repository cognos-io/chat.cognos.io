/**
 * Pure hydration: replace placeholder tokens with original values for display.
 *
 * Hydration is a display concern only — it returns a new string and never
 * mutates stored message data (spec §6.4). Unknown tokens are left visible as
 * placeholders; a failure to map one token must not affect the others.
 */
import { TOKEN_RE } from './redaction-engine';
import { RedactionEntry } from './redaction-types';

/** True if the text contains at least one redaction placeholder token. */
export function containsRedactionToken(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/** All placeholder tokens present in the text, in order of appearance. */
export function extractTokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * Replace every known placeholder token in `text` with its original value.
 * Tokens absent from `entries` are preserved verbatim.
 */
export function hydrateRedactedText(
  text: string,
  entries: readonly RedactionEntry[],
): string {
  if (entries.length === 0 || !text) return text;
  const originalByToken = new Map<string, string>();
  for (const entry of entries) {
    originalByToken.set(entry.token, entry.original);
  }
  return text.replace(TOKEN_RE, (token) => originalByToken.get(token) ?? token);
}

/** One run of a redaction-hydrated string: either plain text or a known token. */
export interface RedactionSegment {
  /** The literal text of this run (the token itself for a redaction segment). */
  readonly text: string;
  /**
   * The mapped entry when this run is a KNOWN placeholder token, so a template
   * can render it as a pill (real value shown, model saw only the placeholder).
   * Absent for plain text and for unknown tokens, which stay verbatim.
   */
  readonly entry?: RedactionEntry;
}

/**
 * Split `text` into ordered plain-text and known-token segments, so a template
 * can render each token as a highlighted pill while leaving surrounding text
 * (and unknown tokens) untouched. The DOM-free counterpart to the markdown
 * renderer's pill injection — for plain-text contexts like a document title.
 *
 * A fresh regex is compiled per call: `TOKEN_RE` is a shared global with
 * stateful `lastIndex`, unsafe to iterate directly.
 */
export function splitRedactionSegments(
  text: string,
  entries: readonly RedactionEntry[],
): RedactionSegment[] {
  if (!text) return [];
  const entryByToken = new Map<string, RedactionEntry>();
  for (const entry of entries) {
    entryByToken.set(entry.token, entry);
  }

  const segments: RedactionSegment[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    // Unknown token → no entry, so it renders as its plain placeholder text.
    segments.push({ text: token, entry: entryByToken.get(token) });
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}
