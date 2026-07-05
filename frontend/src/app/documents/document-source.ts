// Pure helpers shared by every document renderer (spec
// docs/specs/document-generation.md §5.1, §6.4). No Angular imports — this
// module runs inside the render worker as well as the main thread.
import { DocFormat } from './document.types';

const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

// eslint-disable-next-line no-control-regex -- control chars are invalid in filenames on every OS
const FORBIDDEN_FILENAME_CHARS = /[\x00-\x1f\x7f/\\<>:"|?*]/g;
const MAX_FILENAME_LENGTH = 80;

const EXTENSION_BY_FORMAT: Record<DocFormat, string> = {
  docx: '.docx',
  pdf: '.pdf',
  markdown: '.md',
  xlsx: '.xlsx',
};

const MIME_TYPE_BY_FORMAT: Record<DocFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  markdown: 'text/markdown',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * sanitizeDocumentHref returns the URL only when it parses as an absolute
 * http(s) URL, otherwise null. Documents leave the app context, so relative
 * URLs (which would resolve against nothing) are rejected alongside
 * `javascript:`, `data:` and other non-navigational schemes.
 */
export const sanitizeDocumentHref = (
  href: string | null | undefined,
): string | null => {
  if (!href) {
    return null;
  }
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // fall through
  }
  return null;
};

/**
 * documentFilename derives a filesystem-safe filename for a rendered
 * document. `fallback` is assumed already safe and is used as-is when the
 * sanitised base collapses to nothing.
 */
export const documentFilename = (
  base: string | null | undefined,
  format: DocFormat,
  fallback: string,
): string => {
  const source = base && base.trim() ? base : fallback;

  let name = source
    .replace(FORBIDDEN_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');

  if (RESERVED_WINDOWS_NAMES.has(name.toUpperCase())) {
    name = `_${name}`;
  }

  if (name.length > MAX_FILENAME_LENGTH) {
    name = name.slice(0, MAX_FILENAME_LENGTH).replace(/[\s.-]+$/g, '');
  }

  if (!name) {
    name = fallback;
  }

  return `${name}${EXTENSION_BY_FORMAT[format]}`;
};

export const documentMimeType = (format: DocFormat): string =>
  MIME_TYPE_BY_FORMAT[format];
