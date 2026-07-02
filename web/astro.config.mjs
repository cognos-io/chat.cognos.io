// @ts-check
import sitemap from '@astrojs/sitemap';
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
  integrations: [
    sitemap({
      // Keep the error page out of the sitemap.
      filter: (page) => !page.includes('/404'),
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          de: 'de',
          fr: 'fr',
          es: 'es',
          pt: 'pt',
          it: 'it',
        },
      },
    }),
  ],
});
