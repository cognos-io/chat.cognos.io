// Central registry of the languages the app ships translations for. Adding a
// language is a two-step change: add an entry here and drop a matching catalog
// in src/assets/i18n/<code>.json.

export interface AppLanguage {
  /** ISO 639-1 code; also the Transloco active-lang id and `<html lang>`. */
  readonly code: string;
  /** Endonym shown in the switcher (each language in its own words). */
  readonly nativeName: string;
  /** English name, handy for tooltips/aria. */
  readonly englishName: string;
  /** Locale string understood by Paddle.js Checkout (`settings.locale`). */
  readonly paddleLocale: string;
}

export const APP_LANGUAGES: readonly AppLanguage[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', paddleLocale: 'en' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', paddleLocale: 'de' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', paddleLocale: 'fr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', paddleLocale: 'es' },
  {
    code: 'pt',
    nativeName: 'Português',
    englishName: 'Portuguese',
    paddleLocale: 'pt',
  },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', paddleLocale: 'it' },
] as const;

export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_LANGUAGE_CODES: readonly string[] = APP_LANGUAGES.map(
  (l) => l.code,
);

export const LANGUAGE_STORAGE_KEY = 'cognos:lang';

export const isSupportedLanguage = (code: string | null | undefined): boolean =>
  !!code && SUPPORTED_LANGUAGE_CODES.includes(code);

export const findLanguage = (code: string): AppLanguage | undefined =>
  APP_LANGUAGES.find((l) => l.code === code);

export const paddleLocaleFor = (code: string): string =>
  findLanguage(code)?.paddleLocale ?? DEFAULT_LANGUAGE;

/**
 * Reduce a BCP-47 tag to a supported base code, e.g. `de-CH` → `de`.
 * Returns null when the tag has no supported match.
 */
export const matchSupportedLanguage = (tag: string): string | null => {
  const base = tag.toLowerCase().split('-')[0];
  return isSupportedLanguage(base) ? base : null;
};

/**
 * Resolve the language to use before the user has made an explicit choice this
 * session. Order: a previously-saved choice (localStorage) → the browser's
 * preferred languages (the SPA equivalent of the HTTP Accept-Language header) →
 * the default. The backend account preference is layered on later, once the
 * user is authenticated (see LanguageService).
 */
export const resolveInitialLanguage = (
  storedValue: string | null,
  browserLanguages: readonly string[],
): string => {
  if (isSupportedLanguage(storedValue)) {
    return storedValue as string;
  }

  for (const tag of browserLanguages) {
    const matched = matchSupportedLanguage(tag);
    if (matched) {
      return matched;
    }
  }

  return DEFAULT_LANGUAGE;
};
