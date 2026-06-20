/**
 * Tier 1 structured detectors: high-precision regex + checksum matchers.
 *
 * These prefer precision over recall — every detector validates a checksum or
 * format rule where one exists so normal prose and arbitrary identifiers are
 * not corrupted (spec §8.1). All matchers return ranges in the original text.
 *
 * Tier 2 NLP hints (`compromise`) live behind a lazy-loaded detector and are
 * registered separately so the bundle cost is only paid when enabled.
 */
import { Detector, RedactionCandidate, RedactionType } from './redaction-types';

// --- Checksums -------------------------------------------------------------

/** ISO 7064 mod-97-10 check used by IBAN: rearranged value mod 97 must equal 1. */
export function isValidIbanChecksum(compact: string): boolean {
  // Move the first four chars to the end, then map letters to 10..35.
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digit =
      code >= 65 && code <= 90 ? (code - 55).toString() : String.fromCharCode(code);
    for (const d of digit) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

/** Luhn (mod-10) check used by payment cards. */
export function isValidLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** EAN-13 check digit, used by the Swiss AHV (AHVN13) number. */
export function isValidEan13(digits: string): boolean {
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits.charCodeAt(12) - 48;
}

// --- Helpers ---------------------------------------------------------------

function* matchAll(
  text: string,
  pattern: RegExp,
): Generator<RegExpExecArray, void, unknown> {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex += 1; // guard against zero-width
    yield m;
  }
}

function candidate(
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

// --- Email -----------------------------------------------------------------

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export const emailDetector: Detector = {
  id: 'email:v1',
  type: 'email',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, EMAIL_RE)) {
      const value = m[0];
      const at = value.lastIndexOf('@');
      const normalized = value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
      out.push(candidate('email', 'email:v1', m, value, normalized));
    }
    return out;
  },
};

// --- IBAN ------------------------------------------------------------------

// Two letters, two check digits, then 11–30 alphanumerics optionally grouped
// with single spaces. The mod-97 check rejects the vast majority of accidental
// matches that survive the shape test.
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;

export const ibanDetector: Detector = {
  id: 'iban:v1',
  type: 'iban',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, IBAN_RE)) {
      const value = m[0];
      const compact = value.replace(/\s+/g, '');
      if (compact.length < 15 || compact.length > 34) continue;
      if (!isValidIbanChecksum(compact)) continue;
      out.push(candidate('iban', 'iban:v1', m, value, compact));
    }
    return out;
  },
};

// --- Credit card -----------------------------------------------------------

const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

export const creditCardDetector: Detector = {
  id: 'cc:v1',
  type: 'credit_card',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, CARD_RE)) {
      const value = m[0];
      const digits = value.replace(/[ -]/g, '');
      if (digits.length < 13 || digits.length > 19) continue;
      if (!isValidLuhn(digits)) continue;
      out.push(candidate('credit_card', 'cc:v1', m, value, digits));
    }
    return out;
  },
};

// --- Swiss AHV (AHVN13) ----------------------------------------------------

const AHV_RE = /\b756[. ]?\d{4}[. ]?\d{4}[. ]?\d{2}\b/g;

export const swissAhvDetector: Detector = {
  id: 'ch-ahv:v1',
  type: 'ch_ahv',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, AHV_RE)) {
      const value = m[0];
      const digits = value.replace(/[^0-9]/g, '');
      if (!isValidEan13(digits)) continue;
      out.push(candidate('ch_ahv', 'ch-ahv:v1', m, value, digits));
    }
    return out;
  },
};

// --- UK National Insurance number ------------------------------------------

const NINO_RE = /\b[A-Za-z]{2}[ ]?\d{2}[ ]?\d{2}[ ]?\d{2}[ ]?[A-Za-z]\b/g;
const NINO_INVALID_PREFIXES = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);
// First letter cannot be D, F, I, Q, U or V; second cannot be D, F, I, O, Q, U or V.
const NINO_FIRST_INVALID = new Set(['D', 'F', 'I', 'Q', 'U', 'V']);
const NINO_SECOND_INVALID = new Set(['D', 'F', 'I', 'O', 'Q', 'U', 'V']);

export const ukNinoDetector: Detector = {
  id: 'uk-nino:v1',
  type: 'uk_nino',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, NINO_RE)) {
      const value = m[0];
      const compact = value.replace(/\s+/g, '').toUpperCase();
      const prefix = compact.slice(0, 2);
      const suffix = compact[compact.length - 1];
      if (NINO_FIRST_INVALID.has(prefix[0])) continue;
      if (NINO_SECOND_INVALID.has(prefix[1])) continue;
      if (NINO_INVALID_PREFIXES.has(prefix)) continue;
      if (suffix < 'A' || suffix > 'D') continue;
      out.push(candidate('uk_nino', 'uk-nino:v1', m, value, compact));
    }
    return out;
  },
};

// --- Secrets / API keys ----------------------------------------------------

// PEM private-key blocks and well-known provider key prefixes. Generic
// "bearer token" style matches are intentionally excluded to avoid corrupting
// ordinary text; coverage expands iteratively against safe fixtures.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/g, // Stripe live keys
];

export const secretDetector: Detector = {
  id: 'secret:v1',
  type: 'secret',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const pattern of SECRET_PATTERNS) {
      for (const m of matchAll(text, pattern)) {
        const value = m[0];
        out.push(candidate('secret', 'secret:v1', m, value, value.trim()));
      }
    }
    return out;
  },
};

/** Tier 1 detectors that run on every detection pass. */
export const TIER1_DETECTORS: readonly Detector[] = [
  emailDetector,
  ibanDetector,
  creditCardDetector,
  swissAhvDetector,
  ukNinoDetector,
  secretDetector,
];
