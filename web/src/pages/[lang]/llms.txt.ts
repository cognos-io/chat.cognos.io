// Prefixed locales: /de/llms.txt, /fr/llms.txt, …
import type { APIContext } from 'astro';

import { type Lang, nonDefaultLocales } from '../../i18n/config';
import { llmsIndex } from '../../lib/llms';

export function getStaticPaths() {
  return nonDefaultLocales.map((lang) => ({ params: { lang } }));
}

export function GET({ params }: APIContext) {
  return new Response(llmsIndex(params.lang as Lang), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
