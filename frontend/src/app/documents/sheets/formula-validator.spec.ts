import { describe, expect, it } from 'vitest';

import { SheetWarning, validateSheetSpec } from './formula-validator';
import { SheetSpec } from './sheet-spec.types';

const specWithFormula = (
  formula: string,
  overrides: Partial<SheetSpec> = {},
): SheetSpec => ({
  sheets: [
    {
      name: 'Sheet1',
      rows: [
        ['Month', 'Revenue'],
        ['January', 100],
        ['Total', { f: formula }],
      ],
    },
  ],
  ...overrides,
});

const warningsFor = (
  formula: string,
  overrides: Partial<SheetSpec> = {},
): SheetWarning[] => validateSheetSpec(specWithFormula(formula, overrides)).warnings;

describe('validateSheetSpec — security blocklist', () => {
  it.each([
    'WEBSERVICE("http://evil.example/x")',
    'webservice("http://evil.example/x")',
    'WebService("http://evil.example/x")',
    'FILTERXML(A1, "//x")',
    'HYPERLINK("http://evil.example", "click")',
    'RTD("server", "topic", "item")',
    'CALL("some.dll", "fn", "J")',
    'REGISTER("some.dll", "fn", "J")',
    'EXEC("calc.exe")',
  ])('downgrades %s to literal text with a blocked_function warning', (formula) => {
    const { spec, warnings } = validateSheetSpec(specWithFormula(formula));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      sheet: 'Sheet1',
      cell: 'B3',
      kind: 'blocked_function',
    });
    expect(spec.sheets[0].rows[2][1]).toBe(`=${formula}`);
  });

  it('blocks a DDE-style pipe formula', () => {
    const formula = "cmd|'/c calc'!A1";
    const { spec, warnings } = validateSheetSpec(specWithFormula(formula));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('blocked_function');
    expect(spec.sheets[0].rows[2][1]).toBe(`=${formula}`);
  });

  it('the document still renders (spec is returned, not thrown)', () => {
    expect(() => validateSheetSpec(specWithFormula('EXEC("calc.exe")'))).not.toThrow();
  });

  it('leaves a benign formula untouched (no false positive)', () => {
    const { spec, warnings } = validateSheetSpec(specWithFormula('SUM(B2:B2)'));
    expect(warnings).toEqual([]);
    expect(spec.sheets[0].rows[2][1]).toEqual({ f: 'SUM(B2:B2)' });
  });
});

describe('validateSheetSpec — reference checking', () => {
  it('accepts an in-range same-sheet ref', () => {
    expect(warningsFor('SUM(B2:B2)')).toEqual([]);
  });

  it('flags an out-of-range same-sheet ref', () => {
    const warnings = warningsFor('SUM(B10:B20)');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      sheet: 'Sheet1',
      cell: 'B3',
      kind: 'ref_out_of_range',
    });
  });

  it('does not treat a function name like SUM( as a ref', () => {
    // "SUM" has no trailing digits so it never matches the ref token shape;
    // this asserts no *false* ref warning is produced for the call itself,
    // only (if anything) for its actual argument reference.
    expect(warningsFor('SUM(B2:B2)')).toEqual([]);
  });

  it('does not mistake a digit-suffixed function name (LOG10) for a ref', () => {
    const spec: SheetSpec = {
      sheets: [{ name: 'Sheet1', rows: [['x', { f: 'LOG10(100)' }]] }],
    };
    expect(validateSheetSpec(spec).warnings).toEqual([]);
  });

  it('supports $-absolute refs', () => {
    expect(warningsFor('SUM($B$2:$B$2)')).toEqual([]);
    expect(warningsFor('SUM($B$10:$B$20)')).toHaveLength(1);
  });

  it('accepts a valid cross-sheet ref to a bare sheet name', () => {
    const spec: SheetSpec = {
      sheets: [
        { name: 'Sheet1', rows: [['Total', { f: 'SUM(Revenue!B1:B2)' }]] },
        {
          name: 'Revenue',
          rows: [
            ['x', 1],
            ['y', 2],
          ],
        },
      ],
    };
    expect(validateSheetSpec(spec).warnings).toEqual([]);
  });

  it('accepts a valid cross-sheet ref to a quoted sheet name with spaces', () => {
    const spec: SheetSpec = {
      sheets: [
        { name: 'Sheet1', rows: [['Total', { f: "SUM('Q3 Data'!A1:B2)" }]] },
        {
          name: 'Q3 Data',
          rows: [
            ['a', 'b'],
            ['c', 'd'],
          ],
        },
      ],
    };
    expect(validateSheetSpec(spec).warnings).toEqual([]);
  });

  it('flags a ref to an unknown sheet', () => {
    const spec: SheetSpec = {
      sheets: [{ name: 'Sheet1', rows: [['Total', { f: 'SUM(NoSuchSheet!A1:B2)' }]] }],
    };
    const { warnings } = validateSheetSpec(spec);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      sheet: 'Sheet1',
      cell: 'B1',
      kind: 'unknown_sheet',
    });
  });

  it('flags an unknown quoted sheet name', () => {
    const spec: SheetSpec = {
      sheets: [{ name: 'Sheet1', rows: [['Total', { f: "SUM('Nope Sheet'!A1)" }]] }],
    };
    const { warnings } = validateSheetSpec(spec);
    expect(warnings[0].kind).toBe('unknown_sheet');
  });

  it('formula is preserved (not downgraded) on an advisory ref warning', () => {
    const { spec, warnings } = validateSheetSpec(specWithFormula('SUM(B10:B20)'));
    expect(warnings[0].kind).toBe('ref_out_of_range');
    expect(spec.sheets[0].rows[2][1]).toEqual({ f: 'SUM(B10:B20)' });
  });

  it('checks both ends of a range independently', () => {
    // in-range start, out-of-range end
    const warnings = warningsFor('SUM(B1:B99)');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('ref_out_of_range');
  });

  it('handles an empty formula without error or warnings', () => {
    const { spec, warnings } = validateSheetSpec(specWithFormula(''));
    expect(warnings).toEqual([]);
    expect(spec.sheets[0].rows[2][1]).toEqual({ f: '' });
  });

  it('handles a formula at the 1KB length cap without error', () => {
    const formula = `SUM(B2:B2)${' '.repeat(1024 - 'SUM(B2:B2)'.length)}`;
    expect(() => validateSheetSpec(specWithFormula(formula))).not.toThrow();
  });
});

describe('validateSheetSpec — purity', () => {
  it('does not mutate the input spec', () => {
    const spec = specWithFormula('EXEC("calc.exe")');
    const before = JSON.parse(JSON.stringify(spec));
    validateSheetSpec(spec);
    expect(spec).toEqual(before);
  });
});
