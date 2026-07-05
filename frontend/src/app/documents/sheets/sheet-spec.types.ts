// Types + zod schema for the XLSX sheet body JSON (spec
// docs/specs/document-generation.md §6.3-§6.4). No Angular imports — this
// module runs inside the render worker as well as the main thread, and is
// parsed on every `<cog-doc format="xlsx">` body.
import { z } from 'zod';

// Spec §6.4 caps, enforced at parse time (never left to the renderer/library
// to discover, so failure is a clean translated error, not a stalled tab).
export const SHEET_MAX_SHEETS = 50;
export const SHEET_MAX_ROWS_PER_SHEET = 10_000;
export const SHEET_MAX_CELLS_TOTAL = 100_000;
export const SHEET_MAX_FORMULA_LENGTH = 1024;

// xlsx hard limit (31 chars) and the character set Excel refuses in a sheet
// name. Names are sanitised (stripped + truncated) rather than rejected —
// the model shouldn't have to know xlsx trivia to get a document back.
const MAX_SHEET_NAME_LENGTH = 31;
const XLSX_FORBIDDEN_SHEET_NAME_CHARS = /[[\]:*?/\\]/g;

const sheetNameSchema = z
  .string()
  .transform((name) =>
    name
      .replace(XLSX_FORBIDDEN_SHEET_NAME_CHARS, '')
      .trim()
      .slice(0, MAX_SHEET_NAME_LENGTH),
  )
  .pipe(z.string().min(1, 'sheet name is empty after sanitisation'));

const columnSchema = z
  .object({
    width: z.number().min(1).max(255).optional(),
    numFmt: z.string().max(64).optional(),
  })
  .strip();

// Dates arrive as ISO strings in v1 — JSON has no native date type, and a
// model can't emit one. Treating them as plain strings (rather than trying
// to sniff date-shaped strings and coerce them) keeps this schema honest
// about what the wire format actually is; numFmt-driven real Date cells are
// a later refinement once there's a reason to disambiguate "2026-07-04" the
// label from 2026-07-04 the date.
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const formulaCellSchema = z
  .object({
    f: z.string().max(SHEET_MAX_FORMULA_LENGTH),
  })
  .strip();

const valueCellSchema = z
  .object({
    v: scalarSchema,
    numFmt: z.string().max(64).optional(),
    bold: z.boolean().optional(),
  })
  .strip();

const cellSchema = z.union([scalarSchema, formulaCellSchema, valueCellSchema]);

const rowSchema = z.array(cellSchema);

const sheetSchema = z
  .object({
    name: sheetNameSchema,
    freezeHeader: z.boolean().optional(),
    columns: z.array(columnSchema).optional(),
    rows: z.array(rowSchema),
  })
  .strip();

const sheetSpecBodySchema = z
  .object({
    sheets: z.array(sheetSchema),
  })
  .strip();

export type SheetColumn = z.infer<typeof columnSchema>;
export type SheetScalar = z.infer<typeof scalarSchema>;
export type SheetFormulaCell = z.infer<typeof formulaCellSchema>;
export type SheetValueCell = z.infer<typeof valueCellSchema>;
export type SheetCell = z.infer<typeof cellSchema>;
export type SheetRow = SheetCell[];
export type SheetDef = z.infer<typeof sheetSchema>;
export type SheetSpec = z.infer<typeof sheetSpecBodySchema>;

export const isFormulaCell = (cell: SheetCell): cell is SheetFormulaCell =>
  typeof cell === 'object' && cell !== null && 'f' in cell;

export const isValueCell = (cell: SheetCell): cell is SheetValueCell =>
  typeof cell === 'object' && cell !== null && 'v' in cell;

// cellScalarValue returns the underlying scalar a cell resolves to — a plain
// scalar as-is, a `{v}` cell's value, or `undefined` for a formula cell
// (which has no static value to inspect).
export const cellScalarValue = (cell: SheetCell): SheetScalar | undefined => {
  if (isFormulaCell(cell)) {
    return undefined;
  }
  return isValueCell(cell) ? cell.v : cell;
};

const issueToErrorCode = (issue: z.ZodIssue): string => {
  const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
  return `${path}:${issue.code}`;
};

const enforceCaps = (spec: SheetSpec): string[] => {
  const errors: string[] = [];

  if (spec.sheets.length > SHEET_MAX_SHEETS) {
    errors.push(`sheets:too_many:${spec.sheets.length}>${SHEET_MAX_SHEETS}`);
  }

  let totalCells = 0;
  spec.sheets.forEach((sheet, sheetIndex) => {
    if (sheet.rows.length > SHEET_MAX_ROWS_PER_SHEET) {
      errors.push(
        `sheets.${sheetIndex}.rows:too_many:${sheet.rows.length}>${SHEET_MAX_ROWS_PER_SHEET}`,
      );
    }
    for (const row of sheet.rows) {
      totalCells += row.length;
    }
  });

  if (totalCells > SHEET_MAX_CELLS_TOTAL) {
    errors.push(`cells:too_many:${totalCells}>${SHEET_MAX_CELLS_TOTAL}`);
  }

  return errors;
};

/**
 * parseSheetSpec is total: it never throws. A malformed body, a schema
 * violation or a cap breach all come back as `{ spec: null, errors }` with
 * machine-readable, translatable error codes — the caller (the render
 * worker) turns that into the same fail-open UX every other document format
 * uses (spec docs/specs/document-generation.md §3.5).
 */
export const parseSheetSpec = (
  body: string,
): { spec: SheetSpec | null; errors: string[] } => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { spec: null, errors: ['root:invalid_json'] };
  }

  const result = sheetSpecBodySchema.safeParse(json);
  if (!result.success) {
    return { spec: null, errors: result.error.issues.map(issueToErrorCode) };
  }

  const capErrors = enforceCaps(result.data);
  if (capErrors.length > 0) {
    return { spec: null, errors: capErrors };
  }

  return { spec: result.data, errors: [] };
};
