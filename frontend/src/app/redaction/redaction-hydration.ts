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
