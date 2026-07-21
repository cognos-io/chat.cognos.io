// DocIR -> .docx renderer (docs/business_processes/document-generation.md). The
// `docx` library is loaded lazily, inside the render call, so it never enters
// the initial bundle — this module only imports its TYPES (erased at build
// time). No Angular imports; runs inside the render worker as well as the
// main thread.
import type * as Docx from 'docx';
import { unzipSync, zipSync } from 'fflate';

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
  CODE_FONT_DOCX,
  CODE_SHADING_FILL,
  DOCUMENT_CREATOR,
  PAGE_MARGIN_TWIPS,
  PAGE_SIZE_TWIPS,
  QUOTE_INDENT_TWIPS,
  StyleSpec,
  TYPE_SCALE,
  USABLE_WIDTH_TWIPS,
  documentDateRoundedToDay,
  headingStyleName,
  normalizedHeaderText,
} from './doc-styles';

export type DocxLib = typeof Docx;
export type DocxLoader = () => Promise<DocxLib>;

const defaultLoader: DocxLoader = () => import('docx');

// Fallback size (px, ~96dpi) for images with no known intrinsic dimensions.
const FALLBACK_IMAGE_WIDTH_PX = 600;
const FALLBACK_IMAGE_HEIGHT_PX = 400;
// Usable page width expressed in px at 96dpi (1440 twips == 1in == 96px).
const MAX_IMAGE_WIDTH_PX = Math.floor(USABLE_WIDTH_TWIPS / 15);

const ORDERED_LIST_REFERENCE = 'cognos-ordered-list';
const MAX_LIST_NUMBERING_LEVELS = 9;

interface InlineStyle {
  readonly bold?: boolean;
  readonly italics?: boolean;
  readonly strike?: boolean;
  readonly hyperlink?: boolean;
}

type RunOrHyperlink =
  InstanceType<DocxLib['TextRun']> | InstanceType<DocxLib['ExternalHyperlink']>;

/**
 * createDocxRenderer builds a `DocumentRenderer['render']` implementation.
 * `loadLib` is injected so specs can supply a fake `docx` module without ever
 * importing the real (heavy) library.
 */
export const createDocxRenderer = (
  loadLib: DocxLoader = defaultLoader,
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
      const docx = await loadLib();
      const children = doc.blocks.flatMap((block) => mapBlock(docx, block, images));
      const now = documentDateRoundedToDay(new Date());
      const landscape = opts.page?.orientation === 'landscape';
      // docx's own createPageSize swaps width/height internally whenever
      // `orientation: LANDSCAPE` is set (verified against
      // node_modules/docx/dist/index.mjs) — passing the canonical A4
      // width/height plus the orientation flag is correct; pre-swapping them
      // here as well double-swaps and produces a landscape-flagged page with
      // portrait-shaped (narrower-than-tall) dimensions in the XML.
      const pageSize = {
        width: PAGE_SIZE_TWIPS.width,
        height: PAGE_SIZE_TWIPS.height,
        orientation: landscape
          ? docx.PageOrientation.LANDSCAPE
          : docx.PageOrientation.PORTRAIT,
      };

      const document = new docx.Document({
        creator: DOCUMENT_CREATOR,
        lastModifiedBy: DOCUMENT_CREATOR,
        title: opts.title,
        styles: buildStyles(docx, opts),
        numbering: buildNumbering(docx),
        sections: [
          {
            properties: {
              page: {
                size: pageSize,
                margin: {
                  top: PAGE_MARGIN_TWIPS,
                  right: PAGE_MARGIN_TWIPS,
                  bottom: PAGE_MARGIN_TWIPS,
                  left: PAGE_MARGIN_TWIPS,
                },
              },
            },
            headers: buildHeaders(docx, opts.header),
            footers: buildFooters(docx, opts.footer?.pageNumbers),
            children,
          },
        ],
      });

      const buffer = await docx.Packer.toArrayBuffer(document);
      return scrubDocxTimestamps(new Uint8Array(buffer), now);
    } catch (err) {
      if (err instanceof DocumentRenderError) {
        throw err;
      }
      throw new DocumentRenderError('render_failed', 'Failed to render docx document');
    }
  };
};

// Default instance used by the render worker; specs use createDocxRenderer
// directly with a fake loader instead.
export const renderDocx: DocumentRenderer['render'] = createDocxRenderer();

// docx@9.7.1 has no supported way to override the `dcterms:created` /
// `dcterms:modified` core-properties timestamps — `CoreProperties` always
// stamps `new Date()` at pack time regardless of any option passed to
// `Document()` (verified against node_modules/docx/dist/index.mjs). A .docx
// is just a zip of XML, so this rewrites the packed `docProps/core.xml`
// in place to the day-rounded date instead, honouring the metadata-hygiene
// rule (spec: no precise activity timestamps in exported files). Falls
// back to the untouched bytes if the zip doesn't look as expected, so a
// hygiene pass can never break the actual download.
export function scrubDocxTimestamps(bytes: Uint8Array, roundedDate: Date): Uint8Array {
  try {
    const files = unzipSync(bytes);
    const coreXml = files['docProps/core.xml'];
    if (!coreXml) {
      return bytes;
    }
    const isoDay = roundedDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rewritten = new TextDecoder()
      .decode(coreXml)
      .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/, `$1${isoDay}$2`)
      .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${isoDay}$2`);
    files['docProps/core.xml'] = new TextEncoder().encode(rewritten);
    return zipSync(files);
  } catch {
    return bytes;
  }
}

function buildStyles(docx: DocxLib, opts: RenderOptions) {
  const headingStyle = (
    id: 'Heading1' | 'Heading2' | 'Heading3' | 'Heading4',
    spec: StyleSpec,
  ) => ({
    id,
    name: id,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { bold: spec.bold, size: spec.halfPt },
    paragraph: { spacing: { before: 240, after: 120 } },
  });

  return {
    default: {
      document: {
        run: {
          size: TYPE_SCALE.Normal.halfPt,
          language: opts.lang ? { value: opts.lang } : undefined,
        },
        paragraph: { spacing: { after: 120 } },
      },
    },
    paragraphStyles: [
      headingStyle('Heading1', TYPE_SCALE.Heading1),
      headingStyle('Heading2', TYPE_SCALE.Heading2),
      headingStyle('Heading3', TYPE_SCALE.Heading3),
      headingStyle('Heading4', TYPE_SCALE.Heading4),
      {
        id: 'Quote',
        name: 'Quote',
        basedOn: 'Normal',
        next: 'Normal',
        run: { italics: true, size: TYPE_SCALE.Quote.halfPt },
        paragraph: { indent: { left: QUOTE_INDENT_TWIPS } },
      },
      {
        id: 'Code',
        name: 'Code',
        basedOn: 'Normal',
        next: 'Code',
        run: { font: CODE_FONT_DOCX, size: TYPE_SCALE.Code.halfPt },
        paragraph: {
          shading: {
            type: docx.ShadingType.CLEAR,
            fill: CODE_SHADING_FILL,
            color: 'auto',
          },
        },
      },
      {
        id: 'Caption',
        name: 'Caption',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: TYPE_SCALE.Caption.halfPt, color: TYPE_SCALE.Caption.color },
      },
      {
        id: 'Header',
        name: 'Header',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: TYPE_SCALE.Header.halfPt, color: TYPE_SCALE.Header.color },
      },
    ],
  };
}

// buildHeaders returns a section `headers` option with a single centred,
// Header-styled paragraph, or `undefined` when there's no (non-whitespace)
// header text to show — an absent `headers` option renders no header at all.
function buildHeaders(
  docx: DocxLib,
  header: string | undefined,
): { default: InstanceType<DocxLib['Header']> } | undefined {
  const text = normalizedHeaderText(header);
  if (!text) {
    return undefined;
  }
  return {
    default: new docx.Header({
      children: [
        new docx.Paragraph({
          style: 'Header',
          alignment: docx.AlignmentType.CENTER,
          children: [new docx.TextRun(text)],
        }),
      ],
    }),
  };
}

// buildFooters returns a section `footers` option with a single centred
// "current / total" page-number paragraph built from docx's PageNumber field
// children, or `undefined` when page numbers weren't requested.
function buildFooters(
  docx: DocxLib,
  pageNumbers: boolean | undefined,
): { default: InstanceType<DocxLib['Footer']> } | undefined {
  if (!pageNumbers) {
    return undefined;
  }
  return {
    default: new docx.Footer({
      children: [
        new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          children: [
            new docx.TextRun({
              children: [docx.PageNumber.CURRENT, ' / ', docx.PageNumber.TOTAL_PAGES],
            }),
          ],
        }),
      ],
    }),
  };
}

// One reused numbering definition for every ordered list in the document,
// referenced by level (spec: "define one numbering config reused").
function buildNumbering(docx: DocxLib) {
  const levels = Array.from({ length: MAX_LIST_NUMBERING_LEVELS }, (_, level) => ({
    level,
    format: docx.LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: docx.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  return { config: [{ reference: ORDERED_LIST_REFERENCE, levels }] };
}

function headingLevelFor(docx: DocxLib, level: 1 | 2 | 3 | 4 | 5 | 6) {
  const byLevel = {
    1: docx.HeadingLevel.HEADING_1,
    2: docx.HeadingLevel.HEADING_2,
    3: docx.HeadingLevel.HEADING_3,
    4: docx.HeadingLevel.HEADING_4,
    5: docx.HeadingLevel.HEADING_5,
    6: docx.HeadingLevel.HEADING_6,
  } as const;
  return byLevel[level];
}

function alignmentFor(
  docx: DocxLib,
  align: 'left' | 'center' | 'right' | null | undefined,
) {
  switch (align) {
    case 'center':
      return docx.AlignmentType.CENTER;
    case 'right':
      return docx.AlignmentType.RIGHT;
    case 'left':
      return docx.AlignmentType.LEFT;
    default:
      return undefined;
  }
}

function mapBlock(
  docx: DocxLib,
  block: DocBlock,
  images: readonly DocImage[],
): (InstanceType<DocxLib['Paragraph']> | InstanceType<DocxLib['Table']>)[] {
  switch (block.type) {
    case 'heading':
      return [
        new docx.Paragraph({
          heading: headingLevelFor(docx, block.level),
          style: headingStyleName(block.level),
          children: mapInlines(docx, block.inlines),
        }),
      ];
    case 'paragraph':
      return [new docx.Paragraph({ children: mapInlines(docx, block.inlines) })];
    case 'blockquote':
      return mapBlockquote(docx, block.blocks, images);
    case 'code':
      return mapCode(docx, block.text);
    case 'list':
      return mapList(docx, block.ordered, block.items, images, 0);
    case 'table':
      return [mapTable(docx, block.header, block.rows, block.align)];
    case 'hr':
      return [
        new docx.Paragraph({
          border: {
            bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: 'auto' },
          },
        }),
      ];
    case 'image':
      return mapImage(docx, block.imageRef, block.caption, images);
    default:
      return [];
  }
}

function mapBlockquote(
  docx: DocxLib,
  blocks: readonly DocBlock[],
  images: readonly DocImage[],
): (InstanceType<DocxLib['Paragraph']> | InstanceType<DocxLib['Table']>)[] {
  return blocks.flatMap((block) => {
    if (block.type === 'paragraph') {
      return [
        new docx.Paragraph({
          style: 'Quote',
          children: mapInlines(docx, block.inlines),
        }),
      ];
    }
    if (block.type === 'heading') {
      return [
        new docx.Paragraph({
          heading: headingLevelFor(docx, block.level),
          style: headingStyleName(block.level),
          children: mapInlines(docx, block.inlines),
        }),
      ];
    }
    if (block.type === 'blockquote') {
      return mapBlockquote(docx, block.blocks, images);
    }
    // Less common nested content (lists, code, tables, images): map normally
    // rather than trying to force every block type into the Quote style.
    return mapBlock(docx, block, images);
  });
}

function mapCode(docx: DocxLib, text: string): InstanceType<DocxLib['Paragraph']>[] {
  return text.split('\n').map(
    (line) =>
      new docx.Paragraph({
        style: 'Code',
        children: line ? [new docx.TextRun(line)] : [],
      }),
  );
}

function mapList(
  docx: DocxLib,
  ordered: boolean,
  items: readonly DocListItem[],
  images: readonly DocImage[],
  level: number,
): (InstanceType<DocxLib['Paragraph']> | InstanceType<DocxLib['Table']>)[] {
  return items.flatMap((item) => mapListItem(docx, ordered, item, images, level));
}

function mapListItem(
  docx: DocxLib,
  ordered: boolean,
  item: DocListItem,
  images: readonly DocImage[],
  level: number,
): (InstanceType<DocxLib['Paragraph']> | InstanceType<DocxLib['Table']>)[] {
  const numbering = ordered
    ? {
        reference: ORDERED_LIST_REFERENCE,
        level: Math.min(level, MAX_LIST_NUMBERING_LEVELS - 1),
      }
    : undefined;
  const bullet = ordered
    ? undefined
    : { level: Math.min(level, MAX_LIST_NUMBERING_LEVELS - 1) };

  const paragraphs: (
    InstanceType<DocxLib['Paragraph']> | InstanceType<DocxLib['Table']>
  )[] = [];
  let firstParagraphHandled = false;

  for (const block of item.blocks) {
    if (block.type === 'list') {
      paragraphs.push(...mapList(docx, block.ordered, block.items, images, level + 1));
      continue;
    }
    if (block.type === 'paragraph' && !firstParagraphHandled) {
      firstParagraphHandled = true;
      const runs = mapInlines(docx, block.inlines);
      if (item.task) {
        runs.unshift(new docx.TextRun(item.checked ? '☑ ' : '☐ '));
      }
      paragraphs.push(new docx.Paragraph({ children: runs, numbering, bullet }));
      continue;
    }
    paragraphs.push(...mapBlock(docx, block, images));
  }

  return paragraphs;
}

function mapTable(
  docx: DocxLib,
  header: readonly DocCell[],
  rows: readonly DocCell[][],
  align: readonly ('left' | 'center' | 'right' | null)[],
): InstanceType<DocxLib['Table']> {
  const columnCount = header.length || rows[0]?.length || 1;
  // docx tables need explicit column widths; split the usable width equally.
  const colWidth = Math.floor(USABLE_WIDTH_TWIPS / columnCount);
  const columnWidths = Array.from({ length: columnCount }, () => colWidth);

  const cell = (data: DocCell, index: number, bold: boolean) =>
    new docx.TableCell({
      width: { size: colWidth, type: docx.WidthType.DXA },
      children: [
        new docx.Paragraph({
          alignment: alignmentFor(docx, align[index]),
          children: mapInlines(docx, data.inlines, { bold }),
        }),
      ],
    });

  const headerRow = new docx.TableRow({
    tableHeader: true,
    children: header.map((data, index) => cell(data, index, true)),
  });
  const bodyRows = rows.map(
    (row) =>
      new docx.TableRow({
        children: row.map((data, index) => cell(data, index, false)),
      }),
  );

  return new docx.Table({
    width: { size: USABLE_WIDTH_TWIPS, type: docx.WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...bodyRows],
  });
}

function docxImageType(mime: string): 'jpg' | 'png' | 'gif' | 'bmp' {
  const subtype = mime.split('/')[1]?.toLowerCase();
  if (subtype === 'jpeg' || subtype === 'jpg') {
    return 'jpg';
  }
  if (subtype === 'gif') {
    return 'gif';
  }
  if (subtype === 'bmp') {
    return 'bmp';
  }
  return 'png';
}

function scaleImage(
  width?: number,
  height?: number,
): { width: number; height: number } {
  if (!width || !height) {
    return {
      width: Math.min(MAX_IMAGE_WIDTH_PX, FALLBACK_IMAGE_WIDTH_PX),
      height: FALLBACK_IMAGE_HEIGHT_PX,
    };
  }
  const scale = Math.min(
    1,
    MAX_IMAGE_WIDTH_PX / width,
    FALLBACK_IMAGE_HEIGHT_PX / height,
  );
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function mapImage(
  docx: DocxLib,
  imageRef: number,
  caption: string | undefined,
  images: readonly DocImage[],
): InstanceType<DocxLib['Paragraph']>[] {
  const image = images[imageRef];
  if (!image) {
    return [];
  }
  const { width, height } = scaleImage(image.width, image.height);
  const paragraphs = [
    new docx.Paragraph({
      children: [
        new docx.ImageRun({
          type: docxImageType(image.mime),
          data: image.bytes,
          transformation: { width, height },
        }),
      ],
    }),
  ];
  if (caption) {
    paragraphs.push(
      new docx.Paragraph({ style: 'Caption', children: [new docx.TextRun(caption)] }),
    );
  }
  return paragraphs;
}

function mapInlines(
  docx: DocxLib,
  inlines: readonly DocInline[],
  style: InlineStyle = {},
): RunOrHyperlink[] {
  return inlines.flatMap((inline) => mapInline(docx, inline, style));
}

function mapInline(
  docx: DocxLib,
  inline: DocInline,
  style: InlineStyle,
): RunOrHyperlink[] {
  switch (inline.type) {
    case 'text':
      return [
        new docx.TextRun({
          text: inline.text,
          bold: style.bold,
          italics: style.italics,
          strike: style.strike,
          style: style.hyperlink ? 'Hyperlink' : undefined,
        }),
      ];
    case 'strong':
      return mapInlines(docx, inline.inlines, { ...style, bold: true });
    case 'em':
      return mapInlines(docx, inline.inlines, { ...style, italics: true });
    case 'del':
      return mapInlines(docx, inline.inlines, { ...style, strike: true });
    case 'code':
      return [
        new docx.TextRun({
          text: inline.text,
          bold: style.bold,
          italics: style.italics,
          strike: style.strike,
          font: CODE_FONT_DOCX,
          shading: {
            type: docx.ShadingType.CLEAR,
            fill: CODE_SHADING_FILL,
            color: 'auto',
          },
        }),
      ];
    case 'break':
      return [new docx.TextRun({ text: '', break: 1 })];
    case 'link': {
      // Mapper-guaranteed sanitised href (document-source.ts sanitizeDocumentHref):
      // only ever an absolute http(s) URL by the time it reaches the renderer.
      const children = mapInlines(docx, inline.inlines, { ...style, hyperlink: true });
      return [
        new docx.ExternalHyperlink({
          link: inline.href,
          children: children.length
            ? children
            : [new docx.TextRun({ text: inline.href, style: 'Hyperlink' })],
        }),
      ];
    }
    default:
      return [];
  }
}
