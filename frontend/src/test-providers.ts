import { importProvidersFrom } from '@angular/core';

import { Translation, TranslocoTestingModule } from '@jsverse/transloco';

import en from './assets/i18n/en.json';

// Global providers applied to every unit test's TestBed (wired via the
// `providersFile` option of @angular/build:unit-test in angular.json).
//
// Many services and components transitively inject TranslocoService (e.g.
// LanguageService), and templates use the transloco pipe — without a Transloco
// provider those specs fail with NG0201 (no TRANSLOCO_TRANSPILER). We load the
// real English catalog so specs that assert on visible UI text see the same
// strings as production.
export default [
  importProvidersFrom(
    TranslocoTestingModule.forRoot({
      langs: { en: en as unknown as Translation },
      translocoConfig: {
        availableLangs: ['en'],
        defaultLang: 'en',
        fallbackLang: 'en',
        missingHandler: { useFallbackTranslation: true },
      },
      preloadLangs: true,
    }),
  ),
];
