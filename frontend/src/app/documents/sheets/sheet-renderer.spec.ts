// House rule: this spec never imports the real `write-excel-file` package —
// it injects a fake shaped like the library's public surface and asserts on
// the calls the renderer makes against it. Real-bytes validation happens via
// a throwaway smoke script (not committed) and Playwright e2e.
import { describe, expect, it, vi } from 'vitest';

import { SheetLib, SheetLoader, createSheetRenderer } from './sheet-renderer';
import { SheetSpec } from './sheet-spec.types';

function createFakeLib(
  bytes: Uint8Array = new TextEncoder().encode('fake-xlsx-bytes'),
) {
  const calls: { sheets: unknown[]; options: unknown }[] = [];
  const writeXlsxFile = vi.fn(async (sheets: unknown[], options: unknown) => {
    calls.push({ sheets, options });
    return {
      toBlob: async () => new Blob([bytes as BlobPart]),
      toFile: async () => undefined,
    };
  });
  const lib = { default: writeXlsxFile } as unknown as SheetLib;
  return { lib, calls, writeXlsxFile };
}

function render(
  lib: SheetLib,
  ...args: Parameters<ReturnType<typeof createSheetRenderer>>
) {
  const loader: SheetLoader = async () => lib;
  return createSheetRenderer(loader)(...args);
}

interface CapturedCell {
  value?: unknown;
  type?: unknown;
  format?: string;
  fontWeight?: string;
}

interface CapturedSheet {
  sheet?: string;
  data: CapturedCell[][];
  columns?: { width?: number }[];
  stickyRowsCount?: number;
}

describe('createSheetRenderer', () => {
  it('throws empty_document for a spec with no sheets', async () => {
    const { lib } = createFakeLib();
    await expect(render(lib, { sheets: [] }, {})).rejects.toMatchObject({
      code: 'empty_document',
    });
  });

  it('wraps a library failure as render_failed', async () => {
    const { lib } = createFakeLib();
    const failing = {
      default: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as SheetLib;
    const spec: SheetSpec = { sheets: [{ name: 'S', rows: [['a']] }] };
    await expect(render(failing, spec, {})).rejects.toMatchObject({
      code: 'render_failed',
    });
    expect(lib).toBeDefined(); // unused fake kept for symmetry with other specs
  });

  it('returns the blob bytes', async () => {
    const bytes = new TextEncoder().encode('fake-xlsx-bytes');
    const { lib } = createFakeLib(bytes);
    const spec: SheetSpec = { sheets: [{ name: 'S', rows: [['a']] }] };
    const result = await render(lib, spec, {});
    expect(new TextDecoder().decode(result)).toBe('fake-xlsx-bytes');
  });

  it('maps a plain string/number/boolean row to typed cells', async () => {
    const { lib, calls } = createFakeLib();
    // Mixed types (not all-string) and no freezeHeader — this row is not a
    // header, so fontWeight stays unset; the header-bolding rule is covered
    // by its own tests below.
    const spec: SheetSpec = {
      sheets: [{ name: 'S', rows: [['a', 1, true]] }],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[0]).toEqual([
      { value: 'a', type: String, format: undefined, fontWeight: undefined },
      { value: 1, type: Number, format: undefined, fontWeight: undefined },
      { value: true, type: Boolean, format: undefined, fontWeight: undefined },
    ]);
  });

  it('maps a formula cell to a Formula-typed cell with the raw formula text', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [{ name: 'S', rows: [['Total'], [{ f: 'SUM(A1:A1)' }]] }],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[1][0]).toMatchObject({ type: 'Formula', value: 'SUM(A1:A1)' });
  });

  it('maps a {v, numFmt, bold} cell', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        {
          name: 'S',
          rows: [['header'], [{ v: 1234.5, numFmt: '#,##0.00', bold: true }]],
        },
      ],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[1][0]).toMatchObject({
      type: Number,
      value: 1234.5,
      format: '#,##0.00',
      fontWeight: 'bold',
    });
  });

  it('bolds the first row when it is all strings, even without freezeHeader', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        {
          name: 'S',
          rows: [
            ['Month', 'Revenue'],
            ['January', 42000],
          ],
        },
      ],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[0].every((cell) => cell.fontWeight === 'bold')).toBe(true);
    expect(sheet.data[1].every((cell) => cell.fontWeight === undefined)).toBe(true);
  });

  it('does not bold a mixed-type first row unless freezeHeader is set', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [{ name: 'S', rows: [['Month', 42]] }],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[0].every((cell) => cell.fontWeight === undefined)).toBe(true);
  });

  it('bolds a mixed-type first row when freezeHeader is set', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [{ name: 'S', freezeHeader: true, rows: [['Month', 42]] }],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[0].every((cell) => cell.fontWeight === 'bold')).toBe(true);
  });

  it('sets stickyRowsCount:1 when freezeHeader is set, and leaves it unset otherwise', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        { name: 'Frozen', freezeHeader: true, rows: [['a']] },
        { name: 'NotFrozen', rows: [['a']] },
      ],
    };
    await render(lib, spec, {});

    const [frozen, notFrozen] = calls[0].sheets as CapturedSheet[];
    expect(frozen.stickyRowsCount).toBe(1);
    expect(notFrozen.stickyRowsCount).toBeUndefined();
  });

  it('passes column widths through', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        {
          name: 'S',
          columns: [{ width: 18 }, { width: 12, numFmt: '#,##0.00' }],
          rows: [['a', 1]],
        },
      ],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.columns).toEqual([{ width: 18 }, { width: 12 }]);
  });

  it('falls back to a column numFmt when the cell has none of its own', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        {
          name: 'S',
          columns: [{}, { numFmt: '#,##0.00' }],
          rows: [['a', 1]],
        },
      ],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[0][1].format).toBe('#,##0.00');
  });

  it('never applies a column numFmt to a string cell in that column (write-excel-file rejects non-"@" formats on String cells)', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        {
          name: 'S',
          columns: [{}, { numFmt: '#,##0.00' }],
          rows: [
            ['Month', 'Revenue'],
            ['January', 42000],
            ['Note', { v: 'n/a' }],
          ],
        },
      ],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    // Header row and the {v:'n/a'} string cell share column B with a numeric
    // row — neither string cell should inherit the column's numFmt.
    expect(sheet.data[0][1].format).toBeUndefined();
    expect(sheet.data[1][1].format).toBe('#,##0.00');
    expect(sheet.data[2][1].format).toBeUndefined();
  });

  it('a cell-level numFmt overrides the column default', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        {
          name: 'S',
          columns: [{}, { numFmt: '#,##0.00' }],
          rows: [['a', { v: 1, numFmt: '0%' }]],
        },
      ],
    };
    await render(lib, spec, {});

    const sheet = calls[0].sheets[0] as CapturedSheet;
    expect(sheet.data[0][1].format).toBe('0%');
  });

  it('writes every sheet, in order, with its own name', async () => {
    const { lib, calls } = createFakeLib();
    const spec: SheetSpec = {
      sheets: [
        { name: 'Revenue', rows: [['a']] },
        { name: 'Notes', rows: [['b']] },
      ],
    };
    await render(lib, spec, {});

    const sheets = calls[0].sheets as CapturedSheet[];
    expect(sheets.map((s) => s.sheet)).toEqual(['Revenue', 'Notes']);
  });

  it('always calls the multi-sheet overload, even for a single sheet', async () => {
    const { lib, writeXlsxFile } = createFakeLib();
    const spec: SheetSpec = { sheets: [{ name: 'Only', rows: [['a']] }] };
    await render(lib, spec, {});

    const [sheetsArg] = writeXlsxFile.mock.calls[0];
    expect(Array.isArray(sheetsArg)).toBe(true);
    expect(sheetsArg).toHaveLength(1);
  });
});
