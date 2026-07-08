/**
 * Country-specific national identifier / tax / health / phone detectors.
 *
 * Every detector here is checksum- or format-validated so it stays
 * high-precision (false positives corrupt normal text). Validation algorithms
 * and the canonical valid/invalid test vectors are documented in the detector
 * spec; see redaction-detectors-national.spec.ts.
 */
import { candidate, digitsOf, matchAll } from './redaction-detector-utils';
import { Detector, RedactionCandidate } from './redaction-types';

// --- Checksums -------------------------------------------------------------

/** UK NHS number: weighted mod-11 over 9 digits; check 11→0, 10→invalid. */
export function isValidNhs(d: string): boolean {
  if (d.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (d.charCodeAt(i) - 48) * (10 - i);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === d.charCodeAt(9) - 48;
}

/** French NIR: control key = 97 − (first 13 digits mod 97), Corsica 2A/2B → 19/18. */
export function isValidNir(compact: string): boolean {
  if (compact.length !== 15) return false;
  const numeric = compact.replace(/2A/g, '19').replace(/2B/g, '18');
  if (!/^\d{15}$/.test(numeric)) return false;
  const n = Number(numeric.slice(0, 13));
  const remainder = n % 97;
  const key = remainder === 0 ? 97 : 97 - remainder;
  return key === Number(numeric.slice(13, 15));
}

const CF_ODD: Record<string, number> = {
  '0': 1,
  '1': 0,
  '2': 5,
  '3': 7,
  '4': 9,
  '5': 13,
  '6': 15,
  '7': 17,
  '8': 19,
  '9': 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};

/** Italian Codice Fiscale: odd/even position tables, check char = (sum mod 26). */
export function isValidCodiceFiscale(cf: string): boolean {
  if (!/^[A-Z0-9]{16}$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    const ch = cf[i];
    if ((i + 1) % 2 === 1) {
      sum += CF_ODD[ch];
    } else {
      sum += /\d/.test(ch) ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 65;
    }
  }
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** Italian Partita IVA: Luhn-style over 10 digits, check = (10 − sum mod 10) mod 10. */
export function isValidPartitaIva(d: string): boolean {
  if (d.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    let n = d.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10 === d.charCodeAt(10) - 48;
}

/**
 * German Steuer-IdNr: ISO 7064 MOD 11,10 checksum, plus the structural rules
 * (first digit ≠ 0; within the first 10 digits exactly one digit repeats, 2 or
 * 3 times) that make it precise rather than 1-in-10.
 */
export function isValidSteuerId(d: string): boolean {
  if (d.length !== 11 || d[0] === '0') return false;

  const counts = new Map<string, number>();
  for (const ch of d.slice(0, 10)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const repeated = [...counts.values()].filter((v) => v >= 2);
  if (repeated.length !== 1 || repeated[0] > 3) return false;

  let product = 10;
  for (let i = 0; i < 10; i += 1) {
    let sum = (d.charCodeAt(i) - 48 + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  return (11 - product) % 10 === d.charCodeAt(10) - 48;
}

const SVNR_WEIGHTS = [3, 7, 9, 5, 8, 4, 2, 1, 6];
const SVNR_INDICES = [0, 1, 2, 4, 5, 6, 7, 8, 9];

/** Austrian SVNR: check digit at position 4 (mod 11), trailing 6 digits = DDMMYY. */
export function isValidSvnr(d: string): boolean {
  if (d.length !== 10) return false;
  let sum = 0;
  for (let k = 0; k < 9; k += 1) {
    sum += (d.charCodeAt(SVNR_INDICES[k]) - 48) * SVNR_WEIGHTS[k];
  }
  const check = sum % 11;
  if (check === 10 || check !== d.charCodeAt(3) - 48) return false;
  const day = Number(d.slice(4, 6));
  const month = Number(d.slice(6, 8));
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

const NIF_VALID_FIRST = new Set([1, 2, 3, 5, 6, 8, 9]);

/** Portuguese NIF: weighted mod-11, check ≥10 → 0, with valid leading type digit. */
export function isValidNif(d: string): boolean {
  if (d.length !== 9 || !NIF_VALID_FIRST.has(d.charCodeAt(0) - 48)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i += 1) sum += (d.charCodeAt(i) - 48) * (9 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  return check === d.charCodeAt(8) - 48;
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Spanish DNI control letter = DNI_LETTERS[number mod 23]. */
export function isValidDni(eightDigits: string, letter: string): boolean {
  return DNI_LETTERS[Number(eightDigits) % 23] === letter;
}

// --- Detectors -------------------------------------------------------------

// USA SSN. The dashed form + the area/group/serial exclusions (lookaheads)
// are the validation — SSNs have no checksum, so requiring the dashes keeps
// this from matching arbitrary 9-digit runs.
const SSN_RE = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
export const usSsnDetector: Detector = {
  id: 'us-ssn:v1',
  type: 'us_ssn',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, SSN_RE)) {
      out.push(candidate('us_ssn', 'us-ssn:v1', m, m[0], digitsOf(m[0])));
    }
    return out;
  },
};

// UK NHS number — require the 3-3-4 grouping separators so bare 10-digit runs
// don't match, then validate the mod-11 checksum.
const NHS_RE = /\b\d{3}[ -]\d{3}[ -]\d{4}\b/g;
export const ukNhsDetector: Detector = {
  id: 'uk-nhs:v1',
  type: 'uk_nhs',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, NHS_RE)) {
      const digits = digitsOf(m[0]);
      if (isValidNhs(digits)) {
        out.push(candidate('uk_nhs', 'uk-nhs:v1', m, m[0], digits));
      }
    }
    return out;
  },
};

// France NIR (numéro de sécurité sociale): 15 chars, dept may be 2A/2B.
const NIR_RE =
  /\b[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2]|[2-9]\d)[ .]?(?:\d{2}|2[AB])[ .]?\d{3}[ .]?\d{3}[ .]?\d{2}\b/gi;
export const frNirDetector: Detector = {
  id: 'fr-nir:v1',
  type: 'fr_nir',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, NIR_RE)) {
      const compact = m[0].replace(/[ .]/g, '').toUpperCase();
      if (isValidNir(compact)) {
        out.push(candidate('fr_nir', 'fr-nir:v1', m, m[0], compact));
      }
    }
    return out;
  },
};

// Italy Codice Fiscale.
const CF_RE = /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
export const itCodiceFiscaleDetector: Detector = {
  id: 'it-cf:v1',
  type: 'it_codice_fiscale',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, CF_RE)) {
      const cf = m[0].toUpperCase();
      if (isValidCodiceFiscale(cf)) {
        out.push(candidate('it_codice_fiscale', 'it-cf:v1', m, m[0], cf));
      }
    }
    return out;
  },
};

// Italy Partita IVA (11 digits, Luhn-style).
const PIVA_RE = /\b\d{11}\b/g;
export const itPartitaIvaDetector: Detector = {
  id: 'it-piva:v1',
  type: 'it_partita_iva',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, PIVA_RE)) {
      if (isValidPartitaIva(m[0])) {
        out.push(candidate('it_partita_iva', 'it-piva:v1', m, m[0], m[0]));
      }
    }
    return out;
  },
};

// Germany Steuer-IdNr (11 digits).
const STEUER_RE = /\b\d{11}\b/g;
export const deSteuerIdDetector: Detector = {
  id: 'de-steuerid:v1',
  type: 'de_steuer_id',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, STEUER_RE)) {
      if (isValidSteuerId(m[0])) {
        out.push(candidate('de_steuer_id', 'de-steuerid:v1', m, m[0], m[0]));
      }
    }
    return out;
  },
};

// Austria SVNR (10 digits, check digit at position 4 + DDMMYY).
const SVNR_RE = /\b\d{10}\b/g;
export const atSvnrDetector: Detector = {
  id: 'at-svnr:v1',
  type: 'at_svnr',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, SVNR_RE)) {
      if (isValidSvnr(m[0])) {
        out.push(candidate('at_svnr', 'at-svnr:v1', m, m[0], m[0]));
      }
    }
    return out;
  },
};

// Portugal NIF (9 digits). Context is required because many ordinary 9-digit
// identifiers pass the checksum.
const NIF_RE =
  /\b(?:nif|numero fiscal|número fiscal|tax number|tax id)\b[^\d]{0,24}\d{9}\b/gi;
export const ptNifDetector: Detector = {
  id: 'pt-nif:v1',
  type: 'pt_nif',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, NIF_RE)) {
      const value = m[0].match(/\d{9}\b/)?.[0];
      if (value && isValidNif(value)) {
        out.push(candidate('pt_nif', 'pt-nif:v1', m, value, value));
      }
    }
    return out;
  },
};

// Spain DNI (8 digits + control letter).
const DNI_RE = /\b\d{8}[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi;
export const esDniDetector: Detector = {
  id: 'es-dni:v1',
  type: 'es_dni',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, DNI_RE)) {
      const value = m[0].toUpperCase();
      if (isValidDni(value.slice(0, 8), value[8])) {
        out.push(candidate('es_dni', 'es-dni:v1', m, m[0], value));
      }
    }
    return out;
  },
};

// Spain NIE (X/Y/Z + 7 digits + control letter).
const NIE_PREFIX: Record<string, string> = { X: '0', Y: '1', Z: '2' };
const NIE_RE = /\b[XYZ]\d{7}[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi;
export const esNieDetector: Detector = {
  id: 'es-nie:v1',
  type: 'es_nie',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, NIE_RE)) {
      const value = m[0].toUpperCase();
      const eight = NIE_PREFIX[value[0]] + value.slice(1, 8);
      if (isValidDni(eight, value[8])) {
        out.push(candidate('es_nie', 'es-nie:v1', m, m[0], value));
      }
    }
    return out;
  },
};

// Phone numbers in E.164 (+CC) form for the supported countries. We require the
// leading + and validate the national-significant-digit count per calling code;
// bare national-format numbers are too false-positive-prone for regex and are
// deferred to a phone-number library (spec §8.1).
const PHONE_NSN: Record<string, [number, number]> = {
  '1': [10, 10], // USA/Canada
  '44': [9, 10], // UK
  '33': [9, 9], // France
  '39': [9, 10], // Italy
  '49': [6, 11], // Germany (variable)
  '41': [9, 9], // Switzerland
  '43': [4, 13], // Austria (variable)
  '351': [9, 9], // Portugal
  '34': [9, 9], // Spain
};
// Longest calling codes first so e.g. +351 isn't read as +3.
const PHONE_CCS = Object.keys(PHONE_NSN).sort((a, b) => b.length - a.length);
const PHONE_RE = /(?<!\d)\+\d[\d\s().-]{5,18}\d/g;

export const phoneDetector: Detector = {
  id: 'phone:v1',
  type: 'phone',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, PHONE_RE)) {
      const digits = digitsOf(m[0]);
      const cc = PHONE_CCS.find((c) => digits.startsWith(c));
      if (!cc) continue;
      const nsn = digits.length - cc.length;
      const [min, max] = PHONE_NSN[cc];
      if (nsn >= min && nsn <= max) {
        out.push(candidate('phone', 'phone:v1', m, m[0], `+${digits}`));
      }
    }
    return out;
  },
};

/** National-ID / tax / health / phone detectors, all checksum/format validated. */
export const NATIONAL_DETECTORS: readonly Detector[] = [
  usSsnDetector,
  ukNhsDetector,
  frNirDetector,
  itCodiceFiscaleDetector,
  itPartitaIvaDetector,
  deSteuerIdDetector,
  atSvnrDetector,
  ptNifDetector,
  esDniDetector,
  esNieDetector,
  phoneDetector,
];
