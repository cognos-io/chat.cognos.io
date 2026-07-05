// House rule: this spec never imports the real `docx` package — it injects a
// fake shaped like the library's public surface and asserts on the calls the
// renderer makes against it. Real-bytes validation happens in Playwright.
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { DocImage } from '../document.types';
import {
  DocxLib,
  DocxLoader,
  createDocxRenderer,
  scrubDocxTimestamps,
} from './docx-renderer';

interface CapturedHeaderOptions {
  children: { options: CapturedParagraphOptions }[];
}

interface CapturedDocumentOptions {
  creator?: string;
  lastModifiedBy?: string;
  title?: string;
  styles?: {
    default?: { document?: { run?: { language?: { value?: string } } } };
  };
  sections: {
    properties: {
      page: {
        size: { width: number; height: number; orientation?: string };
        margin: { top: number; right: number; bottom: number; left: number };
      };
    };
    headers?: { default: { options: CapturedHeaderOptions } };
    footers?: { default: { options: CapturedHeaderOptions } };
  }[];
}

interface CapturedParagraphOptions {
  heading?: string;
  style?: string;
  children?: unknown[];
  bullet?: { level: number };
  numbering?: { reference: string; level: number };
  border?: unknown;
}

interface CapturedHyperlinkOptions {
  link: string;
  children: unknown[];
}

interface CapturedTableOptions {
  width: unknown;
  columnWidths: number[];
  rows: unknown[];
}

function createFakeDocx() {
  const documentCalls: CapturedDocumentOptions[] = [];
  const paragraphCalls: CapturedParagraphOptions[] = [];
  const tableCalls: CapturedTableOptions[] = [];
  const hyperlinkCalls: CapturedHyperlinkOptions[] = [];

  class FakeDocument {
    constructor(public options: CapturedDocumentOptions) {
      documentCalls.push(options);
    }
  }
  class FakeParagraph {
    public options: CapturedParagraphOptions;
    constructor(options: CapturedParagraphOptions | string) {
      this.options =
        typeof options === 'string' ? { children: [{ text: options }] } : options;
      paragraphCalls.push(this.options);
    }
  }
  class FakeTextRun {
    constructor(public options: unknown) {}
  }
  class FakeExternalHyperlink {
    constructor(public options: CapturedHyperlinkOptions) {
      hyperlinkCalls.push(options);
    }
  }
  class FakeImageRun {
    constructor(public options: unknown) {}
  }
  class FakeTableCell {
    constructor(public options: unknown) {}
  }
  class FakeTableRow {
    constructor(public options: unknown) {}
  }
  class FakeTable {
    constructor(public options: CapturedTableOptions) {
      tableCalls.push(options);
    }
  }
  class FakeHeader {
    constructor(public options: CapturedHeaderOptions) {}
  }
  class FakeFooter {
    constructor(public options: CapturedHeaderOptions) {}
  }

  const toArrayBuffer = vi.fn(
    async () => new TextEncoder().encode('fake-docx-bytes').buffer,
  );

  const fakeDocx = {
    Document: FakeDocument,
    Paragraph: FakeParagraph,
    TextRun: FakeTextRun,
    ExternalHyperlink: FakeExternalHyperlink,
    ImageRun: FakeImageRun,
    Table: FakeTable,
    TableRow: FakeTableRow,
    TableCell: FakeTableCell,
    Header: FakeHeader,
    Footer: FakeFooter,
    Packer: { toArrayBuffer },
    HeadingLevel: {
      HEADING_1: 'Heading1',
      HEADING_2: 'Heading2',
      HEADING_3: 'Heading3',
      HEADING_4: 'Heading4',
      HEADING_5: 'Heading5',
      HEADING_6: 'Heading6',
    },
    AlignmentType: { LEFT: 'left', CENTER: 'center', RIGHT: 'right', START: 'start' },
    BorderStyle: { SINGLE: 'single' },
    ShadingType: { CLEAR: 'clear' },
    WidthType: { DXA: 'dxa' },
    LevelFormat: { DECIMAL: 'decimal' },
    PageNumber: { CURRENT: 'CURRENT', TOTAL_PAGES: 'TOTAL_PAGES' },
    PageOrientation: { PORTRAIT: 'portrait', LANDSCAPE: 'landscape' },
  } as unknown as DocxLib;

  return {
    fakeDocx,
    documentCalls,
    paragraphCalls,
    tableCalls,
    hyperlinkCalls,
    toArrayBuffer,
  };
}

function render(
  fakeDocx: DocxLib,
  ...args: Parameters<ReturnType<typeof createDocxRenderer>>
) {
  const loader: DocxLoader = async () => fakeDocx;
  return createDocxRenderer(loader)(...args);
}

describe('createDocxRenderer', () => {
  it('throws empty_document when the DocIR has no blocks and no images', async () => {
    const { fakeDocx } = createFakeDocx();
    await expect(render(fakeDocx, { blocks: [] }, [], {})).rejects.toMatchObject({
      code: 'empty_document',
    });
  });

  it('does not throw empty_document when there are images but no blocks', async () => {
    const { fakeDocx } = createFakeDocx();
    const images: DocImage[] = [{ bytes: new Uint8Array([1]), mime: 'image/png' }];
    await expect(
      render(fakeDocx, { blocks: [{ type: 'image', imageRef: 0 }] }, images, {}),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('wraps a library failure as render_failed', async () => {
    const { fakeDocx, toArrayBuffer } = createFakeDocx();
    toArrayBuffer.mockRejectedValueOnce(new Error('boom'));
    await expect(
      render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {}),
    ).rejects.toMatchObject({ code: 'render_failed' });
  });

  it('returns the packed bytes', async () => {
    const { fakeDocx } = createFakeDocx();
    const bytes = await render(
      fakeDocx,
      { blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text: 'hi' }] }] },
      [],
      {},
    );
    expect(new TextDecoder().decode(bytes)).toBe('fake-docx-bytes');
  });

  it('sets Cognos-only, non-identifying metadata', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      title: 'Quarterly Review',
    });

    const options = documentCalls[0];
    expect(options.creator).toBe('Cognos');
    expect(options.lastModifiedBy).toBe('Cognos');
    expect(options.title).toBe('Quarterly Review');
    // No email, user id, or any other identity ever appears in the metadata.
    expect(JSON.stringify(options)).not.toMatch(/@|user-|owner/i);
  });

  it('sets A4 page size and 1-inch (1440 twip) margins explicitly', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    const page = documentCalls[0].sections[0].properties.page;
    expect(page.size).toMatchObject({ width: 11906, height: 16838 });
    expect(page.margin).toEqual({ top: 1440, right: 1440, bottom: 1440, left: 1440 });
  });

  it.each([1, 2, 3, 4, 5, 6] as const)(
    'maps heading level %i to the matching HeadingLevel',
    async (level) => {
      const { fakeDocx, paragraphCalls } = createFakeDocx();
      await render(
        fakeDocx,
        {
          blocks: [
            { type: 'heading', level, inlines: [{ type: 'text', text: 'Title' }] },
          ],
        },
        [],
        {},
      );
      expect(paragraphCalls[0].heading).toBe(`Heading${level}`);
    },
  );

  it('gives the table explicit equal columnWidths spanning the usable width', async () => {
    const { fakeDocx, tableCalls } = createFakeDocx();
    await render(
      fakeDocx,
      {
        blocks: [
          {
            type: 'table',
            header: [
              { inlines: [{ type: 'text', text: 'A' }] },
              { inlines: [{ type: 'text', text: 'B' }] },
            ],
            rows: [
              [
                { inlines: [{ type: 'text', text: '1' }] },
                { inlines: [{ type: 'text', text: '2' }] },
              ],
            ],
            align: [null, 'center'],
          },
        ],
      },
      [],
      {},
    );

    const table = tableCalls[0];
    expect(table.columnWidths).toEqual([4513, 4513]);
    expect(table.columnWidths.length).toBe(2);
  });

  it('never invents a link beyond what the mapper supplied', async () => {
    const { fakeDocx, hyperlinkCalls } = createFakeDocx();
    await render(
      fakeDocx,
      {
        blocks: [
          {
            type: 'paragraph',
            inlines: [
              {
                type: 'link',
                href: 'https://example.com/safe',
                inlines: [{ type: 'text', text: 'safe' }],
              },
            ],
          },
        ],
      },
      [],
      {},
    );

    expect(hyperlinkCalls).toHaveLength(1);
    expect(hyperlinkCalls[0].link).toBe('https://example.com/safe');
    expect(JSON.stringify(hyperlinkCalls)).not.toMatch(/javascript:/i);
  });

  it('defaults to A4 portrait dimensions', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    expect(documentCalls[0].sections[0].properties.page.size).toEqual({
      width: 11906,
      height: 16838,
      orientation: 'portrait',
    });
  });

  it('sets the orientation flag (keeping canonical width/height) for a landscape page option', async () => {
    // docx's own createPageSize swaps width/height internally whenever
    // `orientation: LANDSCAPE` is set (verified against
    // node_modules/docx/dist/index.mjs) — passing canonical A4 width/height
    // here is correct; pre-swapping them ourselves as well would double-swap
    // and produce a landscape-flagged page with portrait-shaped dimensions
    // (caught by the real-bytes smoke check against actual document.xml).
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      page: { size: 'A4', orientation: 'landscape' },
    });

    expect(documentCalls[0].sections[0].properties.page.size).toEqual({
      width: 11906,
      height: 16838,
      orientation: 'landscape',
    });
  });

  it('has no headers/footers by default', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    expect(documentCalls[0].sections[0].headers).toBeUndefined();
    expect(documentCalls[0].sections[0].footers).toBeUndefined();
  });

  it('sets a centred, Header-styled default header from a header option', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: 'Quarterly Report',
    });

    const headerParagraph =
      documentCalls[0].sections[0].headers?.default.options.children[0].options;
    expect(headerParagraph?.style).toBe('Header');
    expect(JSON.stringify(headerParagraph?.children)).toContain('Quarterly Report');
  });

  it('omits the header entirely when it is empty or whitespace-only', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: '   ',
    });

    expect(documentCalls[0].sections[0].headers).toBeUndefined();
  });

  it('defines a Header paragraph style at 9pt grey', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: 'Quarterly Report',
    });

    const styles = documentCalls[0].styles as unknown as {
      paragraphStyles: { id: string; run: { size: number; color: string } }[];
    };
    const headerStyle = styles.paragraphStyles.find((s) => s.id === 'Header');
    expect(headerStyle?.run).toEqual({ size: 18, color: '888888' });
  });

  it('builds a page-number footer from PageNumber field children when requested', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      footer: { pageNumbers: true },
    });

    const footerParagraph =
      documentCalls[0].sections[0].footers?.default.options.children[0].options;
    const run = footerParagraph?.children?.[0] as {
      options: { children: unknown[] };
    };
    expect(run.options.children).toEqual(['CURRENT', ' / ', 'TOTAL_PAGES']);
  });

  it('omits the footer when pageNumbers is false or absent', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      footer: { pageNumbers: false },
    });

    expect(documentCalls[0].sections[0].footers).toBeUndefined();
  });

  it('supports a header and page-number footer together', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: 'Quarterly Report',
      footer: { pageNumbers: true },
    });

    expect(documentCalls[0].sections[0].headers).toBeDefined();
    expect(documentCalls[0].sections[0].footers).toBeDefined();
  });

  it('applies a lang option to the default document run language', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      lang: 'de-CH',
    });

    expect(documentCalls[0].styles?.default?.document?.run?.language).toEqual({
      value: 'de-CH',
    });
  });

  it('leaves the document run language unset when no lang option is given', async () => {
    const { fakeDocx, documentCalls } = createFakeDocx();
    await render(fakeDocx, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    expect(documentCalls[0].styles?.default?.document?.run?.language).toBeUndefined();
  });
});

// docx@9.7.1 hardcodes dcterms:created/modified to the exact pack instant with
// no override hook, so the renderer rewrites the packed zip's
// docProps/core.xml afterwards. Tested directly against a synthetic zip built
// with the same `fflate` used by the renderer (not the real `docx` package).
describe('scrubDocxTimestamps', () => {
  const buildCoreXml = () =>
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<cp:coreProperties>',
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-07-04T23:59:59Z</dcterms:created>',
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-07-04T23:59:59Z</dcterms:modified>',
      '</cp:coreProperties>',
    ].join('');

  it('rewrites both timestamps in docProps/core.xml to the rounded date', () => {
    const zip = zipSync({
      'docProps/core.xml': new TextEncoder().encode(buildCoreXml()),
      'word/document.xml': new TextEncoder().encode('<w:document/>'),
    });

    const scrubbed = scrubDocxTimestamps(zip, new Date(Date.UTC(2026, 6, 4)));

    const files = unzipSync(scrubbed);
    const coreXml = new TextDecoder().decode(files['docProps/core.xml']);
    expect(coreXml).toContain(
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-07-04T00:00:00Z</dcterms:created>',
    );
    expect(coreXml).toContain(
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-07-04T00:00:00Z</dcterms:modified>',
    );
    // The rest of the archive (e.g. the actual document body) is untouched.
    expect(new TextDecoder().decode(files['word/document.xml'])).toBe('<w:document/>');
  });

  it('falls back to the original bytes when the input is not a zip', () => {
    const bytes = new TextEncoder().encode('not a zip');
    expect(scrubDocxTimestamps(bytes, new Date())).toBe(bytes);
  });

  it('falls back to the original bytes when the zip has no core.xml', () => {
    const zip = zipSync({
      'word/document.xml': new TextEncoder().encode('<w:document/>'),
    });
    expect(scrubDocxTimestamps(zip, new Date())).toBe(zip);
  });
});
