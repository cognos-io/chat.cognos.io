import { type Lang, bcp47 } from '../i18n/ui';

// Blog content model.
//
// Same shape as the docs (`docs.ts`): posts are described declaratively so the
// i18n catalogs carry structure - sections of blocks - rather than raw HTML,
// and every post ships in all six locales. Prose lives under `blog.posts.<slug>`
// in every locale file; everything that is *not* language-dependent (date,
// author, tags, hero image) lives here, so a translator never has to keep a
// date in sync across six files.
//
// Posts reuse the `DocsBlock` union and the `DocsBlock.astro` renderer, plus the
// `gallery` block for slideshows.

/** A post author. Personal names are never translated; the role line is. */
export interface BlogAuthor {
  /** Stable id; the role line comes from `blog.authors.<id>.role`. */
  id: string;
  /** Personal name, shown verbatim in every locale. */
  name: string;
  /** Portrait under `public/`. Rendered only once the file exists. */
  avatar?: string;
}

export const authors = {
  ewan: {
    id: 'ewan',
    name: 'Ewan Jones',
    avatar: '/blog-media/authors/ewan-jones.png',
  },
} as const satisfies Record<string, BlogAuthor>;

export type AuthorId = keyof typeof authors;

export interface BlogPost {
  /** URL slug; resolves to `blog.posts.<slug>` in the catalog. */
  slug: string;
  /** Publication date as an absolute ISO `YYYY-MM-DD`. */
  date: string;
  author: AuthorId;
  /**
   * Tag ids, labelled from `blog.tags.<id>`. Used for the card eyebrow - not a
   * browsable taxonomy (no per-tag pages until there are enough posts to need
   * them).
   */
  tags: string[];
  /** Lucide icon (PascalCase) shown on the index card behind the title. */
  icon: string;
  /**
   * Optional lead image, rendered only once the file exists under `public/`.
   * Its alt text is translated, so it lives in the catalog at
   * `blog.posts.<slug>.heroAlt` rather than here.
   */
  hero?: { src: string };
}

/**
 * Every post, newest first. Adding an entry here plus a `blog.posts.<slug>`
 * block in all six locale files is all a new article needs - the routes,
 * index, feeds and sitemap follow automatically.
 */
export const posts: BlogPost[] = [
  {
    slug: 'shared-ai-chats-are-public-web-pages',
    date: '2026-07-28',
    author: 'ewan',
    tags: ['privacy', 'industry'],
    icon: 'Globe',
    hero: { src: '/blog-media/shared-ai-chats-are-public-web-pages/hero.svg' },
  },
];

/** Posts sorted newest first, regardless of the order declared above. */
export const postsByDate: BlogPost[] = [...posts].sort((a, b) =>
  b.date.localeCompare(a.date),
);

/** Every blog slug, newest first. */
export const blogSlugs: string[] = postsByDate.map((post) => post.slug);

export function postBySlug(slug: string): BlogPost | undefined {
  return posts.find((post) => post.slug === slug);
}

/**
 * The posts published either side of `slug` in reading order (newer first), for
 * the "keep reading" pager. `prev` is the newer neighbour, matching the pager's
 * left-is-back reading direction on the index.
 */
export function postNeighbours(slug: string): {
  prev: BlogPost | null;
  next: BlogPost | null;
} {
  const index = blogSlugs.indexOf(slug);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? postsByDate[index - 1] : null,
    next: index < postsByDate.length - 1 ? postsByDate[index + 1] : null,
  };
}

/**
 * A publication date written out in the reader's language ("28 July 2026",
 * "28. Juli 2026"). Parsed as UTC so the rendered day never shifts with the
 * build machine's timezone.
 */
export function formatDate(date: string, lang: Lang): string {
  return new Intl.DateTimeFormat(bcp47[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
