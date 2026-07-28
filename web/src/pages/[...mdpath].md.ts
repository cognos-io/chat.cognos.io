import type { APIContext } from 'astro';

import { mdPaths, mdRouteByParam, renderMdRoute } from '../lib/md-routes';

// Markdown twin of every page, at `/<path>.md` - `/terms.md`,
// `/docs/account-key.md`, `/de/blog/<slug>.md`, and `/index.md` for the
// homepage. Indexed by `/llms.txt` (https://llmstxt.org/).
//
// One rest-param route covers all six locales: the locale prefix is part of
// `mdpath`, exactly as it is in the page URL. The map lives in
// `src/lib/md-routes.ts`.

export function getStaticPaths() {
  return mdPaths;
}

export function GET({ params }: APIContext) {
  const match = mdRouteByParam(String(params.mdpath));
  if (!match) return new Response('Not found', { status: 404 });

  return new Response(renderMdRoute(match.route, match.lang), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
