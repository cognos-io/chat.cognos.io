// @ts-check
import { defineConfig } from 'astro/config';

// The marketing site ships in the same six languages as the app. Keep this
// list in sync with `frontend/src/app/i18n/languages.ts`. English is the
// default and served unprefixed at `/`; every other locale is prefixed
// (`/de/`, `/fr/`, …).
// https://astro.build/config
export default defineConfig({
  site: 'https://cognos.io',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de', 'fr', 'es', 'pt', 'it'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
