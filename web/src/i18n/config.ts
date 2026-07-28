// Locale primitives: the language list and the path helpers built on it.
//
// Split out from `./ui.ts` so this half carries no `import … from './locales/*.json'`.
// That keeps it loadable by plain `node --test` (which needs import attributes
// for JSON), which is what lets `../lib/markdown.ts` have unit tests.
// `./ui.ts` re-exports everything here, so import from either.

export const defaultLang = 'en' as const;

/** Endonym shown in the language switcher (each language in its own words). */
export const languages = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
} as const;

export type Lang = keyof typeof languages;

/**
 * BCP 47 tags for the European regional variants the copy is written in - used
 * for `Intl` date formatting and (with `-` swapped for `_`) Open Graph locales.
 * Keep in step with the variants documented in the root CLAUDE.md.
 */
export const bcp47 = {
  en: 'en-GB',
  de: 'de-CH',
  fr: 'fr-CH',
  es: 'es-ES',
  pt: 'pt-PT',
  it: 'it-CH',
} as const satisfies Record<Lang, string>;

export const locales = Object.keys(languages) as Lang[];

/** The non-default locales - used to generate prefixed routes. */
export const nonDefaultLocales = locales.filter((l) => l !== defaultLang);

export function isLang(value: string | undefined): value is Lang {
  return !!value && value in languages;
}

/** Resolve the active locale from an Astro URL pathname (`/de/…` → `de`). */
export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split('/');
  return isLang(maybeLang) ? maybeLang : defaultLang;
}

/** Build a locale-aware path. Default locale stays unprefixed. */
export function localizedPath(lang: Lang, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return lang === defaultLang ? clean : `/${lang}${clean === '/' ? '' : clean}`;
}

/**
 * An in-page anchor that stays a plain hash on the homepage but points back to
 * the (locale-aware) homepage from any other page - so the shared navbar and
 * footer section links work from the standalone pages too.
 */
export function homeAnchor(lang: Lang, currentPath: string, hash: string): string {
  return currentPath === '/' ? hash : `${localizedPath(lang)}${hash}`;
}
