// Shared, framework-free contract for the documents module (spec
// docs/specs/document-generation.md §7). No Angular imports allowed here —
// this module runs inside the render worker as well as the main thread.

export type DocFormat = 'docx' | 'pdf' | 'markdown'; // 'xlsx' reserved for Phase 3

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
