// House rule: this spec never imports the real `pdfmake` package — it injects
// a fake that captures the docDefinition it's called with. Real-bytes
// validation happens in Playwright.
import { describe, expect, it, vi } from 'vitest';

import { DocImage } from '../document.types';
import { PdfLib, PdfLoader, createPdfRenderer } from './pdf-renderer';

type Json = Record<string, unknown>;

interface CapturedDocDefinition {
  pageSize: string;
  pageOrientation: string;
  pageMargins: number[];
  info: { title?: string; author?: string; creator?: string; producer?: string };
  styles: Record<string, Json>;
  content: Json[];
  images: Record<string, string>;
  header?: { text: string; style?: string; alignment?: string; margin?: number[] };
  footer?: (currentPage: number, pageCount: number) => Json;
}

function createFakePdfLib(getBufferImpl?: () => Promise<ArrayBuffer>) {
  const createPdf = vi.fn((docDefinition: unknown) => ({
    getBuffer:
      getBufferImpl ?? (async () => new TextEncoder().encode('fake-pdf-bytes').buffer),
    docDefinition,
  }));
  const fakeLib = { createPdf } as unknown as PdfLib;
  return { fakeLib, createPdf };
}

function render(
  fakeLib: PdfLib,
  ...args: Parameters<ReturnType<typeof createPdfRenderer>>
) {
  const loader: PdfLoader = async () => fakeLib;
  return createPdfRenderer(loader)(...args);
}

function capturedDocDefinition(
  createPdf: ReturnType<typeof vi.fn>,
): CapturedDocDefinition {
  return createPdf.mock.calls[0][0] as CapturedDocDefinition;
}

describe('createPdfRenderer', () => {
  it('throws empty_document when the DocIR has no blocks and no images', async () => {
    const { fakeLib } = createFakePdfLib();
    await expect(render(fakeLib, { blocks: [] }, [], {})).rejects.toMatchObject({
      code: 'empty_document',
    });
  });

  it('does not throw empty_document when there are images but no blocks', async () => {
    const { fakeLib } = createFakePdfLib();
    const images: DocImage[] = [{ bytes: new Uint8Array([1]), mime: 'image/png' }];
    await expect(
      render(fakeLib, { blocks: [{ type: 'image', imageRef: 0 }] }, images, {}),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('wraps a library failure as render_failed', async () => {
    const { fakeLib } = createFakePdfLib(async () => {
      throw new Error('boom');
    });
    await expect(
      render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {}),
    ).rejects.toMatchObject({ code: 'render_failed' });
  });

  it('returns the pdf bytes', async () => {
    const { fakeLib } = createFakePdfLib();
    const bytes = await render(
      fakeLib,
      { blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text: 'hi' }] }] },
      [],
      {},
    );
    expect(new TextDecoder().decode(bytes)).toBe('fake-pdf-bytes');
  });

  it('sets a Cognos-only info block with no user identity', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      title: 'Quarterly Review',
    });

    const info = capturedDocDefinition(createPdf).info;
    expect(info.title).toBe('Quarterly Review');
    expect(info.author).toBe('Cognos');
    expect(info.creator).toBe('Cognos');
    expect(info.producer).toBe('Cognos');
    expect(JSON.stringify(info)).not.toMatch(/@|user-|owner/i);
  });

  it('sets A4 pageSize and defaults to portrait orientation', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    const dd = capturedDocDefinition(createPdf);
    expect(dd.pageSize).toBe('A4');
    expect(dd.pageOrientation).toBe('portrait');
    expect(dd.pageMargins).toEqual([72, 72, 72, 72]);
  });

  it('accepts a lang option as a no-op (pdfmake has no doc-language metadata)', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      lang: 'de-CH',
    });

    // No field on the docDefinition should carry the lang value — asserting
    // there's nowhere for it to have leaked to, not that it was applied.
    expect(JSON.stringify(capturedDocDefinition(createPdf))).not.toContain('de-CH');
  });

  it('honours a landscape page option', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      page: { size: 'A4', orientation: 'landscape' },
    });

    expect(capturedDocDefinition(createPdf).pageOrientation).toBe('landscape');
  });

  it('has no header/footer by default', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    const dd = capturedDocDefinition(createPdf);
    expect(dd.header).toBeUndefined();
    expect(dd.footer).toBeUndefined();
  });

  it('sets a centred header from a non-empty header option', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: 'Quarterly Report',
    });

    const dd = capturedDocDefinition(createPdf);
    expect(dd.header).toMatchObject({ text: 'Quarterly Report', alignment: 'center' });
  });

  it('omits the header entirely when it is empty or whitespace-only', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: '   ',
    });

    expect(capturedDocDefinition(createPdf).header).toBeUndefined();
  });

  it('produces a "current / total" footer when pageNumbers is requested', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      footer: { pageNumbers: true },
    });

    const footer = capturedDocDefinition(createPdf).footer;
    expect(footer).toBeTypeOf('function');
    expect(footer?.(2, 7)).toMatchObject({ text: '2 / 7', alignment: 'center' });
  });

  it('omits the footer when pageNumbers is false or absent', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      footer: { pageNumbers: false },
    });

    expect(capturedDocDefinition(createPdf).footer).toBeUndefined();
  });

  it('supports a header and page-number footer together', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {
      header: 'Quarterly Report',
      footer: { pageNumbers: true },
    });

    const dd = capturedDocDefinition(createPdf);
    expect(dd.header).toMatchObject({ text: 'Quarterly Report' });
    expect(dd.footer?.(1, 3)).toMatchObject({ text: '1 / 3' });
  });

  it('defines a Header style (9pt grey) used by header/footer text', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    const headerStyle = capturedDocDefinition(createPdf).styles['Header'];
    expect(headerStyle['fontSize']).toBe(9);
    expect(headerStyle['color']).toBe('#888888');
  });

  it('defines heading and code styles matching the shared type scale', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(fakeLib, { blocks: [{ type: 'paragraph', inlines: [] }] }, [], {});

    const styles = capturedDocDefinition(createPdf).styles;
    expect(styles['Heading1']['fontSize']).toBe(20);
    expect(styles['Heading1']['bold']).toBe(true);
    expect(styles['code']['font']).toBe('Courier');
    expect(styles['code']['fontSize']).toBe(10);
  });

  it('nests ordered/unordered lists', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(
      fakeLib,
      {
        blocks: [
          {
            type: 'list',
            ordered: false,
            items: [
              {
                blocks: [
                  { type: 'paragraph', inlines: [{ type: 'text', text: 'outer' }] },
                  {
                    type: 'list',
                    ordered: true,
                    items: [
                      {
                        blocks: [
                          {
                            type: 'paragraph',
                            inlines: [{ type: 'text', text: 'inner' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      [],
      {},
    );

    const content = capturedDocDefinition(createPdf).content;
    const outerList = content[0]['ul'] as Json[];
    expect(outerList).toHaveLength(1);
    const [outerText, nested] = outerList[0] as unknown as [Json, Json];
    expect((outerText['text'] as Json[])[0]['text']).toBe('outer');
    expect(nested['ol'] as Json[]).toHaveLength(1);
  });

  it('wires images as data URLs referenced by content nodes', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    const images: DocImage[] = [
      { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
    ];
    await render(
      fakeLib,
      { blocks: [{ type: 'image', imageRef: 0, caption: 'A caption' }] },
      images,
      {},
    );

    const dd = capturedDocDefinition(createPdf);
    expect(dd.images['img0']).toMatch(/^data:image\/png;base64,/);
    expect(dd.content[0]).toMatchObject({ image: 'img0' });
    expect(dd.content[1]).toMatchObject({ text: 'A caption', style: 'Caption' });
  });

  it('never invents a link beyond what the mapper supplied', async () => {
    const { fakeLib, createPdf } = createFakePdfLib();
    await render(
      fakeLib,
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

    const content = capturedDocDefinition(createPdf).content;
    const textNodes = content[0]['text'] as Json[];
    expect(textNodes[0]).toMatchObject({
      link: 'https://example.com/safe',
      style: 'link',
    });
    expect(JSON.stringify(content)).not.toMatch(/javascript:/i);
  });
});
