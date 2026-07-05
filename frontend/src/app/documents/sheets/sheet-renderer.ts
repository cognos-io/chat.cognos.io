// SheetSpec -> .xlsx renderer (spec docs/specs/document-generation.md §5.3,
// §7). `write-excel-file` is loaded lazily, inside the render call, so it
// never enters the initial bundle — this module only imports its TYPES
// (erased at build time). No Angular imports; runs inside the render worker
// as well as the main thread.
//
// Formula capability (verified against node_modules/write-excel-file@4.1.1,
// modules/xlsx/files/sheet.xml/cell.js): a `{ type: 'Formula', value }` cell
// is written as a genuine `<f>…</f>` OOXML element — Excel/LibreOffice
// recalculate it on open. No fflate zip surgery is needed for formulas,
// unlike docx-renderer's timestamp scrub.
//
// Metadata hygiene: unlike `docx` (which hardcodes a `docProps/core.xml`
// creation timestamp docx-renderer.ts has to rewrite), write-excel-file
// emits no `docProps/core.xml` or `docProps/app.xml` at all — verified with
// a real-bytes smoke render (unzipped, no docProps/* present). There is
// nothing to scrub: no creator/producer string, no timestamp, because the
// library never writes one in the first place.
import type * as WriteExcelFileModule from 'write-excel-file/browser';

import { DocumentRenderError, RenderOptions } from '../document.types';
import {
  SheetCell,
  SheetColumn,
  SheetDef,
  SheetRow,
  SheetSpec,
  isFormulaCell,
  isValueCell,
} from './sheet-spec.types';

export type SheetLib = typeof WriteExcelFileModule;
export type SheetLoader = () => Promise<SheetLib>;
export type SheetRendererFn = (
  spec: SheetSpec,
  opts: RenderOptions,
) => Promise<Uint8Array>;

// `write-excel-file` has no root package export (only `/browser`, `/node`,
// `/universal`, `/utility` subpaths — verified against its package.json
// `exports` map), so the bare specifier `write-excel-file` cannot resolve.
const defaultLoader: SheetLoader = () => import('write-excel-file/browser');

type LibSheet = WriteExcelFileModule.Sheet<Blob>;
type LibCell = WriteExcelFileModule.CellObject;

const scalarConstructor = (
  value: string | number | boolean,
): StringConstructor | NumberConstructor | BooleanConstructor => {
  switch (typeof value) {
    case 'string':
      return String;
    case 'number':
      return Number;
    default:
      return Boolean;
  }
};

// isAllStringHeaderRow drives the "bold header row" rule (spec §5.3): a
// first row where every cell resolves to a string reads as a header even
// without an explicit `freezeHeader` flag.
const isAllStringHeaderRow = (row: SheetRow | undefined): boolean => {
  if (!row || row.length === 0) {
    return false;
  }
  return row.every((cell) => {
    if (isFormulaCell(cell)) {
      return false;
    }
    const value = isValueCell(cell) ? cell.v : cell;
    return typeof value === 'string';
  });
};

// mapCell maps one spec cell to write-excel-file's cell-object shape.
// `columns` has no per-column `numFmt` in the library (only `width` —
// verified against types/SheetOptions.d.ts), so a column-level `numFmt` is
// propagated down to each cell in that column here, overridden by any
// cell-level `numFmt`. write-excel-file rejects any non-"@" format on a
// String-typed cell (verified: "The only supported `format` for a cell of
// type `String` is \"@\"" thrown at write time), so a column numFmt meant
// for its numeric rows must never leak onto a string cell in the same
// column (e.g. a text label sharing a column with currency values).
function columnFormatFor(
  colIndex: number,
  columns: SheetColumn[] | undefined,
  isString: boolean,
): string | undefined {
  return isString ? undefined : columns?.[colIndex]?.numFmt;
}

function mapCell(
  cell: SheetCell,
  colIndex: number,
  headerBold: boolean,
  columns: SheetColumn[] | undefined,
): LibCell {
  if (isFormulaCell(cell)) {
    return {
      type: 'Formula',
      value: cell.f,
      format: columnFormatFor(colIndex, columns, false),
      fontWeight: headerBold ? 'bold' : undefined,
    };
  }

  if (isValueCell(cell)) {
    const isString = typeof cell.v === 'string';
    return {
      type: scalarConstructor(cell.v),
      value: cell.v,
      format: cell.numFmt ?? columnFormatFor(colIndex, columns, isString),
      fontWeight: cell.bold || headerBold ? 'bold' : undefined,
    };
  }

  const isString = typeof cell === 'string';
  return {
    type: scalarConstructor(cell),
    value: cell,
    format: columnFormatFor(colIndex, columns, isString),
    fontWeight: headerBold ? 'bold' : undefined,
  };
}

function mapSheet(sheet: SheetDef): LibSheet {
  const headerBold = sheet.freezeHeader === true || isAllStringHeaderRow(sheet.rows[0]);
  const data = sheet.rows.map((row, rowIndex) =>
    row.map((cell, colIndex) =>
      mapCell(cell, colIndex, rowIndex === 0 && headerBold, sheet.columns),
    ),
  );

  return {
    sheet: sheet.name,
    data,
    columns: sheet.columns?.map((column) => ({ width: column.width })),
    stickyRowsCount: sheet.freezeHeader ? 1 : undefined,
  };
}

/**
 * createSheetRenderer builds a `DocumentRenderer['render']`-shaped function
 * over a `SheetSpec` instead of `DocIR` — xlsx isn't a prose document, so it
 * gets its own source type and its own facade (module README "Adding a
 * format" recipe). `loadLib` is injected so specs can supply a fake
 * write-excel-file-shaped module without ever importing the real library.
 */
export const createSheetRenderer = (
  loadLib: SheetLoader = defaultLoader,
): SheetRendererFn => {
  // `opts` is part of the shared render signature (title/header/footer/page —
  // all print-document concepts) but write-excel-file has no workbook-level
  // metadata surface to put any of it into (confirmed by the real-bytes
  // smoke render: no docProps/core.xml or docProps/app.xml at all). Kept in
  // the signature for parity with docx/pdf and so a future column/workbook
  // option has somewhere to land without a signature change.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return async (spec: SheetSpec, opts: RenderOptions): Promise<Uint8Array> => {
    if (spec.sheets.length === 0) {
      throw new DocumentRenderError('empty_document', 'Nothing to render');
    }

    try {
      const lib = await loadLib();
      const writeXlsxFile = lib.default;
      const sheets = spec.sheets.map(mapSheet);
      // Always the "multiple sheets" overload, even for a single sheet —
      // one call shape, no overload-selection branching.
      const result = await writeXlsxFile(sheets, {});
      const blob = await result.toBlob();
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (err) {
      if (err instanceof DocumentRenderError) {
        throw err;
      }
      throw new DocumentRenderError('render_failed', 'Failed to render xlsx document');
    }
  };
};

// Default instance used by the render worker; specs use createSheetRenderer
// directly with a fake loader instead.
export const renderSheet: SheetRendererFn = createSheetRenderer();
