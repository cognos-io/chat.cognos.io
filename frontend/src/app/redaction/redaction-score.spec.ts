import { describe, expect, it } from 'vitest';

import { scoreRedactionCorpus } from './redaction-score';
import { RedactionCandidate } from './redaction-types';

const candidate = (
  type: RedactionCandidate['type'],
  start: number,
  end: number,
): RedactionCandidate => ({
  type,
  detector: `${type}:test`,
  start,
  end,
  value: 'x',
  normalized: 'x',
  confidence: 'high',
});

describe('scoreRedactionCorpus', () => {
  it('computes precision and recall per type and overall', () => {
    const report = scoreRedactionCorpus(
      [
        {
          id: 'one',
          locale: 'en',
          text: 'mail a@b.io and card 4111111111111111',
          expected: [
            { type: 'email', start: 5, end: 11 },
            { type: 'credit_card', start: 21, end: 37 },
          ],
        },
      ],
      () => [
        candidate('email', 5, 11),
        candidate('credit_card', 21, 37),
        candidate('ip_address', 0, 4),
      ],
    );

    expect(report.overall.precision).toBeCloseTo(2 / 3);
    expect(report.overall.recall).toBe(1);
    expect(report.byType.email?.precision).toBe(1);
    expect(report.byType.ip_address?.precision).toBe(0);
  });

  it('fails thresholds when a detector precision drops too low', () => {
    const report = scoreRedactionCorpus(
      [
        {
          id: 'one',
          locale: 'en',
          text: 'safe text',
          expected: [],
        },
      ],
      () => [candidate('email', 0, 4)],
      { email: { precision: 0.99, recall: 0 } },
    );

    expect(report.thresholdFailures).toEqual([
      'email precision 0.000 below threshold 0.990',
    ]);
  });
});
