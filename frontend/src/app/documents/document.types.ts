// Shared, framework-free contract for the documents module (spec
// docs/specs/document-generation.md §7). No Angular imports allowed here —
// this module runs inside the render worker as well as the main thread.
import { SheetWarning } from './sheets/formula-validator';

export type DocFormat = 'docx' | 'pdf' | 'markdown' | 'xlsx';

export interface DocIR {
  blocks: DocBlock[];
}

export type DocBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: DocInline[] }
  | { type: 'paragraph'; inlines: DocInline[] }
  | { type: 'blockquote'; blocks: DocBlock[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'list'; ordered: boolean; items: DocListItem[] }
  | { type: 'table'; header: DocCell[]; rows: DocCell[][]; align: (DocAlign | null)[] }
  | { type: 'hr' }
  | { type: 'image'; imageRef: number; caption?: string };

export interface DocListItem {
  blocks: DocBlock[];
  task?: boolean;
  checked?: boolean;
}

export interface DocCell {
  inlines: DocInline[];
}

export type DocAlign = 'left' | 'center' | 'right';

export type DocInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; inlines: DocInline[] }
  | { type: 'em'; inlines: DocInline[] }
  | { type: 'code'; text: string }
  | { type: 'del'; inlines: DocInline[] }
  | { type: 'break' }
  | { type: 'link'; href: string; inlines: DocInline[] };

export interface DocImage {
  bytes: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
}

export interface RenderOptions {
  title?: string;
  lang?: string;
  page?: { size: 'A4'; orientation: 'portrait' | 'landscape' };
  header?: string;
  footer?: { pageNumbers: boolean };
}

export interface DocumentRenderer {
  render(doc: DocIR, images: DocImage[], opts: RenderOptions): Promise<Uint8Array>;
}

export type DocumentErrorCode =
  | 'unsupported_format'
  | 'empty_document'
  | 'render_failed'
  | 'source_too_large';

export class DocumentRenderError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentRenderError';
  }
}

/**
 * Render worker protocol (spec docs/specs/document-generation.md §7), mirroring
 * the attachment worker's request/event shape (attachment.types.ts). Markdown
 * "rendering" is a pass-through done on the main thread — only docx/pdf/xlsx
 * need the worker (and their lazily-loaded heavy libraries).
 *
 * xlsx is a separate request variant (`render-sheet`), not a third `format`
 * value on `render`: its body is sheet-spec JSON, not markdown, and it has no
 * DocIR/images to carry (README "Adding a format": "Non-DocIR formats (XLSX)
 * get their own source type and renderer"). Keeping `render`'s `format`
 * literal to `'docx' | 'pdf'` means DocumentWorkerClient.render() keeps its
 * existing signature and callers untouched.
 */
export type DocumentWorkerRequest =
  | {
      type: 'render';
      requestId: string;
      format: 'docx' | 'pdf';
      markdown: string;
      images: DocImage[];
      options: RenderOptions;
    }
  | {
      type: 'render-sheet';
      requestId: string;
      body: string;
      options: RenderOptions;
    }
  | {
      type: 'cancel';
      requestId: string;
    };

export interface DocumentWorkerErrorPayload {
  code: DocumentErrorCode;
  message: string;
}

// `warnings` is only ever populated for a `render-sheet` response (the
// formula validator's advisory findings, spec §5.3); docx/pdf renders never
// set it, so existing `{ bytes }`-only callers are unaffected.
export type DocumentWorkerEvent =
  | {
      type: 'rendered';
      requestId: string;
      bytes: Uint8Array;
      warnings?: SheetWarning[];
    }
  | { type: 'failed'; requestId: string; error: DocumentWorkerErrorPayload };
