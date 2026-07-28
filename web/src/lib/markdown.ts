import { type Lang, defaultLang, localizedPath } from '../i18n/config.ts';
import type { DocsBlock } from './docs.ts';
import type { LegalBlock } from './legal.ts';

// Markdown twins of the marketing pages, served at `/<path>.md` and indexed by
// `/llms.txt` (https://llmstxt.org/). An agent that fetches `/terms.md` gets the
// same words as `/terms` with none of the chrome.
//
// The catalogues already describe content declaratively - `{p}`, `{ul}`,
// `{steps}`, `{table}` and friends - so this file is a second renderer beside
// `LegalBlock.astro` and `DocsBlock.astro`, not a second copy of the copy.
//
// Two invariants hold everywhere:
//
//   1. No HTML tag survives. Inline `<b>`/`<a>`/`<code>`/`<br>` become markdown;
//      anything else is stripped to its text.
//   2. Every internal link becomes an absolute `https://cognos.io/…` URL. A
//      bare `.md` file has no base URL, so a relative href would dangle.
//
// In-document links point at the *human* page (`/docs/account-key`), not its
// markdown twin, so an agent quoting us cites a URL a person can open. Only
// `llms.txt` links to the `.md` files, which is what the spec is for.

/** Canonical origin. Links in markdown output must be absolute. */
export const siteOrigin = 'https://cognos.io';

/** The absolute, locale-aware URL of a page path (`/terms` → `https://…/de/terms`). */
export function absoluteUrl(path: string, lang: Lang = defaultLang): string {
  return `${siteOrigin}${localizedPath(lang, path)}`;
}

/** The absolute URL of a page's markdown twin (`/terms` → `https://…/terms.md`). */
export function markdownUrl(path: string, lang: Lang = defaultLang): string {
  const clean = path === '/' ? '/index' : path;
  return `${absoluteUrl(clean, lang)}.md`;
}

// Only the entities the six locale files actually use, plus the handful a
// translator is most likely to reach for next. An unknown entity is left as
// authored rather than mangled.
const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lsaquo: '‹',
  rsaquo: '›',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
      return entities[name] ?? match;
    },
  );
}

// Prose is authored for HTML, so a literal `*` or `_` in a sentence means
// itself. Escape the characters that would otherwise be read as markup once the
// same string is served as markdown.
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

/** A link target as it should appear in markdown output, or null to drop the link. */
function resolveHref(href: string, lang: Lang): string | null {
  // An in-page anchor points into a document the reader already holds, and the
  // markdown twin has no matching ids, so the link is dropped to its text.
  if (href.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return href;
  if (href.startsWith('/')) return absoluteUrl(href, lang);
  return href;
}

/**
 * Convert one trusted inline-HTML string from the catalogues into markdown.
 * Mirrors what `set:html` renders in the Astro components, minus the tags.
 */
export function inlineToMarkdown(html: string, lang: Lang = defaultLang): string {
  let out = '';
  // Text inside <code> is literal, so markdown escaping is suppressed there.
  let inCode = false;
  // Set while inside an <a>: where the link points, and the text collected so
  // far, so `[text](href)` can be emitted at the closing tag.
  let link: { href: string | null; text: string } | null = null;

  const emit = (text: string) => {
    if (link) link.text += text;
    else out += text;
  };

  for (const token of html.split(/(<[^>]*>)/)) {
    if (token === '') continue;

    if (!token.startsWith('<')) {
      const text = decodeEntities(token);
      emit(inCode ? text : escapeMarkdown(text));
      continue;
    }

    const tag = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(token);
    if (!tag) continue;
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();

    switch (name) {
      case 'b':
      case 'strong':
        emit('**');
        break;
      case 'i':
      case 'em':
        emit('*');
        break;
      case 'code':
        inCode = !closing;
        emit('`');
        break;
      case 'br':
        emit('\n');
        break;
      case 'a':
        if (closing) {
          if (link) {
            out += link.href ? `[${link.text}](${link.href})` : link.text;
            link = null;
          }
        } else {
          const href = /href\s*=\s*"([^"]*)"/.exec(token);
          link = { href: href ? resolveHref(href[1], lang) : null, text: '' };
        }
        break;
      // Any other tag is presentational; keep its text, drop the tag.
      default:
        break;
    }
  }

  // An unclosed <a> still owes its text to the output.
  if (link) out += link.href ? `[${link.text}](${link.href})` : link.text;

  return out;
}

/** Every block shape the two renderers accept. */
export type AnyBlock = LegalBlock | DocsBlock;

// Callout variants map onto GitHub's alert syntax. It is a recognised markdown
// convention rather than prose, so the severity of a `security` note survives
// into the markdown twin without inventing an English label that our i18n rules
// would (rightly) require translating into all six locales.
const noteAlerts: Record<string, string> = {
  tip: 'TIP',
  info: 'NOTE',
  warning: 'WARNING',
  security: 'CAUTION',
};

/** How a block renderer turns an image `src` into a URL, or null to omit it. */
export type ImageResolver = (src: string, lang: Lang) => string | null;

export interface BlockOptions {
  lang?: Lang;
  /**
   * Resolves figure and gallery images the way the page does - localised
   * capture if one exists, and nothing at all when the file is missing. Without
   * a resolver, images are omitted entirely.
   */
  resolveImage?: ImageResolver;
}

/** Render one block, or null if the shape is unknown (see the pin test). */
function blockToMarkdown(
  block: AnyBlock,
  lang: Lang,
  resolveImage?: ImageResolver,
): string | null {
  const inline = (html: string) => inlineToMarkdown(html, lang);

  // Mirrors `DocsBlock.astro`: an image appears only once its file exists, so a
  // page authored ahead of its screenshots stays clean in markdown too.
  const image = (src: string, alt: string): string | null => {
    const resolved = resolveImage?.(src, lang);
    if (!resolved) return null;
    const url = resolved.startsWith('/') ? `${siteOrigin}${resolved}` : resolved;
    return `![${inline(alt)}](${url})`;
  };

  if ('p' in block) return inline(block.p);
  if ('h3' in block) return `### ${inline(block.h3)}`;
  if ('ul' in block) return block.ul.map((item) => `- ${inline(item)}`).join('\n');

  if ('steps' in block) {
    return block.steps
      .map((step, index) => {
        const head = `${index + 1}. **${inline(step.title)}**`;
        return step.body ? `${head}\n   ${inline(step.body)}` : head;
      })
      .join('\n');
  }

  if ('note' in block) {
    const alert = noteAlerts[block.note.variant ?? 'tip'] ?? noteAlerts.tip;
    const lines = [`> [!${alert}]`];
    if (block.note.title) lines.push(`> **${inline(block.note.title)}**`, '>');
    lines.push(`> ${inline(block.note.body)}`);
    return lines.join('\n');
  }

  if ('figure' in block) {
    const rendered = image(block.figure.src, block.figure.alt);
    if (!rendered) return null;
    return block.figure.caption
      ? `${rendered}\n\n${inline(block.figure.caption)}`
      : rendered;
  }

  if ('gallery' in block) {
    const rendered = block.gallery.images
      .map((item) => image(item.src, item.alt))
      .filter((part): part is string => part !== null);
    return rendered.length > 0 ? rendered.join('\n\n') : null;
  }

  if ('table' in block) {
    const cell = (value: string) => inline(value).replace(/\|/g, '\\|');
    const head = `| ${block.table.head.map(cell).join(' | ')} |`;
    const rule = `| ${block.table.head.map(() => '---').join(' | ')} |`;
    const rows = block.table.rows.map((row) => `| ${row.map(cell).join(' | ')} |`);
    return [head, rule, ...rows].join('\n');
  }

  if ('cards' in block) {
    return block.cards
      .map((card) => {
        const href = card.to.startsWith('/') ? `${siteOrigin}${card.to}` : card.to;
        return `- [${inline(card.title)}](${href}): ${inline(card.body)}`;
      })
      .join('\n');
  }

  return null;
}

/** Render a list of blocks as markdown paragraphs. */
export function blocksToMarkdown(
  blocks: AnyBlock[],
  options: BlockOptions = {},
): string {
  const { lang = defaultLang, resolveImage } = options;
  return blocks
    .map((block) => blockToMarkdown(block, lang, resolveImage))
    .filter((part): part is string => part !== null && part !== '')
    .join('\n\n');
}

/** A markdown heading of `level` followed by its body, or '' if the body is empty. */
export function mdSection(level: number, heading: string, body: string): string {
  if (!body.trim()) return '';
  return `${'#'.repeat(level)} ${heading}\n\n${body}`;
}

export interface MdDocument {
  title: string;
  /** One-line summary; the page's `metaDescription`. */
  description?: string;
  /** Absolute URL of the human page this file mirrors. */
  url: string;
  /** Locale of the copy, as a BCP 47 tag. */
  locale?: string;
  /** Effective / last-updated date, when the page states one. */
  updated?: string;
  /**
   * Extra front-matter fields for one kind of page (a post's `published`,
   * `author` and `tags`, an article's `reading_time`). Empty values are dropped.
   */
  extra?: Record<string, string | undefined>;
  body: string;
}

/** A YAML scalar, quoted so a colon or quote in a title cannot break the block. */
function yamlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Wrap a rendered body in the envelope every markdown twin shares: YAML front
 * matter, then an H1.
 *
 * The metadata is front matter rather than prose because the field names are
 * machine identifiers - like `user_id` in code, they stay English across all six
 * locales without becoming untranslated copy. `source` points back at the
 * canonical page, so an agent quoting us cites a URL a person can open.
 */
export function mdDocument({
  title,
  description,
  url,
  locale,
  updated,
  extra,
  body,
}: MdDocument): string {
  const front = [`title: ${yamlValue(title)}`];
  if (description) front.push(`description: ${yamlValue(description)}`);
  front.push(`source: ${yamlValue(url)}`);
  if (locale) front.push(`locale: ${yamlValue(locale)}`);
  if (updated) front.push(`updated: ${yamlValue(updated)}`);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) front.push(`${key}: ${yamlValue(value)}`);
  }

  const parts = [`---\n${front.join('\n')}\n---`, `# ${title}`];
  if (body.trim()) parts.push(body.trim());
  return `${parts.join('\n\n')}\n`;
}
