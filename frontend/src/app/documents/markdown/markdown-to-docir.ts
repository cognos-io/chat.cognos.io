// Pure markdown -> DocIR mapper. See
// docs/business_processes/document-generation.md. Uses a plain marked Lexer —
// marked-alert/marked-footnote/katex
// extensions are deliberately NOT registered, so their syntaxes degrade to
// literal text rather than being interpreted. No Angular imports; this
// module runs inside the render worker as well as the main thread.
import { Lexer, Token, Tokens } from 'marked';

import { sanitizeDocumentHref } from '../document-source';
import {
  DocAlign,
  DocBlock,
  DocCell,
  DocIR,
  DocInline,
  DocListItem,
} from '../document.types';

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const HTML_ENTITY_PATTERN = /&amp;|&lt;|&gt;|&quot;|&#39;/g;

// marked leaves these five entities encoded in token.text; decode them so the
// rendered document shows the real characters instead of entity codes.
const decodeEntities = (text: string): string =>
  text.replace(HTML_ENTITY_PATTERN, (match) => HTML_ENTITIES[match]);

const stripTags = (text: string): string => text.replace(/<[^>]*>/g, '').trim();

const HEADING_LEVELS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6]);

export const markdownToDocIR = (markdown: string): DocIR => {
  let tokens: Token[];
  try {
    tokens = new Lexer({ gfm: true }).lex(markdown ?? '');
  } catch {
    return { blocks: [] };
  }
  return { blocks: mapBlocks(tokens) };
};

const mapBlocks = (tokens: Token[]): DocBlock[] => {
  const blocks: DocBlock[] = [];
  for (const token of tokens) {
    const block = mapBlock(token);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
};

const mapBlock = (token: Token): DocBlock | null => {
  try {
    switch (token.type) {
      case 'heading': {
        const depth = (token as Tokens.Heading).depth;
        const level = (HEADING_LEVELS.has(depth) ? depth : 1) as 1 | 2 | 3 | 4 | 5 | 6;
        return { type: 'heading', level, inlines: mapInlines(inlineTokensOf(token)) };
      }
      case 'paragraph':
        return { type: 'paragraph', inlines: mapInlines(inlineTokensOf(token)) };
      case 'text':
        // Text token at block level: tight-list item content lexed without a
        // wrapping paragraph token.
        return { type: 'paragraph', inlines: mapInlines(inlineTokensOf(token)) };
      case 'space':
      case 'def':
        return null;
      case 'code': {
        const code = token as Tokens.Code;
        return code.lang
          ? { type: 'code', text: code.text, lang: code.lang }
          : { type: 'code', text: code.text };
      }
      case 'blockquote':
        return {
          type: 'blockquote',
          blocks: mapBlocks((token as Tokens.Blockquote).tokens ?? []),
        };
      case 'list': {
        const list = token as Tokens.List;
        return {
          type: 'list',
          ordered: list.ordered,
          items: list.items.map(mapListItem),
        };
      }
      case 'table': {
        const table = token as Tokens.Table;
        return {
          type: 'table',
          header: table.header.map(mapCell),
          rows: table.rows.map((row) => row.map(mapCell)),
          align: table.align as (DocAlign | null)[],
        };
      }
      case 'hr':
        return { type: 'hr' };
      case 'html': {
        const text = decodeEntities(stripTags((token as Tokens.HTML).text ?? ''));
        return text ? { type: 'paragraph', inlines: [{ type: 'text', text }] } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
};

const mapListItem = (item: Tokens.ListItem): DocListItem => {
  const listItem: DocListItem = { blocks: mapBlocks(item.tokens ?? []) };
  if (item.task) {
    listItem.task = true;
    listItem.checked = !!item.checked;
  }
  return listItem;
};

const mapCell = (cell: Tokens.TableCell): DocCell => ({
  inlines: mapInlines(cell.tokens ?? []),
});

// inlineTokensOf reads a block token's inline children, falling back to a
// single synthetic text token when marked hasn't populated .tokens (should
// not happen after a top-level Lexer.lex() call, but the mapper must never
// throw).
const inlineTokensOf = (token: Token): Token[] => {
  const withInlines = token as { tokens?: Token[]; text?: string };
  if (withInlines.tokens) {
    return withInlines.tokens;
  }
  const text = withInlines.text ?? '';
  return text ? [{ type: 'text', raw: text, text } as Tokens.Text] : [];
};

const mapInlines = (tokens: Token[]): DocInline[] => {
  const inlines: DocInline[] = [];
  for (const token of tokens) {
    inlines.push(...mapInlineToken(token));
  }
  return inlines;
};

const mapInlineToken = (token: Token): DocInline[] => {
  try {
    switch (token.type) {
      case 'text':
        return [
          { type: 'text', text: decodeEntities((token as Tokens.Text).text ?? '') },
        ];
      case 'escape':
        return [{ type: 'text', text: (token as Tokens.Escape).text ?? '' }];
      case 'strong':
        return [
          {
            type: 'strong',
            inlines: mapInlines((token as Tokens.Strong).tokens ?? []),
          },
        ];
      case 'em':
        return [{ type: 'em', inlines: mapInlines((token as Tokens.Em).tokens ?? []) }];
      case 'del':
        return [
          { type: 'del', inlines: mapInlines((token as Tokens.Del).tokens ?? []) },
        ];
      case 'codespan':
        return [
          { type: 'code', text: decodeEntities((token as Tokens.Codespan).text ?? '') },
        ];
      case 'br':
        return [{ type: 'break' }];
      case 'link': {
        const link = token as Tokens.Link;
        const children = mapInlines(link.tokens ?? []);
        const href = sanitizeDocumentHref(link.href);
        // Invalid href (javascript:, data:, relative, …): drop the link
        // wrapper but keep its text — the content is still shown.
        return href ? [{ type: 'link', href, inlines: children }] : children;
      }
      case 'image': {
        // Inline images are never fetched (privacy, spec Principle 4):
        // degrade to the alt text only.
        const alt = (token as Tokens.Image).text ?? '';
        return alt ? [{ type: 'text', text: decodeEntities(alt) }] : [];
      }
      case 'html': {
        const text = decodeEntities(stripTags((token as Tokens.Tag).text ?? ''));
        return text ? [{ type: 'text', text }] : [];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
};
