import { type Lang, defaultLang, localizedPath } from '../i18n/ui';

// Documentation content model + navigation tree.
//
// Like `legal.ts`, the docs are described declaratively so the i18n catalogs
// carry structure (steps, callouts, screenshots) rather than raw HTML. Inline
// `<b>`/`<a>`/`<code>` markup inside strings is rendered as trusted HTML by
// `DocsBlock.astro`. The catalog shape for a single page lives under
// `docs.pages.<slug>` in every locale file.

/** A single content block inside a docs section. */
export type DocsBlock =
  // A paragraph of prose (trusted inline HTML).
  | { p: string }
  // A sub-heading within a section.
  | { h3: string }
  // A plain bullet list.
  | { ul: string[] }
  // Numbered, titled steps — the backbone of a how-to.
  | { steps: { title: string; body?: string }[] }
  // A highlighted aside. `variant` tints it; `security` is the strongest.
  | {
      note: {
        variant?: 'tip' | 'info' | 'warning' | 'security';
        title?: string;
        body: string;
      };
    }
  // A cropped screenshot with an accessible description and optional caption.
  | { figure: { src: string; alt: string; caption?: string } }
  // A comparison / reference table.
  | { table: { head: string[]; rows: string[][] } }
  // A grid of navigational cards (used on the docs home and "related" rails).
  | { cards: { to: string; icon?: string; title: string; body: string }[] };

export interface DocsSection {
  heading: string;
  blocks: DocsBlock[];
}

/** One entry in the docs sidebar, grouped by category. */
export interface DocGroup {
  /** i18n key under `docs.nav.<id>` for the group label. */
  id: string;
  /** Lucide icon (PascalCase) shown beside the group in the sidebar. */
  icon: string;
  /** Ordered page slugs; each resolves to `docs.pages.<slug>` in the catalog. */
  pages: string[];
}

/**
 * The documentation map. Order here is the order shown in the sidebar and used
 * for "previous / next" links, so it reads as a guided path: start at the top,
 * work down. Every slug must have a matching `docs.pages.<slug>` entry in every
 * locale, and a page rendered by `src/pages/docs/[slug].astro`.
 */
export const docGroups: DocGroup[] = [
  {
    id: 'gettingStarted',
    icon: 'Rocket',
    pages: [
      'what-is-cognos',
      'create-account',
      'account-key',
      'emergency-kit',
      'signing-in',
      'unlock-and-lock',
    ],
  },
  {
    id: 'chatting',
    icon: 'MessagesSquare',
    pages: [
      'your-first-chat',
      'choosing-a-model',
      'privacy-tiers',
      'personas',
      'reasoning',
      'web-search',
      'temporary-conversations',
      'disappearing-messages',
    ],
  },
  {
    id: 'privacyTools',
    icon: 'EyeOff',
    pages: ['redaction', 'attachments', 'generating-documents', 'generating-images'],
  },
  {
    id: 'organising',
    icon: 'FolderTree',
    pages: [
      'projects',
      'bookmarks',
      'searching-conversations',
      'importing-conversations',
      'sharing-conversations',
    ],
  },
  {
    id: 'accountSecurity',
    icon: 'ShieldCheck',
    pages: [
      'multi-factor-authentication',
      'recovery-codes',
      'resetting-your-password',
      'your-privacy',
      'account-memory',
      'sessions-and-logout',
      'deleting-your-account',
    ],
  },
  {
    id: 'billing',
    icon: 'CreditCard',
    pages: ['plans-and-pricing', 'trial-credit', 'managing-your-subscription'],
  },
  {
    id: 'organisations',
    icon: 'Building2',
    pages: ['organisations-overview', 'seats-and-billing', 'organisation-projects'],
  },
];

/** Every documentation slug, in sidebar order. */
export const docSlugs: string[] = docGroups.flatMap((group) => group.pages);

/** The slug that precedes / follows `slug` in the guided path (or null at the ends). */
export function docNeighbours(slug: string): {
  prev: string | null;
  next: string | null;
} {
  const index = docSlugs.indexOf(slug);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? docSlugs[index - 1] : null,
    next: index < docSlugs.length - 1 ? docSlugs[index + 1] : null,
  };
}

/** The group a slug belongs to (for the "you are here" breadcrumb). */
export function docGroupOf(slug: string): DocGroup | undefined {
  return docGroups.find((group) => group.pages.includes(slug));
}

/**
 * Rewrite root-relative links inside a trusted HTML string to the active
 * locale, so an inline `<a href="/docs/account-key">` in prose (which is
 * authored once, in English) points a French reader at `/fr/docs/account-key`.
 * Anchors (`#…`) and external/app URLs (`https://…`, `mailto:…`) are left
 * untouched; the default locale is served unprefixed so it is a no-op there.
 */
export function localizeHtml(html: string, lang: Lang): string {
  if (lang === defaultLang) return html;
  return html.replace(
    /href="(\/[^"]*)"/g,
    (_match, path: string) => `href="${localizedPath(lang, path)}"`,
  );
}
