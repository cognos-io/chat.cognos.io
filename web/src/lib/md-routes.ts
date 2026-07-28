import { COMPANY, CONTACT_EMAILS } from '../config';
import { type Lang, bcp47 } from '../i18n/config';
import { type Translator, useTranslations } from '../i18n/ui';
import { authors, formatDate, postBySlug, postsByDate } from './blog';
import { type DocsSection, docGroups, docSlugs } from './docs';
import type { LegalSection } from './legal';
import {
  type AnyBlock,
  absoluteUrl,
  blocksToMarkdown,
  inlineToMarkdown,
  mdDocument,
  mdSection,
} from './markdown';
import { resolveMedia } from './media';

// The map of every markdown twin: one entry per page, rendered per locale by
// `src/pages/[...mdpath].md.ts` and indexed by `/llms.txt`.
//
// Pages whose copy is already declarative (legal, docs, blog) render through
// `blocksToMarkdown` and need nothing here beyond their catalogue key. The
// homepage, /about, /business and /contact each shape their own catalogue keys,
// so they carry a small hand-written body - the copy still comes from the
// catalogues, so a translation lands in the markdown twin at the same time it
// lands on the page.
//
// Adding a page? Add a route here. `scripts/check-llms.mjs` fails the build if a
// docs slug or blog post has no markdown twin.

/** Which `llms.txt` section a route is listed under. */
export type MdGroup = 'main' | 'docs' | 'legal' | 'blog';

export interface MdRoute {
  /** Locale-independent page path: '/', '/terms', '/docs/account-key'. */
  path: string;
  group: MdGroup;
  /** H1 and `llms.txt` link text. */
  title(t: Translator): string;
  /** Front-matter description and `llms.txt` link note. */
  description(t: Translator): string;
  /** Effective or last-updated date, when the page states one. */
  updated?(t: Translator): string | undefined;
  /** Page-kind-specific front matter (a post's author, an article's reading time). */
  extra?(t: Translator, lang: Lang): Record<string, string | undefined>;
  body(t: Translator, lang: Lang): string;
}

/**
 * `useTranslations` returns the key itself for a missing string, which keeps a
 * half-translated page readable. In markdown that would be a leaked key, so
 * optional fields resolve through here instead.
 */
function maybe(t: Translator, key: string): string | undefined {
  const value = t(key);
  return value === key ? undefined : value;
}

/** Render blocks the way the page does, localised images included. */
function blocks(list: AnyBlock[], lang: Lang): string {
  return blocksToMarkdown(list, { lang, resolveImage: resolveMedia });
}

/** One trusted inline-HTML string from the catalogues, as markdown. */
function inline(html: string, lang: Lang): string {
  return inlineToMarkdown(html, lang);
}

/** Join the parts of a body, dropping the empty ones. */
function joinParts(parts: (string | undefined)[]): string {
  return parts
    .filter((part): part is string => !!part && part.trim() !== '')
    .join('\n\n');
}

/** A bullet list from trusted inline-HTML strings. */
function bullets(items: string[], lang: Lang): string {
  return items.map((item) => `- ${inline(item, lang)}`).join('\n');
}

/** A bullet list of titled items, as `- **title**: body`. */
function titledBullets(items: { title: string; body: string }[], lang: Lang): string {
  return items
    .map((item) => `- **${inline(item.title, lang)}**: ${inline(item.body, lang)}`)
    .join('\n');
}

/**
 * `{ heading, blocks }` sections as `## heading` (or `## 1. heading` for the
 * legal pages, whose sections are numbered on the page and cross-referenced by
 * number in the copy).
 */
function sections(
  list: (DocsSection | LegalSection)[],
  lang: Lang,
  { numbered = false }: { numbered?: boolean } = {},
): string {
  return list
    .map((section, index) => {
      const heading = numbered
        ? `${index + 1}. ${inline(section.heading, lang)}`
        : inline(section.heading, lang);
      return mdSection(2, heading, blocks(section.blocks, lang));
    })
    .filter((part) => part !== '')
    .join('\n\n');
}

// -- the five legal pages ----------------------------------------------------
// All share `LegalPage.astro`'s shape, so one factory covers them.

const legalPages = ['privacy', 'terms', 'refund', 'subprocessors', 'security'] as const;

function legalRoute(page: (typeof legalPages)[number]): MdRoute {
  const base = `pages.${page}`;
  return {
    path: `/${page}`,
    group: 'legal',
    title: (t) => t(`${base}.title`),
    description: (t) => t(`${base}.metaDescription`),
    updated: (t) => maybe(t, `${base}.effectiveDate`),
    body: (t, lang) => {
      const facts = t.raw<{ label: string; value: string }[]>(`${base}.facts`) ?? [];
      return joinParts([
        inline(t(`${base}.lead`), lang),
        facts
          .map((f) => `- **${inline(f.label, lang)}**: ${inline(f.value, lang)}`)
          .join('\n'),
        blocks(t.raw<AnyBlock[]>(`${base}.intro`) ?? [], lang),
        sections(t.raw<LegalSection[]>(`${base}.sections`) ?? [], lang, {
          numbered: true,
        }),
      ]);
    },
  };
}

// -- documentation -----------------------------------------------------------

function docRoute(slug: string): MdRoute {
  const base = `docs.pages.${slug}`;
  return {
    path: `/docs/${slug}`,
    group: 'docs',
    title: (t) => t(`${base}.title`),
    description: (t) => t(`${base}.metaDescription`),
    updated: (t) => maybe(t, `${base}.updated`),
    extra: (t) => ({ reading_time: maybe(t, `${base}.time`) }),
    body: (t, lang) => {
      const needs = t.raw<string[]>(`${base}.needs`) ?? [];
      const related = t.raw<string[]>(`${base}.related`) ?? [];
      return joinParts([
        inline(t(`${base}.lead`), lang),
        mdSection(2, t('docs.meta.needLabel'), bullets(needs, lang)),
        sections(t.raw<DocsSection[]>(`${base}.sections`) ?? [], lang),
        mdSection(
          2,
          t('docs.meta.relatedLabel'),
          related
            .map(
              (rel) =>
                `- [${inline(t(`docs.pages.${rel}.navTitle`), lang)}](${absoluteUrl(
                  `/docs/${rel}`,
                  lang,
                )}): ${inline(t(`docs.pages.${rel}.lead`), lang)}`,
            )
            .join('\n'),
        ),
      ]);
    },
  };
}

const docsIndexRoute: MdRoute = {
  path: '/docs',
  group: 'docs',
  title: (t) => t('docs.home.title'),
  description: (t) => t('docs.home.metaDescription'),
  body: (t, lang) =>
    joinParts([
      inline(t('docs.home.lead'), lang),
      sections(t.raw<DocsSection[]>('docs.home.sections') ?? [], lang),
      // The full guided path, in sidebar order. An agent that reads only this
      // file still learns every article that exists and what each covers.
      ...docGroups.map((group) =>
        mdSection(
          2,
          inline(t(`docs.nav.${group.id}`), lang),
          group.pages
            .map(
              (slug) =>
                `- [${inline(t(`docs.pages.${slug}.navTitle`), lang)}](${absoluteUrl(
                  `/docs/${slug}`,
                  lang,
                )}): ${inline(t(`docs.pages.${slug}.lead`), lang)}`,
            )
            .join('\n'),
        ),
      ),
    ]),
};

// -- blog --------------------------------------------------------------------

function postRoute(slug: string): MdRoute {
  const base = `blog.posts.${slug}`;
  const post = postBySlug(slug);
  return {
    path: `/blog/${slug}`,
    group: 'blog',
    title: (t) => t(`${base}.title`),
    description: (t) => t(`${base}.metaDescription`),
    updated: () => post?.date,
    extra: (t) => ({
      published: post?.date,
      author: post ? authors[post.author].name : undefined,
      reading_time: maybe(t, `${base}.time`),
      tags: post?.tags.map((tag) => t(`blog.tags.${tag}`)).join(', '),
    }),
    body: (t, lang) =>
      joinParts([
        inline(t(`${base}.lead`), lang),
        sections(t.raw<DocsSection[]>(`${base}.sections`) ?? [], lang),
      ]),
  };
}

const blogIndexRoute: MdRoute = {
  path: '/blog',
  group: 'blog',
  title: (t) => t('blog.index.title'),
  description: (t) => t('blog.index.metaDescription'),
  body: (t, lang) =>
    joinParts([
      inline(t('blog.index.lead'), lang),
      postsByDate
        .map(
          (post) =>
            `- [${inline(t(`blog.posts.${post.slug}.title`), lang)}](${absoluteUrl(
              `/blog/${post.slug}`,
              lang,
            )}) - ${formatDate(post.date, lang)}: ${inline(
              t(`blog.posts.${post.slug}.lead`),
              lang,
            )}`,
        )
        .join('\n'),
    ]),
};

// -- the four hand-shaped pages ----------------------------------------------
// Their catalogue keys are per-section rather than a block list, so each body
// names the keys it renders. Pure interface copy (buttons, form fields, the
// animated redaction demo's labels) is left out: it is chrome, not content.

const homeRoute: MdRoute = {
  path: '/',
  group: 'main',
  title: (t) =>
    [t('hero.titleBefore'), t('hero.titleEm'), t('hero.titleAfter')]
      .filter((part) => part.trim() !== '')
      .join(' '),
  description: (t) => t('meta.description'),
  body: (t, lang) => {
    const plan = (key: 'individuals' | 'business') => {
      const base = `audience.${key}`;
      const price = `**${t(`${base}.currency`)} ${t(`${base}.amount`)}** ${t(`${base}.period`)}`;
      // Only the pay-as-you-go plan carries a tagline, and only Unlimited an
      // annual price, so both resolve through `maybe`.
      return mdSection(
        3,
        inline(t(`${base}.title`), lang),
        joinParts([
          price,
          maybe(t, `${base}.tagline`) && inline(t(`${base}.tagline`), lang),
          maybe(t, `${base}.annual`) && inline(t(`${base}.annual`), lang),
          bullets(t.raw<string[]>(`${base}.items`) ?? [], lang),
        ]),
      );
    };

    return joinParts([
      inline(t('hero.lead'), lang),
      bullets(Object.values(t.raw<Record<string, string>>('hero.assure') ?? {}), lang),

      mdSection(
        2,
        inline(t('contrast.title'), lang),
        joinParts([
          inline(t('contrast.lead'), lang),
          mdSection(
            3,
            inline(t('contrast.them.title'), lang),
            bullets(t.raw<string[]>('contrast.them.items') ?? [], lang),
          ),
          mdSection(
            3,
            inline(t('contrast.us.title'), lang),
            bullets(t.raw<string[]>('contrast.us.items') ?? [], lang),
          ),
        ]),
      ),

      mdSection(
        2,
        inline(t('how.title'), lang),
        joinParts([
          inline(t('how.lead'), lang),
          titledBullets(
            t.raw<{ title: string; body: string }[]>('how.steps') ?? [],
            lang,
          ),
        ]),
      ),

      mdSection(
        2,
        inline(t('redaction.title'), lang),
        joinParts([
          inline(t('redaction.lead'), lang),
          inline(t('redaction.flow.lead'), lang),
        ]),
      ),

      mdSection(
        2,
        inline(t('features.title'), lang),
        joinParts([
          inline(t('features.lead'), lang),
          titledBullets(
            t.raw<{ title: string; body: string }[]>('features.items') ?? [],
            lang,
          ),
        ]),
      ),

      mdSection(
        2,
        `${inline(t('audience.titleLine1'), lang)} ${inline(t('audience.titleLine2'), lang)}`,
        joinParts([
          inline(t('audience.lead'), lang),
          plan('individuals'),
          plan('business'),
          inline(t('audience.vatNote'), lang),
        ]),
      ),

      mdSection(
        2,
        inline(t('security.title'), lang),
        joinParts([
          inline(t('security.lead'), lang),
          titledBullets(
            t.raw<{ title: string; body: string }[]>('security.items') ?? [],
            lang,
          ),
        ]),
      ),
    ]);
  },
};

const aboutRoute: MdRoute = {
  path: '/about',
  group: 'main',
  title: (t) => t('pages.about.title'),
  description: (t) => t('pages.about.metaDescription'),
  body: (t, lang) => {
    const base = 'pages.about';
    const milestones =
      t.raw<{ date: string; title: string; body: string }[]>(
        `${base}.milestones.items`,
      ) ?? [];
    return joinParts([
      inline(t(`${base}.lead`), lang),

      mdSection(
        2,
        inline(t(`${base}.origin.title`), lang),
        joinParts([
          ...(t.raw<string[]>(`${base}.origin.body`) ?? []).map((p) => inline(p, lang)),
          `> ${inline(t(`${base}.origin.quote`), lang)}\n>\n> ${inline(
            t(`${base}.origin.quoteAttribution`),
            lang,
          )}`,
        ]),
      ),

      mdSection(
        2,
        inline(t(`${base}.principles.title`), lang),
        titledBullets(
          t.raw<{ title: string; body: string }[]>(`${base}.principles.items`) ?? [],
          lang,
        ),
      ),

      mdSection(
        2,
        inline(t(`${base}.milestones.title`), lang),
        joinParts([
          inline(t(`${base}.milestones.lead`), lang),
          milestones
            .map(
              (item) =>
                `- **${inline(item.date, lang)}** - **${inline(item.title, lang)}**: ${inline(
                  item.body,
                  lang,
                )}`,
            )
            .join('\n'),
        ]),
      ),

      mdSection(
        2,
        inline(t(`${base}.team.title`), lang),
        joinParts([
          inline(t(`${base}.team.lead`), lang),
          titledBullets(
            t.raw<{ title: string; body: string }[]>(`${base}.team.items`) ?? [],
            lang,
          ),
        ]),
      ),
    ]);
  },
};

const businessRoute: MdRoute = {
  path: '/business',
  group: 'main',
  title: (t) => t('pages.business.title'),
  description: (t) => t('pages.business.metaDescription'),
  body: (t, lang) => {
    const base = 'pages.business';
    return joinParts([
      inline(t(`${base}.lead`), lang),

      mdSection(
        2,
        inline(t(`${base}.who.title`), lang),
        joinParts([
          inline(t(`${base}.who.lead`), lang),
          titledBullets(
            t.raw<{ title: string; body: string }[]>(`${base}.who.items`) ?? [],
            lang,
          ),
        ]),
      ),

      mdSection(
        2,
        inline(t(`${base}.why.title`), lang),
        joinParts([
          ...(t.raw<string[]>(`${base}.why.body`) ?? []).map((p) => inline(p, lang)),
          bullets(t.raw<string[]>(`${base}.why.points`) ?? [], lang),
        ]),
      ),

      mdSection(
        2,
        inline(t(`${base}.pricing.title`), lang),
        inline(t(`${base}.pricing.body`), lang),
      ),

      mdSection(
        2,
        inline(t(`${base}.team.title`), lang),
        joinParts([
          inline(t(`${base}.team.lead`), lang),
          bullets(t.raw<string[]>(`${base}.team.points`) ?? [], lang),
          maybe(t, `${base}.team.footnote`) && inline(t(`${base}.team.footnote`), lang),
        ]),
      ),
    ]);
  },
};

const contactRoute: MdRoute = {
  path: '/contact',
  group: 'main',
  title: (t) => t('pages.contact.title'),
  description: (t) => t('pages.contact.metaDescription'),
  body: (t, lang) => {
    const base = 'pages.contact';
    const channels = t.raw<{ title: string; body: string }[]>(`${base}.channels`) ?? [];
    // The shared inbox heads the same list the channels are in, so it reads as
    // one list rather than two abutting ones.
    const inbox = `- **${CONTACT_EMAILS.support}**${
      maybe(t, `${base}.pgp`) ? ` (${inline(t(`${base}.pgp`), lang)})` : ''
    }`;
    return joinParts([
      inline(t(`${base}.lead`), lang),
      [inbox, titledBullets(channels, lang)].filter((part) => part !== '').join('\n'),
      mdSection(
        2,
        inline(t(`${base}.location.title`), lang),
        inline(t(`${base}.location.body`), lang),
      ),
      mdSection(
        2,
        inline(t(`${base}.hours.title`), lang),
        inline(t(`${base}.hours.body`), lang),
      ),
      mdSection(
        2,
        inline(t(`${base}.imprint.title`), lang),
        joinParts([
          [COMPANY.legalName, ...COMPANY.addressLines].join('  \n'),
          `${inline(t(`${base}.imprint.uidLabel`), lang)}: ${COMPANY.uid}`,
          COMPANY.registerUrl,
        ]),
      ),
    ]);
  },
};

/**
 * Every markdown route, in the order they are listed in `llms.txt`: what Cognos
 * is first, then the documentation, then the legal pages, then the blog.
 */
export const mdRoutes: MdRoute[] = [
  homeRoute,
  aboutRoute,
  businessRoute,
  contactRoute,
  docsIndexRoute,
  ...docSlugs.map(docRoute),
  ...legalPages.map(legalRoute),
  blogIndexRoute,
  ...postsByDate.map((post) => postRoute(post.slug)),
];

/**
 * The `mdpath` param a route is served at: '/' becomes 'index', so the homepage
 * twin is `/index.md`. Prefixed locales carry their prefix ('de/terms').
 */
export function mdPathParam(route: MdRoute, lang: Lang): string {
  const path = route.path === '/' ? '/index' : route.path;
  const prefixed = lang === 'en' ? path : `/${lang}${path}`;
  return prefixed.slice(1);
}

const routesByParam = new Map<string, { route: MdRoute; lang: Lang }>();

/** Look up a route by the `mdpath` the endpoint was called with. */
export function mdRouteByParam(
  param: string,
): { route: MdRoute; lang: Lang } | undefined {
  return routesByParam.get(param);
}

/** Render a route in one locale as a complete markdown document. */
export function renderMdRoute(route: MdRoute, lang: Lang): string {
  const t = useTranslations(lang);
  return mdDocument({
    title: route.title(t),
    description: route.description(t),
    url: absoluteUrl(route.path, lang),
    locale: bcp47[lang],
    updated: route.updated?.(t),
    extra: route.extra?.(t, lang),
    body: route.body(t, lang),
  });
}

// Built once at module load, and consumed by both the endpoint's
// `getStaticPaths` and its `GET`.
export const mdPaths: {
  params: { mdpath: string };
  props: { path: string; lang: Lang };
}[] = [];
for (const lang of Object.keys(bcp47) as Lang[]) {
  for (const route of mdRoutes) {
    const param = mdPathParam(route, lang);
    routesByParam.set(param, { route, lang });
    mdPaths.push({ params: { mdpath: param }, props: { path: route.path, lang } });
  }
}
