// Marketing-site i18n. Six locales, matching the app
// (`frontend/src/app/i18n/languages.ts`). English is the default and served
// unprefixed; catalogs live in ./locales/<code>.json and share the app's
// nested-key + `{{ var }}` interpolation convention.
//
// The locale list and path helpers live in `./config.ts` and are re-exported
// here, so every existing `from '../i18n/ui'` import keeps working.
import { type Lang, defaultLang } from './config';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import pt from './locales/pt.json';

export {
  bcp47,
  defaultLang,
  getLangFromUrl,
  homeAnchor,
  isLang,
  languages,
  locales,
  localizedPath,
  nonDefaultLocales,
} from './config';
export type { Lang } from './config';

const catalogs: Record<Lang, unknown> = { en, de, fr, es, pt, it };

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
 * the page - it just shows English until a translator fills the gap.
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
