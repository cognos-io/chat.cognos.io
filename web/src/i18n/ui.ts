// Marketing-site i18n. Six locales, matching the app
// (`frontend/src/app/i18n/languages.ts`). English is the default and served
// unprefixed; catalogs live in ./locales/<code>.json and share the app's
// nested-key + `{{ var }}` interpolation convention.
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import pt from './locales/pt.json';

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

export const locales = Object.keys(languages) as Lang[];

/** The non-default locales — used to generate prefixed routes. */
export const nonDefaultLocales = locales.filter((l) => l !== defaultLang);

const catalogs: Record<Lang, unknown> = { en, de, fr, es, pt, it };

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

type Dict = Record<string, unknown>;

function resolve(dict: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Dict)[part] : undefined),
      dict,
    );
}

function interpolate(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{{ ${name} }}`,
  );
}

export interface Translator {
  /** Resolve a string key, with optional `{{ var }}` interpolation. */
  (key: string, params?: Record<string, string | number>): string;
  /** Resolve a key that points at an array/object (e.g. a list of cards). */
  raw<T = unknown>(key: string): T;
}

/**
 * Returns a translator bound to `lang`. Missing keys fall back to English,
 * then to the key itself, so a partially-translated catalog never blanks out
 * the page — it just shows English until a translator fills the gap.
 */
export function useTranslations(lang: Lang): Translator {
  const active = catalogs[lang] ?? catalogs[defaultLang];
  const fallback = catalogs[defaultLang];

  const t = ((key: string, params?: Record<string, string | number>) => {
    const found = resolve(active, key) ?? resolve(fallback, key);
    return typeof found === 'string' ? interpolate(found, params) : key;
  }) as Translator;

  t.raw = <T>(key: string): T => {
    return (resolve(active, key) ?? resolve(fallback, key)) as T;
  };

  return t;
}
