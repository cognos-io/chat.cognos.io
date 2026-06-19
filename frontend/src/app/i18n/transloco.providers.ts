import {
  EnvironmentProviders,
  Provider,
  inject,
  isDevMode,
  provideAppInitializer,
} from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { TranslocoService, provideTransloco } from '@jsverse/transloco';

import { LanguageService } from '@app/services/language.service';

import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  resolveInitialLanguage,
} from './languages';
import { TranslocoHttpLoader } from './transloco-loader';

// provideAppI18n wires up Transloco plus the initial-language resolution that
// runs before the app renders, so the first paint is already in the right
// language (no English flash). LanguageService takes over reactive switching
// and account-preference sync once it is constructed here.
export function provideAppI18n(): (Provider | EnvironmentProviders)[] {
  return [
    provideTransloco({
      config: {
        availableLangs: [...SUPPORTED_LANGUAGE_CODES],
        defaultLang: DEFAULT_LANGUAGE,
        fallbackLang: DEFAULT_LANGUAGE,
        // Catalogs are complete per language, but missing keys (e.g. during an
        // in-progress translation sweep) fall back to English rather than show
        // the raw key.
        missingHandler: { useFallbackTranslation: true },
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),
    provideAppInitializer(() => {
      // inject() must run synchronously, before any await — grab every
      // dependency up front, then do the async catalog load.
      const transloco = inject(TranslocoService);
      const language = inject(LanguageService);

      const initial = resolveInitialLanguage(
        localStorageLanguage(),
        navigatorLanguages(),
      );

      transloco.setActiveLang(initial);
      document.documentElement.lang = initial;

      // Ensure the active catalog (and its English fallback) are loaded before
      // the first render, then start LanguageService so it subscribes to auth
      // changes and applies the account preference once available.
      return Promise.all([
        firstValueFrom(transloco.load(initial)),
        initial === DEFAULT_LANGUAGE
          ? Promise.resolve()
          : firstValueFrom(transloco.load(DEFAULT_LANGUAGE)),
      ]).then(() => language.init());
    }),
  ];
}

const localStorageLanguage = (): string | null => {
  try {
    return localStorage.getItem('cognos:lang');
  } catch {
    return null;
  }
};

const navigatorLanguages = (): readonly string[] => {
  if (typeof navigator === 'undefined') {
    return [];
  }
  return navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];
};
