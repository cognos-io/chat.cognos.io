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

// getPath reads a dotted leaf value (string) from a locale object, or undefined.
function getPath(source: unknown, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      source,
    );
  return typeof value === 'string' ? value : undefined;
}

// Every web-search string the feature renders (spec docs/specs/web-search.md §9).
const WEB_SEARCH_KEYS = [
  'chat.composer.tools.webSearch.title',
  'chat.composer.tools.webSearch.description',
  'chat.composer.tools.webSearch.unsupported',
  'chat.models.strengths.webSearch',
  'chat.message.searching',
  'chat.message.sources.searchedOne',
  'chat.message.sources.searchedOther',
  'chat.message.sources.open',
  'chat.message.sources.marker',
  'chat.message.sources.webResult',
];

// Org billing gate copy rendered by OrgBillingBannerComponent across chat and
// project write surfaces (fail closed, spec §5.8).
const ORG_BILLING_LOCK_KEYS = [
  'billing.orgLock.titleInactive',
  'billing.orgLock.titlePastDue',
  'billing.orgLock.bodyInactive',
  'billing.orgLock.bodyPastDue',
  'billing.orgLock.personalUnaffected',
  'billing.orgLock.memberNext',
  'billing.orgLock.adminNextInactive',
  'billing.orgLock.adminNextPastDue',
  'billing.orgLock.openTeamBilling',
];

const ORG_BILLING_LOCK_ORG_PLACEHOLDER_KEYS = ORG_BILLING_LOCK_KEYS.filter(
  (key) =>
    key !== 'billing.orgLock.openTeamBilling' &&
    key !== 'billing.orgLock.personalUnaffected',
);

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

  it('includes the model-discovery keys in English', () => {
    // Canary so a refactor that drops the discovery strings is caught directly.
    // Parity across locales is enforced by the structural test above; this
    // guards the specific keys the composer/settings selector depends on.
    for (const key of [
      'chat.models.filters.recommended',
      'chat.models.filters.pinned',
      'chat.models.unavailable.badge',
      'chat.models.unavailable.generic',
      'chat.models.unavailable.privacyTier',
      'chat.models.filters.webSearch',
      'chat.models.filters.image',
      'chat.models.filters.longContext',
      'chat.models.sections.pinned',
      'chat.models.sections.recent',
      'chat.models.sections.recommended',
      'chat.models.strengths.everyday',
      'chat.models.search.placeholder',
      'chat.models.search.noResults',
      'chat.models.search.showHidden',
      'chat.models.search.privacyNote',
      'chat.models.synonyms.lowCost',
      'chat.models.synonyms.webSearch',
      'chat.models.synonyms.private',
      'chat.models.manageInSettings',
      'chat.models.privacyFooter',
    ]) {
      expect(englishKeys.has(key), `en.json missing ${key}`).toBe(true);
    }
  });

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

  it('includes every web-search key in English', () => {
    for (const key of WEB_SEARCH_KEYS) {
      expect(englishKeys.has(key), `en.json missing ${key}`).toBe(true);
      expect(getPath(en, key)?.trim(), `en.json empty ${key}`).toBeTruthy();
    }
  });

  for (const [name, translation] of Object.entries(locales)) {
    it(`${name}.json translates every web-search key (non-empty, not the English string)`, () => {
      for (const key of WEB_SEARCH_KEYS) {
        const value = getPath(translation, key);
        expect(value?.trim(), `${name}.json empty/missing ${key}`).toBeTruthy();
        // A value identical to English signals an untranslated placeholder. None
        // of these keys are proper nouns, so every locale must differ from en.
        expect(value, `${name}.json ${key} is still the English string`).not.toBe(
          getPath(en, key),
        );
      }
    });
  }

  it('includes every org billing lock key in English', () => {
    for (const key of ORG_BILLING_LOCK_KEYS) {
      expect(englishKeys.has(key), `en.json missing ${key}`).toBe(true);
      expect(getPath(en, key)?.trim(), `en.json empty ${key}`).toBeTruthy();
    }
    for (const key of ORG_BILLING_LOCK_ORG_PLACEHOLDER_KEYS) {
      expect(getPath(en, key)).toContain('{{ org }}');
    }
  });

  for (const [name, translation] of Object.entries(locales)) {
    it(`${name}.json translates every org billing lock key`, () => {
      for (const key of ORG_BILLING_LOCK_KEYS) {
        const value = getPath(translation, key);
        expect(value?.trim(), `${name}.json empty/missing ${key}`).toBeTruthy();
        expect(value, `${name}.json ${key} is still the English string`).not.toBe(
          getPath(en, key),
        );
      }
      for (const key of ORG_BILLING_LOCK_ORG_PLACEHOLDER_KEYS) {
        expect(getPath(translation, key)).toContain('{{ org }}');
      }
    });
  }
});
