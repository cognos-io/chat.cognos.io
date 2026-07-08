import { describe, expect, it } from 'vitest';

import {
  healthDetectorsForLocale,
  swissHealthInsuranceDetector,
} from './redaction-detectors-health';

function detect(text: string, locale = 'en') {
  return healthDetectorsForLocale(locale).flatMap((detector) => detector.detect(text));
}

describe('health detectors', () => {
  it('detects a Swiss health insurance card number', () => {
    const [candidate] = swissHealthInsuranceDetector.detect(
      'Card 80756012345678901234',
    );
    expect(candidate).toMatchObject({
      type: 'health',
      detector: 'ch-health-card:v1',
      confidence: 'high',
    });
  });

  it('flags medical prose as a health hint without selecting the whole sentence', () => {
    const [candidate] = detect('My diagnosis is asthma and I take medication.');
    expect(candidate).toMatchObject({
      type: 'health',
      detector: 'health-keyword:v1',
      value: 'diagnosis',
      confidence: 'medium',
    });
  });

  it('does not trigger on common homonyms without medical context', () => {
    expect(detect('The table condition in the report is green.')).toEqual([]);
  });
});
