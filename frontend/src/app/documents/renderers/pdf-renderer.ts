// DocIR -> .pdf renderer (docs/business_processes/document-generation.md), built on
// pdfmake@0.3.11's browser bundle. pdfmake is a UMD/webpack bundle: its ESM
// named exports are unreliable (its CJS `module.exports` gets reassigned to
// the pdfmake singleton, which static CJS->ESM interop cannot see through —
// confirmed against the real package with a throwaway node smoke check), so
// every dynamic import here is read via `.default` (see pdfmake-shims.d.ts
// for the ambient types this relies on). No Angular imports; runs inside the
// render worker as well as the main thread.
import { Base64 } from 'js-base64';

import {
  DocBlock,
  DocCell,
  DocIR,
  DocImage,
  DocInline,
  DocListItem,
  DocumentRenderError,
  DocumentRenderer,
  RenderOptions,
} from '../document.types';
import {
  CODE_FONT_PDF,
  DOCUMENT_CREATOR,
  FOOTER_MARGIN_PT,
  HEADER_MARGIN_PT,
  PAGE_MARGIN_PT,
  TYPE_SCALE,
  USABLE_WIDTH_PT,
  headingStyleName,
  normalizedHeaderText,
} from './doc-styles';

// Minimal surface this renderer needs from the loaded library — a fake
// implementing just this shape is enough for specs, and is what
// `createPdf(...).getBuffer()` returns for both the real Buffer (Node/worker
// polyfill) and any array-like the fake substitutes.
export interface PdfLib {
  createPdf(docDefinition: unknown): { getBuffer(): Promise<ArrayBuffer | Uint8Array> };
}
export type PdfLoader = () => Promise<PdfLib>;

const defaultLoader: PdfLoader = async () => {
  const [pdfMakeModule, vfsModule, courierModule] = await Promise.all([
    import('pdfmake/build/pdfmake.js'),
    import('pdfmake/build/vfs_fonts.js'),
    import('pdfmake/build/standard-fonts/Courier.js'),
  ]);
  const pdfMake = pdfMakeModule.default;
  if (typeof pdfMake.addVirtualFileSystem === 'function') {
    pdfMake.addVirtualFileSystem(vfsModule.default);
  }
  // Registers the Courier standard-14 font family (+ its AFM metrics into the
  // virtual filesystem) so the Code style below can actually resolve.
  if (typeof pdfMake.addFontContainer === 'function') {
    pdfMake.addFontContainer(courierModule.default);
  }
  return pdfMake;
};

/**
 * createPdfRenderer builds a `DocumentRenderer['render']` implementation.
 * `loadLib` is injected so specs can supply a fake pdfmake-shaped object
 * (capturing the docDefinition it's called with) without ever importing the
 * real (heavy) library.
 */
export const createPdfRenderer = (
  loadLib: PdfLoader = defaultLoader,
): DocumentRenderer['render'] => {
  return async (
    doc: DocIR,
    images: DocImage[],
    opts: RenderOptions,
  ): Promise<Uint8Array> => {
    if (doc.blocks.length === 0 && images.length === 0) {
      throw new DocumentRenderError('empty_document', 'Nothing to render');
    }

    try {
      const pdfMake = await loadLib();
      const content = doc.blocks.flatMap((block) => mapBlock(block, images));
      const headerText = normalizedHeaderText(opts.header);

      const docDefinition = {
        pageSize: 'A4',
        pageOrientation: opts.page?.orientation ?? 'portrait',
        pageMargins: PAGE_MARGIN_PT,
        info: {
          title: opts.title,
          author: DOCUMENT_CREATOR,
          creator: DOCUMENT_CREATOR,
          producer: DOCUMENT_CREATOR,
        },
        // opts.lang: pdfmake's docDefinition has no document-language metadata
        // field (checked its TDocumentDefinitions typings/docs) — intentional
        // no-op here; see docx-renderer.ts for where `lang` actually applies.
        defaultStyle: { fontSize: TYPE_SCALE.Normal.pt },
        styles: buildStyles(),
        content,
        images: buildImageMap(images),
        ...(headerText
          ? {
              header: {
                text: headerText,
                style: 'Header',
                alignment: 'center',
                margin: HEADER_MARGIN_PT,
              },
            }
          : {}),
        ...(opts.footer?.pageNumbers
          ? {
              footer: (currentPage: number, pageCount: number) => ({
                text: `${currentPage} / ${pageCount}`,
                style: 'Header',
                alignment: 'center',
                margin: FOOTER_MARGIN_PT,
              }),
            }
          : {}),
      };

      const pdfDoc = pdfMake.createPdf(docDefinition);
      const buffer = await pdfDoc.getBuffer();
      return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    } catch (err) {
      if (err instanceof DocumentRenderError) {
        throw err;
      }
      throw new DocumentRenderError('render_failed', 'Failed to render pdf document');
    }
  };
};

// Default instance used by the render worker; specs use createPdfRenderer
// directly with a fake loader instead.
export const renderPdf: DocumentRenderer['render'] = createPdfRenderer();

function buildStyles(): Record<string, Record<string, unknown>> {
  return {
    Title: { fontSize: TYPE_SCALE.Title.pt, bold: true },
    Heading1: { fontSize: TYPE_SCALE.Heading1.pt, bold: true, margin: [0, 12, 0, 6] },
    Heading2: { fontSize: TYPE_SCALE.Heading2.pt, bold: true, margin: [0, 10, 0, 5] },
    Heading3: { fontSize: TYPE_SCALE.Heading3.pt, bold: true, margin: [0, 8, 0, 4] },
    Heading4: { fontSize: TYPE_SCALE.Heading4.pt, bold: true, margin: [0, 6, 0, 3] },
    Quote: { italics: true, margin: [20, 4, 20, 4] },
    code: { font: CODE_FONT_PDF, fontSize: TYPE_SCALE.Code.pt, margin: [0, 2, 0, 2] },
    link: { color: '#1a73e8', decoration: 'underline' },
    Caption: { fontSize: TYPE_SCALE.Caption.pt, color: `#${TYPE_SCALE.Caption.color}` },
    Header: { fontSize: TYPE_SCALE.Header.pt, color: `#${TYPE_SCALE.Header.color}` },
  };
}

function buildImageMap(images: readonly DocImage[]): Record<string, string> {
  const map: Record<string, string> = {};
  images.forEach((image, index) => {
    map[imageKey(index)] =
      `data:${image.mime};base64,${Base64.fromUint8Array(image.bytes)}`;
  });
  return map;
}

const imageKey = (imageRef: number): string => `img${imageRef}`;

function mapBlock(block: DocBlock, images: readonly DocImage[]): unknown[] {
  switch (block.type) {
    case 'heading':
      return [
        { text: mapInlines(block.inlines), style: headingStyleName(block.level) },
      ];
    case 'paragraph':
      return [{ text: mapInlines(block.inlines) }];
    case 'blockquote':
      return mapBlockquote(block.blocks, images);
    case 'code':
      return [{ text: block.text, style: 'code', preserveLeadingSpaces: true }];
    case 'list':
      return [
        block.ordered
          ? { ol: block.items.map((item) => mapListItem(item, images)) }
          : { ul: block.items.map((item) => mapListItem(item, images)) },
      ];
    case 'table':
      return [mapTable(block.header, block.rows, block.align)];
    case 'hr':
      return [hrCanvas()];
    case 'image':
      return mapImage(block.imageRef, block.caption, images);
    default:
      return [];
  }
}

function mapBlockquote(
  blocks: readonly DocBlock[],
  images: readonly DocImage[],
): unknown[] {
  return blocks.flatMap((block) => {
    if (block.type === 'paragraph') {
      return [{ text: mapInlines(block.inlines), style: 'Quote' }];
    }
    if (block.type === 'heading') {
      return [
        { text: mapInlines(block.inlines), style: headingStyleName(block.level) },
      ];
    }
    if (block.type === 'blockquote') {
      return mapBlockquote(block.blocks, images);
    }
    return mapBlock(block, images);
  });
}

function mapListItem(item: DocListItem, images: readonly DocImage[]): unknown {
  const parts: unknown[] = [];
  let firstParagraphHandled = false;

  for (const block of item.blocks) {
    if (block.type === 'list') {
      parts.push(
        block.ordered
          ? { ol: block.items.map((child) => mapListItem(child, images)) }
          : { ul: block.items.map((child) => mapListItem(child, images)) },
      );
      continue;
    }
    if (block.type === 'paragraph' && !firstParagraphHandled) {
      firstParagraphHandled = true;
      const inlines = mapInlines(block.inlines);
      if (item.task) {
        inlines.unshift({ text: item.checked ? '☑ ' : '☐ ' });
      }
      parts.push({ text: inlines });
      continue;
    }
    parts.push(...mapBlock(block, images));
  }

  return parts.length === 1 ? parts[0] : parts;
}

function mapTable(
  header: readonly DocCell[],
  rows: readonly DocCell[][],
  align: readonly ('left' | 'center' | 'right' | null)[],
): unknown {
  const columnCount = header.length || rows[0]?.length || 1;
  const widths = Array.from({ length: columnCount }, () => '*');

  const row = (cells: readonly DocCell[], bold: boolean) =>
    cells.map((cell, index) => ({
      text: mapInlines(cell.inlines),
      bold: bold || undefined,
      alignment: align[index] ?? undefined,
    }));

  return {
    table: {
      headerRows: 1,
      widths,
      body: [row(header, true), ...rows.map((r) => row(r, false))],
    },
  };
}

function hrCanvas(): unknown {
  return {
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: Math.round(USABLE_WIDTH_PT),
        y2: 0,
        lineWidth: 1,
        lineColor: '#cccccc',
      },
    ],
  };
}

function mapImage(
  imageRef: number,
  caption: string | undefined,
  images: readonly DocImage[],
): unknown[] {
  const image = images[imageRef];
  if (!image) {
    return [];
  }
  const nodes: unknown[] = [
    { image: imageKey(imageRef), fit: [Math.round(USABLE_WIDTH_PT), 600] },
  ];
  if (caption) {
    nodes.push({ text: caption, style: 'Caption' });
  }
  return nodes;
}

interface PdfTextRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  decoration?: 'lineThrough';
  style?: string;
  link?: string;
}

interface InlineStyle {
  readonly bold?: boolean;
  readonly italics?: boolean;
  readonly strike?: boolean;
}

function mapInlines(
  inlines: readonly DocInline[],
  style: InlineStyle = {},
): PdfTextRun[] {
  return inlines.flatMap((inline) => mapInline(inline, style));
}

function mapInline(inline: DocInline, style: InlineStyle): PdfTextRun[] {
  switch (inline.type) {
    case 'text':
      return [
        {
          text: inline.text,
          bold: style.bold,
          italics: style.italics,
          decoration: style.strike ? 'lineThrough' : undefined,
        },
      ];
    case 'strong':
      return mapInlines(inline.inlines, { ...style, bold: true });
    case 'em':
      return mapInlines(inline.inlines, { ...style, italics: true });
    case 'del':
      return mapInlines(inline.inlines, { ...style, strike: true });
    case 'code':
      return [
        { text: inline.text, style: 'code', bold: style.bold, italics: style.italics },
      ];
    case 'break':
      return [{ text: '\n' }];
    case 'link': {
      // Mapper-guaranteed sanitised href (document-source.ts sanitizeDocumentHref):
      // only ever an absolute http(s) URL by the time it reaches the renderer.
      // pdfmake link nodes are a single flattened text run rather than nested
      // formatting, matching how the library represents hyperlinks.
      const text = mapInlines(inline.inlines, style)
        .map((run) => run.text)
        .join('');
      return [{ text: text || inline.href, link: inline.href, style: 'link' }];
    }
    default:
      return [];
  }
}
