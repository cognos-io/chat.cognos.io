// Shared helpers for the regex detectors. Kept in their own module so the
// base detectors and the per-country national-ID detectors can both use them
// without a circular import.
import { RedactionCandidate, RedactionType } from './redaction-types';

/**
 * Iterate every match of `pattern` in `text`, guarding against zero-width
 * matches. The pattern is recompiled with the global flag so callers can pass a
 * plain literal without worrying about shared `lastIndex` state.
 */
export function* matchAll(
  text: string,
  pattern: RegExp,
): Generator<RegExpExecArray, void, unknown> {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex += 1;
    yield m;
  }
}

/** Build a high-confidence candidate for a matched substring. */
export function candidate(
  type: RedactionType,
  detector: string,
  match: RegExpExecArray,
  matched: string,
  normalized: string,
): RedactionCandidate {
  const start = match.index + match[0].indexOf(matched);
  return {
    type,
    detector,
    start,
    end: start + matched.length,
    value: matched,
    normalized,
    confidence: 'high',
  };
}

/** Digits only, dropping every non-digit separator. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}
