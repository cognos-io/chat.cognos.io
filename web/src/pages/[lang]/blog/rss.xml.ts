// Prefixed-locale feeds at /de/blog/rss.xml, /fr/blog/rss.xml, …
import type { APIContext } from 'astro';

import { isLang, nonDefaultLocales } from '../../../i18n/ui';
import { blogFeed } from '../../../lib/feed';

export function getStaticPaths() {
  return nonDefaultLocales.map((lang) => ({ params: { lang } }));
}

export function GET(context: APIContext) {
  const { lang } = context.params;
  if (!isLang(lang)) {
    throw new Error(`[feed] unknown locale: "${lang}"`);
  }
  return blogFeed(lang, context.site);
}
