import { importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';

import { Translation, TranslocoTestingModule } from '@jsverse/transloco';

import en from '../../assets/i18n/en.json';

export const storybookProviders = [
  provideRouter([]),
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
