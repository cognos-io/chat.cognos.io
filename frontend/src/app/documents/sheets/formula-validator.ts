// Hand-rolled XLSX formula validator (spec docs/specs/document-generation.md
// §5.3, Decision 11 — `hyperformula` is GPLv3 and excluded on principle; no
// permissively-licensed full evaluator exists, so this is reference-topology
// checking only, never evaluation). No Angular imports — runs inside the
// render worker as well as the main thread.
import { SheetCell, SheetDef, SheetSpec, isFormulaCell } from './sheet-spec.types';

export type SheetWarningKind =
  | 'blocked_function'
  | 'ref_out_of_range'
  | 'unknown_sheet';

export interface SheetWarning {
  readonly sheet: string;
  readonly cell: string;
  readonly kind: SheetWarningKind;
  readonly detail: string;
}

// Principle 4 (spec §3): a generated file must never phone home or execute
// anything when opened. These built-in Excel functions can reach the network
// (WEBSERVICE, FILTERXML, RTD) or invoke arbitrary code (CALL, REGISTER, EXEC)
// or a link-like action (HYPERLINK) — all attacker-reachable via prompt
// injection into the model's document content. Matched case-insensitively,
// function-name-only (word boundary + immediately followed by `(`).
const BLOCKED_FUNCTIONS = [
  'WEBSERVICE',
  'FILTERXML',
  'HYPERLINK',
  'RTD',
  'CALL',
  'REGISTER',
  'EXEC',
] as const;
const BLOCKED_FUNCTION_RE = new RegExp(
  `\\b(${BLOCKED_FUNCTIONS.join('|')})\\s*\\(`,
  'i',
);

// Excel's legacy Dynamic Data Exchange formula shape is `=cmd|'/c calc'!A1` —
// a `|` anywhere in a formula is enough of a smell to block on, since no
// legitimate spec-emitted formula (SUM, AVERAGE, cell math) ever needs one.
const DDE_PIPE_CHAR = '|';

// Excel's own ceiling (XFD / 1,048,576) — refs beyond this aren't just
// "outside the emitted grid", they're not valid addresses at all.
const EXCEL_MAX_COLUMNS = 16_384; // XFD
const EXCEL_MAX_ROWS = 1_048_576;

// A1-style ref/range token, with an optional sheet qualifier: `B2`, `$B$2`,
// `A1:C10`, `Revenue!B2`, `'Q3 Data'!A1:B2`. Deliberately requires a row
// number (not just letters) so bare function names (`SUM`) never match; the
// word-boundary checks below additionally reject partial matches inside a
// longer identifier (`LOG10(`, `DEC2BIN(`) and outright function calls.
// Whole-column/row refs (`A:A`, `1:1`) have no row+column pair to bounds-check
// and are intentionally not matched — they pass through unchecked rather than
// producing a false positive; this is topology *checking*, not evaluation.
const SHEET_NAME_BARE = '[A-Za-z_][A-Za-z0-9_.]*';
const SHEET_NAME_QUOTED = "'(?:[^']|'')*'";
const CELL_ADDR = String.raw`\$?[A-Za-z]{1,3}\$?[0-9]{1,7}`;
const REF_TOKEN_RE = new RegExp(
  `(?:(${SHEET_NAME_QUOTED}|${SHEET_NAME_BARE})!)?(${CELL_ADDR})(?::(${CELL_ADDR}))?`,
  'g',
);
const IDENTIFIER_CHAR_RE = /[A-Za-z0-9_]/;

const columnLetters = (index: number): string => {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

// cellAddress computes the A1 address of the cell *containing* a formula
// (not a referenced cell) — this is what SheetWarning.cell reports, so a
// warning can be located without re-scanning the sheet.
const cellAddress = (rowIndex: number, colIndex: number): string =>
  `${columnLetters(colIndex)}${rowIndex + 1}`;

const columnIndex = (letters: string): number => {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1; // 0-based
};

const ADDRESS_RE = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/;

const parseAddress = (addr: string): { col: number; row: number } | null => {
  const match = ADDRESS_RE.exec(addr);
  if (!match) {
    return null;
  }
  return { col: columnIndex(match[1]), row: Number.parseInt(match[2], 10) - 1 };
};

const unquoteSheetName = (raw: string): string =>
  raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;

const sheetDimensions = (sheet: SheetDef): { rows: number; cols: number } => ({
  rows: sheet.rows.length,
  cols: sheet.rows.reduce((max, row) => Math.max(max, row.length), 0),
});

const findBlockedFunction = (formula: string): string | null => {
  const match = BLOCKED_FUNCTION_RE.exec(formula);
  if (match) {
    return `blocked function ${match[1].toUpperCase()}()`;
  }
  if (formula.includes(DDE_PIPE_CHAR)) {
    return 'possible DDE reference (pipe character in formula)';
  }
  return null;
};

interface RefIssue {
  kind: 'ref_out_of_range' | 'unknown_sheet';
  detail: string;
}

// checkReferences extracts every A1/range ref from `formula` and flags the
// ones that point at a sheet not in this spec, or a row/column beyond that
// sheet's actual emitted grid. Advisory only — no evaluation, no mutation;
// Excel/LibreOffice recalculate the real result on open.
const checkReferences = (
  formula: string,
  currentSheet: SheetDef,
  sheetsByName: Map<string, SheetDef>,
): RefIssue[] => {
  const issues: RefIssue[] = [];
  REF_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = REF_TOKEN_RE.exec(formula))) {
    const [full, sheetRaw, fromAddr, toAddr] = match;
    const start = match.index;
    const end = start + full.length;

    const before = start > 0 ? formula[start - 1] : '';
    if (IDENTIFIER_CHAR_RE.test(before)) {
      continue; // part of a longer identifier, e.g. the tail of a name
    }
    const immediatelyAfter = formula[end] ?? '';
    if (IDENTIFIER_CHAR_RE.test(immediatelyAfter)) {
      continue; // mid-identifier match, e.g. "DEC2" inside "DEC2BIN("
    }
    let peek = end;
    while (formula[peek] === ' ') {
      peek++;
    }
    if (formula[peek] === '(') {
      continue; // function call, e.g. "SUM(" or "LOG10("
    }

    const sheetName = sheetRaw ? unquoteSheetName(sheetRaw) : currentSheet.name;
    const targetSheet = sheetsByName.get(sheetName);
    if (!targetSheet) {
      issues.push({
        kind: 'unknown_sheet',
        detail: `references unknown sheet "${sheetName}"`,
      });
      continue;
    }

    const dims = sheetDimensions(targetSheet);
    const addresses = toAddr ? [fromAddr, toAddr] : [fromAddr];
    for (const addr of addresses) {
      const parsed = parseAddress(addr);
      if (!parsed) {
        continue;
      }
      const outOfRange =
        parsed.col >= EXCEL_MAX_COLUMNS ||
        parsed.row >= EXCEL_MAX_ROWS ||
        parsed.col >= dims.cols ||
        parsed.row >= dims.rows;
      if (outOfRange) {
        const qualified = sheetRaw ? `${sheetName}!${addr}` : addr;
        issues.push({
          kind: 'ref_out_of_range',
          detail: `${qualified} is outside sheet "${sheetName}" (${dims.rows} rows x ${dims.cols} cols)`,
        });
        break;
      }
    }
  }

  return issues;
};

// downgradeFormulaCell replaces a blocked formula with a plain-text cell
// holding the formula source verbatim (prefixed with `=` so it visibly reads
// as "this was a formula") — the cell keeps its content, it just never
// executes (spec §3.5 "fail open"; §3.4 "zero network I/O").
const downgradeFormulaCell = (cell: SheetCell): SheetCell =>
  isFormulaCell(cell) ? `=${cell.f}` : cell;

/**
 * validateSheetSpec is pure: it never mutates `spec`. It returns a new spec
 * with blocked formulas downgraded to literal text, plus every warning
 * collected along the way (blocked-function hits and advisory reference
 * issues). The document still renders either way — nothing here throws.
 */
export const validateSheetSpec = (
  spec: SheetSpec,
): { spec: SheetSpec; warnings: SheetWarning[] } => {
  const warnings: SheetWarning[] = [];
  const sheetsByName = new Map(spec.sheets.map((sheet) => [sheet.name, sheet]));

  const sheets = spec.sheets.map((sheet) => {
    const rows = sheet.rows.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        if (!isFormulaCell(cell)) {
          return cell;
        }
        const address = cellAddress(rowIndex, colIndex);
        const blocked = findBlockedFunction(cell.f);
        if (blocked) {
          warnings.push({
            sheet: sheet.name,
            cell: address,
            kind: 'blocked_function',
            detail: blocked,
          });
          return downgradeFormulaCell(cell);
        }

        for (const issue of checkReferences(cell.f, sheet, sheetsByName)) {
          warnings.push({ sheet: sheet.name, cell: address, ...issue });
        }
        return cell;
      }),
    );
    return { ...sheet, rows };
  });

  return { spec: { ...spec, sheets }, warnings };
};
