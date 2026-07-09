import { RedactionEntry, RedactionType } from './redaction-types';

export interface RedactionAllowlistItem {
  token: string;
  type: RedactionType;
  value: string;
  normalized: string;
}

const ALLOWLIST_TOKEN_PREFIX = '[[PII_ALLOWLIST_';

export function isAllowlistEntry(entry: RedactionEntry): boolean {
  return (
    entry.detector === 'allowlist:v1' && entry.token.startsWith(ALLOWLIST_TOKEN_PREFIX)
  );
}

export function allowlistToken(): string {
  return `${ALLOWLIST_TOKEN_PREFIX}${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}]]`;
}

export function allowlistEntry(
  type: RedactionType,
  value: string,
  normalized: string,
): RedactionEntry {
  return {
    version: '1',
    token: allowlistToken(),
    type,
    original: value,
    normalized,
    detector: 'allowlist:v1',
    source: { kind: 'message' },
  };
}

export function allowlistItem(entry: RedactionEntry): RedactionAllowlistItem {
  return {
    token: entry.token,
    type: entry.type,
    value: entry.original,
    normalized: entry.normalized,
  };
}
