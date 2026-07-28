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

/** Labels for `note` callouts, so an aside still reads as an aside in markdown. */
const noteLabels: Record<string, string> = {
  tip: 'Tip',
  info: 'Note',
  warning: 'Warning',
  security: 'Security',
};

/** Render one block, or null if the shape is unknown (see the pin test). */
function blockToMarkdown(block: AnyBlock, lang: Lang): string | null {
  const inline = (html: string) => inlineToMarkdown(html, lang);

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
    const label = noteLabels[block.note.variant ?? 'tip'] ?? noteLabels.tip;
    const heading = block.note.title ? `${label}: ${inline(block.note.title)}` : label;
    return `> **${heading}**\n>\n> ${inline(block.note.body)}`;
  }

  // Screenshots carry nothing an LLM can read, and their resolved paths differ
  // per locale, so the alt text is the content that travels.
  if ('figure' in block) return `(Screenshot: ${inline(block.figure.alt)})`;
  if ('gallery' in block) {
    return block.gallery.images
      .map((image) => `(Screenshot: ${inline(image.alt)})`)
      .join('\n\n');
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
export function blocksToMarkdown(blocks: AnyBlock[], lang: Lang = defaultLang): string {
  return blocks
    .map((block) => blockToMarkdown(block, lang))
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
  /** One-line summary, rendered as the leading blockquote. */
  description?: string;
  /** Absolute URL of the human page this file mirrors. */
  url: string;
  /** Effective / last-updated date, when the page states one. */
  updated?: string;
  body: string;
}

/**
 * Wrap a rendered body in the envelope every markdown twin shares: an H1, the
 * summary, and a pointer back to the canonical page so a citation resolves to
 * something a person can open.
 */
export function mdDocument({
  title,
  description,
  url,
  updated,
  body,
}: MdDocument): string {
  const parts = [`# ${title}`];
  if (description) parts.push(`> ${description}`);
  parts.push(`Source: ${url}`);
  if (updated) parts.push(`Last updated: ${updated}`);
  if (body.trim()) parts.push(body.trim());
  return `${parts.join('\n\n')}\n`;
}
