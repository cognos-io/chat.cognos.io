// English feed at /blog/rss.xml.
import type { APIContext } from 'astro';

import { blogFeed } from '../../lib/feed';

export function GET(context: APIContext) {
  return blogFeed('en', context.site);
}
