// Pure `<cog-doc>` block parser. See
// docs/business_processes/document-generation.md. No Angular imports — this
// runs on every streamed delta repaint
// as well as on reload, so the hot "no sentinel" path stays a single O(n)
// scan and the parser never throws (fail-open by construction, spec).
import { RenderOptions } from '../document.types';
import {
  COG_DOC_MAX_SOURCE_BYTES,
  CogDocSpec,
  MessageSegment,
  cogDocSpecSchema,
} from './cog-doc.types';

const OPENING_TAG = '<cog-doc';
const textEncoder = new TextEncoder();

// Opening sentinel: start of content or a newline, up to 3 leading spaces
// (the CommonMark indented-code-block threshold — 4+ spaces is a code
// block and must NOT match), then the literal tag name followed by
// whitespace or the tag's closing `>` (rejects "<cog-document>" etc).
const OPEN_SENTINEL_RE = /(^|\n)( {0,3})<cog-doc(?=[\s>])/g;

// Closing sentinel: a line (only spaces/tabs before and after) consisting of
// `</cog-doc>`. Applied to the *body* text with no fenced-code awareness —
// see the pinned test for the resulting v1 quirk.
const CLOSE_SENTINEL_RE = /^[ \t]*<\/cog-doc>[ \t]*$/m;

// spec: single-quoted attribute value only (models receive the exact
// contract in the system prompt). A literal `'` inside the JSON would
// truncate the match early — an accepted limitation, not our problem to
// paper over with a smarter scanner.
const SPEC_ATTR_RE = /\bspec='([^']*)'/;

const isBlank = (text: string): boolean => text.trim() === '';

/** Strips exactly one leading and one trailing newline, per spec. */
const stripOuterNewline = (text: string): string => {
  let out = text;
  if (out.startsWith('\n')) {
    out = out.slice(1);
  }
  if (out.endsWith('\n')) {
    out = out.slice(0, -1);
  }
  return out;
};

const parseSpecAttr = (attrsRaw: string): CogDocSpec | null => {
  const match = SPEC_ATTR_RE.exec(attrsRaw);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    const result = cogDocSpecSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

/**
 * segmentMessageContent splits assistant message content into ordered
 * markdown / document segments. Total function — never throws. `streaming`
 * controls how an unterminated block at end-of-content is treated: mid-
 * stream it becomes an in-progress document segment; once streaming has
 * finished an unterminated block fails open to plain markdown, so nothing the
 * model wrote is ever hidden. See docs/business_processes/document-generation.md.
 */
export const segmentMessageContent = (
  content: string | null | undefined,
  opts: { streaming: boolean },
): MessageSegment[] => {
  const original = content ?? '';

  // Hot path: this runs on every streamed delta repaint, so the overwhelmingly
  // common "plain text, no document block" case must stay a single scan.
  if (original.indexOf(OPENING_TAG) === -1) {
    return isBlank(original) ? [] : [{ kind: 'markdown', text: original }];
  }

  // CRLF sources (pasted content, some providers) must not defeat the
  // line-start sentinel matching below; normalise once up front.
  const text = original.replace(/\r\n?/g, '\n');

  const segments: MessageSegment[] = [];
  const pushMarkdown = (chunk: string): void => {
    if (!isBlank(chunk)) {
      segments.push({ kind: 'markdown', text: chunk });
    }
  };

  let cursor = 0;

  for (;;) {
    OPEN_SENTINEL_RE.lastIndex = cursor;
    const openMatch = OPEN_SENTINEL_RE.exec(text);
    if (!openMatch) {
      pushMarkdown(text.slice(cursor));
      break;
    }

    const sentinelStart = openMatch.index + openMatch[1].length;
    const tagNameStart = sentinelStart + openMatch[2].length;
    pushMarkdown(text.slice(cursor, sentinelStart));

    const tagCloseIdx = text.indexOf('>', tagNameStart);
    if (tagCloseIdx === -1) {
      // Opening tag itself is still incomplete (attributes may still be
      // arriving mid-stream).
      if (opts.streaming) {
        segments.push({
          kind: 'document',
          block: {
            state: 'streaming',
            spec: null,
            body: '',
            raw: text.slice(sentinelStart),
          },
        });
      } else {
        pushMarkdown(text.slice(sentinelStart));
      }
      break;
    }

    const attrsRaw = text.slice(tagNameStart + OPENING_TAG.length, tagCloseIdx);
    const openTagEnd = tagCloseIdx + 1;
    const spec = parseSpecAttr(attrsRaw);
    const remainder = text.slice(openTagEnd);
    const closeMatch = CLOSE_SENTINEL_RE.exec(remainder);

    if (!closeMatch) {
      if (opts.streaming) {
        segments.push({
          kind: 'document',
          block: {
            state: 'streaming',
            spec,
            body: stripOuterNewline(remainder),
            raw: text.slice(sentinelStart),
          },
        });
      } else {
        // Truncated stream (stop / max_output_tokens): fail open. The raw
        // fragment starts at the sentinel so the tag line stays visible.
        pushMarkdown(text.slice(sentinelStart));
      }
      break;
    }

    const closeStartAbs = openTagEnd + closeMatch.index;
    const closeEndAbs = closeStartAbs + closeMatch[0].length;
    const body = stripOuterNewline(text.slice(openTagEnd, closeStartAbs));
    const blockRaw = text.slice(sentinelStart, closeEndAbs);

    // Measure once per candidate block, not per character (spec).
    const byteLength = textEncoder.encode(blockRaw).length;
    const state =
      spec !== null && byteLength <= COG_DOC_MAX_SOURCE_BYTES ? 'ready' : 'invalid';

    segments.push({
      kind: 'document',
      block: { state, spec, body, raw: blockRaw },
    });

    cursor = closeEndAbs;
  }

  return segments;
};

/**
 * filenameBaseFromSpec picks the un-sanitised filename base: explicit
 * filename → title → first `# ` heading in the body → null (caller supplies
 * a localised fallback via the existing `documentFilename()`, spec).
 */
export const filenameBaseFromSpec = (
  spec: CogDocSpec | null,
  body: string,
): string | null => {
  const filename = spec?.filename?.trim();
  if (filename) {
    return filename;
  }
  const title = spec?.title?.trim();
  if (title) {
    return title;
  }
  const headingMatch = /^# +(.+)$/m.exec(body);
  const heading = headingMatch?.[1]?.trim();
  if (heading) {
    return heading;
  }
  return null;
};

/** renderOptionsFromSpec maps a parsed spec onto the renderer-facing options. */
export const renderOptionsFromSpec = (spec: CogDocSpec | null): RenderOptions => {
  if (!spec) {
    return {};
  }
  const options: RenderOptions = {};
  if (spec.title) {
    options.title = spec.title;
  }
  if (spec.lang) {
    options.lang = spec.lang;
  }
  if (spec.page?.size || spec.page?.orientation) {
    options.page = {
      size: spec.page.size ?? 'A4',
      orientation: spec.page.orientation ?? 'portrait',
    };
  }
  if (spec.header) {
    options.header = spec.header;
  }
  if (spec.footer) {
    options.footer = { pageNumbers: spec.footer.pageNumbers ?? false };
  }
  return options;
};
