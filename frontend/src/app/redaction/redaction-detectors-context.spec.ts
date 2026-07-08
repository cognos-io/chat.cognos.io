import { describe, expect, it } from 'vitest';

import { contextDetectorsForLocale } from './redaction-detectors-context';

function detect(text: string, locale = 'en') {
  return contextDetectorsForLocale(locale).flatMap((detector) => detector.detect(text));
}

describe('contextDetectorsForLocale', () => {
  it('promotes a local phone-shaped number near a phone keyword', () => {
    const [candidate] = detect('Please call mobile 079 123 45 67 tomorrow.');
    expect(candidate).toMatchObject({
      type: 'phone',
      normalized: '0791234567',
      confidence: 'medium',
    });
  });

  it('does not promote the same number without context', () => {
    expect(detect('Reference 079 123 45 67 was printed.')).toEqual([]);
  });

  it('detects dates of birth near localised birth keywords', () => {
    expect(detect('Geboren am 04.07.1986', 'de')[0]).toMatchObject({
      type: 'dob',
      confidence: 'medium',
    });
    expect(detect('né le 04/07/1986', 'fr')[0]).toMatchObject({
      type: 'dob',
      confidence: 'medium',
    });
  });

  it('does not treat bare dates or version strings as DOBs', () => {
    expect(detect('Release 04.07.1986 shipped')).toEqual([]);
    expect(detect('Version 1.2.3 is available')).toEqual([]);
  });
});
