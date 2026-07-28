// Prefixed locales: /de/llms-full.txt, /fr/llms-full.txt, …
import type { APIContext } from 'astro';

import { type Lang, nonDefaultLocales } from '../../i18n/config';
import { llmsFull } from '../../lib/llms';

export function getStaticPaths() {
  return nonDefaultLocales.map((lang) => ({ params: { lang } }));
}

export function GET({ params }: APIContext) {
  return new Response(llmsFull(params.lang as Lang), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
