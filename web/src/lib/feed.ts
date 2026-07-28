import rss from '@astrojs/rss';

import { type Lang, bcp47, localizedPath, useTranslations } from '../i18n/ui';
import { postsByDate } from './blog';

// One RSS feed per locale, so a German reader subscribing to /de/blog/rss.xml
// receives German titles and summaries rather than English ones. Shared by the
// `/blog/rss.xml` and `/[lang]/blog/rss.xml` endpoints.

/** Build the feed response for `lang`. `site` comes from the endpoint context. */
export function blogFeed(lang: Lang, site: URL | undefined) {
  if (!site) {
    throw new Error(
      '[feed] astro.config.mjs must set `site` for the blog feed to build absolute links',
    );
  }
  const t = useTranslations(lang);

  return rss({
    title: t('blog.index.feedTitle'),
    description: t('blog.index.metaDescription'),
    site,
    // Dates are date-only in the content model; parsed as UTC so the feed's
    // pubDate does not drift with the build machine's timezone.
    items: postsByDate.map((post) => ({
      title: t(`blog.posts.${post.slug}.title`),
      description: t(`blog.posts.${post.slug}.lead`),
      pubDate: new Date(`${post.date}T00:00:00Z`),
      link: localizedPath(lang, `/blog/${post.slug}`),
      categories: post.tags.map((tag) => t(`blog.tags.${tag}`)),
    })),
    customData: `<language>${bcp47[lang].toLowerCase()}</language>`,
  });
}
