import { describe, expect, it } from 'vitest';

import {
  chDrivingLicenceDetector,
  chPostFinanceDetector,
  passportDetector,
} from './redaction-detectors-structured-v2';

describe('v2 structured detectors', () => {
  it('detects supported passport formats and ignores ordinary IDs', () => {
    expect(passportDetector.detect('Passport CH X1234567')[0]).toMatchObject({
      type: 'passport',
      normalized: 'CHX1234567',
    });
    expect(passportDetector.detect('ticket ABC-12345')).toEqual([]);
  });

  it('detects Swiss driving licence numbers', () => {
    expect(chDrivingLicenceDetector.detect('Licence 123456789')[0]).toMatchObject({
      type: 'ch_driving_licence',
      normalized: '123456789',
    });
    expect(chDrivingLicenceDetector.detect('order 123456789')).toEqual([]);
  });

  it('detects PostFinance account numbers only near banking context', () => {
    expect(
      chPostFinanceDetector.detect('PostFinance account 12-345678-9')[0],
    ).toMatchObject({
      type: 'ch_postfinance',
      normalized: '12-345678-9',
    });
    expect(chPostFinanceDetector.detect('version 12-345678-9')).toEqual([]);
  });
});
