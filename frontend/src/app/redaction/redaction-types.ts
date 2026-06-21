/**
 * Pure, framework-agnostic types for the PII redaction engine.
 *
 * Nothing in the `redaction/` module may import Angular or chat state: the
 * engine operates on plain strings so the same detection/tokenisation/hydration
 * code can later serve document and document-chunk sources (see spec §6.8).
 */

/**
 * Detector confidence. Tier 1 structured detectors are always `high`; Tier 2
 * NLP hints are `low`/`medium` and require explicit user opt-in before they are
 * redacted (spec §8).
 */
export type RedactionConfidence = 'low' | 'medium' | 'high';

/** Supported sensitive-value categories. */
export type RedactionType =
  | 'iban'
  | 'email'
  | 'credit_card'
  | 'secret'
  | 'phone'
  // National identifiers / tax / health numbers (checksum-validated).
  | 'us_ssn'
  | 'uk_nino'
  | 'uk_nhs'
  | 'fr_nir'
  | 'it_codice_fiscale'
  | 'it_partita_iva'
  | 'de_steuer_id'
  | 'ch_ahv'
  | 'at_svnr'
  | 'pt_nif'
  | 'es_dni'
  | 'es_nie'
  // Tier 2 NLP entity hints.
  | 'person'
  | 'org'
  | 'place'
  // User-selected manual redaction (no detector).
  | 'custom';

/** Where a redacted source originated. Modelled now so documents reuse it. */
export type RedactionSourceKind = 'message' | 'document' | 'document_chunk';

export interface RedactionSource {
  kind: RedactionSourceKind;
  id?: string;
}

/**
 * A single detected sensitive value, with its range in the *original* text.
 * `value` is the exact matched substring; `normalized` is the canonical form
 * used to decide whether two detections share a token within a conversation.
 */
export interface RedactionCandidate {
  type: RedactionType;
  /** Stable detector id, e.g. `iban:v1`. */
  detector: string;
  /** Inclusive start offset in the original text. */
  start: number;
  /** Exclusive end offset in the original text. */
  end: number;
  value: string;
  normalized: string;
  confidence: RedactionConfidence;
}

/**
 * A pluggable detector. Tiers differ only in cost and confidence, never in
 * interface, so a heavier ML backend can be added without engine changes.
 */
export interface Detector {
  readonly id: string;
  readonly type: RedactionType;
  detect(text: string): RedactionCandidate[];
}

/**
 * The decrypted mapping payload. Sealed form lives in the backend
 * `redaction_entries.data` field; the original value never leaves the device
 * in plaintext.
 */
export interface RedactionEntry {
  version: '1';
  token: string;
  type: RedactionType;
  original: string;
  normalized: string;
  detector: string;
  source?: RedactionSource;
  created_at?: string;
}

/** Result of applying redactions to a piece of text. */
export interface RedactionResult {
  /** Text with selected candidates replaced by placeholder tokens. */
  redactedText: string;
  /** Tokens present in `redactedText`, in order of first appearance. */
  tokens: string[];
  /** Entries that did not already exist and must be persisted. */
  newEntries: RedactionEntry[];
}

/** Generates a fresh, value-independent token for a candidate type. */
export type TokenGenerator = (type: RedactionType) => string;
