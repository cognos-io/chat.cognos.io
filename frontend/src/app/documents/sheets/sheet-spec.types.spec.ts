import { describe, expect, it } from 'vitest';

import {
  SHEET_MAX_CELLS_TOTAL,
  SHEET_MAX_FORMULA_LENGTH,
  SHEET_MAX_ROWS_PER_SHEET,
  SHEET_MAX_SHEETS,
  cellScalarValue,
  isFormulaCell,
  isValueCell,
  parseSheetSpec,
} from './sheet-spec.types';

const minimalBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    sheets: [{ name: 'Sheet1', rows: [['a', 1]] }],
    ...overrides,
  });

describe('parseSheetSpec — happy paths', () => {
  it('parses a minimal valid spec', () => {
    const { spec, errors } = parseSheetSpec(minimalBody());
    expect(errors).toEqual([]);
    expect(spec).toEqual({ sheets: [{ name: 'Sheet1', rows: [['a', 1]] }] });
  });

  it('parses every cell union form in one row', () => {
    const body = JSON.stringify({
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            [
              'text',
              42,
              true,
              { f: 'SUM(A1:A2)' },
              { v: 'styled', numFmt: '#,##0', bold: true },
            ],
          ],
        },
      ],
    });

    const { spec, errors } = parseSheetSpec(body);
    expect(errors).toEqual([]);
    expect(spec?.sheets[0].rows[0]).toEqual([
      'text',
      42,
      true,
      { f: 'SUM(A1:A2)' },
      { v: 'styled', numFmt: '#,##0', bold: true },
    ]);
  });

  it('accepts freezeHeader and column width/numFmt', () => {
    const body = JSON.stringify({
      sheets: [
        {
          name: 'Sheet1',
          freezeHeader: true,
          columns: [{ width: 18 }, { width: 12, numFmt: '#,##0.00' }],
          rows: [['Month', 'Revenue']],
        },
      ],
    });

    const { spec, errors } = parseSheetSpec(body);
    expect(errors).toEqual([]);
    expect(spec?.sheets[0].freezeHeader).toBe(true);
    expect(spec?.sheets[0].columns).toEqual([
      { width: 18 },
      { width: 12, numFmt: '#,##0.00' },
    ]);
  });

  it('strips xlsx-forbidden characters from a sheet name', () => {
    const body = JSON.stringify({
      sheets: [{ name: 'Q1[Report]:Data*?/\\', rows: [['a', 1]] }],
    });
    const { spec, errors } = parseSheetSpec(body);
    expect(errors).toEqual([]);
    expect(spec?.sheets[0].name).toBe('Q1ReportData');
  });

  it('truncates a sheet name to the 31-char xlsx hard limit', () => {
    const longName = 'A'.repeat(50);
    const body = JSON.stringify({ sheets: [{ name: longName, rows: [['a', 1]] }] });
    const { spec, errors } = parseSheetSpec(body);
    expect(errors).toEqual([]);
    expect(spec?.sheets[0].name).toHaveLength(31);
    expect(spec?.sheets[0].name).toBe('A'.repeat(31));
  });

  it('treats an ISO date string as a plain string (v1: no native date type)', () => {
    const body = JSON.stringify({
      sheets: [{ name: 'Sheet1', rows: [['2026-07-04']] }],
    });
    const { spec, errors } = parseSheetSpec(body);
    expect(errors).toEqual([]);
    expect(spec?.sheets[0].rows[0][0]).toBe('2026-07-04');
  });
});

describe('parseSheetSpec — invalid paths', () => {
  it('never throws on garbage input', () => {
    expect(() => parseSheetSpec('not json at all')).not.toThrow();
    expect(() => parseSheetSpec('')).not.toThrow();
    expect(() => parseSheetSpec('{}')).not.toThrow();
    expect(() => parseSheetSpec('null')).not.toThrow();
  });

  it('fails on unparseable JSON with a machine-readable error', () => {
    const { spec, errors } = parseSheetSpec('{not json');
    expect(spec).toBeNull();
    expect(errors).toEqual(['root:invalid_json']);
  });

  it('fails when sheets is missing', () => {
    const { spec, errors } = parseSheetSpec('{}');
    expect(spec).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when a sheet name sanitises down to nothing', () => {
    const body = JSON.stringify({ sheets: [{ name: '[]:*?/\\', rows: [['a', 1]] }] });
    const { spec, errors } = parseSheetSpec(body);
    expect(spec).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when a row contains a non-cell value', () => {
    const body = JSON.stringify({
      sheets: [{ name: 'S', rows: [[{ nonsense: true }]] }],
    });
    const { spec, errors } = parseSheetSpec(body);
    expect(spec).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when a column width is out of the 1-255 bound', () => {
    const body = JSON.stringify({
      sheets: [{ name: 'S', columns: [{ width: 0 }], rows: [] }],
    });
    expect(parseSheetSpec(body).spec).toBeNull();

    const body2 = JSON.stringify({
      sheets: [{ name: 'S', columns: [{ width: 256 }], rows: [] }],
    });
    expect(parseSheetSpec(body2).spec).toBeNull();
  });
});

describe('parseSheetSpec — caps', () => {
  it('rejects more than SHEET_MAX_SHEETS sheets', () => {
    const sheets = Array.from({ length: SHEET_MAX_SHEETS + 1 }, (_, i) => ({
      name: `S${i}`,
      rows: [],
    }));
    const { spec, errors } = parseSheetSpec(JSON.stringify({ sheets }));
    expect(spec).toBeNull();
    expect(errors.some((e) => e.startsWith('sheets:too_many'))).toBe(true);
  });

  it('accepts exactly SHEET_MAX_SHEETS sheets', () => {
    const sheets = Array.from({ length: SHEET_MAX_SHEETS }, (_, i) => ({
      name: `S${i}`,
      rows: [],
    }));
    const { spec, errors } = parseSheetSpec(JSON.stringify({ sheets }));
    expect(errors).toEqual([]);
    expect(spec?.sheets).toHaveLength(SHEET_MAX_SHEETS);
  });

  it('rejects more than SHEET_MAX_ROWS_PER_SHEET rows in one sheet', () => {
    const rows = Array.from({ length: SHEET_MAX_ROWS_PER_SHEET + 1 }, () => ['x']);
    const body = JSON.stringify({ sheets: [{ name: 'S', rows }] });
    const { spec, errors } = parseSheetSpec(body);
    expect(spec).toBeNull();
    expect(errors.some((e) => e.includes('rows:too_many'))).toBe(true);
  });

  it('rejects more than SHEET_MAX_CELLS_TOTAL cells across sheets', () => {
    // One sheet at the row cap, each row wide enough to blow the cell total.
    const wideRow = Array.from(
      { length: Math.ceil(SHEET_MAX_CELLS_TOTAL / SHEET_MAX_ROWS_PER_SHEET) + 1 },
      () => 'x',
    );
    const rows = Array.from({ length: SHEET_MAX_ROWS_PER_SHEET }, () => wideRow);
    const body = JSON.stringify({ sheets: [{ name: 'S', rows }] });
    const { spec, errors } = parseSheetSpec(body);
    expect(spec).toBeNull();
    expect(errors.some((e) => e.startsWith('cells:too_many'))).toBe(true);
  });

  it('rejects a formula string over the 1KB cap', () => {
    const body = JSON.stringify({
      sheets: [
        { name: 'S', rows: [[{ f: 'A'.repeat(SHEET_MAX_FORMULA_LENGTH + 1) }]] },
      ],
    });
    const { spec, errors } = parseSheetSpec(body);
    expect(spec).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a formula string at exactly the 1KB cap', () => {
    const body = JSON.stringify({
      sheets: [{ name: 'S', rows: [[{ f: 'A'.repeat(SHEET_MAX_FORMULA_LENGTH) }]] }],
    });
    const { spec, errors } = parseSheetSpec(body);
    expect(errors).toEqual([]);
    expect(spec).not.toBeNull();
  });
});

describe('cell union type guards', () => {
  it.each([
    ['a string', 'text', false, false],
    ['a number', 42, false, false],
    ['a boolean', true, false, false],
    ['a formula cell', { f: 'SUM(A1)' }, true, false],
    ['a value cell', { v: 'x' }, false, true],
  ] as const)('classifies %s', (_label, cell, expectFormula, expectValue) => {
    expect(isFormulaCell(cell)).toBe(expectFormula);
    expect(isValueCell(cell)).toBe(expectValue);
  });

  it('cellScalarValue resolves every non-formula cell shape', () => {
    expect(cellScalarValue('text')).toBe('text');
    expect(cellScalarValue(42)).toBe(42);
    expect(cellScalarValue(true)).toBe(true);
    expect(cellScalarValue({ v: 'styled', bold: true })).toBe('styled');
    expect(cellScalarValue({ f: 'SUM(A1)' })).toBeUndefined();
  });
});
