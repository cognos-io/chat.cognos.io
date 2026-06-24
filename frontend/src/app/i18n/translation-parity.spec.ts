import { describe, expect, it } from 'vitest';

import de from '../../assets/i18n/de.json';
import en from '../../assets/i18n/en.json';
import es from '../../assets/i18n/es.json';
import fr from '../../assets/i18n/fr.json';
import itLocale from '../../assets/i18n/it.json';
import pt from '../../assets/i18n/pt.json';

// Guards translation completeness across every supported locale. A missing key
// in any locale (e.g. a new feature's strings only added to en.json) fails CI
// here rather than silently falling back to English at runtime. Required for
// the conversation-copy flow, but applies to every feature.

type Json = Record<string, unknown>;

// flattenKeys returns the set of dotted leaf paths, so the comparison is
// structural (a key present as an object in one locale and a string in another
// would also surface as a difference).
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Json).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

const locales: Record<string, unknown> = { de, es, fr, it: itLocale, pt };
const englishKeys = new Set(flattenKeys(en));

describe('i18n translation parity', () => {
  for (const [name, translation] of Object.entries(locales)) {
    it(`${name}.json has exactly the same keys as en.json`, () => {
      const keys = new Set(flattenKeys(translation));

      const missing = [...englishKeys].filter((key) => !keys.has(key)).sort();
      const extra = [...keys].filter((key) => !englishKeys.has(key)).sort();

      expect(missing, `${name}.json is missing keys`).toEqual([]);
      expect(extra, `${name}.json has keys not in en.json`).toEqual([]);
    });
  }

  it('includes the conversation-copy keys in English', () => {
    // A canary so a refactor that drops these specific keys is caught directly.
    for (const key of [
      'chat.list.duplicate',
      'chat.header.duplicate',
      'chat.copy.titleSuffix',
      'chat.copy.loadingTitle',
      'chat.copy.loadingWarning',
      'chat.toasts.duplicated',
      'chat.toasts.duplicateError',
      'chat.toasts.duplicateAttachments',
      'chat.toasts.duplicateTooLarge',
      'chat.toasts.duplicateProject',
    ]) {
      expect(englishKeys.has(key), `en.json missing ${key}`).toBe(true);
    }
  });
});
