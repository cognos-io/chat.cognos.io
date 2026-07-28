import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Lang } from '../i18n/ui';

// Build-time image resolution, shared by `DocsBlock.astro` (figures) and
// `Slideshow.astro` (galleries).
//
// Two rules, both about never shipping a broken image:
//
//   1. An image renders only once its file exists under `public/`, so a page
//      authored ahead of its screenshots stays clean instead of showing a
//      broken-image icon.
//   2. Localised captures live under `<dir>/<lang>/<name>`, and win for the
//      active locale when present - so a French reader stops seeing English
//      app chrome the moment its capture lands, with the English shot as the
//      fallback until then.
//
// `process.cwd()` is the `web/` project root during `astro dev` and
// `astro build`.
const publicDir = join(process.cwd(), 'public');

/** The path to use for `src` in the active locale, or null if nothing exists. */
export function resolveMedia(src: string, lang: Lang): string | null {
  if (/^https?:/.test(src)) return src;
  if (lang !== 'en') {
    const localised = src.replace(/^\/([^/]+)\//, `/$1/${lang}/`);
    if (existsSync(join(publicDir, localised))) return localised;
  }
  return existsSync(join(publicDir, src)) ? src : null;
}
